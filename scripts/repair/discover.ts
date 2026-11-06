import { fetchPage } from '../../scraper/fetch';
import { parseAuditions } from '../../scraper/parse';
import { AUDITION_WORD_RE, SOFT_404_RE } from '../../lib/repair/page-signals';

/**
 * Candidate discovery for a theater whose audition page broke. We know the old
 * URL, so we know the origin, and that is enough to work without a web search.
 *
 * Three sources, in descending order of trust:
 *   1. the site's own navigation, including dropdown sub-items (which live in
 *      the markup even when CSS hides them)
 *   2. a second hop through "hub" pages (Get Involved, About, News, and the
 *      broken URL's own parent directory)
 *   3. conventional guessed paths
 *
 * The nav matters more than the guess list because theaters very often post a
 * throwaway page for a single show or season — /auditions-the-nutcracker-2026
 * — which no guess list can predict but which the nav always links.
 */

// Tried only after the site's own links come up empty.
const GUESS_PATHS = [
  '/auditions', '/auditions/', '/auditions.html',
  '/audition', '/audition/', '/audition.html',
  '/audition-info', '/audition-info/', '/audition-information',
  '/auditions-2/', '/casting', '/casting/',
  '/get-involved/auditions', '/get-involved/auditions/', '/get-involved',
  '/about/auditions', '/about-us/auditions', '/about-us/auditions/',
  '/opportunities', '/opportunities/', '/work-with-us', '/work-with-us/',
  '/participate/auditions', '/join-us/auditions',
  '/employment', '/auditions-and-employment',
  '/education/auditions', '/community/auditions',
];


/** Link href/text that could lead to an audition page, including one-show pages. */
const AUDITION_LINK_RE = /audition|casting|open.?call|now.?casting|join.(the.)?cast|be.in.a.show|performer|submission/i;

/** Pages that tend to *contain* a link to a temporary audition page. */
const HUB_LINK_RE = /get.?involved|opportunit|work.with.us|about|participate|education|community|news|announce|blog|company|employment|jobs|shows?|production|season|on.?stage|upcoming|current/i;

const PROBE_DELAY_MS = 500;
const PROBE_TIMEOUT_MS = 5_000; // most probes are dead ends; fail them fast
const MAX_PARSE_CANDIDATES = 3; // each parse is an LLM call; cap the spend per theater
const MAX_PROBES = 45;          // politeness ceiling per theater
const MAX_HUB_HOPS = 4;         // second-hop pages to crawl for buried audition links

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type Verdict =
  | 'CURRENT_URL_OK'   // the original URL works and parses; just re-activate
  | 'CANDIDATE_STRONG' // found a page that parses current-dated auditions
  | 'CANDIDATE_WEAK'   // found an audition page, but nothing currently dated
  | 'BLOCKED'          // 403/Cloudflare — needs the Playwright track
  | 'ORIGIN_DEAD'       // domain does not resolve or origin is gone
  | 'STALE_LISTINGS_ONLY' // URL on record is a real audition page, but only past listings
  | 'NO_CANDIDATE';     // site is alive but exposes no audition page

export type CandidateSource = 'nav' | 'homepage' | 'subpage' | 'guess' | 'current';

export interface Probe {
  url: string;
  status: number;
  softNotFound: boolean;
  hasAuditionWords: boolean;
  textLength: number;
  source: CandidateSource;
  linkText?: string;
}

export interface TriageFinding {
  theaterId: string;
  theaterName: string;
  currentUrl: string | null;
  verdict: Verdict;
  recommendedUrl: string | null;
  /** Where the winning candidate came from, and how it was linked. */
  candidateSource: CandidateSource | null;
  candidateLinkText: string | null;
  /** True when the URL looks tied to one show or season, so expect it to churn. */
  looksTemporary: boolean;
  currentDated: number;
  undated: number;
  staleDated: number;
  sample: string | null;
  evidence: string;
  probes: Probe[];
}

interface Candidate {
  url: string;
  source: CandidateSource;
  linkText?: string;
}

async function probe(c: Candidate): Promise<Probe> {
  const { text, status } = await fetchPage(c.url, { timeoutMs: PROBE_TIMEOUT_MS });
  return {
    url: c.url,
    status,
    softNotFound: text ? SOFT_404_RE.test(text.slice(0, 2_000)) : false,
    hasAuditionWords: text ? AUDITION_WORD_RE.test(text) : false,
    textLength: text?.length ?? 0,
    source: c.source,
    linkText: c.linkText,
  };
}

