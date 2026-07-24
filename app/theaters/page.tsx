import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Theater } from '@/lib/types';
import SearchableTheaterList from '@/components/SearchableTheaterList';

export const revalidate = 3600;

export default async function TheatersPage({
  searchParams,
}: {
  searchParams: Promise<{ admin?: string }>;
}) {
  const { admin } = await searchParams;
  const adminKey = process.env.ADMIN_KEY && admin === process.env.ADMIN_KEY ? admin : null;
  const { data: theaters, error } = await supabase
    .from('theaters')
    .select('*')
    .eq('is_active', true)
    .order('state', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-10">
        <p className="text-red-600 text-sm">Could not load theaters: {error.message}</p>
      </main>
    );
  }

  const stateCount = new Set(theaters.map((t) => t.state)).size;

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">All theaters</h1>
          <p className="text-gray-500 text-sm mt-1">
            {theaters.length} theaters across {stateCount} states
          </p>
        </div>
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors mt-1">
          ← Back
        </Link>
      </header>

      <SearchableTheaterList theaters={theaters as Theater[]} adminKey={adminKey} />
    </main>
  );
}
