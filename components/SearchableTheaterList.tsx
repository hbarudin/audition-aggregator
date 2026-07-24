'use client';

import { useState, useEffect } from 'react';
import { Theater } from '@/lib/types';

interface Props {
  theaters: Theater[];
  adminKey?: string | null;
}

export default function SearchableTheaterList({ theaters, adminKey }: Props) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const filtered = debouncedQuery
    ? theaters.filter((t) => {
        const needle = debouncedQuery.toLowerCase();
        return (
          t.name.toLowerCase().includes(needle) ||
          t.city.toLowerCase().includes(needle)
        );
      })
    : theaters;

  const byState = filtered.reduce<Record<string, Theater[]>>((acc, t) => {
    const key = t.state || '?';
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const states = Object.keys(byState).sort();

  return (
    <div>
      <input
        type="search"
        placeholder="Search theaters or cities…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-6"
      />

      {!debouncedQuery && (
        <div className="flex flex-wrap gap-2 mb-8">
          {states.map((state) => (
            <a
              key={state}
              href={`#${state}`}
              className="text-xs font-medium text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-2 py-1 hover:border-gray-400 transition-colors"
            >
              {state} <span className="text-gray-400">({byState[state].length})</span>
            </a>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="mt-16 text-center text-gray-400">No theaters match &ldquo;{debouncedQuery}&rdquo;</p>
      ) : (
        <div className="space-y-10">
          {states.map((state) => (
            <section key={state} id={state}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3 pb-2 border-b border-gray-100">
                {state}
              </h2>
              <ul className="space-y-2">
                {byState[state].map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2">
                    {t.audition_page_url ? (
                      <a
                        href={t.audition_page_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline transition-colors"
                      >
                        {t.name}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    )}
                    <span className="text-xs text-gray-400">{t.city}</span>
                    {adminKey && (
                      <a
                        href={`/admin/theaters/${t.id}?key=${adminKey}`}
                        className="text-xs text-gray-400 hover:text-blue-600 transition-colors ml-1"
                      >
                        edit
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
