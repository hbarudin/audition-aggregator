import { SupabaseClient } from '@supabase/supabase-js';
import { commentOnIssue, closeIssue, addLabel } from '../../scraper/github';

/**
 * The write half of the theater-repair workflow, shared by the CLI
 * (scripts/repair/apply.ts) and the admin GUI (/admin/repair) so the two can
 * never drift. Deciding *what* to do is the caller's job; this performs one
 * already-decided action and reports what happened.
 */

export type RepairAction = 'url' | 'reactivate' | 'close' | 'playwright' | 'retire';

export interface RepairTarget {
  theaterId: string;
  theaterName: string;
  issueNumber: number | null;
  currentUrl: string | null;
  /** The URL to store, for the `url` action. */
  newUrl?: string | null;
  foundVia?: string | null;
  temporary?: boolean;
  currentDated?: number;
  undated?: number;
  staleDated?: number;
  sample?: string | null;
  evidence: string;
}

export interface RepairResult {
  /** Carried through so callers never have to match results back by name. */
  theaterId: string;
  theaterName: string;
  action: RepairAction;
  ok: boolean;
  detail: string;
}

/**
 * Target exactly one theater row. Theater names are not unique ("Phoenix
 * Theatre" appears twice), so every write keys on the id.
 */
function updateTheater(supabase: SupabaseClient, id: string, values: Record<string, unknown>) {
  return supabase.from('theaters').update(values).eq('id', id);
}

function parsedLine(t: RepairTarget): string {
  return `**Parsed:** ${t.currentDated ?? 0} current audition(s), ${t.undated ?? 0} undated, ${t.staleDated ?? 0} past`;
}

export async function applyDecision(
  supabase: SupabaseClient,
  action: RepairAction,
  target: RepairTarget
): Promise<RepairResult> {
  const done = (ok: boolean, detail: string): RepairResult => ({
    theaterId: target.theaterId,
    theaterName: target.theaterName,
    action,
    ok,
    detail,
  });

  try {
    if (action === 'url' || action === 'reactivate') {
      const values: Record<string, unknown> = { is_active: true };
      const url = action === 'url' ? target.newUrl?.trim() : undefined;

      if (action === 'url') {
        if (!url) return done(false, 'No URL given for a "url" decision.');
        try {
          new URL(url);
        } catch {
          return done(false, `Not a valid URL: ${url}`);
        }
        values.audition_page_url = url;
      }

      const { error } = await updateTheater(supabase, target.theaterId, values);
      if (error) return done(false, `Database update failed: ${error.message}`);

      if (target.issueNumber) {
        const body =
          action === 'reactivate'
            ? `Repaired by the theater-repair workflow.\n\nThe URL on record is reachable, so the deactivation no longer applies. Theater re-activated; no URL change.\n\n**URL:** ${target.currentUrl}\n${parsedLine(target)}\n**Finding:** ${target.evidence}`
            : `Repaired by the theater-repair workflow.\n\n**Old URL:** ${target.currentUrl}\n**New URL:** ${url}\n**Found via:** ${target.foundVia ?? 'n/a'}\n${parsedLine(target)}\n**Sample:** ${target.sample || 'n/a'}\n\nTheater re-activated and will be picked up by the next scrape.${
                target.temporary
                  ? '\n\n⚠️ This URL looks tied to a single show or season, so expect it to break again once that run ends.'
                  : ''
              }`;
        await commentOnIssue(target.issueNumber, body);
        await closeIssue(target.issueNumber, 'completed');
      }

      return done(
        true,
        action === 'url'
          ? `Re-activated, URL set to ${url}${target.issueNumber ? `, issue #${target.issueNumber} closed` : ''}`
          : `Re-activated, URL unchanged${target.issueNumber ? `, issue #${target.issueNumber} closed` : ''}`
      );
    }

    if (action === 'retire') {
      const reason = `Retired by theater-repair workflow on ${new Date().toISOString().split('T')[0]}: ${target.evidence}`;
      const { error } = await updateTheater(supabase, target.theaterId, {
        is_active: false,
        notes: reason,
      });
      if (error) return done(false, `Database update failed: ${error.message}`);

      if (target.issueNumber) {
        await commentOnIssue(
          target.issueNumber,
          `Retired by the theater-repair workflow.\n\n**URL on record:** ${target.currentUrl}\n**Finding:** ${target.evidence}\n\nNo working audition page could be found, so this theater is deactivated. Re-open if it comes back.`
        );
        await closeIssue(target.issueNumber, 'not_planned');
      }
      return done(true, `Retired${target.issueNumber ? `, issue #${target.issueNumber} closed as not-planned` : ''}`);
    }

    if (action === 'playwright') {
      if (!target.issueNumber) return done(false, 'No issue to tag.');
      await addLabel(target.issueNumber, 'needs-playwright');
      await commentOnIssue(
        target.issueNumber,
        `Triaged by the theater-repair workflow: **bot-blocked**.\n\n**URL:** ${target.currentUrl}\n**Finding:** ${target.evidence}\n\nPlain \`fetch\` cannot reach this site. Tagged \`needs-playwright\`; the issue stays open and the theater stays inactive until the Playwright fetch path exists.`
      );
      return done(true, `Issue #${target.issueNumber} tagged needs-playwright, left open`);
    }

    // action === 'close'
    if (!target.issueNumber) return done(false, 'No issue to close.');
    await commentOnIssue(
      target.issueNumber,
      `Closed by the theater-repair workflow: the underlying condition no longer holds.\n\n**Finding:** ${target.evidence}`
    );
    await closeIssue(target.issueNumber, 'completed');
    return done(true, `Issue #${target.issueNumber} closed`);
  } catch (err) {
    return done(false, `${err}`);
  }
}
