'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, ADMIN_COOKIE_OPTIONS, safeNextPath, verifyAdminKey } from '@/lib/admin';

export type LoginState = { error: string } | null;

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const token = verifyAdminKey(((formData.get('key') as string) ?? '').trim());
  if (!token) return { error: 'Incorrect key.' };

  (await cookies()).set(ADMIN_COOKIE, token, ADMIN_COOKIE_OPTIONS);

  // redirect throws, so it has to come after everything else.
  redirect(safeNextPath(formData.get('next')));
}

export async function logout() {
  (await cookies()).delete(ADMIN_COOKIE);
  redirect('/theaters');
}
