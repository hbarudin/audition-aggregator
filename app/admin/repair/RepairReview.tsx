'use client';

import { useActionState, useMemo, useState } from 'react';
import { applyDecisions, ApplyState } from './actions';
import { AppliedRecord, Finding, Report, VERDICT_BLURB } from '@/lib/repair/report-types';

const VERDICT_STYLE: Record<string, string> = {
  CURRENT_URL_OK: 'bg-success-muted text-success border-success-border',
  CANDIDATE_STRONG: 'bg-success-muted text-success border-success-border',
  CANDIDATE_WEAK: 'bg-warning-muted text-warning border-warning-border',
  STALE_LISTINGS_ONLY: 'bg-warning-muted text-warning border-warning-border',
  BLOCKED: 'bg-warning-muted text-warning border-warning-border',
  NO_CANDIDATE: 'bg-muted text-muted-foreground border-border',
  ORIGIN_DEAD: 'bg-destructive/10 text-destructive border-destructive/30',
};

/** Which choices make sense for a given verdict, recommendation first. */
function choicesFor(f: Finding): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [{ value: '', label: 'Leave alone' }];
  if (f.recommendedUrl && f.recommendedUrl !== f.currentUrl) {
    out.push({ value: 'url', label: 'Use the found URL' });
  }
  if (f.verdict === 'CURRENT_URL_OK' || f.verdict === 'STALE_LISTINGS_ONLY') {
    out.push({ value: 'reactivate', label: 'Re-activate as-is' });
  }
  out.push({ value: 'url:custom', label: 'Use a URL I type…' });
  if (f.verdict === 'BLOCKED') out.push({ value: 'playwright', label: 'Needs Playwright' });
  out.push({ value: 'close', label: 'Close the issue only' });
  out.push({ value: 'retire', label: 'Retire this theater' });
  return out;
}

