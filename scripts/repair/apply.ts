import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as readline from 'readline';
import { applyDecision, RepairAction, RepairTarget } from '../../lib/repair/apply';

/**
 * Applies a reviewed decision sheet from triage.ts. The GUI at /admin/repair
 * does the same job; both call lib/repair/apply.ts so they cannot drift.
 *
 *   npx tsx scripts/repair/apply.ts repair/decisions-2026-11-06.tsv [--yes]
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
function resolve(row: Row, acceptVerdict: string | undefined): { action: RepairAction; url?: string } | null {
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
  if (d === 'reactivate') return { action: 'reactivate' };
  if (['close', 'playwright', 'retire'].includes(d)) return { action: d as RepairAction };
  if (d === 'review') return null; // triage wants a human; not actionable yet

  console.log(`  ! ${row.theater}: unrecognized decision "${row.decision}"; skipping`);
  return null;
}

function toTarget(row: Row, url?: string): RepairTarget {
  const issue = parseInt(row.issue, 10);
  return {
    theaterId: row.theater_id,
    theaterName: row.theater,
    issueNumber: Number.isFinite(issue) ? issue : null,
    currentUrl: row.current_url || null,
    newUrl: url ?? null,
    foundVia: row.found_via || null,
    temporary: !!row.temporary,
    currentDated: parseInt(row.current, 10) || 0,
    undated: parseInt(row.undated, 10) || 0,
    staleDated: parseInt(row.past, 10) || 0,
    sample: row.sample || null,
    evidence: row.evidence,
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
    .filter((p): p is { row: Row; plan: { action: RepairAction; url?: string } } => p.plan !== null);

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
    const result = await applyDecision(supabase, plan.action, toTarget(row, plan.url));
    console.log(`\n${result.theaterName} — ${result.action}`);
    if (result.ok) {
      console.log(`  → ${result.detail}`);
      applied++;
    } else {
      console.error(`  ! FAILED: ${result.detail}`);
      failed++;
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Applied: ${applied}`);
  console.log(`Failed:  ${failed}`);
  if (applied) console.log(`\nRe-run triage to refresh the sheet, or run the scraper to pick up re-activated theaters.`);
}

main();
