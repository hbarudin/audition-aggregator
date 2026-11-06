import * as fs from 'fs';
import * as path from 'path';
import { AppliedRecord, Finding, Report, ReconcileItem } from './report-types';

/**
 * Reads the triage reports that scripts/repair/triage.ts writes into repair/.
 * Server-only: it touches the filesystem. Types live in ./report-types so the
 * client can share them.
 *
 * Triage stays a CLI because it makes hundreds of outbound requests per batch
 * and needs the Anthropic key, which is not work for a request handler. The
 * GUI reads what it produced. That makes /admin/repair a local tool -- run
 * `npm run dev` -- since the reports are not deployed.
 */

export const REPAIR_DIR = 'repair';

/** Report filenames, newest first. */
export function listReports(): string[] {
  try {
    return fs
      .readdirSync(REPAIR_DIR)
      .filter((f) => f.endsWith('.evidence.json'))
      .sort()
      .reverse();
  } catch {
    return []; // no repair/ directory yet
  }
}

export function readReport(file: string): Report | null {
  // Defend the path: this name reaches the filesystem, and only a plain report
  // filename from repair/ is ever legitimate.
  if (file !== path.basename(file) || !file.endsWith('.evidence.json')) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(path.join(REPAIR_DIR, file), 'utf8');
  } catch {
    return null;
  }

  let parsed: {
    generatedAt?: string;
    findings?: (Finding & { probes?: unknown[] })[];
    reconcile?: ReconcileItem[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const findings = (parsed.findings ?? []).map(({ probes, ...f }) => ({
    ...f,
    probeCount: Array.isArray(probes) ? probes.length : 0,
  }));

  return {
    file,
    generatedAt: parsed.generatedAt ?? 'unknown',
    findings,
    reconcile: parsed.reconcile ?? [],
  };
}

/**
 * A report is an immutable snapshot, so applying a decision does not change
 * it. Without a record of what has already been written, a reloaded page
 * offers every finished theater again -- and applying twice posts a duplicate
 * comment and re-closes a closed issue. Successful writes are logged beside
 * the report so the page can tell done from pending.
 */
function appliedPath(reportFile: string): string | null {
  if (reportFile !== path.basename(reportFile) || !reportFile.endsWith('.evidence.json')) return null;
  return path.join(REPAIR_DIR, reportFile.replace(/\.evidence\.json$/, '.applied.json'));
}

export function readApplied(reportFile: string): AppliedRecord[] {
  const file = appliedPath(reportFile);
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as AppliedRecord[]) : [];
  } catch {
    return []; // nothing applied yet, or the log is unreadable
  }
}

export function recordApplied(reportFile: string, records: AppliedRecord[]): void {
  const file = appliedPath(reportFile);
  if (!file || records.length === 0) return;
  const existing = readApplied(reportFile);
  try {
    fs.writeFileSync(file, JSON.stringify([...existing, ...records], null, 2));
  } catch (err) {
    // The writes themselves already succeeded; losing the log must not fail
    // the request, but it does mean the page may offer a done row again.
    console.error(`Could not record applied decisions to ${file}: ${err}`);
  }
}
