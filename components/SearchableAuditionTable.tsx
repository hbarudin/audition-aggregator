'use client';

import { useState, useEffect, useMemo } from 'react';
import { Audition } from '@/lib/types';
import AuditionTable from '@/components/AuditionTable';
import { distanceMiles } from '@/lib/geo/distance';
import { resolveLocation, LocationLookup } from '@/app/actions/geocode';
import { Button } from '@/components/ui/button';

function matches(audition: Audition, query: string): boolean {
  const needle = query.toLowerCase();
  const haystack = [audition.theater?.name ?? '', audition.show_name ?? '']
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

// Theaters are placed at their city's centroid, not their street address, so
// the error is roughly "how big is this town" -- a venue in the San Fernando
// Valley is stored as Los Angeles and measures from downtown. That is noise at
// 50 miles and a real distortion at 10, which is why the list starts there
// rather than lower.
const RADII = [10, 25, 50, 75, 100, 150, 200, 300];

// A bare town name can be in 28 states, which is more buttons than anyone
// reads. The ones we show first are the states with listings in them, so for
// most towns the whole answer is above the fold and this cap never bites.
const CHOICES_SHOWN = 6;

interface Props {
  auditions: Audition[];
  sort: string;
  direction: string;
  basePath: string;
}

export default function SearchableAuditionTable({ auditions, sort, direction, basePath }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [selectedState, setSelectedState] = useState('');

  const [locationInput, setLocationInput] = useState('');
  const [radius, setRadius] = useState(50);
  const [distanceSort, setDistanceSort] = useState<'asc' | 'desc'>('asc');
  // The query that produced the result is stored alongside it, so the state of
  // the lookup can be read off the current input rather than tracked in a
  // second state that could disagree with it.
  const [lookup, setLookup] = useState<{ query: string; result: LocationLookup } | null>(null);
  // The town whose full list of states has been asked for, stored the same way
  // the lookup is: a fresh town means a fresh list, and reading the expansion
  // off the current input is what keeps the two from disagreeing.
  const [expandedChoices, setExpandedChoices] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const location = locationInput.trim();

  // The lookup table lives on the server, so this is a round trip -- debounced
  // longer than the text search for that reason. A response for a query the
  // reader has already typed past is discarded rather than applied late.
  useEffect(() => {
    if (!location) return;
    let current = true;
    const timer = setTimeout(async () => {
      const result = await resolveLocation(location);
      if (current) setLookup({ query: location, result });
    }, 400);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [location]);

  const settled = lookup?.query === location ? lookup.result : null;
  const origin = settled?.kind === 'found' ? settled.location : null;
  const originStatus = !location ? 'idle' : !settled ? 'resolving' : settled.kind;

  // Twenty Princetons is a question the reader cannot answer from the names
  // alone, so each one is measured against the listings and carries the count.
  // Which state has theaters in it is far too weak a signal to sort on -- 17 of
  // the 20 Princetons are in states this site has listings in -- but which
  // Princeton has auditions near it picks out the right one immediately.
  const choices = useMemo(() => {
    if (settled?.kind !== 'choices') return [];
    const placed = auditions
      .map((a) => a.theater)
      .filter((t) => t?.latitude != null && t?.longitude != null)
      .map((t) => ({ latitude: t!.latitude!, longitude: t!.longitude! }));

    return settled.places
      .map((place) => ({
        label: `${settled.city}, ${place.state}`,
        nearby: placed.filter((t) => distanceMiles(place, t) <= radius).length,
      }))
      // Sort is stable, so towns with nothing near them keep their alphabetical
      // order behind the ones that do.
      .sort((a, b) => b.nearby - a.nearby);
  }, [settled, auditions, radius]);

  const shownChoices =
    expandedChoices === location ? choices : choices.slice(0, CHOICES_SHOWN);

  const states = [
    'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL',
    'IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE',
    'NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
    'VA','VT','WA','WI','WV','WY',
  ];

  // Keyed by audition id rather than theater id: that is what the table has in
  // hand for each row, and two auditions at one theater share a distance.
  const distances = useMemo(() => {
    if (!origin) return null;
    const miles = new Map<string, number>();
    for (const audition of auditions) {
      const theater = audition.theater;
      if (theater?.latitude == null || theater?.longitude == null) continue;
      miles.set(
        audition.id,
        distanceMiles(origin, { latitude: theater.latitude, longitude: theater.longitude })
      );
    }
    return miles;
  }, [auditions, origin]);

  const matchesFilters = (a: Audition) => {
    if (debouncedQuery && !matches(a, debouncedQuery)) return false;
    if (fromDate) {
      if (!a.audition_date_start) return false;
      if (a.audition_date_start < fromDate) return false;
    }
    if (selectedState && a.theater?.state !== selectedState) return false;
    return true;
  };

  const withoutRadius = auditions.filter(matchesFilters);

  // Theaters we could not place are dropped while a radius is on -- there is no
  // honest way to say whether they are within it -- but they are counted, so
  // the reader knows the list is not the whole story.
  const filtered = distances
    ? withoutRadius.filter((a) => {
        const miles = distances.get(a.id);
        return miles !== undefined && miles <= radius;
      })
    : withoutRadius;

  const unplaceable = distances
    ? withoutRadius.filter((a) => !distances.has(a.id)).length
    : 0;

  // Overrides the server's ordering while a location is set, which is the
  // point: the column headers sort through the URL, and a navigation would
  // throw the location away before it could be used.
  const ordered =
    distances && distanceSort
      ? [...filtered].sort((a, b) => {
          const sign = distanceSort === 'asc' ? 1 : -1;
          return sign * ((distances.get(a.id) ?? 0) - (distances.get(b.id) ?? 0));
        })
      : filtered;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search theaters or shows…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
        />
        <select
          value={selectedState}
          onChange={(e) => setSelectedState(e.target.value)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground/75 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 shrink-0">
          <label htmlFor="from-date" className="text-sm text-muted-foreground/80 whitespace-nowrap">
            {/* The full phrasing wants ~160px it does not have on a phone. */}
            <span className="sm:hidden">On or after</span>
            <span className="hidden sm:inline">Audition date on or after</span>
          </label>
          <input
            id="from-date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground/75 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          />
          {fromDate && (
            <button
              onClick={() => setFromDate('')}
              className="text-muted-foreground/80 hover:text-muted-foreground text-lg leading-none"
              aria-label="Clear date filter"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor="near" className="text-sm text-muted-foreground/80 whitespace-nowrap">
            Within
          </label>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground/75 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
            aria-label="Radius in miles"
          >
            {RADII.map((miles) => (
              <option key={miles} value={miles}>{miles} miles</option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground/80">of</span>
          <input
            id="near"
            type="text"
            placeholder="ZIP, or town and state (Princeton, NJ)"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            className="min-w-0 flex-1 sm:w-72 sm:flex-none rounded-md border border-border px-3 py-1.5 text-sm placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          />
          {locationInput && (
            <button
              onClick={() => setLocationInput('')}
              className="shrink-0 px-1 text-muted-foreground/80 hover:text-muted-foreground text-lg leading-none"
              aria-label="Clear location filter"
            >
              ×
            </button>
          )}
          {/* Takes its own line on a phone rather than crushing the input. */}
          <span className="w-full sm:w-auto text-sm text-muted-foreground/80" aria-live="polite">
            {originStatus === 'resolving' && 'Looking up…'}
            {originStatus === 'none' && (
              <span className="text-destructive">
                Could not find that. Try a 5-digit ZIP, or a town with its state.
              </span>
            )}
            {originStatus === 'choices' &&
              settled?.kind === 'choices' &&
              (settled.places.length === 1
              ? 'Did you mean:'
              : `${settled.places.length} towns are called ${settled.city}. Which one?`)}
            {originStatus === 'found' && origin && `Measuring from ${origin.label}`}
          </span>
      </div>

      {/* Picking a choice writes it back into the box rather than setting the
          origin directly, so the text the reader sees is always the text the
          lookup ran on and there is no second place for the answer to live. */}
      {choices.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {shownChoices.map((choice) => (
            <Button
              key={choice.label}
              variant="outline"
              size="sm"
              onClick={() => setLocationInput(choice.label)}
            >
              {choice.label}
              <span className="text-muted-foreground/80">
                {choice.nearby === 1 ? '1 nearby' : `${choice.nearby} nearby`}
              </span>
            </Button>
          ))}
          {choices.length > shownChoices.length && (
            <Button variant="ghost" size="sm" onClick={() => setExpandedChoices(location)}>
              +{choices.length - shownChoices.length} more
            </Button>
          )}
        </div>
      )}
      </div>

      {ordered.length === 0 ? (
        <div className="mt-16 text-center text-muted-foreground/80">
          <p className="text-lg font-medium">No auditions match your filters</p>
          <p className="text-sm mt-2">
            {origin
              ? `Nothing within ${radius} miles of ${origin.label}. Try a wider radius.`
              : 'Try adjusting your search, state, or date.'}
          </p>
        </div>
      ) : (
        <>
          {unplaceable > 0 && (
            <p className="mb-2 text-xs text-muted-foreground/80">
              {unplaceable === 1
                ? "1 audition is hidden: we don't have coordinates for its theater. " +
                  'Clear the location to see it.'
                : `${unplaceable} auditions are hidden: we don't have coordinates for ` +
                  'their theaters. Clear the location to see them.'}
            </p>
          )}
          <AuditionTable
            auditions={ordered}
            sort={sort}
            direction={direction}
            basePath={basePath}
            query={debouncedQuery}
            distances={distances ?? undefined}
            distanceSort={distanceSort}
            onSortByDistance={() =>
              setDistanceSort((previous) => (previous === 'asc' ? 'desc' : 'asc'))
            }
          />
        </>
      )}
    </div>
  );
}
