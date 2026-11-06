import * as fs from 'fs';
import * as path from 'path';
import { Finding, Report, ReconcileItem } from './report-types';

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
