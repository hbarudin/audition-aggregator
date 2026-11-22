import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

/**
 * One-off: the 2026-11-21 Pennsylvania batch went in before the notes fix in
 * add-njact-theaters.ts, so all 14 rows carry the NJACT note verbatim --
 * wrong on the membership, the empty njact column and the hardcoded date.
 *
 *   npx tsx scripts/repair/fix-pa-notes.ts            # dry run
 *   npx tsx scripts/repair/fix-pa-notes.ts --yes      # apply
 *
 * Scoped two ways on purpose: only the ids this batch actually inserted, and
 * only rows whose note still matches the bad string exactly. A row someone has
 * since edited by hand is left alone rather than overwritten.
 */

const IDS_FILE = 'repair/pa-adds.inserted.json';
const BAD = 'NJACT  member. Added from repair/pa-adds.tsv on 2026-11-14.';
const GOOD = 'Added from repair/pa-adds.tsv on 2026-11-21.';

const apply = process.argv.includes('--yes');

async function main() {
  const ids: string[] = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8')).map((r: { id: string }) => r.id);

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await db.from('theaters').select('id, name, notes').in('id', ids);
  if (error) throw error;

  const stale = (data ?? []).filter((r) => r.notes === BAD);
  const other = (data ?? []).filter((r) => r.notes !== BAD);

  console.log(`ids on file      ${ids.length}`);
  console.log(`found in DB      ${data?.length ?? 0}`);
  console.log(`will update      ${stale.length}`);
  console.log(`left alone       ${other.length}${other.length ? ' -> ' + other.map((r) => r.name).join(', ') : ''}`);
  console.log('');
  for (const r of stale) {
    console.log(`  ${r.name}`);
    console.log(`    - ${r.notes}`);
    console.log(`    + ${GOOD}`);
  }

  if (!apply) {
    console.log(`\nDRY RUN - nothing written. Re-run with --yes to update these ${stale.length} rows.`);
    return;
  }
  if (!stale.length) {
    console.log('\nNothing to update.');
    return;
  }

  const { data: updated, error: updateError } = await db
    .from('theaters')
    .update({ notes: GOOD })
    .in('id', stale.map((r) => r.id))
    .eq('notes', BAD)
    .select('id, name');
  if (updateError) throw updateError;

  console.log(`\nUpdated ${updated?.length ?? 0} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
