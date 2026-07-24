import { Audition } from '@/lib/types';

export default function AuditionCard({ audition }: { audition: Audition }) {
  const theater = audition.theater;

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white hover:border-gray-300 transition-colors">
      <div className="flex justify-between items-start gap-4">
        <div>
          <p className="font-semibold text-gray-900">{theater?.name}</p>
          <p className="text-sm text-gray-500">
            {theater?.city}, {theater?.state}
          </p>
        </div>
        {audition.source_url && (
          <a
            href={audition.source_url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-sm text-blue-600 hover:underline"
          >
            View posting →
          </a>
        )}
      </div>

      {audition.show_name && (
        <p className="mt-2 text-gray-800 font-medium">{audition.show_name}</p>
      )}

      <div className="mt-2 space-y-0.5 text-sm text-gray-600">
        {audition.audition_dates && (
          <p>
            <span className="text-gray-400">Auditions: </span>
            {audition.audition_dates}
          </p>
        )}
        {audition.performance_dates && (
          <p>
            <span className="text-gray-400">Performances: </span>
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
    green: 'bg-green-50 text-green-700 ring-green-600/20',
    blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
    purple: 'bg-purple-50 text-purple-700 ring-purple-600/20',
    gray: 'bg-gray-50 text-gray-600 ring-gray-500/20',
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[color]}`}
    >
      {children}
    </span>
  );
}
