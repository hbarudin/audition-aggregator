import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Theater } from '../lib/types';
import { extractAuditions, getParseClient } from './parse';

/**
 * The daily scrape's parse step runs through the Message Batches API, which
 * costs 50% of standard prices in exchange for giving up a synchronous answer.
 * Measured on a 25-theater sample in Nov 2026, a full run is ~588k input and
 * ~56k output tokens on Haiku 4.5: ~$0.87 standard, ~$0.43 batched.
 *
 * The trade is latency, and it is a real one. Most batches end within the
 * hour; the contract allows 24. So a run cannot assume it will see its own
 * results, and the one thing it must never do is destroy data it cannot
 * replace -- which is why the delete-and-reinsert that used to sit right after
 * each parse now happens only in collectBatch, per theater, and only for a
 * result that actually came back.
 */

// How long a run waits for its own batch before handing it to the next run.
// Generous enough to cover the common case (most batches end well inside an
// hour) without pinning the Actions job near its timeout.
export const POLL_TIMEOUT_MS = 90 * 60_000;
export const POLL_INTERVAL_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PendingBatch {
  id: string;
  submitted_at: string;
  request_count: number;
}

export interface CollectSummary {
  auditions: number;
  theatersWritten: number;
  failed: number;
  skipped: number;
}

export interface ParseRequest {
  theaterId: string;
  params: Anthropic.MessageCreateParamsNonStreaming;
}

/** Submit one batch and write down its id before anything can go wrong. */
export async function submitBatch(
  sb: SupabaseClient,
  requests: ParseRequest[]
): Promise<string> {
  const batch = await getParseClient().messages.batches.create({
    // custom_id is the theater's uuid, so results need no separate mapping --
    // which matters because results come back in arbitrary order.
    requests: requests.map((r) => ({ custom_id: r.theaterId, params: r.params })),
  });

  // Recorded before the first poll, not after: a crash between submit and
  // record is the one failure that orphans a paid-for batch, so the window is
  // kept as small as it can be.
  const { error } = await sb.from('scrape_batches').insert({
    id: batch.id,
    request_count: requests.length,
  });
  if (error) {
    console.error(`  → FAILED to record batch ${batch.id}: ${error.message}`);
    console.error(`  → Collect it by hand with that id; it will not be found automatically.`);
  }

  return batch.id;
}

/** Wait for a batch to end. Returns null if it outlasted the timeout. */
export async function pollUntilEnded(
  batchId: string,
  timeoutMs = POLL_TIMEOUT_MS
): Promise<boolean> {
  const client = getParseClient();
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status === 'ended') return true;

    const c = batch.request_counts;
    const waited = Math.round((timeoutMs - (deadline - Date.now())) / 60_000);
    console.log(
      `  → ${batch.processing_status} after ${waited}m: ${c.succeeded} succeeded, ${c.processing} processing, ${c.errored} errored`
    );

    if (Date.now() + POLL_INTERVAL_MS >= deadline) return false;
    await sleep(POLL_INTERVAL_MS);
  }
}

/** One status check, no waiting. Used when deciding what to do with a leftover. */
export async function hasEnded(batchId: string): Promise<boolean> {
  const batch = await getParseClient().messages.batches.retrieve(batchId);
  return batch.processing_status === 'ended';
}

/** Batches a previous run submitted but never resolved, oldest first. */
export async function findPendingBatches(sb: SupabaseClient): Promise<PendingBatch[]> {
  const { data, error } = await sb
    .from('scrape_batches')
    .select('id,submitted_at,request_count')
    .eq('outcome', 'pending')
    .order('submitted_at');

  if (error) {
    console.error(`Could not read scrape_batches: ${error.message}`);
    return [];
  }
  return (data ?? []) as PendingBatch[];
}

/**
 * Read a finished batch and write its listings.
 *
 * Replacement is per theater and conditional on a succeeded result, which is
 * the important difference from the old inline write. An errored or expired
 * result means we failed to read the page, not that the theater has no
 * auditions, so its existing rows are left exactly as they are -- stale, but
 * true as of the last run that could read it. Only a result that came back
 * gets to overwrite anything.
 */
