'use server';

import { createClient } from '@supabase/supabase-js';

function serverClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface SimilarTheater {
  id: string;
  name: string;
  city: string;
  state: string;
  audition_page_url: string | null;
}

export async function findSimilarTheaters(name: string, url: string): Promise<SimilarTheater[]> {
  const sb = serverClient();
  const found: SimilarTheater[] = [];

  if (name.trim().length >= 3) {
    const { data } = await sb
      .from('theaters')
      .select('id, name, city, state, audition_page_url')
      .ilike('name', `%${name.trim()}%`)
      .limit(5);
    if (data) found.push(...data);
  }

  if (url.trim()) {
    const { data } = await sb
      .from('theaters')
      .select('id, name, city, state, audition_page_url')
      .eq('audition_page_url', url.trim())
      .limit(3);
    if (data) found.push(...data);
  }

  // deduplicate by id
  return [...new Map(found.map((t) => [t.id, t])).values()];
}

type FormState = { success: true; theaterName: string } | { error: string } | null;

export async function addTheater(_prevState: FormState, formData: FormData): Promise<FormState> {
  const name = (formData.get('name') as string).trim();
  const city = (formData.get('city') as string).trim();
  const state = (formData.get('state') as string).trim();
  const audition_page_url = (formData.get('audition_page_url') as string).trim() || null;
  const notes = (formData.get('notes') as string).trim() || '';

  if (!name || !city || !state) {
    return { error: 'Name, city, and state are required.' };
  }

  const { error } = await serverClient()
    .from('theaters')
    .insert({ name, city, state, audition_page_url, notes, is_active: true });

  if (error) return { error: error.message };

  return { success: true, theaterName: name };
}
