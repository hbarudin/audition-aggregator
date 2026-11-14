'use server';

import { geocodeQuery } from '@/lib/geo';

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  label: string;
}

/**
 * Resolves the radius filter's location box. The lookup table is 1.9 MB, so it
 * stays on the server and the browser asks for one pair of coordinates
 * instead -- one round trip per location, not per keystroke.
 *
 * Returns null for anything that does not resolve; the caller decides what to
 * say about it. Input is only ever used as a Map key, never interpolated
 * anywhere, so there is nothing to sanitize beyond the length cap.
 */
export async function resolveLocation(query: string): Promise<ResolvedLocation | null> {
  if (typeof query !== 'string' || query.length > 100) return null;
  return geocodeQuery(query);
}
