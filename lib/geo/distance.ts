// Kept apart from lib/geo/index.ts on purpose: that module pulls in the 1.9 MB
// lookup table, and the audition table needs to measure distances in the
// browser. Importing from here keeps the table on the server.

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles. */
export function distanceMiles(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}
