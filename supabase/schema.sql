-- Run this in the Supabase SQL editor to set up the schema.
-- Mirrors the live database as of 2026-09-27.

create table theaters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text not null default '',
  state       text not null default '',
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
