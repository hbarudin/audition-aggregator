import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { Theater } from '@/lib/types';
import { logout } from '../../login/actions';
import EditTheaterForm from './EditTheaterForm';

export default async function EditTheaterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!(await isAdmin())) {
    redirect(`/admin/login?next=${encodeURIComponent(`/admin/theaters/${id}`)}`);
  }

  const { data: theater, error } = await supabase
    .from('theaters')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !theater) notFound();

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground/80 uppercase tracking-wide mb-1">Admin</p>
          <h1 className="text-2xl font-bold tracking-tight">Edit theater</h1>
          <p className="text-sm text-muted-foreground mt-1">{theater.id}</p>
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

      <EditTheaterForm theater={theater as Theater} />
    </main>
  );
}