export async function collectBatch(
  sb: SupabaseClient,
  batchId: string
): Promise<CollectSummary> {
  const client = getParseClient();

  // Re-read theaters rather than trusting anything held from submit time: a
  // recovered batch can be a day old, and the url may have been repaired or
  // the theater deactivated since.
  const { data: theaterRows } = await sb.from('theaters').select('*');
  const theaters = new Map<string, Theater>(
    ((theaterRows ?? []) as Theater[]).map((t) => [t.id, t])
  );

  const summary: CollectSummary = { auditions: 0, theatersWritten: 0, failed: 0, skipped: 0 };
  const today = new Date().toISOString().split('T')[0];

  for await (const result of await client.messages.batches.results(batchId)) {
    const theater = theaters.get(result.custom_id);
    const name = theater?.name ?? result.custom_id;

    if (result.result.type !== 'succeeded') {
      // invalid_request needs a code fix; anything else is safe to retry on
      // the next run, which will resubmit this theater anyway.
      const detail =
        result.result.type === 'errored'
          ? `${result.result.error.type}`
          : result.result.type;
      console.log(`  → ${name}: ${detail} — existing listings left untouched`);
      summary.failed++;
      continue;
    }

    if (!theater) {
      console.log(`  → ${result.custom_id}: theater no longer exists; discarding result`);
      summary.skipped++;
      continue;
    }
    if (!theater.is_active) {
      console.log(`  → ${name}: deactivated since submit; discarding result`);
      summary.skipped++;
      continue;
    }

    const message = result.result.message;
    const auditions = extractAuditions(message.content, message.stop_reason, name);

    // A page listing only past auditions is dormant, not broken. Deactivation
    // is reserved for pages we genuinely cannot read (404, soft-404); old rows
    // are still stored and still truthful, and the app derives freshness from
    // the date columns (lib/expiry.ts), so they land on /past and never
    // surface as current.
    const dated = auditions.filter((a) => a.audition_date_start != null);
    if (dated.length > 0 && dated.every((a) => a.audition_date_start! < today)) {
      const latest = dated.reduce((a, b) => (a.audition_date_start! > b.audition_date_start! ? a : b));
      console.log(`  → ${name}: dormant, every parsed audition date has passed (latest: ${latest.audition_date_start})`);
    }

    // Replace this theater's auditions with fresh data from this scrape run.
    const { error: delError } = await sb.from('auditions').delete().eq('theater_id', theater.id);
    if (delError) {
      console.log(`  → ${name}: delete failed (${delError.message}); skipping to avoid duplicating rows`);
      summary.failed++;
      continue;
    }

    summary.theatersWritten++;

    if (auditions.length === 0) {
      console.log(`  → ${name}: no current auditions`);
      continue;
    }

    const rows = auditions.map((a) => ({
      ...a,
      theater_id: theater.id,
      source_url: theater.audition_page_url,
      scraped_at: new Date().toISOString(),
    }));

    const { error } = await sb.from('auditions').insert(rows);
    if (error) {
      console.log(`  → ${name}: DB insert error: ${error.message}`);
      summary.failed++;
      continue;
    }

    console.log(`  → ${name}: ${auditions.length} audition(s) saved`);
    summary.auditions += auditions.length;
  }

  await resolveBatch(sb, batchId, 'collected', summary);

  return summary;
}

/**
 * Close out a batch row. Worth shouting about on failure: a row left 'pending'
 * means the next run resolves this batch again, deleting and rewriting rows
 * from a staler parse than the one already on disk.
 */
async function resolveBatch(
  sb: SupabaseClient,
  batchId: string,
  outcome: 'collected' | 'cancelled',
  summary?: CollectSummary
): Promise<void> {
  const { error } = await sb
    .from('scrape_batches')
    .update({
      outcome,
      resolved_at: new Date().toISOString(),
      succeeded: summary?.theatersWritten ?? null,
      failed: summary?.failed ?? null,
      skipped: summary?.skipped ?? null,
    })
    .eq('id', batchId);

  if (error) {
    console.error(`  → FAILED to mark batch ${batchId} ${outcome}: ${error.message}`);
    console.error(`  → Set outcome='${outcome}' on that row by hand, or the next run will redo it.`);
  }
}

/**
 * Abandon a batch that is still processing when a newer run starts. The pages
 * this run is about to fetch are fresher than the ones that batch was built
 * from, so racing it buys nothing and risks the stale write. The spend is
 * already sunk either way; cancelling at least stops the requests that have
 * not run yet.
 */
export async function cancelBatch(sb: SupabaseClient, batchId: string): Promise<void> {
  try {
    await getParseClient().messages.batches.cancel(batchId);
  } catch (err) {
    // A batch that ended between the poll and here cannot be cancelled. The
    // row still gets resolved: this run is submitting a newer one.
    console.log(`  → Could not cancel ${batchId}: ${err}`);
  }
  await resolveBatch(sb, batchId, 'cancelled');
}
