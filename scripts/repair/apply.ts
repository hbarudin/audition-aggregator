import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as readline from 'readline';
import { commentOnIssue, closeIssue, addLabel } from '../../scraper/github';

/**
 * Applies a reviewed decision sheet from triage.ts.
 *
 *   npx tsx scripts/repair/apply.ts repair/decisions-2026-11-05.tsv [--yes]
 *   npx tsx scripts/repair/apply.ts <sheet> --accept-recommended <verdict|all>
 *
 * Decision column values:
 *   ?            leave alone (the default; nothing is written)
 *   y            accept the row's recommendation
 *   url          use candidate_url: set it, re-activate, close the issue
 *   url:<URL>    use an explicit URL instead of the candidate
 *   reactivate   the current URL works; re-activate and close the issue
 *   close        close the issue only; no database change
 *   playwright   keep the issue open, tag it needs-playwright
 *   retire       deactivate permanently, note why, close the issue as not-planned
 *   skip         leave the issue open, no change
 *
 * `retire` is never auto-filled by --accept-recommended; it must be typed per row.
 */

type Action = 'url' | 'reactivate' | 'close' | 'playwright' | 'retire' | 'skip';

interface Row {
  decision: string;
  theater: string;
  theater_id: string;
  issue: string;
  verdict: string;
  recommended: string;
  current_url: string;
  candidate_url: string;
  found_via: string;
  temporary: string;
  current: string;
  undated: string;
  past: string;
  sample: string;
  evidence: string;
}

const hasFlag = (n: string) => process.argv.includes(`--${n}`);
function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function parseSheet(file: string): Row[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const header = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    const row = {} as Record<string, string>;
    header.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()));
    return row as unknown as Row;
  });
}

/** Resolve a decision cell into a concrete action plus an explicit URL if given. */
function resolve(row: Row, acceptVerdict: string | undefined): { action: Action; url?: string } | null {
  let d = row.decision.toLowerCase();

  // Bulk-accept a reviewed batch: only the named verdict (or "all"), never retire.
  if (d === '?' && acceptVerdict) {
    const matches = acceptVerdict === 'all' || row.verdict.toLowerCase() === acceptVerdict.toLowerCase();
    if (matches && row.recommended !== 'retire' && row.recommended !== 'review') d = 'y';
  }

  if (d === '?' || d === '' || d === 'skip') return null;
  if (d === 'y') d = row.recommended.toLowerCase();

  if (d.startsWith('url:')) return { action: 'url', url: row.decision.slice(4).trim() };
  if (d === 'url') {
    if (!row.candidate_url) {
      console.log(`  ! ${row.theater}: decision "url" but no candidate_url on the row; skipping`);
      return null;
    }
    return { action: 'url', url: row.candidate_url };
  }
  if (d === 'reactivate') return { action: 'reactivate', url: row.current_url };
  if (['close', 'playwright', 'retire'].includes(d)) return { action: d as Action };
  if (d === 'review') return null; // triage wants a human; not actionable yet

  console.log(`  ! ${row.theater}: unrecognized decision "${row.decision}"; skipping`);
  return null;
}

/**
 * Target exactly one theater row. Prefer the id from the sheet; theater names
 * are not unique ("Phoenix Theatre" appears twice), so a name-keyed update
 * would silently change both.
 */
