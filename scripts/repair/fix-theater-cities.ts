// One-off cleanup for issue #170: theaters whose `city` column holds a
// misspelling, the wrong state, or scraper debris.
//
//   npx tsx scripts/repair/fix-theater-cities.ts                   print the plan
//   npx tsx scripts/repair/fix-theater-cities.ts --apply           write the confident rows
//   npx tsx scripts/repair/fix-theater-cities.ts --inferred village,red-barn
//                                                                  add named judgment calls
//
// This is a display bug before it is a geocoding one: the site prints
// `city, state` under every theater name, so "Auditions - RTOP Theatre -
// Pullman, WA" is on the home page right now. Correcting the city geocodes the
// row as a side effect, so each theater is one edit, not two.
//
// Two tiers, and --apply alone only writes the first:
//
//   confident  a misspelling, a wrong state, or a venue name wrapped around a
//              real city. The intended value is not in question.
//   inferred   the city is absent, a county, or a resort, and the replacement
//              is read off the theater's name rather than corrected. Each is
//              named with --inferred and opted into one at a time, so a plain
//              --apply cannot act on a guess and there is no flag that takes
//              all of them at once.
//
// Every row asserts the city it expects to find. A theater edited by hand
// since this list was written is skipped and reported, never overwritten.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { geocodeCityState } from '../../lib/geo';

const APPLY = process.argv.includes('--apply');

