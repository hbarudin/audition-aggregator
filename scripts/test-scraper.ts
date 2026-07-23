// Smoke test: fetch + parse one theater URL.
// Run with: npx tsx scripts/test-scraper.ts [url] [theater-name]
// Example:  npx tsx scripts/test-scraper.ts https://www.5thavenue.org/about/careers/auditions/ "5th Ave Theatre"
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { fetchPage } from '../scraper/fetch';
import { parseAuditions } from '../scraper/parse';

const url = process.argv[2] ?? 'https://act2.org/about/casting/';
const name = process.argv[3] ?? 'Act 2 Playhouse';

console.log(`Testing: ${name}`);
console.log(`URL: ${url}\n`);

async function main() {
  const text = await fetchPage(url);
  if (!text) {
    console.error('Fetch failed.');
    process.exit(1);
  }

  console.log(`Fetched ${text.length} chars of text. Preview:`);
  console.log(text.slice(0, 300));
  console.log('...\n');

  const auditions = await parseAuditions(text, name);
  console.log(`Parsed ${auditions.length} audition(s):\n`);
  console.log(JSON.stringify(auditions, null, 2));
}

main();
