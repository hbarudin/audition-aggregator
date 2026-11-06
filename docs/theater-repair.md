# Repairing broken and missing theater pages

The daily scrape files a `scraper-issue` for every theater it cannot read. Those
issues used to accumulate with no way out: nothing closed them, and each one had
to be solved from scratch. This is the repeatable procedure, plus the tooling
that does most of it.

## The two classes of issue

They look similar in the tracker but need completely different work, because
they start from different information.

| Issue title | What we know | Discovery |
|---|---|---|
| `Broken page: <theater>` | the old URL, so the **domain** | automated — probe the site itself |
| `Missing audition URL: <theater>` | name + city/state, **no domain** | needs a web search per theater |

Check the split before planning a session:

```
gh issue list --label scraper-issue --state open --limit 200 \
  --json title --jq '.[].title | split(":")[0]' | sort | uniq -c
```

Only the `Broken page` class is automated today. The `Missing audition URL`
class is still manual: find the theater's site, then add the URL through
`/admin/theaters/<id>` or hand it to `apply.ts` as a `url:<URL>` decision.

## The loop

Nothing is written until you decide. `triage.ts` only reads; `apply.ts` is the
only thing that touches Supabase or the tracker, and only for rows you have
marked.

```
# 1. Triage a batch. Start small; each theater takes ~30-60s.
npx tsx scripts/repair/triage.ts --limit 10

# 2. Read repair/decisions-<date>.tsv and set the decision column.

# 3. Apply. It prints the plan and asks for confirmation.
npx tsx scripts/repair/apply.ts repair/decisions-<date>.tsv
```

Useful flags:

- `--theater "Name"` — triage one theater by substring match
- `--dry` — probe only, skip the LLM parse (fast, free, no audition counts)
- `--out <path>` — write the sheet somewhere other than `repair/`

## How discovery works

For a `Broken page` theater we know the domain, so no search is needed:

1. **Re-probe the URL on record.** Pages come back. If it returns 200 and parses
   a currently-dated audition, the deactivation was stale — just re-activate.
2. **Check the origin.** A 403 anywhere means bot-blocked (see Cloudflare below).
   A non-resolving origin is the one real retirement signal.
3. **Read the site's own links**, which beat any guess list:
   - the nav, **including dropdown sub-items** — they are in the markup even
     when CSS hides them
   - a second hop through hub pages: Get Involved, About, News, the show/season
     pages, and the broken URL's own parent directory
4. **Then** fall back to ~27 conventional guessed paths (`/auditions`,
   `/get-involved/auditions`, …).
5. **Validate by parsing.** A candidate only counts if the real scraper parser
   extracts an audition from it. Counts of current / undated / past listings go
   on the sheet as the evidence for your decision.

Probing is capped at 45 paths per theater with a 700ms delay, and at most 3
candidates get an LLM parse.

### Temporary, show-specific pages

Theaters very often post a throwaway page for a single show or season —
`/auditions-the-nutcracker-for-kids`. No guess list predicts those, which is why
the nav crawl matters. They are valid targets, but the sheet marks them
`temporary = yes`, because that URL will 404 once the run ends. When a standing
audition landing page exists too, prefer it; take the show-specific page when it
is all there is, and expect the issue to come back.

## Verdicts and what they mean

| Verdict | Means | Recommends |
|---|---|---|
| `CURRENT_URL_OK` | the URL on record works and parses current auditions | `reactivate` |
| `CANDIDATE_STRONG` | found a page that parses current-dated auditions | `url` |
| `CANDIDATE_WEAK` | found an audition page, nothing currently dated | `review` |
| `BLOCKED` | 403 — bot-blocked, plain `fetch` cannot read it | `playwright` |
| `ORIGIN_DEAD` | the domain does not resolve | `retire` |
| `STALE_LISTINGS_ONLY` | the URL on record is a real audition page, but lists only past calls | `reactivate` |
| `NO_CANDIDATE` | site is alive but exposes no audition page | `review` |

`NO_CANDIDATE` deliberately does **not** recommend retirement. A live site with
no audition page is usually a theater between seasons, not a dead one.

### `STALE_LISTINGS_ONLY`

The URL on record is a real audition page that lists only past calls. The URL
is not wrong — the theater simply has not posted a new audition yet.

Re-activate these. The scraper used to deactivate a theater whose parsed dates
were all before a hardcoded `2025-01-01` dateline, which made re-activating
them pointless: the next run deactivated them again and re-filed the identical
issue. That rule is gone. Deactivation is now reserved for pages we genuinely
cannot read, so a dormant theater stays active and keeps being checked until it
posts its next call. Old rows are still stored and land on `/past`.

## Decision column

| Value | Effect |
|---|---|
| `?` | the default — nothing is written |
| `y` | accept the row's `recommended` value |
| `url` | set `candidate_url`, re-activate, close the issue |
| `url:<URL>` | set an explicit URL instead, re-activate, close the issue |
| `reactivate` | the current URL works — re-activate, close, no URL change |
| `close` | close the issue only; no database change |
| `playwright` | tag the issue `needs-playwright`, leave it open |
| `retire` | `is_active = false`, reason into `notes`, close as not-planned |
| `skip` | leave it alone, issue stays open |

To accept a reviewed batch without editing every row:

```
npx tsx scripts/repair/apply.ts <sheet> --accept-recommended CANDIDATE_STRONG
npx tsx scripts/repair/apply.ts <sheet> --accept-recommended all
```

`--accept-recommended` never applies `retire` or `review`. Retirement is always
typed per row, on purpose: it is the one decision that silently drops a theater
from the site.

## Cloudflare / 403 theaters

A 403 is not a broken page — the page is fine and we cannot read it. These need
a headless-browser fetch path; `fetchPage` uses plain `fetch`. Mark them
`playwright` so the issue is labelled `needs-playwright` and stays open as the
queue for that work. Do not retire them.

## Bookkeeping the triage also reports

Two conditions need no probing, and `triage.ts` lists them in its summary and in
the `.evidence.json` file:

- **stale-issue** — the theater is active again but its issue is still open.
  Resolve with `close`.
- **untracked-inactive** — the theater is deactivated with no open issue, so the
  work is invisible. Needs an issue filed, or retirement.

## After applying

Re-activated theaters are picked up by the next daily scrape, or run it now:

```
npx tsx scraper/index.ts
```

## Still open

- The scraper does not close an issue when a page recovers on its own, so the
  `close` path above stays manual. Auto-closing on a successful scrape would
  make the loop self-clearing.
- A live listing whose only date is a submission deadline ("due by November
  22nd") parses with no `audition_date_start`, so it counts as undated rather
  than current and lands in `CANDIDATE_WEAK`. Related: the undated-handling
  backlog items (#155, #156).
- `Missing audition URL` discovery (98 theaters) has no tooling. It needs a
  search step; there is no `website` column to work from, and only 5 of the 98
  have anything in `notes`.
