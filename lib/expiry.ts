// Freshness is derived from the typed date columns rather than the stored
// is_expired flag: the scraper's LLM sets that flag once at parse time and
// nothing recomputes it, so rows silently rot as their dates pass.
//
// audition_date_end is the last relevant day, falling back to
// audition_date_start when the parser only found one date. Rows with neither
// date ("rolling", "TBD") are undatable, so they count as upcoming rather than
// being hidden. The two filters are exact complements.

const today = () => new Date().toISOString().split('T')[0];

export function upcomingFilter(): string {
  const t = today();
  return [
    `audition_date_end.gte.${t}`,
    `and(audition_date_end.is.null,audition_date_start.gte.${t})`,
    `and(audition_date_end.is.null,audition_date_start.is.null)`,
  ].join(',');
}

export function pastFilter(): string {
  const t = today();
  return [
    `audition_date_end.lt.${t}`,
    `and(audition_date_end.is.null,audition_date_start.lt.${t})`,
  ].join(',');
}
