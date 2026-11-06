'use server';

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { isAdmin } from '@/lib/admin';
import { applyDecision, RepairAction, RepairResult } from '@/lib/repair/apply';
import { readApplied, readReport, recordApplied } from '@/lib/repair/report';

function serverClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export type ApplyState = { results: RepairResult[] } | { error: string } | null;

const ACTIONS: RepairAction[] = ['url', 'reactivate', 'close', 'playwright', 'retire'];

/**
 * Applies the decisions chosen in the GUI. The findings are re-read from the
 * report on the server rather than trusted from the form, so a tampered
 * submission cannot smuggle in its own evidence or point a write at a
 * different theater. Only the decision and any typed URL come from the client.
 */
export async function applyDecisions(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  // Server Functions are reachable by direct POST, so authorization is checked
  // here and not only on the page that renders the form.
  if (!(await isAdmin())) return { error: 'Unauthorized.' };

  const reportFile = formData.get('report');
  if (typeof reportFile !== 'string') return { error: 'No report specified.' };

  const report = readReport(reportFile);
  if (!report) return { error: `Could not read report ${reportFile}.` };

  const byId = new Map(report.findings.map((f) => [f.theaterId, f]));
  // Applying the same decision twice posts a duplicate comment and re-closes a
  // closed issue, so a theater already written for this report is refused even
  // if the form still offers it.
  const alreadyApplied = new Set(readApplied(reportFile).map((a) => a.theaterId));
  const supabase = serverClient();
  const results: RepairResult[] = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('decision:') || typeof value !== 'string' || !value) continue;

    const theaterId = key.slice('decision:'.length);
    const finding = byId.get(theaterId);
    if (!finding) continue;
    if (alreadyApplied.has(theaterId)) {
      results.push({
        theaterId: finding.theaterId,
        theaterName: finding.theaterName,
        action: 'close',
        ok: false,
        detail: 'Already applied for this report; skipped to avoid writing twice.',
      });
      continue;
    }

    let action = value;
    let newUrl: string | null = finding.recommendedUrl;

    if (value === 'url:custom') {
      action = 'url';
      const typed = formData.get(`url:${theaterId}`);
      newUrl = typeof typed === 'string' ? typed.trim() : '';
    }

    if (!ACTIONS.includes(action as RepairAction)) continue;

    results.push(
      await applyDecision(supabase, action as RepairAction, {
        theaterId: finding.theaterId,
        theaterName: finding.theaterName,
        issueNumber: finding.issueNumber,
        currentUrl: finding.currentUrl,
        newUrl,
        foundVia: finding.candidateSource,
        temporary: finding.looksTemporary,
        currentDated: finding.currentDated,
        undated: finding.undated,
        staleDated: finding.staleDated,
        sample: finding.sample,
        evidence: finding.evidence,
      })
    );
  }

  if (results.length === 0) {
    return { error: 'Nothing was selected, so nothing was changed.' };
  }

  const now = new Date().toISOString();
  recordApplied(
    reportFile,
    results
      .filter((r) => r.ok)
      .map((r) => ({
        theaterId: r.theaterId,
        theaterName: r.theaterName,
        action: r.action,
        detail: r.detail,
        at: now,
      }))
  );

  revalidatePath('/admin/repair');
  revalidatePath('/theaters');
  return { results };
}
