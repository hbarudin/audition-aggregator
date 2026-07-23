#!/usr/bin/env node
// Parses Non-Equity Theatre List 5.0 text export into structured seed data.
const fs = require('fs');
const path = require('path');

const INPUT = path.join(
  '/Users/hannah/.claude/projects/-Users-hannah-Development-audition-aggregator',
  '6335257e-8323-4f17-a4aa-43fc7fdc0109/tool-results/b6p2auwql.txt'
);

const text = fs.readFileSync(INPUT, 'utf-8');
const lines = text.split('\n').map(l => l.trim());

// Group into blocks separated by blank lines
const rawBlocks = [];
let current = [];
for (const line of lines) {
  if (line === '') {
    if (current.length > 0) {
      rawBlocks.push([...current]);
      current = [];
    }
  } else {
    current.push(line);
  }
}
if (current.length > 0) rawBlocks.push(current);

// Merge orphaned URL-only blocks back into the previous block.
// (The Barnstormers entry has a spurious blank line before its URL.)
const blocks = [];
for (const block of rawBlocks) {
  const isUrlOnly = block.every(l => /^https?:\/\//.test(l) || /^www\./.test(l));
  if (isUrlOnly && blocks.length > 0) {
    blocks[blocks.length - 1].push(...block);
  } else {
    blocks.push(block);
  }
}

const isUrl = s => /^https?:\/\//.test(s) || /^www\./.test(s);
const extractEmbeddedUrl = s => { const m = s.match(/https?:\/\/\S+/); return m ? m[0] : null; };

// Location: "City, ST", "City, State Name", or bare "ST"
const isLocation = s => {
  if (/^[A-Z]{2}$/.test(s)) return true; // bare state like "CO"
  if (/^.+[,\.]\s*[A-Z][A-Za-z\s]{1,20}$/.test(s)) return true;
  return false;
};

function parseLocation(s) {
  // Handle "Fort Myers. FL" (period typo)
  const sep = s.includes(',') ? ',' : '.';
  const idx = s.lastIndexOf(sep);
  if (idx === -1) return { city: '', state: s.trim() };
  return { city: s.substring(0, idx).trim(), state: s.substring(idx + 1).trim() };
}

function parseBlock(block) {
  let name = block[0].trim();
  let notes = [];
  let city = '';
  let state = '';
  let url = null;
  let urlText = null;

  // Extract inline parenthetical from name line
  const inlineNote = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (inlineNote) {
    name = inlineNote[1].trim();
    notes.push(inlineNote[2].trim());
  }

  for (let i = 1; i < block.length; i++) {
    const line = block[i];

    // Parenthetical note line
    if (/^\(.+\)$/.test(line)) {
      notes.push(line.slice(1, -1));
      continue;
    }

    // Real URL
    if (isUrl(line)) {
      if (!url) url = line.startsWith('www.') ? 'https://' + line.trim() : line.trim();
      continue;
    }

    // Embedded URL within text (e.g., "Employment | Festival 56 http://...")
    const embedded = extractEmbeddedUrl(line);
    if (embedded) {
      if (!url) url = embedded;
      continue;
    }

    // Location line
    if (isLocation(line)) {
      ({ city, state } = parseLocation(line));
      continue;
    }

    // Text-only hyperlink (display text, URL was lost from Word doc)
    if (i > 0 && !urlText) {
      urlText = line;
    }
  }

  return {
    name,
    notes: notes.join('; '),
    city,
    state,
    url: url ? url.replace(/\s+$/, '') : null,
    urlText: url ? null : urlText, // only keep if no real URL found
  };
}

const theaters = rawBlocks
  .filter(b => b.length > 0 && !b[0].includes('Non-Equity Theatre List'))
  .map(b => {
    // Re-apply Barnstormers merge at parse time using the merged blocks
    return null;
  });

// Use merged blocks
// If the first block starts with the title, drop that line and keep the rest as an entry.
const normalizedBlocks = blocks.map((b, i) => {
  if (i === 0 && b[0].includes('Non-Equity Theatre List')) return b.slice(1);
  return b;
});

const parsed = normalizedBlocks
  .filter(b => b.length > 0)
  .map(parseBlock);

// Deduplicate by (name, state) — keep first occurrence
const seen = new Set();
const deduped = parsed.filter(t => {
  const key = `${t.name.toLowerCase()}|${t.state}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// Write output as TypeScript
const outputPath = path.join(__dirname, 'theater-seeds.ts');
const lines2 = [
  '// Auto-generated from Non-Equity Theatre List 5.0 — do not edit by hand.',
  '// Entries with url=null had text-only hyperlinks in the source doc; add URLs manually.',
  '',
  'export interface TheaterSeed {',
  '  name: string;',
  '  city: string;',
  '  state: string;',
  '  audition_page_url: string | null;',
  '  notes: string;',
  '}',
  '',
  'export const theaterSeeds: TheaterSeed[] = [',
  ...deduped.map(t => [
    '  {',
    `    name: ${JSON.stringify(t.name)},`,
    `    city: ${JSON.stringify(t.city)},`,
    `    state: ${JSON.stringify(t.state)},`,
    `    audition_page_url: ${JSON.stringify(t.url)},`,
    `    notes: ${JSON.stringify(t.notes)},`,
    '  },',
  ].join('\n')),
  '];',
].join('\n');

fs.writeFileSync(outputPath, lines2);

const withUrl = deduped.filter(t => t.url).length;
const textOnly = deduped.filter(t => !t.url && t.urlText).length;
const noLink = deduped.filter(t => !t.url && !t.urlText).length;

process.stderr.write(`\nParsed ${deduped.length} theaters (after dedup)\n`);
process.stderr.write(`  ${withUrl} with real URLs\n`);
process.stderr.write(`  ${textOnly} text-only links (URL lost from Word doc)\n`);
process.stderr.write(`  ${noLink} with no link at all\n`);
process.stderr.write(`\nWrote: ${outputPath}\n`);