/** A probe worth spending an LLM call on. */
function isLiveAuditionPage(p: Probe): boolean {
  return p.status === 200 && !p.softNotFound && p.hasAuditionWords && p.textLength > 200;
}

async function getHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return { html: await res.text(), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/**
 * Whether two URLs belong to the same theater's site. Comparing URL.origin is
 * too strict: the stored URL is often http://www.example.com while the live
 * site serves https://example.com, and an exact origin match then discards
 * every link in the site's own nav.
 */
function sameSite(a: string, b: string): boolean {
  try {
    const host = (u: string) => new URL(u).hostname.replace(/^www\./i, '').toLowerCase();
    return host(a) === host(b);
  } catch {
    return false;
  }
}

interface Anchor {
  href: string;
  text: string;
  inNav: boolean;
}

/**
 * Every anchor in the document, tagged with whether it sits inside a nav-ish
 * container. Dropdown sub-items are plain markup inside those containers, so
 * reading the whole region picks them up without needing to execute CSS or JS.
 */
function extractAnchors(html: string): Anchor[] {
  const navRegions: [number, number][] = [];
  const regionRe = /<(nav|header)\b[^>]*>|<(ul|div)\b[^>]*(?:class|id)=["'][^"']*(?:nav|menu|primary-menu|main-menu)[^"']*["'][^>]*>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = regionRe.exec(html)) !== null) {
    // Approximate the region as a generous window from the opening tag. Nav
    // markup is small, and over-reach only costs us a mis-ranked candidate.
    navRegions.push([rm.index, rm.index + 20_000]);
  }
  const inNav = (i: number) => navRegions.some(([s, e]) => i >= s && i <= e);

  const anchors: Anchor[] = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    anchors.push({
      href: m[1],
      text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      inNav: inNav(m.index),
    });
  }
  return anchors;
}

function absolutize(href: string, base: string, site: string): string | null {
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
  try {
    const abs = new URL(href, base);
    if (!sameSite(abs.toString(), site)) return null; // stay on the theater's own site
    if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?|xlsx?|mp4|mov)$/i.test(abs.pathname)) return null;
    abs.hash = '';
    return abs.toString();
  } catch {
    return null;
  }
}

/**
 * A URL tied to a single show or season rather than a standing auditions page.
 * Worth recording: it will work today and 404 next season.
 */
function looksTemporaryUrl(url: string): boolean {
  let slug: string;
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    slug = p.split('/').pop() ?? '';
  } catch {
    return false;
  }
  slug = slug.replace(/\.(html?|php|aspx?)$/i, '');
  if (/\b(19|20)\d{2}\b/.test(slug)) return true; // a year in the slug
  const rest = slug
    .split(/[-_]/)
    .filter((tok) => tok && !/^(auditions?|casting|call|open|info|information|for|the|a|an|and|at|page|2)$/i.test(tok));
  return rest.length >= 2; // e.g. auditions-the-nutcracker-for-kids
}

/**
 * Collect candidates from the site's own links, then guessed paths. Hub pages
 * get a second hop because a one-show audition page is often linked only from
 * a Get Involved or News page, never from the top-level nav.
 */
async function collectCandidates(origin: string, brokenUrl: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<string>([brokenUrl]);
  const push = (c: Candidate) => {
    if (seen.has(c.url)) return;
    seen.add(c.url);
    out.push(c);
  };

  const home = await getHtml(origin);
  // Follow the site to where it actually lives. The stored URL is frequently
  // http://www.x.com while the site serves https://x.com, and guessing paths
  // on the stale origin means every probe pays a redirect.
  const canonicalOrigin = home ? new URL(home.finalUrl).origin : origin;
  const hubs: Candidate[] = [];

  if (home) {
    const anchors = extractAnchors(home.html);
    // Nav first, then body links: the nav is where a season's audition page is announced.
    for (const pass of [true, false]) {
      for (const a of anchors) {
        if (a.inNav !== pass) continue;
        const url = absolutize(a.href, home.finalUrl, canonicalOrigin);
        if (!url) continue;
        if (AUDITION_LINK_RE.test(a.href) || AUDITION_LINK_RE.test(a.text)) {
          push({ url, source: pass ? 'nav' : 'homepage', linkText: a.text || undefined });
        } else if (HUB_LINK_RE.test(a.href) || HUB_LINK_RE.test(a.text)) {
          hubs.push({ url, source: 'subpage', linkText: a.text || undefined });
        }
      }
    }
  }

  // The broken URL's own parent directory is a strong hub: /about-us/auditions
  // breaking usually means the replacement is still under /about-us/.
  try {
    const u = new URL(brokenUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 1) {
      hubs.unshift({ url: `${canonicalOrigin}/${parts.slice(0, -1).join('/')}/`, source: 'subpage', linkText: 'parent of the broken URL' });
    }
  } catch {
    /* already validated upstream */
  }

  // Second hop: scan a few hub pages for audition links the homepage didn't show.
  const hubSeen = new Set<string>();
  let hopped = 0;
  for (const hub of hubs) {
    if (hopped >= MAX_HUB_HOPS) break;
    if (hubSeen.has(hub.url)) continue;
    hubSeen.add(hub.url);
    await sleep(PROBE_DELAY_MS);
    const page = await getHtml(hub.url);
    if (!page) continue;
    hopped++;
    for (const a of extractAnchors(page.html)) {
      if (!AUDITION_LINK_RE.test(a.href) && !AUDITION_LINK_RE.test(a.text)) continue;
      const url = absolutize(a.href, page.finalUrl, canonicalOrigin);
      if (!url) continue;
      push({ url, source: 'subpage', linkText: a.text ? `${a.text} (via ${hub.linkText ?? hub.url})` : `via ${hub.linkText ?? hub.url}` });
    }
  }

  for (const p of GUESS_PATHS) push({ url: canonicalOrigin + p, source: 'guess' });

  return out;
}

