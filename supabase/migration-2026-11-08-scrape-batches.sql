-- Migration: batch handoff table for the Message Batches API scrape.
-- Run this once in the Supabase SQL editor. The same DDL is in schema.sql,
-- which is the full-schema reference and is not runnable against a live
-- database; this file is the runnable slice.
--
-- The daily scrape submits one batch of ~325 parse requests and collects the
-- results when they are ready -- usually within the hour, by contract up to 24
-- hours. This table is the handoff between the run that asks and the run that
-- collects. Without it a run that times out waiting has paid for work it can
-- never find again.

create table scrape_batches (
  id            text primary key,     -- Anthropic's batch id (msgbatch_...)
  submitted_at  timestamptz not null default now(),
  request_count integer not null,

  outcome       text not null default 'pending'
                check (outcome in ('pending', 'collected', 'cancelled')),
  resolved_at   timestamptz,

  succeeded     integer,
  failed        integer,
  skipped       integer
);

create index scrape_batches_pending_idx on scrape_batches(submitted_at)
  where outcome = 'pending';

alter table scrape_batches enable row level security;

grant select, insert, update on table scrape_batches to service_role;
