'use server';

import { createClient } from '@supabase/supabase-js';
import { isAdmin } from '@/lib/admin';
import { geocodeCityState } from '@/lib/geo';

function serverClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export type UpdateState = { success: true } | { error: string } | null;

export async function updateTheater(_prevState: UpdateState, formData: FormData): Promise<UpdateState> {
  if (!(await isAdmin())) {
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

  // Re-geocoded on every save, since the city is what is being edited. A city
  // that does not resolve clears the coordinates rather than leaving the old
  // city's ones behind: a wrong location is worse than no location.
  const coordinates = geocodeCityState(city, state);

  const { error } = await serverClient()
    .from('theaters')
    .update({
      name,
      city,
      state,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      audition_page_url,
      notes,
      is_active,
    })
    .eq('id', id);

  if (error) return { error: error.message };

  return { success: true };
}
