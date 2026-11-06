import * as fs from 'fs';
import * as path from 'path';
import { REPAIR_DIR } from './report';

/**
 * Passing over a theater is a decision, just a quiet one. Applying a batch
 * without selecting a row means "I looked at this and it is not worth doing
 * now", so the theater is snoozed rather than re-queued into the next batch.
 *
 * It is a snooze and not a retirement: a theater between seasons becomes worth
 * another look once the season turns, so the record expires.
 */

export const DEFER_DAYS = 30;

const DEFER_FILE = path.join(REPAIR_DIR, 'deferred.json');

export interface Deferral {
  theaterId: string;
  theaterName: string;
  at: string;
}

export function readDeferrals(): Deferral[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(DEFER_FILE, 'utf8'));
    return Array.isArray(parsed) ? (parsed as Deferral[]) : [];
  } catch {
    return [];
  }
}

/** Theater ids snoozed and not yet expired. */
export function activeDeferrals(now = new Date()): Map<string, Deferral> {
  const cutoff = now.getTime() - DEFER_DAYS * 24 * 60 * 60 * 1000;
  const out = new Map<string, Deferral>();
  for (const d of readDeferrals()) {
    const at = Date.parse(d.at);
    if (Number.isFinite(at) && at >= cutoff) out.set(d.theaterId, d);
  }
  return out;
}

/** Records a pass-over, replacing any earlier one so the clock restarts. */
export function recordDeferrals(deferrals: Deferral[]): void {
  if (deferrals.length === 0) return;
  const fresh = new Map(readDeferrals().map((d) => [d.theaterId, d]));
  for (const d of deferrals) fresh.set(d.theaterId, d);
  try {
    fs.mkdirSync(REPAIR_DIR, { recursive: true });
    fs.writeFileSync(DEFER_FILE, JSON.stringify([...fresh.values()], null, 2));
  } catch (err) {
    // The applied writes already succeeded; losing the snooze log only means
    // the theater comes back sooner than intended.
    console.error(`Could not record deferrals to ${DEFER_FILE}: ${err}`);
  }
}
