import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Audition } from '@/lib/types';
import SearchableAuditionTable from '@/components/SearchableAuditionTable';

export const revalidate = 3600;

export default async function PastAuditions({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const validSorts = ['audition_dates', 'is_paid', 'show_name', 'theater_name', 'non_union_ok', 'housing'];
  const sort = validSorts.includes(params.sort ?? '') ? params.sort! : 'audition_dates';
  const direction = params.dir === 'desc' ? 'desc' : ('asc' as const);

  let query = supabase
    .from('auditions')
    .select('*, theater:theaters(name, city, state)')
    .eq('is_expired', true);

  if (sort === 'theater_name') {
    query = query.order('name', { referencedTable: 'theaters', ascending: direction === 'asc', nullsFirst: false });
  } else if (sort === 'audition_dates') {
    query = query.order('audition_date_start', { ascending: direction === 'asc', nullsFirst: false });
  } else {
    query = query.order(sort, { ascending: direction === 'asc', nullsFirst: false });
  }

  const { data: auditions, error } = await query;

  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Past Auditions</h1>
          <p className="text-gray-500 text-sm mt-1">Auditions whose dates have passed</p>
        </div>
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors mt-1">
          ← Current auditions
        </Link>
      </header>

      {error && (
        <p className="mt-8 text-red-600 text-sm">Could not load auditions: {error.message}</p>
      )}

      {!error && (!auditions || auditions.length === 0) && (
        <div className="mt-16 text-center text-gray-400">
          <p className="text-lg font-medium">No past auditions</p>
        </div>
      )}

      {auditions && auditions.length > 0 && (
        <SearchableAuditionTable
          auditions={auditions as Audition[]}
          sort={sort}
          direction={direction}
          basePath="/past"
        />
      )}
    </main>
  );
}