function theaterQuery(supabase: SupabaseClient, row: Row) {
  if (!row.theater_id) {
    console.log(`  ! ${row.theater}: no theater_id on the row; falling back to a name match`);
  }
  return {
    update: (values: Record<string, unknown>) => {
      const q = supabase.from('theaters').update(values);
      return row.theater_id ? q.eq('id', row.theater_id) : q.eq('name', row.theater);
    },
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((res) => rl.question(question, res));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: npx tsx scripts/repair/apply.ts <decision-sheet.tsv> [--yes] [--accept-recommended <verdict|all>]');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const rows = parseSheet(file);
  const acceptVerdict = arg('accept-recommended');
  const planned = rows
    .map((row) => ({ row, plan: resolve(row, acceptVerdict) }))
    .filter((p): p is { row: Row; plan: { action: Action; url?: string } } => p.plan !== null);

  if (planned.length === 0) {
    console.log(`No actionable rows in ${file}. Mark a decision column and re-run.`);
    return;
  }

  console.log(`\nPlanned changes from ${file}:\n`);
  for (const { row, plan } of planned) {
    const target = plan.url ? ` → ${plan.url}` : '';
    console.log(`  ${plan.action.toUpperCase().padEnd(10)} ${row.theater} (#${row.issue})${target}`);
  }
  const retiring = planned.filter((p) => p.plan.action === 'retire');
  if (retiring.length) {
    console.log(`\n  ${retiring.length} theater(s) will be RETIRED (is_active=false, issue closed as not-planned).`);
  }
  console.log(`\n${planned.length} row(s) will be written to Supabase and GitHub.`);

  if (!hasFlag('yes')) {
    if (!(await confirm('Type "yes" to apply: '))) {
      console.log('Aborted; nothing was written.');
      return;
    }
  }

  let applied = 0;
  let failed = 0;

  for (const { row, plan } of planned) {
    const issueNum = parseInt(row.issue, 10);
    console.log(`\n${row.theater} — ${plan.action}`);

    try {
      if (plan.action === 'url' || plan.action === 'reactivate') {
        const update: Record<string, unknown> = { is_active: true };
        if (plan.url) update.audition_page_url = plan.url;

        const { error } = await theaterQuery(supabase, row).update(update);
        if (error) throw new Error(`DB update failed: ${error.message}`);
        console.log(`  → DB: is_active=true${plan.url ? `, url=${plan.url}` : ''}`);

        if (Number.isFinite(issueNum)) {
          const body = plan.action === 'reactivate'
            ? `Repaired by the theater-repair workflow.\n\nThe URL on record is reachable, so the deactivation no longer applies. Theater re-activated; no URL change.\n\n**URL:** ${row.current_url}\n**Parsed:** ${row.current} current audition(s), ${row.undated} undated, ${row.past} past\n**Finding:** ${row.evidence}`
            : `Repaired by the theater-repair workflow.\n\n**Old URL:** ${row.current_url}\n**New URL:** ${plan.url}\n**Found via:** ${row.found_via || 'n/a'}\n**Parsed:** ${row.current} current audition(s), ${row.undated} undated, ${row.past} past\n**Sample:** ${row.sample || 'n/a'}\n\nTheater re-activated and will be picked up by the next scrape.${row.temporary ? '\n\n⚠️ This URL looks tied to a single show or season, so expect it to break again once that run ends.' : ''}`;
          await commentOnIssue(issueNum, body);
          await closeIssue(issueNum, 'completed');
          console.log(`  → Issue #${issueNum} commented and closed`);
        }
      } else if (plan.action === 'retire') {
        const reason = `Retired by theater-repair workflow on ${new Date().toISOString().split('T')[0]}: ${row.evidence}`;
        const { error } = await theaterQuery(supabase, row).update({ is_active: false, notes: reason });
        if (error) throw new Error(`DB update failed: ${error.message}`);
        console.log(`  → DB: is_active=false, reason recorded in notes`);

        if (Number.isFinite(issueNum)) {
          await commentOnIssue(issueNum, `Retired by the theater-repair workflow.\n\n**URL on record:** ${row.current_url}\n**Finding:** ${row.evidence}\n\nNo working audition page could be found, so this theater is deactivated. Re-open if it comes back.`);
          await closeIssue(issueNum, 'not_planned');
          console.log(`  → Issue #${issueNum} closed as not-planned`);
        }
      } else if (plan.action === 'playwright') {
        if (Number.isFinite(issueNum)) {
          await addLabel(issueNum, 'needs-playwright');
          await commentOnIssue(issueNum, `Triaged by the theater-repair workflow: **bot-blocked**.\n\n**URL:** ${row.current_url}\n**Finding:** ${row.evidence}\n\nPlain \`fetch\` cannot reach this site. Tagged \`needs-playwright\`; the issue stays open and the theater stays inactive until the Playwright fetch path exists.`);
          console.log(`  → Issue #${issueNum} tagged needs-playwright, left open`);
        }
      } else if (plan.action === 'close') {
        if (Number.isFinite(issueNum)) {
          await commentOnIssue(issueNum, `Closed by the theater-repair workflow: the underlying condition no longer holds.\n\n**Finding:** ${row.evidence}`);
          await closeIssue(issueNum, 'completed');
          console.log(`  → Issue #${issueNum} closed`);
        }
      }
      applied++;
    } catch (err) {
      console.error(`  ! FAILED: ${err}`);
      failed++;
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Applied: ${applied}`);
  console.log(`Failed:  ${failed}`);
  if (applied) console.log(`\nRe-run triage to refresh the sheet, or run the scraper to pick up re-activated theaters.`);
}

main();
