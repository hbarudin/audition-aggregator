import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Audition } from '@/lib/types';
import { upcomingFilter } from '@/lib/expiry';
import SearchableAuditionTable from '@/components/SearchableAuditionTable';

export const revalidate = 3600;

export default async function Home({
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
    .or(upcomingFilter());

  if (sort === 'theater_name') {
    query = query.order('name', { referencedTable: 'theaters', ascending: direction === 'asc', nullsFirst: false });
  } else if (sort === 'audition_dates') {
    query = query.order('audition_date_start', { ascending: direction === 'asc', nullsFirst: false });
  } else {
    query = query.order(sort, { ascending: direction === 'asc', nullsFirst: false });
  }

  const [{ data: auditions, error }, { data: lastScrape }] = await Promise.all([
    query,
    supabase.from('auditions').select('scraped_at').order('scraped_at', { ascending: false }).limit(1).single(),
  ]);

  const lastUpdated = lastScrape?.scraped_at
    ? new Date(lastScrape.scraped_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <main className="max-w-6xl mx-auto px-4 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audition Aggregator</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Non-union theater auditions, updated daily
            {lastUpdated && <span className="text-muted-foreground/80"> · Last scraped {lastUpdated}</span>}
          </p>
        </div>
        <div className="flex items-center gap-4 mt-1">
          <Link href="/add-theater" className="text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors">
            + Add theater
          </Link>
          <Link href="/theaters" className="text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors">
            All theaters
          </Link>
          <Link href="/past" className="text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors">
            Past auditions →
          </Link>
        </div>
      </header>

      {error && (
        <p className="mt-8 text-destructive text-sm">Could not load auditions: {error.message}</p>
      )}

      {!error && (!auditions || auditions.length === 0) && (
        <div className="mt-16 text-center text-muted-foreground/80">
          <p className="text-lg font-medium">No auditions yet</p>
          <p className="text-sm mt-2">The scraper will populate this list once it runs.</p>
        </div>
      )}

      {auditions && auditions.length > 0 && (
        <SearchableAuditionTable
          auditions={auditions as Audition[]}
          sort={sort}
          direction={direction}
          basePath="/"
        />
      )}
    </main>
  );
}
