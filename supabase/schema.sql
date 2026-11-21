-- Run this in the Supabase SQL editor to set up the schema.
-- Mirrors the live database as of 2026-09-27.

create table theaters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text not null default '',
  state       text not null default '',

  -- City centroid, filled from the offline table in lib/geo. Nullable on
  -- purpose: a theater whose city will not geocode keeps null coordinates and
  -- still appears everywhere except the radius filter. Added 2026-11-14;
  -- runnable slice: migration-2026-11-14-theater-coordinates.sql
  latitude    double precision,
  longitude   double precision,

  audition_page_url text,
  notes       text default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table auditions (
  id               uuid primary key default gen_random_uuid(),
  theater_id       uuid not null references theaters(id) on delete cascade,
  show_name        text,

  -- Audition dates: the free-text form as listed, plus the parsed range the
  -- app sorts and filters on. See lib/expiry.ts.
  audition_dates   text,
  audition_date_start date,
  audition_date_end   date,

  -- Performance dates: free text, plus the parsed end of the run. Used to age
  -- out listings that state no audition date at all ("rolling submissions").
  performance_dates    text,
  performance_date_end date,

  is_paid          boolean,
  non_union_ok     boolean,
  housing          text not null default 'unknown' check (housing in ('yes', 'no', 'unknown')),
  source_url       text,
  scraped_at       timestamptz,
  raw_text         text,

  -- Written by the scraper but not read by the app: it is a snapshot of what
  -- the parser believed at scrape time and nothing recomputes it as dates
  -- pass. Freshness is derived from the date columns instead.
  is_expired       boolean not null default false,

  created_at       timestamptz not null default now()
);

create index auditions_theater_id_idx on auditions(theater_id);
create index auditions_is_expired_idx  on auditions(is_expired);
create index auditions_scraped_at_idx  on auditions(scraped_at desc);

-- Allow public read access (no auth in MVP).
alter table theaters enable row level security;
alter table auditions enable row level security;

create policy "public read theaters" on theaters for select using (true);
create policy "public read auditions" on auditions for select using (true);

-- The scraper and the admin edit page update theaters through service_role,
-- which bypasses RLS but still needs the table grant. This was missing on the
-- live database until 2026-10-20: deactivation writes failed silently for
-- months because the error was discarded. auditions already had it.
grant update on table theaters to service_role;

-- ---------------------------------------------------------------------------
-- Added 2026-11-08 with the move to the Message Batches API.
-- Runnable slice for an existing database: migration-2026-11-08-scrape-batches.sql
--
-- The daily scrape no longer gets its answers inside the run that asks the
-- questions: it submits one batch of ~325 requests and collects the results
-- when they are ready, usually within the hour but by contract up to 24 hours
-- later. This table is the handoff. Without it a run that submits a batch and
-- then times out waiting has paid for work it can never find again, and the
-- site keeps yesterday's listings with nothing to say why.
--
-- outcome is the whole point. A 'pending' row is a batch the next run still
-- owes something, and resolving those is the first thing it does -- before it
-- submits anything new, so a slow batch can never land on top of fresher
-- data. At most one batch is ever in flight: a run that finds one still
-- processing cancels it ('cancelled') rather than racing it, because the
-- pages it is about to fetch are newer than the ones that batch was built
-- from.
create table scrape_batches (
  id            text primary key,     -- Anthropic's batch id (msgbatch_...)
  submitted_at  timestamptz not null default now(),
  request_count integer not null,

  outcome       text not null default 'pending'
                check (outcome in ('pending', 'collected', 'cancelled')),
  resolved_at   timestamptz,

  -- Per-theater tallies from the collect pass, for the run log.
  succeeded     integer,
  failed        integer,
  skipped       integer
);

create index scrape_batches_pending_idx on scrape_batches(submitted_at)
  where outcome = 'pending';

-- Internal bookkeeping, unlike theaters and auditions: RLS on with no public
-- policy, so anon cannot read it at all. service_role bypasses RLS but still
-- needs the table grants -- the theaters grant above is the cautionary tale,
-- a missing grant that failed silently for months.
alter table scrape_batches enable row level security;

grant select, insert, update on table scrape_batches to service_role;
