/**
 * Shared tests for "is this a readable audition page", used by both discovery
 * tracks so the two cannot drift.
 */

export const SOFT_404_RE =
  /\b(page not found|404 not found|this page (doesn't|does not) exist|we couldn't find this page|page cannot be found|nothing found)\b/i;

/**
 * The plural matters more than the singular here: audition pages are titled
 * "Auditions" far more often than "Audition", and an earlier version of this
 * pattern wrote `audition` with no optional `s`. With the trailing `\b` that
 * never matched the plural, so pages whose only signal was the word
 * "Auditions" were discarded as not being audition pages at all.
 */
export const AUDITION_WORD_RE = /\b(auditions?|casting|open call|submissions?)\b/i;
