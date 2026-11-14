# Audition Aggregator

Collects open audition listings from regional theater websites into one searchable place.

A scheduled scraper fetches each theater's audition page, hands the text to Claude for
structured parsing, and writes the results to Supabase. The Next.js app reads from there.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 4 · Supabase · Claude API

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

Run `supabase/schema.sql` in the Supabase SQL editor to create the tables, then
`npx tsx scripts/seed-theaters.ts` to load the theater list.

### Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser | Read-only access (public read is intentional) |
| `SUPABASE_URL` | server | Same URL, server side |
| `SUPABASE_SERVICE_ROLE_KEY` | server, scraper | Writes; bypasses RLS |
| `ANTHROPIC_API_KEY` | scraper | Parsing audition pages |
| `GITHUB_TOKEN` | server, scraper | Files issues for feedback and broken pages |
| `ADMIN_KEY` | server | Gates the admin pages |

## Commands

```bash
npm run dev      # dev server
npm run build    # production build + typecheck
npm run lint     # ESLint

npx tsx scraper/index.ts                  # full scrape
npx tsx scripts/test-scraper.ts [url]     # smoke test one page

npx tsx scripts/geo/backfill-coordinates.ts          # plan the geocode backfill
npx tsx scripts/geo/backfill-coordinates.ts --apply  # write it
npx tsx scripts/geo/build-us-places.ts               # rebuild the lookup table
```

## Layout

```
app/              routes: /, /past, /theaters, /add-theater, /admin/*
components/       UI
lib/              Supabase client, types, expiry rules, admin session
lib/geo/          offline US ZIP and city lookup, haversine distance
scraper/          fetch → parse (Claude) → write; entry point is index.ts
scripts/          seeding and one-off migrations
supabase/         schema.sql and seed data
```

## Location search

The radius filter ("within 50 miles of 08540") measures from city centroids held
in `theaters.latitude` / `theaters.longitude`, against whatever the reader types
in the location box. Both ends are resolved against `lib/geo/us-places.generated.ts`,
a committed 1.9 MB table of every US ZIP code and ~36,000 place names built from
the [GeoNames](https://www.geonames.org/) dumps (CC BY 4.0). No geocoding API is
called, at build time or at request time.

The table is server-side only -- the browser asks for one pair of coordinates
through a server action and does the distance arithmetic itself, over rows it has
already loaded. Rebuild the table with `scripts/geo/build-us-places.ts` when the
GeoNames dumps move on; nothing depends on doing so regularly.

A handful of real places are filed by GeoNames under another name -- West
Windsor NJ as Princeton Junction, Sanibel Island FL as Sanibel. Those are listed
in `lib/geo/aliases.ts`, which both ends of the lookup consult, so a reader can
type the name a theater is stored under. Aliases are not for typos: a theater
stored as "Brimingham, AL" has wrong data in a column the site prints, and the
fix is to correct the row.

A theater whose city still will not resolve (a typo, or scraper debris in the
city column) keeps null coordinates. It appears everywhere it did before and is
counted but not listed while a radius is on, since there is no honest way to say
whether it falls inside one. `scripts/geo/backfill-coordinates.ts` prints those
rows, which doubles as a worklist for fixing the city on `/admin/theaters/[id]`.

## Admin access

The admin pages are gated by `ADMIN_KEY`. Sign in at `/admin/login`; this sets an
httpOnly session cookie good for 30 days. Once signed in, `edit` links appear next
to each theater on `/theaters`.

The cookie stores an HMAC derived from `ADMIN_KEY`, not the key itself, so it can't
be read back out. There is no key in any URL — earlier versions used a `?key=`
query parameter, which leaked into browser history and server logs.

## Deployment

The app deploys to Vercel from `main`. All seven environment variables above must be
set for both Production and Preview.

The scraper does **not** run on Vercel. It runs as a GitHub Action
(`.github/workflows/scrape.yml`) daily at noon UTC, and can be triggered manually from
the Actions tab. It needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`ANTHROPIC_API_KEY` as repository secrets.

### Database permissions

`service_role` needs `UPDATE` on `theaters` — the scraper deactivates theaters whose
pages 404, and the admin page edits them. Without the grant these writes fail with
`permission denied for table theaters`. See the bottom of `supabase/schema.sql`.
