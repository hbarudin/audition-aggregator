'use server';

import { createClient } from '@supabase/supabase-js';

function serverClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export type UpdateState = { success: true } | { error: string } | null;

export async function updateTheater(_prevState: UpdateState, formData: FormData): Promise<UpdateState> {
  if (formData.get('key') !== process.env.ADMIN_KEY) {
    return { error: 'Unauthorized.' };
  }

  const id = formData.get('id') as string;
  const name = (formData.get('name') as string).trim();
  const city = (formData.get('city') as string).trim();
  const state = (formData.get('state') as string).trim();
  const audition_page_url = (formData.get('audition_page_url') as string).trim() || null;
  const notes = (formData.get('notes') as string).trim();
  const is_active = formData.get('is_active') === 'true';

  if (!name || !city || !state) {
    return { error: 'Name, city, and state are required.' };
  }

  const { error } = await serverClient()
    .from('theaters')
    .update({ name, city, state, audition_page_url, notes, is_active })
    .eq('id', id);

  if (error) return { error: error.message };

  return { success: true };
}
