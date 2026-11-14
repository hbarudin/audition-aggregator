import { placeKey } from './normalize';

/**
 * Places the GeoNames tables file under a different name than the one worth
 * showing a reader.
 *
 * This is not for typos. A theater stored as "Brimingham, AL" has wrong data
 * in a column the site prints under its name, and the fix is to correct the
 * row, which geocodes it as a side effect. These are the opposite case: the
 * stored name is the right one to display, and only the lookup fails.
 *
 * West Windsor is a township; GeoNames carries the census place inside it,
 * Princeton Junction. Sanibel Island is carried as Sanibel. Both substitutes
 * sit within the place they stand in for, which is well inside the tolerance
 * of a radius measured in tens of miles.
 *
 * The aliases apply to both ends of the lookup -- a reader typing "West
 * Windsor, NJ" into the location box hits the same gap a theater does.
 */
const ALIASES: Array<[city: string, state: string, lookUpInstead: string]> = [
  ['West Windsor', 'NJ', 'Princeton Junction'],
  ['Sanibel Island', 'FL', 'Sanibel'],
];

/** Normalized key -> normalized key, so callers can substitute before lookup. */
export const PLACE_ALIASES = new Map(
  ALIASES.map(([city, state, lookUpInstead]) => [
    placeKey(city, state),
    placeKey(lookUpInstead, state),
  ])
);
