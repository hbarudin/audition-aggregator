// Shared by the lookup table generator (scripts/geo/build-us-places.ts) and by
// the lookups themselves. Both sides must normalize identically or a key that
// was written one way will never be read back, so this lives in one file and
// is imported by both rather than being retyped.

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
};

export const STATE_CODES = Object.values(STATE_NAMES).sort();

/**
 * "nj" / "New Jersey" / " NJ " all become "NJ". Anything unrecognized is
 * upper-cased and handed back as-is: the seed data holds a handful of
 * non-US rows (one Ontario theater) that should simply fail to match
 * rather than be coerced into a US state.
 */
export function normalizeState(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return STATE_NAMES[trimmed.toLowerCase()] ?? trimmed.toUpperCase();
}

/**
 * Folds a city name to its lookup key: lower case, accents stripped,
 * punctuation collapsed to spaces, and the three abbreviations that actually
 * appear in the seed data spelled out ("St. Louis" and "Saint Louis" are the
 * same place, and GeoNames files it under the long form).
 */
export function normalizeCity(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\bft\b/g, 'fort')
    .replace(/\s+/g, ' ')
    .trim();
}

export function placeKey(city: string, state: string): string {
  return `${normalizeCity(city)}|${normalizeState(state)}`;
}
