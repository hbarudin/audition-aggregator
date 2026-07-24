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

async function deactivateTheater(theater: Theater, reason: string, openIssues: Set<string>): Promise<void> {
  console.log(`  → Deactivating: ${reason}`);
  await supabase.from('theaters').update({ is_active: false }).eq('id', theater.id);
  const title = `Broken page: ${theater.name}`;
  if (openIssues.has(title)) {
    console.log(`  → Issue already open, skipping`);
    return;
  }
  await fileIssue(
    title,
    `The scraper detected a broken or outdated audition page for **${theater.name}**.\n\n**URL:** ${theater.audition_page_url}\n**Reason:** ${reason}\n\nThis theater has been set to \`is_active = false\` and will be excluded from future scrapes until the URL is fixed and the theater is re-activated.`,
    ['scraper-issue']
  );
}

interface ScrapeResult {
  auditions: number;
  deactivated: boolean;
}

async function scrapeTheater(theater: Theater, openIssues: Set<string>): Promise<ScrapeResult> {
  const { text: pageText, status } = await fetchPage(theater.audition_page_url!);

  if (status === 404) {
    await deactivateTheater(theater, `HTTP 404 — page does not exist`, openIssues);
    return { auditions: 0, deactivated: true };
  }

  if (!pageText) return { auditions: 0, deactivated: false };

  if (PAGE_NOT_FOUND_RE.test(pageText.slice(0, 2_000))) {
    await deactivateTheater(theater, `Page content matches "page not found" pattern`, openIssues);
    return { auditions: 0, deactivated: true };
  }

  const auditions = await parseAuditions(pageText, theater.name);

  // If Claude found auditions but every dated one is from before 2025, the page is stale.
  const datedAuditions = auditions.filter((a) => a.audition_date_start != null);
  const allPreDateline = datedAuditions.length > 0 && datedAuditions.every((a) => a.audition_date_start! < '2025-01-01');
  if (allPreDateline) {
    await deactivateTheater(
      theater,
      `All parsed audition dates are from before 2025 (oldest: ${datedAuditions[0].audition_date_start})`,
      openIssues
    );
    return { auditions: 0, deactivated: true };
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

    const hasOpenIssue =
      openIssues.has(`Broken page: ${theater.name}`) ||
      openIssues.has(`Missing audition URL: ${theater.name}`);

    if (hasOpenIssue) {
      console.log(`  → Skipping: open issue exists`);
      if (i < theaters.length - 1) await sleep(DELAY_MS);
      continue;
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
