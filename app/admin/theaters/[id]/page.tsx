import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Theater } from '@/lib/types';
import EditTheaterForm from './EditTheaterForm';

export default async function EditTheaterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { id } = await params;
  const { key } = await searchParams;

  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    notFound();
  }

  const { data: theater, error } = await supabase
    .from('theaters')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !theater) notFound();

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <header className="mb-8">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Admin</p>
        <h1 className="text-2xl font-bold tracking-tight">Edit theater</h1>
        <p className="text-sm text-gray-500 mt-1">{theater.id}</p>
      </header>

      <EditTheaterForm theater={theater as Theater} adminKey={key} />
    </main>
  );
}