export async function triageTheater(
  theater: { id: string; name: string; audition_page_url: string | null },
  opts: { skipParse?: boolean } = {}
): Promise<TriageFinding> {
  const probes: Probe[] = [];
  let currentUrlIsAuditionPage = false;
  const base = {
    theaterId: theater.id,
    theaterName: theater.name,
    currentUrl: theater.audition_page_url,
    candidateSource: null as CandidateSource | null,
    candidateLinkText: null as string | null,
    looksTemporary: false,
    currentDated: 0,
    undated: 0,
    staleDated: 0,
    sample: null as string | null,
  };

  if (!theater.audition_page_url) {
    return { ...base, verdict: 'NO_CANDIDATE', recommendedUrl: null,
      evidence: 'No URL on record; needs the search track.', probes };
  }

  let origin: string;
  try {
    origin = new URL(theater.audition_page_url).origin;
  } catch {
    return { ...base, verdict: 'NO_CANDIDATE', recommendedUrl: null,
      evidence: `Unparseable URL on record: ${theater.audition_page_url}`, probes };
  }

  // 1. Does the URL we already have work again?
  const current = await probe({ url: theater.audition_page_url, source: 'current' });
  probes.push(current);

  if (current.status === 403) {
    return { ...base, verdict: 'BLOCKED', recommendedUrl: null,
      evidence: `HTTP 403 on the current URL — bot-blocked, needs Playwright.`, probes };
  }

  if (isLiveAuditionPage(current)) {
    const counts = opts.skipParse
      ? { currentDated: 0, undated: 0, staleDated: 0, sample: null }
      : await parseCounts(theater.audition_page_url, theater.name);
    if (opts.skipParse || counts.currentDated > 0) {
      return { ...base, ...counts, verdict: 'CURRENT_URL_OK', recommendedUrl: theater.audition_page_url,
        candidateSource: 'current',
        evidence: `Current URL returns 200 and parses ${counts.currentDated} current audition(s). Deactivation looks stale.`, probes };
    }
    // Live audition page but nothing current. Keep it as the fallback: the URL
    // is not wrong, the theater just has not posted a new call yet.
    Object.assign(base, counts);
    currentUrlIsAuditionPage = true;
  }

  // 2. Is the origin even alive?
  await sleep(PROBE_DELAY_MS);
  const home = await probe({ url: origin, source: 'current' });
  probes.push(home);

  if (home.status === 403) {
    return { ...base, verdict: 'BLOCKED', recommendedUrl: null,
      evidence: `Homepage returns HTTP 403 — bot-blocked, needs Playwright.`, probes };
  }
  if (home.status === 0) {
    return { ...base, verdict: 'ORIGIN_DEAD', recommendedUrl: null,
      evidence: `${origin} does not resolve or timed out. Retirement candidate.`, probes };
  }

  // 3. Nav links, hub sub-pages, then guesses.
  const candidates = await collectCandidates(origin, theater.audition_page_url);

  const liveCandidates: Probe[] = [];
  let probed = 0;
  for (const c of candidates) {
    if (probed >= MAX_PROBES) break;
    // The site's own links are ordered ahead of the guesses. Once one of them
    // is a live audition page there is nothing left to guess at, so stop
    // rather than paying 27 more probes for a worse answer.
    if (c.source === 'guess' && liveCandidates.length > 0) break;
    await sleep(PROBE_DELAY_MS);
    const p = await probe(c);
    probes.push(p);
    probed++;
    if (p.status === 403) {
      return { ...base, verdict: 'BLOCKED', recommendedUrl: null,
        evidence: `HTTP 403 while probing ${c.url} — bot-blocked, needs Playwright.`, probes };
    }
    if (isLiveAuditionPage(p)) {
      liveCandidates.push(p);
      if (liveCandidates.length >= MAX_PARSE_CANDIDATES) break;
    }
  }

  if (liveCandidates.length === 0) {
    const linkCount = candidates.filter((c) => c.source !== 'guess').length;

    // The URL on record is a working audition page with nothing current on it:
    // a dormant theater, not a broken link. Safe to re-activate -- the scraper
    // no longer deactivates for stale listings, so it will simply keep checking
    // until the theater posts its next call.
    if (currentUrlIsAuditionPage) {
      return { ...base, verdict: 'STALE_LISTINGS_ONLY', recommendedUrl: theater.audition_page_url,
        candidateSource: 'current',
        evidence: `The URL on record is a live audition page but lists nothing current (${base.undated} undated, ${base.staleDated} past). The URL is not wrong — the theater has not posted a new call. Re-activate and let the scraper keep watching it.`, probes };
    }

    return { ...base, verdict: 'NO_CANDIDATE', recommendedUrl: null,
      evidence: `${origin} answers (HTTP ${home.status}) but no audition page found: ${probed} path(s) probed, ${linkCount} from the site's own nav/sub-pages. The domain still resolves, so this is more likely a theater between seasons than a dead one — decide between retiring it and finding the page by hand.`, probes };
  }

  // 4. Parse the live candidates; prefer one with currently-dated auditions.
  let best: { url: string; source: CandidateSource; linkText?: string; currentDated: number; undated: number; staleDated: number; sample: string | null } | null = null;
  for (const c of liveCandidates) {
    const counts = opts.skipParse
      ? { currentDated: 0, undated: 0, staleDated: 0, sample: null }
      : await parseCounts(c.url, theater.name);
    const cand = { url: c.url, source: c.source, linkText: c.linkText, ...counts };
    if (!best || cand.currentDated > best.currentDated || (cand.currentDated === best.currentDated && cand.undated > best.undated)) {
      best = cand;
    }
    if (cand.currentDated > 0) break;
  }

  const { url: bestUrl, source: bestSource, linkText: bestLinkText, ...bestCounts } = best!;
  const temporary = looksTemporaryUrl(bestUrl);
  const tempNote = temporary
    ? ' This URL looks tied to one show/season, so expect it to break again — the standing nav link may be the safer target.'
    : '';
  const via = bestLinkText ? ` (linked as "${bestLinkText}")` : '';
  const common = {
    ...base, ...bestCounts,
    candidateSource: bestSource,
    candidateLinkText: bestLinkText ?? null,
    looksTemporary: temporary,
    recommendedUrl: bestUrl,
    probes,
  };

  if (bestCounts.currentDated > 0) {
    return { ...common, verdict: 'CANDIDATE_STRONG',
      evidence: `${bestUrl} [${bestSource}]${via} parses ${bestCounts.currentDated} current audition(s).${tempNote}` };
  }

  return { ...common, verdict: 'CANDIDATE_WEAK',
    evidence: `${bestUrl} [${bestSource}]${via} looks like an audition page but parses no currently-dated audition (${bestCounts.undated} undated, ${bestCounts.staleDated} past). Needs a human look.${tempNote}` };
}

async function parseCounts(url: string, theaterName: string) {
  const { text } = await fetchPage(url);
  if (!text) return { currentDated: 0, undated: 0, staleDated: 0, sample: null };

  let auditions;
  try {
    auditions = await parseAuditions(text, theaterName);
  } catch (err) {
    console.log(`  → parse failed for ${url}: ${err}`);
    return { currentDated: 0, undated: 0, staleDated: 0, sample: null };
  }

  const today = new Date().toISOString().split('T')[0];
  const dated = auditions.filter((a) => a.audition_date_start != null);
  const currentDated = dated.filter((a) => a.audition_date_start! >= today);
  const sampleRow = currentDated[0] ?? auditions[0];

  return {
    currentDated: currentDated.length,
    undated: auditions.length - dated.length,
    staleDated: dated.length - currentDated.length,
    sample: sampleRow
      ? `${sampleRow.show_name ?? 'untitled'} — ${sampleRow.audition_dates ?? 'no date given'}`
      : null,
  };
}
