// Server-side only. Importing this module pulls in us-places.generated.ts,
// ~1.9 MB of lookup table that must never reach the browser. Client code that
// needs to measure distance imports lib/geo/distance.ts instead.
import { ZIPS, PLACES } from './us-places.generated';
import { normalizeCity, normalizeState, placeKey, STATE_CODES } from './normalize';
import { PLACE_ALIASES } from './aliases';
import type { Coordinates } from './distance';

export { STATE_CODES, normalizeState };
export type { Coordinates };

/**
 * A resolved location, carrying the label the lookup actually matched so the
 * UI can show what it decided -- "Springfield, IL" when the user typed
 * "springfield il", "Princeton, NJ" when they typed a ZIP.
 */
export interface GeocodeResult extends Coordinates {
  label: string;
}

// The tables are ~1.9 MB of text. Parsing them costs ~60 ms and a few MB of
// heap, so it happens on the first lookup rather than at import, and the Maps
// are kept for the life of the process.
let zipIndex: Map<string, Coordinates> | null = null;
let placeIndex: Map<string, Coordinates> | null = null;

function parse(table: string): Map<string, Coordinates> {
  const index = new Map<string, Coordinates>();
  for (const line of table.split('\n')) {
    // Split from the right: the last two fields are the coordinates and
    // everything before them is the key, which for places contains spaces
    // ("cleveland heights|OH").
    const lngAt = line.lastIndexOf(' ');
    if (lngAt === -1) continue;
    const latAt = line.lastIndexOf(' ', lngAt - 1);
    if (latAt === -1) continue;
    index.set(line.slice(0, latAt), {
      latitude: Number(line.slice(latAt + 1, lngAt)),
      longitude: Number(line.slice(lngAt + 1)),
    });
  }
  return index;
}

function zips() {
  return (zipIndex ??= parse(ZIPS));
}

function places() {
  return (placeIndex ??= parse(PLACES));
}

/**
 * Looks up a "city, ST" pair. Returns null when the city is not in the table,
 * which for the seeded theaters means either a typo ("Los Angles, CA") or
 * scraper debris in the city column -- both worth leaving uncoded rather than
 * guessing at.
 */
export function geocodeCityState(city: string, state: string): Coordinates | null {
  if (!city.trim() || !state.trim()) return null;
  const key = placeKey(city, state);
  return places().get(PLACE_ALIASES.get(key) ?? key) ?? null;
}

export function geocodeZip(zip: string): Coordinates | null {
  const digits = zip.trim();
  return /^\d{5}$/.test(digits) ? zips().get(digits) ?? null : null;
}

/**
 * Resolves whatever the user typed into the location box. Accepts a 5-digit
 * ZIP (optionally with a +4 suffix), "Town, ST", or "Town ST".
 *
 * A bare town name with no state is deliberately rejected: there are 28
 * Springfields, and silently picking the biggest one would put a user's
 * radius in the wrong half of the country without telling them.
 */
export function geocodeQuery(input: string): GeocodeResult | null {
  const query = input.trim();
  if (!query) return null;

  const zipMatch = query.match(/^(\d{5})(?:-\d{4})?$/);
  if (zipMatch) {
    const hit = geocodeZip(zipMatch[1]);
    return hit ? { ...hit, label: zipMatch[1] } : null;
  }

  // "Princeton, NJ" / "Princeton NJ" / "Princeton, New Jersey"
  const parts = query.split(',');
  let city: string;
  let state: string;

  if (parts.length >= 2) {
    state = parts.pop()!;
    city = parts.join(',');
  } else {
    const words = query.split(/\s+/);
    if (words.length < 2) return null;
    state = words.pop()!;
    city = words.join(' ');
    // Guard against swallowing the last word of a two-word town: "New York"
    // would otherwise be read as the city "New" in the state "York".
    if (normalizeState(state).length !== 2) return null;
  }

  const hit = geocodeCityState(city, state);
  if (!hit) return null;

  return {
    ...hit,
    label: `${titleCase(city)}, ${normalizeState(state)}`,
  };
}

function titleCase(value: string): string {
  return normalizeCity(value).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
