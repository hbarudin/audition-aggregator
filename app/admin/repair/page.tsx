import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin';
import { listReports, readApplied, readReport } from '@/lib/repair/report';
import { logout } from '../login/actions';
import RepairReview from './RepairReview';

// The report is a file on disk that the triage CLI rewrites, so this page must
// not be cached between runs.
export const dynamic = 'force-dynamic';

export default async function RepairPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  const params = await searchParams;

  if (!(await isAdmin())) {
    redirect(`/admin/login?next=${encodeURIComponent('/admin/repair')}`);
  }

  const reports = listReports();
  const selected = params.report && reports.includes(params.report) ? params.report : reports[0];
  const report = selected ? readReport(selected) : null;
  const applied = selected ? readApplied(selected) : [];

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground/80 uppercase tracking-wide mb-1">Admin</p>
          <h1 className="text-2xl font-bold tracking-tight">Theater repair</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review what triage found, then choose what to do with each theater.
          </p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors mt-1"
          >
            Sign out
          </button>
        </form>
      </header>

      {reports.length > 1 && (
        <nav className="mb-6 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Report:</span>
          {reports.map((r) => (
            <a
              key={r}
              href={`/admin/repair?report=${encodeURIComponent(r)}`}
              className={`rounded-md border px-2 py-1 transition-colors ${
                r === selected
                  ? 'border-highlight bg-highlight/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {r.replace('decisions-', '').replace('.evidence.json', '')}
            </a>
          ))}
        </nav>
      )}

      {!report ? (
        <div className="rounded-lg border border-border p-6">
          <h2 className="font-semibold">No triage report yet</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Triage runs as a command, because it makes hundreds of outbound requests per batch.
            Run it, then reload this page:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs font-mono">
            npm run repair:triage -- --limit 10
          </pre>
          <p className="text-xs text-muted-foreground mt-3">
            See <code className="font-mono">docs/theater-repair.md</code> for the full workflow.
          </p>
        </div>
      ) : report.findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {report.file} has no findings in it.
        </p>
      ) : (
        <RepairReview report={report} applied={applied} />
      )}

      {report && report.reconcile.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold">
            Also worth a look ({report.reconcile.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Bookkeeping triage noticed. These are not in the list above and need no probing.
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {report.reconcile.map((r, i) => (
              <li key={i} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {r.kind}
                  </span>
                  <span className="font-medium">{r.name}</span>
                  {r.issueNumber && (
                    <a
                      href={`https://github.com/hbarudin/audition-aggregator/issues/${r.issueNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-link hover:underline"
                    >
                      #{r.issueNumber}
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
