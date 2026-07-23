// Run with: npx tsx scripts/seed-theaters.ts
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { theaterSeeds } from './theater-seeds';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role bypasses RLS for seeding
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  console.log(`Seeding ${theaterSeeds.length} theaters...`);

  const { error } = await supabase.from('theaters').insert(
    theaterSeeds.map(t => ({
      name: t.name,
      city: t.city,
      state: t.state,
      audition_page_url: t.audition_page_url,
      notes: t.notes,
    }))
  );

  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }

  console.log('Done.');
}

main();
