// Regenerates lib/geo/us-places.generated.ts from the GeoNames public dumps.
//
//   npx tsx scripts/geo/build-us-places.ts
//
// Run on a dev machine, not in CI or at build time: it downloads ~45 MB and
// shells out to `unzip`. The generated file is committed, so the app and the
// backfill script never touch the network to geocode anything.
//
// Two sources, because neither is enough on its own:
//
//   export/zip/US.zip        every US postal code with a centroid. This is the
//                            only source for ZIP lookups. Its place names are
//                            USPS preferred names, which quietly file whole
//                            towns under their big neighbor -- Tigard OR comes
//                            back as "Portland", Cleveland Heights OH as
//                            "Cleveland" -- so it is a poor city index.
//
//   export/dump/cities500.zip  populated places down to population 500, under
//                            their real municipal names plus ASCII variants.
//                            This is the city index; population breaks ties
//                            when two places in one state share a name.
//
// Data is CC BY 4.0, (c) GeoNames (https://www.geonames.org/). The attribution
// is repeated in the generated file's header so it travels with the data.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { placeKey } from '../../lib/geo/normalize';

const POSTAL_URL = 'https://download.geonames.org/export/zip/US.zip';
const CITIES_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const OUT = path.join(__dirname, '..', '..', 'lib', 'geo', 'us-places.generated.ts');

// Three decimal places is about 110 m. The radius filter works in tens of
// miles off city centroids, so more precision would be a lie told in bytes.
const round = (n: number) => n.toFixed(3).replace(/\.?0+$/, '') || '0';

async function fetchAndUnzip(url: string, member: string, dir: string): Promise<string> {
  const zip = path.join(dir, path.basename(url));
  process.stdout.write(`Downloading ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  console.log(`${(fs.statSync(zip).size / 1e6).toFixed(1)} MB`);
  execFileSync('unzip', ['-o', '-q', zip, member, '-d', dir]);
  return path.join(dir, member);
}

interface Place { lat: number; lng: number; rank: number }

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'us-places-'));

  return (async () => {
    const postalFile = await fetchAndUnzip(POSTAL_URL, 'US.txt', dir);
    const citiesFile = await fetchAndUnzip(CITIES_URL, 'cities500.txt', dir);

    // --- ZIP centroids -----------------------------------------------------
    const zips: string[] = [];
    const postalByCity = new Map<string, { lat: number; lng: number; n: number }>();

    for (const line of fs.readFileSync(postalFile, 'utf8').split('\n')) {
      if (!line) continue;
      // country, postal_code, place_name, admin1_name, admin1_code, ... lat, lng, accuracy
      const f = line.split('\t');
      const [zip, place, , stateCode] = [f[1], f[2], f[3], f[4]];
      const lat = Number(f[9]);
      const lng = Number(f[10]);
      if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      zips.push(`${zip} ${round(lat)} ${round(lng)}`);

      if (!place || !stateCode) continue;
      const key = placeKey(place, stateCode);
      const agg = postalByCity.get(key) ?? { lat: 0, lng: 0, n: 0 };
      agg.lat += lat;
      agg.lng += lng;
      agg.n += 1;
      postalByCity.set(key, agg);
    }

    // --- City centroids ----------------------------------------------------
    // cities500 first and by population, so "Springfield, IL" resolves to the
    // capital rather than whichever row happened to be read last.
    const places = new Map<string, Place>();
    const offer = (key: string, lat: number, lng: number, rank: number) => {
      const existing = places.get(key);
      if (!existing || rank > existing.rank) places.set(key, { lat, lng, rank });
    };

    for (const line of fs.readFileSync(citiesFile, 'utf8').split('\n')) {
      if (!line) continue;
      // geonameid, name, asciiname, alternatenames, lat, lng, class, code,
      // country, cc2, admin1, ... population
      const f = line.split('\t');
      if (f[8] !== 'US') continue;
      const stateCode = f[10];
      const lat = Number(f[4]);
      const lng = Number(f[5]);
      const population = Number(f[14]) || 0;
      if (!stateCode || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      offer(placeKey(f[1], stateCode), lat, lng, population);
      // The ASCII form only differs for accented names ("Cañon City"); normalize
      // already strips accents, so this usually collapses onto the same key.
      if (f[2] && f[2] !== f[1]) offer(placeKey(f[2], stateCode), lat, lng, population);
    }

    // Postal place names fill the gaps left by the population floor -- the
    // villages under 500 people, which are exactly the ones cities500 drops.
    // Rank -1 keeps them from ever outranking a real municipality.
    let fromPostal = 0;
    for (const [key, agg] of postalByCity) {
      if (places.has(key)) continue;
      places.set(key, { lat: agg.lat / agg.n, lng: agg.lng / agg.n, rank: -1 });
      fromPostal += 1;
    }

    const placeLines = [...places.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, p]) => `${key} ${round(p.lat)} ${round(p.lng)}`);

    zips.sort();

    const body = `// GENERATED FILE -- do not edit by hand.
// Rebuild with: npx tsx scripts/geo/build-us-places.ts
//
// Geographic data from GeoNames (https://www.geonames.org/), used under
// CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
//
// Two space-separated tables, parsed lazily by lib/geo/lookup.ts.
//   ZIPS:   <5-digit zip> <lat> <lng>
//   PLACES: <normalized city>|<state code> <lat> <lng>
// Coordinates are centroids rounded to ~110 m.
//
// ${zips.length.toLocaleString('en-US')} ZIP codes, ${places.size.toLocaleString('en-US')} places (${fromPostal.toLocaleString('en-US')} of them from postal place names).

export const ZIPS = \`${zips.join('\n')}\`;

export const PLACES = \`${placeLines.join('\n')}\`;
`;

    fs.writeFileSync(OUT, body);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(
      `Wrote ${path.relative(process.cwd(), OUT)}: ` +
        `${zips.length} ZIPs, ${places.size} places, ` +
        `${(Buffer.byteLength(body) / 1e6).toFixed(2)} MB`
    );
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
