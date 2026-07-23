import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { Theater } from '../lib/types';
import { fetchPage } from './fetch';
import { parseAuditions } from './parse';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const DELAY_MS = 1_000; // be polite to theater servers

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeTheater(theater: Theater): Promise<number> {
  const pageText = await fetchPage(theater.audition_page_url!);
  if (!pageText) return 0;

  const auditions = await parseAuditions(pageText, theater.name);

  // Replace this theater's auditions with fresh data from this scrape run
  await supabase.from('auditions').delete().eq('theater_id', theater.id);

  if (auditions.length === 0) {
    console.log(`  → No current auditions`);
    return 0;
  }

  const rows = auditions.map((a) => ({
    ...a,
    theater_id: theater.id,
    source_url: theater.audition_page_url,
    scraped_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('auditions').insert(rows);
  if (error) {
    console.log(`  → DB insert error: ${error.message}`);
    return 0;
  }

  console.log(`  → ${auditions.length} audition(s) saved`);
  return auditions.length;
}

async function main() {
  const { data: theaters, error } = await supabase
    .from('theaters')
    .select('*')
    .eq('is_active', true)
    .not('audition_page_url', 'is', null);

  if (error) {
    console.error('Failed to load theaters:', error.message);
    process.exit(1);
  }

  console.log(`Scraping ${theaters.length} theaters...\n`);

  let totalAuditions = 0;
  let errorCount = 0;

  for (let i = 0; i < theaters.length; i++) {
    const theater = theaters[i] as Theater;
    console.log(`[${i + 1}/${theaters.length}] ${theater.name}`);

    try {
      const found = await scrapeTheater(theater);
      totalAuditions += found;
    } catch (err) {
      console.log(`  → Unexpected error: ${err}`);
      errorCount++;
    }

    if (i < theaters.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n--- Done ---`);
  console.log(`Theaters:  ${theaters.length}`);
  console.log(`Auditions: ${totalAuditions}`);
  console.log(`Errors:    ${errorCount}`);
}

main();
