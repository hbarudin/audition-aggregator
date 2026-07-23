import { supabase } from '@/lib/supabase';
import { Audition } from '@/lib/types';
import AuditionCard from '@/components/AuditionCard';
import SortControls from '@/components/SortControls';

export const revalidate = 3600;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; expired?: string }>;
}) {
  const params = await searchParams;
  const sort = params.sort === 'is_paid' ? 'is_paid' : 'audition_dates';
  const direction = params.dir === 'desc' ? 'desc' : ('asc' as const);
  const showExpired = params.expired === 'true';

  let query = supabase
    .from('auditions')
    .select('*, theater:theaters(name, city, state)')
    .order(sort, { ascending: direction === 'asc', nullsFirst: false });

  if (!showExpired) {
    query = query.eq('is_expired', false);
  }

  const { data: auditions, error } = await query;

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Audition Aggregator</h1>
        <p className="text-gray-500 text-sm mt-1">
          Non-union theater auditions, updated daily
        </p>
      </header>

      <SortControls sort={sort} direction={direction} showExpired={showExpired} />

      {error && (
        <p className="mt-8 text-red-600 text-sm">
          Could not load auditions: {error.message}
        </p>
      )}

      {!error && (!auditions || auditions.length === 0) && (
        <div className="mt-16 text-center text-gray-400">
          <p className="text-lg font-medium">No auditions yet</p>
          <p className="text-sm mt-2">
            The scraper will populate this list once it runs.
          </p>
        </div>
      )}

      {auditions && auditions.length > 0 && (
        <ul className="mt-6 space-y-3">
          {(auditions as Audition[]).map((a) => (
            <li key={a.id}>
              <AuditionCard audition={a} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
