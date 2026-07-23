import Link from 'next/link';

interface Props {
  sort: string;
  direction: string;
  showExpired: boolean;
}

export default function SortControls({ sort, direction, showExpired }: Props) {
  const toggleDir = direction === 'asc' ? 'desc' : 'asc';

  function href(newSort: string, newDir?: string, newExpired?: boolean) {
    const s = newSort;
    const d = newDir ?? (sort === newSort ? toggleDir : 'asc');
    const e = newExpired ?? showExpired;
    return `/?sort=${s}&dir=${d}&expired=${e}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-400">Sort:</span>

      <SortLink
        href={href('audition_dates')}
        active={sort === 'audition_dates'}
        direction={sort === 'audition_dates' ? direction : null}
      >
        Audition date
      </SortLink>

      <SortLink
        href={href('is_paid', sort === 'is_paid' ? toggleDir : 'desc')}
        active={sort === 'is_paid'}
        direction={sort === 'is_paid' ? direction : null}
      >
        Pay status
      </SortLink>

      <Link
        href={href(sort, direction, !showExpired)}
        className={`ml-auto rounded px-3 py-1 border transition-colors ${
          showExpired
            ? 'bg-gray-900 text-white border-gray-900'
            : 'text-gray-500 border-gray-200 hover:border-gray-400'
        }`}
      >
        {showExpired ? 'Hiding past ✓' : 'Show past auditions'}
      </Link>
    </div>
  );
}

function SortLink({
  href,
  active,
  direction,
  children,
}: {
  href: string;
  active: boolean;
  direction: string | null;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded px-3 py-1 border transition-colors ${
        active
          ? 'bg-gray-900 text-white border-gray-900'
          : 'text-gray-500 border-gray-200 hover:border-gray-400'
      }`}
    >
      {children}
      {active && direction && (
        <span className="ml-1">{direction === 'asc' ? '↑' : '↓'}</span>
      )}
    </Link>
  );
}
