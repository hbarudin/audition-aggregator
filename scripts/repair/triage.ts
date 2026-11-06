import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { Theater } from '../../lib/types';
import { fetchOpenScraperIssues, OpenIssue } from '../../scraper/github';
import { triageTheater, TriageFinding, Verdict } from './discover';

/**
 * Triage pass for the `scraper-issue` backlog. Writes a decision sheet; it
 * never touches the database or the tracker. `apply.ts` does that, and only
 * for rows a human has marked.
 *
 *   npx tsx scripts/repair/triage.ts [--limit N] [--theater "Name"] [--dry] [--out path]
 */

const REPAIR_DIR = 'repair';

/** The default recommendation per verdict. A human still has to accept it. */
const RECOMMENDATION: Record<Verdict, string> = {
  CURRENT_URL_OK: 'reactivate',
  CANDIDATE_STRONG: 'url',
  CANDIDATE_WEAK: 'review',
  BLOCKED: 'playwright',
  ORIGIN_DEAD: 'retire',
  STALE_LISTINGS_ONLY: 'reactivate',
  NO_CANDIDATE: 'review',
};


/**
 * A report is the record of a batch, and apply.ts logs what was written
 * beside it, so overwriting one loses work that has not been acted on yet.
 * Later batches on the same day get a suffix instead.
 */
function nextFreePath(stamp: string): string {
  const first = path.join(REPAIR_DIR, `decisions-${stamp}.tsv`);
  if (!fs.existsSync(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = path.join(REPAIR_DIR, `decisions-${stamp}-${n}.tsv`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

/** Theater ids this workflow deliberately retired. */
function retiredIds(): Set<string> {
  const ids = new Set<string>();
  let files: string[];
  try {
    files = fs.readdirSync(REPAIR_DIR).filter((f) => f.endsWith('.applied.json'));
  } catch {
    return ids;
  }
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(REPAIR_DIR, f), 'utf8'));
      for (const record of Array.isArray(parsed) ? parsed : []) {
        if (record?.action === 'retire' && record?.theaterId) ids.add(record.theaterId);
      }
    } catch {
      /* unreadable log */
    }
  }
  return ids;
}

/**
 * Theater ids that have already been written for. Deliberately keyed on what
 * was *applied*, not on what was triaged: leaving a row alone means "not now",
 * so it has to come back in a later batch. Only a decision that actually did
 * something -- including `playwright`, which parks a theater pending that work
 * -- takes it out of rotation.
 */
