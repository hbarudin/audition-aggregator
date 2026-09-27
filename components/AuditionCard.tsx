import { Audition } from '@/lib/types';

export default function AuditionCard({ audition }: { audition: Audition }) {
  const theater = audition.theater;

  return (
    <div className="border border-border rounded-lg p-4 bg-card hover:border-ring transition-colors">
      <div className="flex justify-between items-start gap-4">
        <div>
          <p className="font-semibold text-foreground">{theater?.name}</p>
          <p className="text-sm text-muted-foreground">
            {theater?.city}, {theater?.state}
          </p>
        </div>
        {audition.source_url && (
          <a
            href={audition.source_url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-sm text-link hover:underline"
          >
            View posting →
          </a>
        )}
      </div>

      {audition.show_name && (
        <p className="mt-2 text-foreground font-medium">{audition.show_name}</p>
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
