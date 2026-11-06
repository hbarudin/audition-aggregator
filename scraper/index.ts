import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { Theater } from '../lib/types';
import { fetchPage } from './fetch';
import { parseAuditions } from './parse';
import { fileIssue, fetchOpenScraperIssueTitles } from './github';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const DELAY_MS = 1_000; // be polite to theater servers

const PAGE_NOT_FOUND_RE = /\b(page not found|404 not found|this page (doesn't|does not) exist|we couldn't find this page|page cannot be found)\b/i;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns whether the theater was actually deactivated. */
async function deactivateTheater(theater: Theater, reason: string, openIssues: Set<string>): Promise<boolean> {
  console.log(`  → Deactivating: ${reason}`);

  // This write silently did nothing for months: service_role was missing the
  // UPDATE grant on theaters and the error was discarded. Surface it instead.
  const { error } = await supabase.from('theaters').update({ is_active: false }).eq('id', theater.id);
  if (error) {
    console.error(`  → FAILED to deactivate ${theater.name}: ${error.message}`);
    return false;
  }

  const title = `Broken page: ${theater.name}`;
  if (openIssues.has(title)) {
    console.log(`  → Issue already open, skipping`);
    return true;
  }
  await fileIssue(
    title,
    `The scraper detected a broken or outdated audition page for **${theater.name}**.\n\n**URL:** ${theater.audition_page_url}\n**Reason:** ${reason}\n\nThis theater has been set to \`is_active = false\` and will be excluded from future scrapes until the URL is fixed and the theater is re-activated.`,
    ['scraper-issue']
  );

  return true;
}

interface ScrapeResult {
  auditions: number;
  deactivated: boolean;
}

async function scrapeTheater(theater: Theater, openIssues: Set<string>): Promise<ScrapeResult> {
  const { text: pageText, status } = await fetchPage(theater.audition_page_url!);

  if (status === 404) {
    const deactivated = await deactivateTheater(theater, `HTTP 404 — page does not exist`, openIssues);
    return { auditions: 0, deactivated };
  }

  if (!pageText) return { auditions: 0, deactivated: false };

  if (PAGE_NOT_FOUND_RE.test(pageText.slice(0, 2_000))) {
    const deactivated = await deactivateTheater(theater, `Page content matches "page not found" pattern`, openIssues);
    return { auditions: 0, deactivated };
  }

  const auditions = await parseAuditions(pageText, theater.name);

  // A page listing only past auditions is dormant, not broken. This used to
  // deactivate the theater against a hardcoded 2025-01-01 dateline, which was
  // wrong three ways: the wall never moved, so what counted as "stale" drifted
  // further from the truth every month; a correct URL got reported as a broken
  // page; and worst, deactivating cost us the theater's next season, because a
  // deactivated theater is never scraped again and so the call we were waiting
  // for could never be picked up.
  //
  // Deactivation is now reserved for pages we genuinely cannot read (404,
  // soft-404). Old rows are still stored and still truthful: the app derives
  // freshness from the date columns (lib/expiry.ts), so they land on /past and
  // never surface as current.
  const datedAuditions = auditions.filter((a) => a.audition_date_start != null);
  const today = new Date().toISOString().split('T')[0];
  if (datedAuditions.length > 0 && datedAuditions.every((a) => a.audition_date_start! < today)) {
    const latest = datedAuditions.reduce((a, b) => (a.audition_date_start! > b.audition_date_start! ? a : b));
    console.log(`  → Dormant: every parsed audition date has passed (latest: ${latest.audition_date_start})`);
  }

  // Replace this theater's auditions with fresh data from this scrape run
  await supabase.from('auditions').delete().eq('theater_id', theater.id);

  if (auditions.length === 0) {
    console.log(`  → No current auditions`);
    return { auditions: 0, deactivated: false };
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
    return { auditions: 0, deactivated: false };
  }

  console.log(`  → ${auditions.length} audition(s) saved`);
  return { auditions: auditions.length, deactivated: false };
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

  const openIssues = await fetchOpenScraperIssueTitles();
  console.log(`Loaded ${openIssues.size} open scraper issue(s) from GitHub\n`);

  // File issues for active theaters with no audition URL configured
  const { data: noUrl } = await supabase
    .from('theaters')
    .select('*')
    .eq('is_active', true)
    .is('audition_page_url', null);

  if (noUrl && noUrl.length > 0) {
    console.log(`Filing issues for ${noUrl.length} theater(s) missing an audition URL...\n`);
    for (const t of noUrl as Theater[]) {
      const title = `Missing audition URL: ${t.name}`;
      if (openIssues.has(title)) {
        console.log(`  → ${t.name} (issue already open, skipping)`);
        continue;
      }
      console.log(`  → ${t.name}`);
      await fileIssue(
        title,
        `**${t.name}** is marked active in the database but has no \`audition_page_url\` set, so it cannot be scraped.\n\nPlease find and add the correct URL, or set \`is_active = false\` if this theater should be excluded.`,
        ['scraper-issue']
      );
    }
    console.log();
  }

  console.log(`Scraping ${theaters.length} theaters...\n`);

  let totalAuditions = 0;
  let errorCount = 0;
  let deactivatedCount = 0;

  for (let i = 0; i < theaters.length; i++) {
    const theater = theaters[i] as Theater;
    console.log(`[${i + 1}/${theaters.length}] ${theater.name}`);

    // An open issue used to skip the theater entirely. That was redundant --
    // a genuinely broken theater is already is_active = false and never
    // reaches this loop -- and it quietly froze every theater someone
    // re-activated to retry: the open issue kept it from ever being scraped
    // again, so the issue itself became the thing keeping it broken.
    // Duplicate issues are already prevented inside deactivateTheater.
    if (openIssues.has(`Broken page: ${theater.name}`)) {
      console.log(`  → Has an open tracker issue; re-trying it anyway`);
    }

    try {
      const result = await scrapeTheater(theater, openIssues);
      totalAuditions += result.auditions;
      if (result.deactivated) deactivatedCount++;
    } catch (err) {
      console.log(`  → Unexpected error: ${err}`);
      errorCount++;
    }

    if (i < theaters.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n--- Done ---`);
  console.log(`Theaters:    ${theaters.length}`);
  console.log(`Auditions:   ${totalAuditions}`);
  console.log(`Deactivated: ${deactivatedCount}`);
  console.log(`Errors:      ${errorCount}`);
}

main();
