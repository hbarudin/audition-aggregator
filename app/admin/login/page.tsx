import { redirect } from 'next/navigation';
import { isAdmin, safeNextPath } from '@/lib/admin';
import LoginForm from './LoginForm';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNextPath(next);

  if (await isAdmin()) redirect(target);

  return (
    <main className="max-w-sm mx-auto px-4 py-20">
      <header className="mb-8">
        <p className="text-xs text-muted-foreground/80 uppercase tracking-wide mb-1">Admin</p>
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      </header>

      <LoginForm next={target} />
    </main>
  );
}