function alreadyActedOn(): Set<string> {
  const seen = new Set<string>();
  let files: string[];
  try {
    files = fs.readdirSync(REPAIR_DIR).filter((f) => f.endsWith('.applied.json'));
  } catch {
    return seen;
  }
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(REPAIR_DIR, f), 'utf8'));
      for (const record of Array.isArray(parsed) ? parsed : []) {
        if (record?.theaterId) seen.add(record.theaterId);
      }
    } catch {
      /* unreadable log; just do not let it hide anything */
    }
  }
  return seen;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function tsvCell(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\t\r\n]+/g, ' ').trim();
}

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const issues = await fetchOpenScraperIssues();
  if (issues.length === 0) {
    console.error('No open scraper issues found (is GITHUB_TOKEN set?).');
    process.exit(1);
  }

  const brokenByName = new Map<string, OpenIssue>();
  const missingByName = new Map<string, OpenIssue>();
  for (const i of issues) {
    const m = i.title.match(/^(Broken page|Missing audition URL): (.+)$/);
    if (!m) continue;
    (m[1] === 'Broken page' ? brokenByName : missingByName).set(m[2], i);
  }
  console.log(`Open issues: ${brokenByName.size} broken page, ${missingByName.size} missing URL\n`);

  const { data, error } = await supabase.from('theaters').select('*');
  if (error) {
    console.error('Failed to load theaters:', error.message);
    process.exit(1);
  }
  const theaters = data as Theater[];
  const byName = new Map(theaters.map((t) => [t.name, t]));

  // Track A: theaters with a "Broken page" issue. We have the old URL, so
  // discovery is domain-local and needs no web search.
  const only = arg('theater');
  let targets = [...brokenByName.keys()]
    .map((name) => ({ name, issue: brokenByName.get(name)!, theater: byName.get(name) }))
    .filter((t): t is { name: string; issue: OpenIssue; theater: Theater } => {
      if (!t.theater) {
        console.log(`  ! "${t.name}" has issue #${t.issue.number} but no matching theater row; skipping`);
        return false;
      }
      return true;
    });

  if (only) targets = targets.filter((t) => t.name.toLowerCase().includes(only.toLowerCase()));

  // Skip theaters an earlier batch already acted on, so --limit means "the next
  // N still needing a decision". Rows left alone come back. --redo overrides.
  if (!hasFlag('redo') && !only) {
    const seen = alreadyActedOn();
    const before = targets.length;
    targets = targets.filter((t) => !seen.has(t.theater.id));
    const skipped = before - targets.length;
    if (skipped) console.log(`Skipping ${skipped} theater(s) already repaired (--redo to include them)\n`);
  }

  const limit = arg('limit') ? parseInt(arg('limit')!, 10) : undefined;
  if (limit) targets = targets.slice(0, limit);

  console.log(`Triaging ${targets.length} theater(s)${hasFlag('dry') ? ' (--dry: no LLM parsing)' : ''}...\n`);

  const findings: (TriageFinding & { issueNumber: number; recommendation: string })[] = [];

  for (let i = 0; i < targets.length; i++) {
    const { name, issue, theater } = targets[i];
    console.log(`[${i + 1}/${targets.length}] ${name} (#${issue.number})`);
    let f: TriageFinding;
    try {
      f = await triageTheater(theater, { skipParse: hasFlag('dry') });
    } catch (err) {
      console.log(`  → triage error: ${err}`);
      f = {
        theaterId: theater.id, theaterName: name, currentUrl: theater.audition_page_url,
        verdict: 'NO_CANDIDATE', recommendedUrl: null, candidateSource: null,
        candidateLinkText: null, looksTemporary: false, currentDated: 0, undated: 0,
        staleDated: 0, sample: null, evidence: `Triage threw: ${err}`, probes: [],
      };
    }
    console.log(`  → ${f.verdict}: ${f.evidence}`);
    findings.push({ ...f, issueNumber: issue.number, recommendation: RECOMMENDATION[f.verdict] });
  }

  // Bookkeeping proposals that need no probing.
  const reconcile: { kind: string; name: string; issueNumber: number | null; note: string }[] = [];
  for (const [name, issue] of brokenByName) {
    const t = byName.get(name);
    if (t?.is_active) {
      reconcile.push({ kind: 'stale-issue', name, issueNumber: issue.number,
        note: 'Theater is active again but the issue is still open. The scrape no longer skips it, so this is just a stale issue to close.' });
    }
  }
  const issuedNames = new Set([...brokenByName.keys(), ...missingByName.keys()]);
  // A theater retired through this workflow is inactive with no open issue by
  // design. Without this it reappears as "untracked" in every later batch.
  const retired = retiredIds();
  for (const t of theaters) {
    if (!t.is_active && !issuedNames.has(t.name) && !retired.has(t.id)) {
      reconcile.push({ kind: 'untracked-inactive', name: t.name, issueNumber: null,
        note: `Deactivated with no open issue — invisible work. URL on record: ${t.audition_page_url ?? 'none'}` });
    }
  }

  fs.mkdirSync(REPAIR_DIR, { recursive: true });
  const stamp = new Date().toISOString().split('T')[0];
  const outPath = arg('out') ?? nextFreePath(stamp);
  const jsonPath = outPath.replace(/\.tsv$/, '.evidence.json');

  // theater_id is the write key: "Phoenix Theatre" is not unique, so applying
  // a change by name would hit both rows.
  const header = ['decision', 'theater', 'theater_id', 'issue', 'verdict', 'recommended', 'current_url', 'candidate_url', 'found_via', 'temporary', 'current', 'undated', 'past', 'sample', 'evidence'];
  const lines = [header.join('\t')];
  for (const f of findings) {
    lines.push([
      '?', f.theaterName, f.theaterId, f.issueNumber, f.verdict, f.recommendation,
      f.currentUrl, f.recommendedUrl, f.candidateSource, f.looksTemporary ? 'yes' : '',
      f.currentDated, f.undated, f.staleDated, f.sample, f.evidence,
    ].map(tsvCell).join('\t'));
  }
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), findings, reconcile }, null, 2));

  const byVerdict = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.verdict] = (acc[f.verdict] ?? 0) + 1;
    return acc;
  }, {});

  console.log('\n--- Triage summary ---');
  for (const [v, n] of Object.entries(byVerdict).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${v}  → recommends "${RECOMMENDATION[v as Verdict]}"`);
  }
  const temps = findings.filter((f) => f.looksTemporary && f.recommendedUrl);
  if (temps.length) {
    console.log(`\n  ${temps.length} candidate(s) look show/season-specific (will churn):`);
    for (const t of temps) console.log(`    ${t.theaterName}: ${t.recommendedUrl}`);
  }
  if (reconcile.length) {
    console.log(`\n  ${reconcile.length} bookkeeping item(s) (see ${jsonPath}):`);
    for (const r of reconcile) console.log(`    [${r.kind}] ${r.name}${r.issueNumber ? ` (#${r.issueNumber})` : ''}`);
  }
  console.log(`\nDecision sheet: ${outPath}`);
  console.log(`Evidence:       ${jsonPath}`);
  console.log(`\nEvery row starts at "?" — nothing happens until you edit the decision column.`);
  console.log(`Then: npx tsx scripts/repair/apply.ts ${outPath}`);
}

main();
