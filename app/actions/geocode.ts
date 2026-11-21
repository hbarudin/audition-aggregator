'use server';

import { geocodeQuery, suggestPlaces, PlaceChoices } from '@/lib/geo';

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  label: string;
}

/**
 * What the location box got back. A bare town is not a failure -- it is a
 * question the reader can answer in one click -- so it has its own case
 * rather than being folded into "could not find that".
 */
export type LocationLookup =
  | { kind: 'found'; location: ResolvedLocation }
  | { kind: 'choices'; city: string; places: PlaceChoices['places'] }
  | { kind: 'none' };

/**
 * Resolves the radius filter's location box. The lookup table is 1.9 MB, so it
 * stays on the server and the browser asks for one pair of coordinates
 * instead -- one round trip per location, not per keystroke.
 *
 * Input is only ever used as a Map key, never interpolated anywhere, so there
 * is nothing to sanitize beyond the length cap.
 */
export async function resolveLocation(query: string): Promise<LocationLookup> {
  if (typeof query !== 'string' || query.length > 100) return { kind: 'none' };

  const found = geocodeQuery(query);
  if (found) return { kind: 'found', location: found };

  const choices = suggestPlaces(query);
  return choices ? { kind: 'choices', ...choices } : { kind: 'none' };
}
