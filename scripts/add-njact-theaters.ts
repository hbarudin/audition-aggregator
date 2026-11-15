import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { geocodeCityState, geocodeZip } from '../lib/geo';

/**
 * Bulk-adds theaters from a reviewed sheet. Same shape as the repair flow:
 * the sheet is the proposal, nothing is written without --yes.
 *
 *   npx tsx scripts/add-njact-theaters.ts repair/njact-adds-2026-11-14.tsv
 *   npx tsx scripts/add-njact-theaters.ts <sheet> --yes
 *
 * Decision column:
 *   y   insert this theater
 *   ?   skip (the default for rows whose audition URL looked fragile)
 *   n   skip
 *
 * This script only ever INSERTs. It never updates or deactivates an existing
 * row, so a mistaken run leaves the current data intact and is undone by
 * deleting the rows it printed.
 */

interface Row {
  decision: string; miles: string; theater: string; city: string; state: string;
  zip: string; audition_page_url: string; website: string; njact: string; caution: string; note: string;
}

const file = process.argv[2];
const apply = process.argv.includes('--yes');
if (!file) {
  console.error('usage: npx tsx scripts/add-njact-theaters.ts <sheet.tsv> [--yes]');
  process.exit(1);
}

function parseSheet(path: string): Row[] {
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {} as Record<string, string>;
    header.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()));
    return row as unknown as Row;
  });
}

async function main() {
  const rows = parseSheet(file);
  const chosen = rows.filter((r) => r.decision.toLowerCase() === 'y');
  const skipped = rows.length - chosen.length;

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Re-check against live data at apply time, not just at proposal time: the
  // sheet may have been sitting for a while, and inserting a duplicate theater
  // is the one mistake this script could make that is tedious to unpick.
  const { data: existing, error } = await db.from('theaters').select('name, audition_page_url');
  if (error) throw error;
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const seenName = new Set((existing ?? []).map((t) => t.name.toLowerCase().trim()));
  const seenHost = new Set((existing ?? []).map((t) => host(t.audition_page_url ?? '')).filter(Boolean));

  const toInsert: Record<string, unknown>[] = [];
  const collisions: string[] = [];
  const uncoded: string[] = [];

  for (const r of chosen) {
    if (seenName.has(r.theater.toLowerCase().trim()) || (host(r.audition_page_url) && seenHost.has(host(r.audition_page_url)))) {
      collisions.push(r.theater);
      continue;
    }
    // A ZIP off the theater's own contact page beats a town centroid, and
    // covers the rows where the address scraped cleanly but the town name
    // is not one the places table carries.
    const coords = (r.zip ? geocodeZip(r.zip) : null) ?? geocodeCityState(r.city, r.state);
    if (!coords) uncoded.push(`${r.theater} (${r.city || 'no city'}, ${r.state})`);
    toInsert.push({
      name: r.theater,
      city: r.city,
      state: r.state,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      audition_page_url: r.audition_page_url,
      notes: `NJACT ${r.njact} member. Added from ${file} on 2026-11-14.`,
      is_active: true,
    });
  }

  console.log(`sheet            ${file}`);
  console.log(`marked y         ${chosen.length} of ${rows.length}  (${skipped} left as ? or n)`);
  console.log(`already in DB    ${collisions.length}${collisions.length ? ' -> ' + collisions.join(', ') : ''}`);
  console.log(`will insert      ${toInsert.length}`);
  console.log(`without coords   ${uncoded.length}${uncoded.length ? ' -> ' + uncoded.join('; ') : ''}`);
  console.log('');
  for (const t of toInsert) {
    console.log(`  + ${String(t.name).slice(0, 38).padEnd(40)} ${String(t.city).slice(0, 18).padEnd(19)} ${t.state}  ${t.audition_page_url}`);
  }

  if (!apply) {
    console.log(`\nDRY RUN - nothing written. Re-run with --yes to insert these ${toInsert.length} rows.`);
    return;
  }
  if (!toInsert.length) {
    console.log('\nNothing to insert.');
    return;
  }

  const { data, error: insertError } = await db.from('theaters').insert(toInsert).select('id, name');
  if (insertError) throw insertError;
  console.log(`\nInserted ${data?.length ?? 0} theaters.`);
  fs.writeFileSync(file.replace(/\.tsv$/, '.inserted.json'), JSON.stringify(data, null, 2));
  console.log(`Ids written to ${file.replace(/\.tsv$/, '.inserted.json')} (delete those to undo).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
