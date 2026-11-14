// Fills theaters.latitude / theaters.longitude from the offline city table.
//
//   npx tsx scripts/geo/backfill-coordinates.ts            print the plan
//   npx tsx scripts/geo/backfill-coordinates.ts --apply    write it
//   npx tsx scripts/geo/backfill-coordinates.ts --all      re-geocode rows
//                                                          that already have
//                                                          coordinates
//
// Dry run by default: it prints every row it would touch and every city it
// could not place, and writes nothing until --apply. Nothing is ever cleared
// -- a row that fails to geocode is left exactly as it is, so a coordinate
// typed by hand on the admin page survives later runs.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { geocodeCityState } from '../../lib/geo';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role bypasses RLS
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface Row {
  id: string;
  name: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
}

async function main() {
  const { data, error } = await supabase
    .from('theaters')
    .select('id, name, city, state, latitude, longitude')
    .order('name');

  if (error) {
    console.error('Could not read theaters:', error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  const candidates = ALL ? rows : rows.filter((t) => t.latitude === null || t.longitude === null);

  const planned: Array<Row & { latitude: number; longitude: number }> = [];
  const unplaceable: Row[] = [];

  for (const theater of candidates) {
    const hit = geocodeCityState(theater.city, theater.state);
    if (hit) planned.push({ ...theater, latitude: hit.latitude, longitude: hit.longitude });
    else unplaceable.push(theater);
  }

  console.log(
    `${rows.length} theaters, ${rows.length - candidates.length} already placed, ` +
      `${candidates.length} to look up.\n`
  );

  for (const t of planned) {
    console.log(
      `  ${t.latitude.toFixed(3).padStart(8)}, ${t.longitude.toFixed(3).padStart(9)}  ` +
        `${t.city}, ${t.state}  — ${t.name}`
    );
  }

  if (unplaceable.length) {
    console.log(`\nNot in the city table (left untouched, fix the city on /admin/theaters):`);
    for (const t of unplaceable) {
      console.log(`  ${JSON.stringify(`${t.city}, ${t.state}`)}  — ${t.name}`);
    }
  }

  console.log(`\n${planned.length} to write, ${unplaceable.length} unplaceable.`);

  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to write these.');
    return;
  }

  let written = 0;
  for (const t of planned) {
    const { error: updateError } = await supabase
      .from('theaters')
      .update({ latitude: t.latitude, longitude: t.longitude })
      .eq('id', t.id);

    if (updateError) console.error(`  failed: ${t.name}: ${updateError.message}`);
    else written += 1;
  }

  console.log(`Wrote ${written} of ${planned.length}.`);
}

main();
