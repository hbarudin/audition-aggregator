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
let cityIndex: Map<string, string[]> | null = null;

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

// Normalized city name -> the states that have a town by that name, derived
// from the place keys rather than stored: it is the same 35,701 rows read a
// second way, and only a reader who types a bare town ever needs it.
function cityStates() {
  if (cityIndex) return cityIndex;
  const index = new Map<string, string[]>();
  for (const key of places().keys()) {
    const bar = key.lastIndexOf('|');
    if (bar === -1) continue;
    const city = key.slice(0, bar);
    const existing = index.get(city);
    if (existing) existing.push(key.slice(bar + 1));
    else index.set(city, [key.slice(bar + 1)]);
  }
  for (const states of index.values()) states.sort();
  return (cityIndex = index);
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

/** A town name that could be any of several places. */
export interface PlaceChoices {
  /** Title-cased, as it should be shown and as `geocodeQuery` will read it back. */
  city: string;
  /**
   * One per state that has a town by this name, alphabetical -- twenty of them
   * for Princeton, twenty-eight for Clinton. Coordinates ride along so the
   * caller can rank the choices against what it is showing rather than make
   * the reader guess which Princeton the site has listings near.
   */
  places: Array<Coordinates & { state: string }>;
}

/**
 * The states a bare town name could refer to.
 *
 * `geocodeQuery` refuses a bare town on purpose -- there are 20 Princetons --
 * but refusing is only half an answer. This is the other half: the reader
 * names the town, the lookup names the states it could be in, and the choice
 * stays with the reader instead of being guessed at.
 *
 * Three readings, first hit wins: the whole string, so two-word towns survive
 * ("New York"); the part before the last comma; and the string without its
 * last word, which is where an unknown or mistyped state lands ("Springfield,
 * Masachusetts"). Returns null when no reading names a town we hold.
 */
export function suggestPlaces(input: string): PlaceChoices | null {
  const query = input.trim();
  if (!query) return null;

  const readings = [query];
  const comma = query.lastIndexOf(',');
  if (comma > 0) readings.push(query.slice(0, comma));
  const words = query.split(/\s+/);
  if (words.length > 1) readings.push(words.slice(0, -1).join(' '));

  for (const reading of readings) {
    const city = normalizeCity(reading);
    const states = city ? cityStates().get(city) : undefined;
    if (!states) continue;
    return {
      city: titleCase(city),
      places: states.map((state) => ({ state, ...places().get(`${city}|${state}`)! })),
    };
  }
  return null;
}

function titleCase(value: string): string {
  return normalizeCity(value).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