/** --inferred village,red-barn -> ['village', 'red-barn'] */
function inferredKeys(): string[] {
  const at = process.argv.indexOf('--inferred');
  if (at === -1) return [];
  return (process.argv[at + 1] ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

interface Correction {
  /** Short handle for --inferred. Only the inferred rows need one. */
  key?: string;
  id: string;
  name: string;
  /** Asserted against the live row before anything is written. */
  fromCity: string;
  fromState: string;
  toCity: string;
  toState: string;
  /** Shown in the plan. Why this row is being changed, in a few words. */
  because: string;
}

const CONFIDENT: Correction[] = [
  { id: '47006db8-8d3c-4ddf-a842-a1d5665210fa', name: 'Red Mountain Theatre Company',
    fromCity: 'Brimingham', fromState: 'AL', toCity: 'Birmingham', toState: 'AL',
    because: 'misspelling' },
  { id: '469076e9-a535-4772-a95e-44c6d44bc380', name: 'Cupcake Theatre',
    fromCity: 'Los Angles', fromState: 'CA', toCity: 'Los Angeles', toState: 'CA',
    because: 'misspelling' },
  { id: 'ec8de7c3-f931-4383-83a0-af0e7ae888f0', name: 'Berkley Rep',
    fromCity: 'Berkley', fromState: 'CA', toCity: 'Berkeley', toState: 'CA',
    because: 'misspelling' },
  { id: '04872524-2886-4cd9-8506-3a4092f805e0', name: 'Nettle Creek Players',
    fromCity: 'Hangerstown', fromState: 'IN', toCity: 'Hagerstown', toState: 'IN',
    because: 'misspelling' },
  { id: 'eadaf873-b411-49ad-ab9c-0496803e3f1f', name: 'Theatre at the Center',
    fromCity: 'Muster', fromState: 'IN', toCity: 'Munster', toState: 'IN',
    because: 'misspelling' },
  { id: '61a3ab1b-ed40-4b1f-bd1f-65559ca015e4', name: 'The Stephen Foster Story',
    fromCity: 'Bradstown', fromState: 'KY', toCity: 'Bardstown', toState: 'KY',
    because: 'misspelling' },
  { id: '38150d9f-0085-4c86-9574-bf4cdc176adf', name: 'Cedar Summerstock Theater',
    fromCity: 'Ansgar', fromState: 'IA', toCity: 'Saint Ansgar', toState: 'IA',
    because: 'misspelling' },
  { id: '2e3cb6b5-4e35-4323-923e-7c007374ccc1', name: 'Cedar Summerstock Theatre',
    fromCity: 'Ansgar', fromState: 'IA', toCity: 'Saint Ansgar', toState: 'IA',
    because: 'misspelling' },

  { id: '35fd83af-ae0f-422b-8e56-9ec41709a92e', name: 'Indiana Repertory Theatre',
    fromCity: 'Indianapolis', fromState: 'ID', toCity: 'Indianapolis', toState: 'IN',
    because: 'wrong state' },
  { id: '15215f02-273c-40fc-915f-36fbdc5b36aa', name: 'Charleston Stage',
    fromCity: 'Charleston', fromState: 'NC', toCity: 'Charleston', toState: 'SC',
    because: 'wrong state' },

  { id: '783e198e-efa1-4c47-b0e6-9096f56585bf', name: 'Pines Dinner Theatre',
    fromCity: 'Perform at the Pines - Pines Dinner Theatre - Allentown', fromState: 'PA',
    toCity: 'Allentown', toState: 'PA',
    because: 'scraper debris' },
  { id: '7199f8b8-2790-4634-842f-6f833199a6d6', name: 'Regional Theatre of the Palouse',
    fromCity: 'Auditions - RTOP Theatre - Pullman', fromState: 'WA',
    toCity: 'Pullman', toState: 'WA',
    because: 'scraper debris' },
  { id: 'bad53c2c-4c4c-480b-8989-b84ee9d5153d', name: 'The Market Theatre',
    fromCity: 'Audition — Market Theatre | Anderson', fromState: 'SC',
    toCity: 'Anderson', toState: 'SC',
    because: 'scraper debris' },
];

const INFERRED_ROWS: Correction[] = [
  { key: 'village', id: '2b38077f-5910-4b7f-899b-5d1f512a1648', name: 'Village Theatre',
    fromCity: 'Auditions - Village Theatre in Issaquah & Everett', fromState: 'WA',
    toCity: 'Issaquah', toState: 'WA',
    because: 'two venues, Issaquah and Everett; one row holds one city' },
  { key: 'guild', id: 'eb04f4f5-684d-433d-9c44-2605570a538e', name: 'Colorado Theatre Guild',
    fromCity: '', fromState: 'CO', toCity: 'Denver', toState: 'CO',
    because: 'city is empty; a statewide guild may have no single home' },
  { key: 'red-barn', id: '5ca3b815-87c3-4bcc-9fe6-68b7cb8ce57b', name: 'Red Barn Summer Theatre',
    fromCity: 'Clinton County', fromState: 'IN', toCity: 'Frankfort', toState: 'IN',
    because: 'a county, not a town; Frankfort is its seat' },
  { key: 'sundance', id: '5365ac81-f2cc-4aaa-be41-ce023bb2dce1', name: 'Sundance Summer Theatre',
    fromCity: 'Sundance', fromState: 'UT', toCity: 'Provo', toState: 'UT',
    because: 'a resort, not a place; Provo is ~12 mi off, which a 25-mi radius would feel' },
  { key: 'artistree', id: 'c7f4af3c-7639-406c-a39d-3c60354650a6', name: 'ArtisTree Music Theatre Festival- The Grange Theatre',
    fromCity: 'Promfret', fromState: 'VT', toCity: 'South Pomfret', toState: 'VT',
    because: 'Pomfret VT does not resolve either; the venue is in South Pomfret' },
];

// Left alone on purpose. Gananoque is in Ontario and a US-only table will never
// place it; the right outcome there is null coordinates, not a wrong city.
const LEAVE_ALONE = [
  { name: 'The Thousand Island Playhouse', city: 'Gananoque, ON', why: 'Canadian; out of scope for lib/geo' },
];

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // service role bypasses RLS
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface Row { id: string; name: string; city: string; state: string }

async function main() {
  const chosen = inferredKeys();
  const unknown = chosen.filter((k) => !INFERRED_ROWS.some((r) => r.key === k));
  if (unknown.length) {
    console.error(
      `Unknown --inferred key(s): ${unknown.join(', ')}.\n` +
        `Known: ${INFERRED_ROWS.map((r) => r.key).join(', ')}`
    );
    process.exit(1);
  }

  const opted = INFERRED_ROWS.filter((r) => chosen.includes(r.key!));
  const held = INFERRED_ROWS.filter((r) => !chosen.includes(r.key!));
  const planned = [...CONFIDENT, ...opted];

  const { data, error } = await supabase
    .from('theaters')
    .select('id, name, city, state')
    .in('id', planned.map((c) => c.id));

  if (error) {
    console.error('Could not read theaters:', error.message);
    process.exit(1);
  }

  const live = new Map((data as Row[]).map((t) => [t.id, t]));
  const ready: Array<Correction & { latitude: number; longitude: number }> = [];
  const skipped: Array<{ correction: Correction; why: string }> = [];

  for (const correction of planned) {
    const row = live.get(correction.id);
    if (!row) {
      skipped.push({ correction, why: 'no theater with that id' });
      continue;
    }
    if (row.city !== correction.fromCity || row.state !== correction.fromState) {
      skipped.push({
        correction,
        why: `row now reads ${JSON.stringify(`${row.city}, ${row.state}`)}; expected ` +
          `${JSON.stringify(`${correction.fromCity}, ${correction.fromState}`)}`,
      });
      continue;
    }
    const hit = geocodeCityState(correction.toCity, correction.toState);
    if (!hit) {
      skipped.push({ correction, why: `${correction.toCity}, ${correction.toState} does not geocode` });
      continue;
    }
    ready.push({ ...correction, latitude: hit.latitude, longitude: hit.longitude });
  }

  console.log(
    `${CONFIDENT.length} confident rows` +
      (opted.length ? ` + ${opted.length} inferred (${opted.map((r) => r.key).join(', ')})` : '') +
      '\n'
  );

  for (const c of ready) {
    console.log(`  ${c.name}`);
    console.log(
      `    ${JSON.stringify(`${c.fromCity}, ${c.fromState}`)} -> ` +
        `${JSON.stringify(`${c.toCity}, ${c.toState}`)}  ` +
        `(${c.latitude}, ${c.longitude})  — ${c.because}`
    );
  }

  if (skipped.length) {
    console.log('\nSkipped:');
    for (const s of skipped) console.log(`  ${s.correction.name}: ${s.why}`);
  }

  if (held.length) {
    console.log('\nInferred rows not opted into (add with --inferred <key>):');
    for (const r of held) console.log(`  ${r.key!.padEnd(10)} ${r.name} — ${r.because}`);
  }

  console.log('\nLeft alone:');
  for (const l of LEAVE_ALONE) console.log(`  ${l.name} (${l.city}): ${l.why}`);

  console.log(`\n${ready.length} to write, ${skipped.length} skipped.`);

  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to write these.');
    return;
  }

  let written = 0;
  for (const c of ready) {
    const { error: updateError } = await supabase
      .from('theaters')
      .update({ city: c.toCity, state: c.toState, latitude: c.latitude, longitude: c.longitude })
      .eq('id', c.id);

    if (updateError) console.error(`  failed: ${c.name}: ${updateError.message}`);
    else written += 1;
  }

  console.log(`Wrote ${written} of ${ready.length}.`);
}

main();
