#!/usr/bin/env node
// Generates supabase/seed-theaters.sql from the parsed theater seeds.
const path = require('path');
const fs = require('fs');

// Load the theater seeds via a quick eval (they're plain TS data, no imports needed)
const seedFile = fs.readFileSync(path.join(__dirname, 'theater-seeds.ts'), 'utf-8');
// Strip the TypeScript interface and type annotations to get runnable JS
const js = seedFile
  .replace(/export interface[\s\S]*?^}/m, '')
  .replace(/: TheaterSeed\[\]/g, '')
  .replace(/export const /g, 'const ')
  .replace(/as const/g, '');

const mod = { exports: {} };
new Function('module', 'exports', js + '\nmodule.exports = theaterSeeds;')(mod, mod.exports);
const seeds = mod.exports;

// Escape both ASCII apostrophe and Unicode right single quotation mark
const escape = s => s === null ? 'NULL' : `'${String(s).replace(/['’]/g, "''")}'`;

const rows = seeds.map(t =>
  `  (${escape(t.name)}, ${escape(t.city)}, ${escape(t.state)}, ${escape(t.audition_page_url)}, ${escape(t.notes)})`
);

const sql = `-- Theater seed data (${seeds.length} theaters)
-- Paste into the Supabase SQL editor and run.
INSERT INTO theaters (name, city, state, audition_page_url, notes) VALUES
${rows.join(',\n')}
;`;

const outPath = path.join(__dirname, '..', 'supabase', 'seed-theaters.sql');
fs.writeFileSync(outPath, sql);
console.log(`Wrote ${seeds.length} rows to supabase/seed-theaters.sql`);
