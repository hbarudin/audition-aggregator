import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { Theater } from '../../lib/types';
import { fetchOpenScraperIssues } from '../../scraper/github';
import { activeDeferrals, DEFER_DAYS } from '../../lib/repair/defer';
import { findMissingUrl, MissingFinding } from './find-url';

/**
 * Triage for the "Missing audition URL" track: theaters with no URL on record.
 * Writes the same report shape as triage.ts, so /admin/repair and apply.ts
 * work on it unchanged.
 *
 *   npx tsx scripts/repair/triage-missing.ts [--limit N] [--theater "Name"]
 */

const REPAIR_DIR = 'repair';
const DELAY_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasFlag = (n: string) => process.argv.includes(`--${n}`);
function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function tsvCell(v: string | number | boolean | null): string {
  if (v === null || v === undefined || v === false) return '';
  return String(v).replace(/[\t\r\n]+/g, ' ').trim();
}

function nextFreePath(stamp: string): string {
  const first = path.join(REPAIR_DIR, `missing-${stamp}.tsv`);
  if (!fs.existsSync(first)) return first;
  for (let n = 2; ; n++) {
    const c = path.join(REPAIR_DIR, `missing-${stamp}-${n}.tsv`);
    if (!fs.existsSync(c)) return c;
  }
}

/** Ids already handled or already queued, across both tracks' reports. */
function excluded(): Set<string> {
  const out = new Set<string>();
  let files: string[] = [];
  try {
    files = fs.readdirSync(REPAIR_DIR);
  } catch {
    return out;
  }
  for (const f of files.filter((x) => x.endsWith('.applied.json'))) {
    try {
      for (const r of JSON.parse(fs.readFileSync(path.join(REPAIR_DIR, f), 'utf8')) ?? []) {
        if (r?.theaterId) out.add(r.theaterId);
      }
    } catch { /* unreadable */ }
  }
  for (const f of files.filter((x) => x.endsWith('.evidence.json'))) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(REPAIR_DIR, f), 'utf8'));
      for (const finding of parsed.findings ?? []) {
        if (finding?.theaterId) out.add(finding.theaterId);
      }
    } catch { /* unreadable */ }
  }
  return out;
}

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const issues = await fetchOpenScraperIssues();
  const missingIssue = new Map<string, number>();
  for (const i of issues) {
    const m = i.title.match(/^Missing audition URL: (.+)$/);
    if (m) missingIssue.set(m[1], i.number);
  }

  const { data, error } = await supabase
    .from('theaters')
    .select('*')
    .eq('is_active', true)
    .is('audition_page_url', null);

  if (error) {
    console.error('Failed to load theaters:', error.message);
    process.exit(1);
  }

  let targets = (data as Theater[]).filter((t) => missingIssue.has(t.name));
  console.log(`${targets.length} active theater(s) with no audition URL and an open issue\n`);

  const only = arg('theater');
  if (only) targets = targets.filter((t) => t.name.toLowerCase().includes(only.toLowerCase()));

  if (!hasFlag('redo') && !only) {
    const skip = excluded();
    const before = targets.length;
    targets = targets.filter((t) => !skip.has(t.id));
    if (before - targets.length) console.log(`Skipping ${before - targets.length} already handled or queued`);

    const snoozed = activeDeferrals();
    const b2 = targets.length;
    targets = targets.filter((t) => !snoozed.has(t.id));
    if (b2 - targets.length) console.log(`Skipping ${b2 - targets.length} you passed on within ${DEFER_DAYS} days`);
    console.log();
  }

  const limit = arg('limit') ? parseInt(arg('limit')!, 10) : undefined;
  if (limit) targets = targets.slice(0, limit);

  if (targets.length === 0) {
    console.log('Nothing left to triage on this track.');
    return;
  }

  console.log(`Searching for ${targets.length} theater(s)...\n`);
  const findings: MissingFinding[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    console.log(`[${i + 1}/${targets.length}] ${t.name} — ${t.city}, ${t.state}`);
    try {
      const f = await findMissingUrl(
        { id: t.id, name: t.name, city: t.city, state: t.state, notes: t.notes },
        missingIssue.get(t.name) ?? null
      );
      console.log(`  → ${f.verdict}: ${f.evidence}`);
      findings.push(f);
    } catch (err) {
      console.log(`  → error: ${err}`);
      findings.push({
        theaterId: t.id, theaterName: t.name, issueNumber: missingIssue.get(t.name) ?? null,
        verdict: 'NOT_FOUND', recommendation: 'review', currentUrl: null, recommendedUrl: null,
        candidateSource: 'search', candidateLinkText: null, looksTemporary: false,
        currentDated: 0, undated: 0, staleDated: 0, sample: null,
        evidence: `Triage threw: ${err}`, probes: [],
      });
    }
    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  fs.mkdirSync(REPAIR_DIR, { recursive: true });
  const stamp = new Date().toISOString().split('T')[0];
  const outPath = arg('out') ?? nextFreePath(stamp);
  const jsonPath = outPath.replace(/\.tsv$/, '.evidence.json');

  const header = ['decision', 'theater', 'theater_id', 'issue', 'verdict', 'recommended', 'current_url', 'candidate_url', 'found_via', 'temporary', 'current', 'undated', 'past', 'sample', 'evidence'];
  const lines = [header.join('\t')];
  for (const f of findings) {
    lines.push([
      '?', f.theaterName, f.theaterId, f.issueNumber, f.verdict, f.recommendation,
      f.currentUrl, f.recommendedUrl, f.candidateSource, f.looksTemporary,
      f.currentDated, f.undated, f.staleDated, f.sample, f.evidence,
    ].map(tsvCell).join('\t'));
  }
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), findings, reconcile: [] }, null, 2));

  const byVerdict = findings.reduce<Record<string, number>>((a, f) => {
    a[f.verdict] = (a[f.verdict] ?? 0) + 1;
    return a;
  }, {});
  console.log('\n--- Summary ---');
  for (const [v, n] of Object.entries(byVerdict).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${v}`);
  }
  console.log(`\nDecision sheet: ${outPath}`);
  console.log(`Review at /admin/repair — every row starts at "?".`);
}

// These scripts finish their work but Node keeps the process alive: the HTTP
// keep-alive pool holds an ESTABLISHED socket open after the last request, so
// the event loop never drains. Left alone the process lingers indefinitely,
// which also strands anything waiting on it to finish. Exit explicitly.
main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
