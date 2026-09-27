// Freshness is derived from the typed date columns rather than the stored
// is_expired flag: the scraper's LLM sets that flag once at parse time and
// nothing recomputes it, so rows silently rot as their dates pass.
//
// Signals, in order of preference:
//   1. audition_date_end — the last day auditions are held.
//   2. audition_date_start — when the parser only found one date.
//   3. performance_date_end — for listings that give no audition date at all
//      ("rolling submissions"). A season that has already closed cannot still
//      be casting, so the run's end date ages the listing out.
// A row with none of the three is genuinely undatable and stays listed.
//
// The two filters are exact complements: every row matches exactly one.

const today = () => new Date().toISOString().split('T')[0];

const UNDATED = 'audition_date_end.is.null,audition_date_start.is.null';

// The undated cases are spelled out as two flat and(...) groups rather than one
// group wrapping an or(...), so no clause depends on nested boolean parsing.
export function upcomingFilter(): string {
  const t = today();
  return [
    `audition_date_end.gte.${t}`,
    `and(audition_date_end.is.null,audition_date_start.gte.${t})`,
    `and(${UNDATED},performance_date_end.is.null)`,
    `and(${UNDATED},performance_date_end.gte.${t})`,
  ].join(',');
}

export function pastFilter(): string {
  const t = today();
  return [
    `audition_date_end.lt.${t}`,
    `and(audition_date_end.is.null,audition_date_start.lt.${t})`,
    `and(${UNDATED},performance_date_end.lt.${t})`,
  ].join(',');
}
