'use client';

import { useState, useEffect } from 'react';
import { Audition } from '@/lib/types';
import AuditionTable from '@/components/AuditionTable';

function matches(audition: Audition, query: string): boolean {
  const needle = query.toLowerCase();
  const haystack = [audition.theater?.name ?? '', audition.show_name ?? '']
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const states = [
    'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL',
    'IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE',
    'NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
    'VA','VT','WA','WI','WV','WY',
  ];

  const filtered = auditions.filter((a) => {
    if (debouncedQuery && !matches(a, debouncedQuery)) return false;
    if (fromDate) {
      if (!a.audition_date_start) return false;
      if (a.audition_date_start < fromDate) return false;
    }
    if (selectedState && a.theater?.state !== selectedState) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search theaters or shows…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <select
          value={selectedState}
          onChange={(e) => setSelectedState(e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 shrink-0">
          <label htmlFor="from-date" className="text-sm text-gray-400 whitespace-nowrap">From</label>
          <input
            id="from-date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {fromDate && (
            <button
              onClick={() => setFromDate('')}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              aria-label="Clear date filter"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-16 text-center text-gray-400">
          <p className="text-lg font-medium">No auditions match your filters</p>
          <p className="text-sm mt-2">Try adjusting your search, state, or date.</p>
        </div>
      ) : (
        <AuditionTable auditions={filtered} sort={sort} direction={direction} basePath={basePath} query={debouncedQuery} />
      )}
    </div>
  );
}
