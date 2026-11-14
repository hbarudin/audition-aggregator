// Run with: npx tsx scripts/seed-theaters.ts
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { theaterSeeds } from './theater-seeds';
import { geocodeCityState } from '../lib/geo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role bypasses RLS for seeding
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  console.log(`Seeding ${theaterSeeds.length} theaters...`);

  // Geocoded here for the same reason /add-theater does it: so a freshly
  // seeded database has a working radius filter without anyone remembering to
  // run the backfill. Seeds whose city will not resolve stay null, and
  // scripts/geo/backfill-coordinates.ts prints them.
  const rows = theaterSeeds.map(t => {
    const coordinates = geocodeCityState(t.city, t.state);
    return {
      name: t.name,
      city: t.city,
      state: t.state,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      audition_page_url: t.audition_page_url,
      notes: t.notes,
    };
  });

  const unplaceable = rows.filter(r => r.latitude === null).length;
  if (unplaceable) console.log(`${unplaceable} could not be geocoded; run scripts/geo/backfill-coordinates.ts after fixing their cities.`);

  const { error } = await supabase.from('theaters').insert(rows);

  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }

  console.log('Done.');
}

main();