function Pill({ verdict }: { verdict: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide ${
        VERDICT_STYLE[verdict] ?? 'bg-muted text-muted-foreground border-border'
      }`}
    >
      {verdict.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export default function RepairReview({
  report,
  applied,
}: {
  report: Report;
  applied: AppliedRecord[];
}) {
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [state, action, isApplying] = useActionState<ApplyState, FormData>(applyDecisions, null);

  const set = (id: string, value: string) => setDecisions((d) => ({ ...d, [id]: value }));

  const doneById = useMemo(
    () => new Map(applied.map((a) => [a.theaterId, a])),
    [applied]
  );
  const pending = useMemo(
    () => report.findings.filter((f) => !doneById.has(f.theaterId)),
    [report.findings, doneById]
  );
  const done = useMemo(
    () => report.findings.filter((f) => doneById.has(f.theaterId)),
    [report.findings, doneById]
  );

  // Only pending rows can be chosen, so a stale selection left over from the
  // last submit cannot resurrect a theater that has already been written.
  const chosen = useMemo(
    () => pending.filter((f) => decisions[f.theaterId]),
    [pending, decisions]
  );
  const retiring = chosen.filter((f) => decisions[f.theaterId] === 'retire');

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of pending) c[f.verdict] = (c[f.verdict] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [pending]);

  /** Accept the suggestion for every row triage was confident about. */
  const acceptStrong = () => {
    const next = { ...decisions };
    for (const f of pending) {
      if (f.verdict === 'CANDIDATE_STRONG' && f.recommendedUrl) next[f.theaterId] = 'url';
      if (f.verdict === 'CURRENT_URL_OK') next[f.theaterId] = 'reactivate';
    }
    setDecisions(next);
  };

  const lastResults = state && 'results' in state ? state.results : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {counts.map(([v, n]) => (
          <span key={v} className="flex items-center gap-1.5">
            <Pill verdict={v} />
            <span className="tabular-nums">{n}</span>
          </span>
        ))}
        <span className="ml-auto">
          {pending.length} left{done.length ? ` · ${done.length} done` : ''} · triaged{' '}
          {new Date(report.generatedAt).toLocaleString()}
        </span>
      </div>

      {lastResults && (
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <h2 className="text-sm font-semibold mb-2">
            Applied {lastResults.filter((r) => r.ok).length} change(s)
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {lastResults.map((r, i) => (
              <li key={i} className={r.ok ? 'text-foreground/80' : 'text-destructive'}>
                <span className="font-medium">{r.theaterName}</span> — {r.detail}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            Anything you left alone is snoozed for 30 days and will not come back in the next
            batch. Re-run <code className="font-mono">npm run repair:triage</code> for more.
          </p>
        </div>
      )}

      {state && 'error' in state && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="report" value={report.file} />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={acceptStrong}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            Accept all confident finds
          </button>
          <button
            type="button"
            onClick={() => setDecisions({})}
            className="text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors"
          >
            Clear
          </button>
        </div>

        <ul className="flex flex-col gap-3">
          {pending.map((f) => {
            const decision = decisions[f.theaterId] ?? '';
            return (
              <li
                key={f.theaterId}
                className={`rounded-lg border p-4 transition-colors ${
                  decision ? 'border-highlight bg-highlight/5' : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold truncate">{f.theaterName}</h3>
                      <Pill verdict={f.verdict} />
                      {f.looksTemporary && (
                        <span className="rounded-full border border-warning-border bg-warning-muted px-2 py-0.5 text-[11px] text-warning">
                          one show only
                        </span>
                      )}
                      {f.issueNumber && (
                        <a
                          href={`https://github.com/hbarudin/audition-aggregator/issues/${f.issueNumber}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-link hover:underline"
                        >
                          #{f.issueNumber}
                        </a>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {VERDICT_BLURB[f.verdict] ?? f.verdict}
                    </p>
                  </div>

                  <select
                    name={`decision:${f.theaterId}`}
                    value={decision}
                    onChange={(e) => set(f.theaterId, e.target.value)}
                    className="shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {choicesFor(f).map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">Was</dt>
                  <dd className="truncate font-mono text-xs text-muted-foreground">
                    {f.currentUrl ?? '—'}
                  </dd>

                  {f.recommendedUrl && f.recommendedUrl !== f.currentUrl && (
                    <>
                      <dt className="text-muted-foreground">Found</dt>
                      <dd className="min-w-0">
                        <a
                          href={f.recommendedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-link hover:underline break-all"
                        >
                          {f.recommendedUrl}
                        </a>
                        {f.candidateSource && (
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            — via {f.candidateSource}
                            {f.candidateLinkText ? ` ("${f.candidateLinkText}")` : ''}
                          </span>
                        )}
                      </dd>
                    </>
                  )}

                  <dt className="text-muted-foreground">Parsed</dt>
                  <dd className="text-xs text-muted-foreground tabular-nums">
                    {f.currentDated} current · {f.undated} undated · {f.staleDated} past
                    {f.sample ? <span className="text-foreground/70"> — {f.sample}</span> : null}
                  </dd>
                </dl>

                {decision === 'url:custom' && (
                  <input
                    name={`url:${f.theaterId}`}
                    value={urls[f.theaterId] ?? ''}
                    onChange={(e) => setUrls((u) => ({ ...u, [f.theaterId]: e.target.value }))}
                    placeholder="https://…"
                    className="mt-3 w-full rounded-md border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}

                {decision === 'retire' && (
                  <p className="mt-3 text-xs text-destructive">
                    This drops {f.theaterName} from the site and closes #{f.issueNumber} as
                    not-planned. The reason is recorded on the theater.
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {pending.length === 0 && (
          <p className="rounded-lg border border-success-border bg-success-muted px-4 py-3 text-sm text-success">
            Every theater in this report has been handled. Run{' '}
            <code className="font-mono">npm run repair:triage</code> for the next batch.
          </p>
        )}

        {done.length > 0 && (
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Done ({done.length})
            </summary>
            <ul className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm">
              {done.map((f) => {
                const record = doneById.get(f.theaterId)!;
                return (
                  <li key={f.theaterId} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{f.theaterName}</span>
                    {f.issueNumber && (
                      <a
                        href={`https://github.com/hbarudin/audition-aggregator/issues/${f.issueNumber}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-link hover:underline"
                      >
                        #{f.issueNumber}
                      </a>
                    )}
                    <span className="text-xs text-muted-foreground">{record.detail}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}

        <div className="sticky bottom-0 flex items-center gap-4 border-t border-border bg-background/95 py-4 backdrop-blur">
          <button
            type="submit"
            disabled={isApplying || chosen.length === 0}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {isApplying ? 'Applying…' : `Apply ${chosen.length} change${chosen.length === 1 ? '' : 's'}`}
          </button>
          <p className="text-xs text-muted-foreground">
            {chosen.length === 0
              ? 'Nothing selected — nothing will change.'
              : `Writes to the database and the tracker.${
                  retiring.length ? ` ${retiring.length} theater(s) will be retired.` : ''
                }`}
          </p>
        </div>
      </form>
    </div>
  );
}
