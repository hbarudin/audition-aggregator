import { Audition } from '@/lib/types';
import Highlight from '@/components/Highlight';

/**
 * The narrow-screen counterpart to AuditionTable. Carries the same facts as a
 * table row -- the flag columns become badges, and a flag the posting never
 * stated has no badge at all, which is how a blank cell reads in the table.
 */
export default function AuditionCard({
  audition,
  query = '',
  miles,
}: {
  audition: Audition;
  query?: string;
  miles?: number;
}) {
  const theater = audition.theater;

  return (
    <div className="border border-border rounded-lg p-4 bg-card hover:border-ring transition-colors">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">
            <Highlight text={theater?.name ?? ''} query={query} />
          </p>
          <p className="text-sm text-muted-foreground">
            {theater?.city}, {theater?.state}
            {miles !== undefined && (
              <span className="text-muted-foreground/80"> · {Math.round(miles)} mi</span>
            )}
          </p>
        </div>
        {audition.source_url && (
          <a
            href={audition.source_url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 -my-2 -mr-2 py-2 pl-2 pr-2 text-sm text-link hover:underline"
          >
            View posting →
          </a>
        )}
      </div>

      {audition.show_name && (
        <p className="mt-2 text-foreground font-medium">
          <Highlight text={audition.show_name} query={query} />
        </p>
      )}

      <div className="mt-2 space-y-0.5 text-sm text-muted-foreground">
        {audition.audition_dates && (
          <p>
            <span className="text-muted-foreground/80">Auditions: </span>
            {audition.audition_dates}
          </p>
        )}
        {audition.performance_dates && (
          <p>
            <span className="text-muted-foreground/80">Performances: </span>
            {audition.performance_dates}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {audition.is_paid === true && (
          <Badge color="green">Paid</Badge>
        )}
        {audition.is_paid === false && (
          <Badge color="gray">Unpaid</Badge>
        )}
        {audition.non_union_ok === true && (
          <Badge color="blue">Non-union OK</Badge>
        )}
        {audition.non_union_ok === false && (
          <Badge color="gray">Union only</Badge>
        )}
        {audition.housing === 'yes' && (
          <Badge color="purple">Housing offered</Badge>
        )}
        {audition.housing === 'no' && (
          <Badge color="gray">No housing</Badge>
        )}
      </div>
    </div>
  );
}

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: 'green' | 'blue' | 'purple' | 'gray';
}) {
  const styles = {
    green: 'bg-success-muted text-success ring-success/30',
    blue: 'bg-link/10 text-link ring-link/30',
    purple: 'bg-accent text-accent-foreground ring-border',
    gray: 'bg-muted text-muted-foreground ring-border',
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[color]}`}
    >
      {children}
    </span>
  );
}
