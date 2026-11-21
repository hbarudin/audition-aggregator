import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { Theater } from '../lib/types';
import { fetchPage } from './fetch';
import { buildParseRequest } from './parse';
import {
  ParseRequest,
  cancelBatch,
  collectBatch,
  findPendingBatches,
  hasEnded,
  pollUntilEnded,
  submitBatch,
} from './batch';
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

/**
 * Settle anything a previous run left owed, before this run submits work of
 * its own. Order matters: resolving first means a slow batch can only ever
 * write data that is older than nothing, never older than something.
 */
async function resolveOwedBatches(): Promise<void> {
  const pending = await findPendingBatches(supabase);
  if (pending.length === 0) return;

  console.log(`${pending.length} batch(es) from a previous run were never resolved:\n`);

  for (const batch of pending) {
    const age = Math.round((Date.now() - new Date(batch.submitted_at).getTime()) / 3_600_000);
    console.log(`Batch ${batch.id} (${batch.request_count} requests, submitted ${age}h ago)`);

    if (await hasEnded(batch.id)) {
      const summary = await collectBatch(supabase, batch.id);
      console.log(
        `  → Collected: ${summary.auditions} audition(s) across ${summary.theatersWritten} theater(s), ${summary.failed} failed, ${summary.skipped} skipped\n`
      );
    } else {
      console.log(`  → Still processing; cancelling in favour of this run's fresher pages`);
      await cancelBatch(supabase, batch.id);
      console.log();
    }
  }
}

interface FetchPhase {
  requests: ParseRequest[];
  fetchFailed: number;
  deactivated: number;
}

/**
 * Fetch every page and build the parse request for it. Everything that does
 * not need the model -- 404s, soft-404s, deactivation, issue filing -- is
 * settled here, synchronously, exactly as it was before batching.
 */
async function fetchAll(theaters: Theater[], openIssues: Set<string>): Promise<FetchPhase> {
  const requests: ParseRequest[] = [];
  let fetchFailed = 0;
  let deactivated = 0;

  for (let i = 0; i < theaters.length; i++) {
    const theater = theaters[i];
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
      const { text: pageText, status } = await fetchPage(theater.audition_page_url!);

      if (status === 404) {
        if (await deactivateTheater(theater, `HTTP 404 — page does not exist`, openIssues)) deactivated++;
      } else if (!pageText) {
        fetchFailed++;
      } else if (PAGE_NOT_FOUND_RE.test(pageText.slice(0, 2_000))) {
        if (await deactivateTheater(theater, `Page content matches "page not found" pattern`, openIssues)) deactivated++;
      } else {
        requests.push({
          theaterId: theater.id,
          params: buildParseRequest(pageText, theater.name),
        });
        console.log(`  → Queued for parsing (${pageText.length} chars)`);
      }
    } catch (err) {
      console.log(`  → Unexpected error: ${err}`);
      fetchFailed++;
    }

    if (i < theaters.length - 1) await sleep(DELAY_MS);
  }

  return { requests, fetchFailed, deactivated };
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

  await resolveOwedBatches();

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

  console.log(`Fetching ${theaters.length} theater pages...\n`);
  const { requests, fetchFailed, deactivated } = await fetchAll(theaters as Theater[], openIssues);

  if (requests.length === 0) {
    console.log(`\nNo readable pages to parse; nothing to submit.`);
    return;
  }

  console.log(`\nSubmitting ${requests.length} page(s) as one batch...`);
  const batchId = await submitBatch(supabase, requests);
  console.log(`Batch ${batchId} submitted. Waiting for results.\n`);

  const ended = await pollUntilEnded(batchId);

  if (!ended) {
    // Not a failure. The batch is recorded as pending, the next run resolves
    // it, and today's listings stay as they were rather than half-written.
    console.log(`\n--- Batch still processing ---`);
    console.log(`Left pending; tomorrow's run will collect it before submitting.`);
    console.log(`Theaters:    ${theaters.length}`);
    console.log(`Queued:      ${requests.length}`);
    console.log(`Fetch fails: ${fetchFailed}`);
    console.log(`Deactivated: ${deactivated}`);
    return;
  }

  console.log(`\nCollecting results...\n`);
  const summary = await collectBatch(supabase, batchId);

  console.log(`\n--- Done ---`);
  console.log(`Theaters:    ${theaters.length}`);
  console.log(`Queued:      ${requests.length}`);
  console.log(`Fetch fails: ${fetchFailed}`);
  console.log(`Deactivated: ${deactivated}`);
  console.log(`Auditions:   ${summary.auditions} across ${summary.theatersWritten} theater(s)`);
  console.log(`Failed:      ${summary.failed}`);
  console.log(`Skipped:     ${summary.skipped}`);
}

main();
