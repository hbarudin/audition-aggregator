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
```

## Layout

```
app/              routes: /, /past, /theaters, /add-theater, /admin/*
components/       UI
lib/              Supabase client, types, expiry rules, admin session
scraper/          fetch → parse (Claude) → write; entry point is index.ts
scripts/          seeding and one-off migrations
supabase/         schema.sql and seed data
```

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
