/**
 * Shapes and labels for the triage reports. Kept free of Node imports so the
 * client component can share them -- report.ts reads the filesystem and must
 * stay server-only.
 */

export type Verdict =
  | 'CURRENT_URL_OK'
  | 'CANDIDATE_STRONG'
  | 'CANDIDATE_WEAK'
  | 'BLOCKED'
  | 'ORIGIN_DEAD'
  | 'STALE_LISTINGS_ONLY'
  | 'NO_CANDIDATE';

/** One triaged theater, without the bulky probe log. */
export interface Finding {
  theaterId: string;
  theaterName: string;
  issueNumber: number | null;
  verdict: Verdict;
  recommendation: string;
  currentUrl: string | null;
  recommendedUrl: string | null;
  candidateSource: string | null;
  candidateLinkText: string | null;
  looksTemporary: boolean;
  currentDated: number;
  undated: number;
  staleDated: number;
  sample: string | null;
  evidence: string;
  /** How many URLs triage tried, kept as a count rather than the full list. */
  probeCount: number;
}

export interface ReconcileItem {
  kind: string;
  name: string;
  issueNumber: number | null;
  note: string;
}

export interface Report {
  file: string;
  generatedAt: string;
  findings: Finding[];
  reconcile: ReconcileItem[];
}

export const VERDICT_BLURB: Record<Verdict, string> = {
  CURRENT_URL_OK: 'The URL on record works and lists current auditions.',
  CANDIDATE_STRONG: 'Found a page that lists current auditions.',
  CANDIDATE_WEAK: 'Found an audition page, but nothing currently dated.',
  BLOCKED: 'The site blocks us (HTTP 403). Needs a headless browser.',
  ORIGIN_DEAD: 'The domain does not resolve. Retirement candidate.',
  STALE_LISTINGS_ONLY: 'The URL is fine; the theater just has not posted a new call.',
  NO_CANDIDATE: 'Site is alive but no audition page was found.',
};
