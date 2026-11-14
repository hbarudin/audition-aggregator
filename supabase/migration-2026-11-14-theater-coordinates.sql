-- Runnable slice of schema.sql for an existing database.
-- Adds the coordinate columns backing the radius filter (issue #157).
--
-- Both columns stay nullable. A theater whose city cannot be geocoded -- a
-- typo, or scraper debris in the city column -- keeps null coordinates and
-- goes on showing up everywhere except the radius filter, which is the right
-- failure: invisible is worse than unplaceable.
--
-- Backfill the existing rows afterwards with:
--   npx tsx scripts/geo/backfill-coordinates.ts          (dry run)
--   npx tsx scripts/geo/backfill-coordinates.ts --apply

alter table theaters add column if not exists latitude  double precision;
alter table theaters add column if not exists longitude double precision;
