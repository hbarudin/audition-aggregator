const REPO = 'hbarudin/audition-aggregator';

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

export async function fetchOpenScraperIssueTitles(): Promise<Set<string>> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return new Set();

  const titles = new Set<string>();
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/issues?state=open&labels=scraper-issue&per_page=100&page=${page}`,
      { headers: githubHeaders(token) }
    );
    if (!res.ok) break;

    const issues = await res.json() as { title: string }[];
    if (issues.length === 0) break;

    for (const issue of issues) titles.add(issue.title);
    if (issues.length < 100) break;
    page++;
  }

  return titles;
}

export async function fileIssue(title: string, body: string, labels: string[] = []): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log(`  → GITHUB_TOKEN not set; skipping issue: ${title}`);
    return;
  }

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ title, body, labels }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    console.log(`  → Failed to file GitHub issue: ${err.message ?? res.status}`);
  } else {
    const issue = await res.json() as { number: number };
    console.log(`  → Filed GitHub issue #${issue.number}: ${title}`);
  }
}

export interface OpenIssue {
  number: number;
  title: string;
  labels: string[];
}

/**
 * Same listing as fetchOpenScraperIssueTitles, but keeps the issue numbers so
 * the repair workflow can comment on and close them. The titles-only version
 * stays because the scraper's hot path only needs membership tests.
 */
export async function fetchOpenScraperIssues(): Promise<OpenIssue[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];

  const issues: OpenIssue[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/issues?state=open&labels=scraper-issue&per_page=100&page=${page}`,
      { headers: githubHeaders(token) }
    );
    if (!res.ok) break;

    const batch = await res.json() as { number: number; title: string; labels: { name: string }[] }[];
    if (batch.length === 0) break;

    for (const i of batch) {
      issues.push({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name) });
    }
    if (batch.length < 100) break;
    page++;
  }

  return issues;
}

export async function commentOnIssue(number: number, body: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log(`  → GITHUB_TOKEN not set; skipping comment on #${number}`);
    return false;
  }

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${number}/comments`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    console.log(`  → Failed to comment on #${number}: ${err.message ?? res.status}`);
    return false;
  }
  return true;
}

/**
 * `reason` maps to GitHub's close reason: 'completed' for a theater we fixed,
 * 'not_planned' for one we retired.
 */
export async function closeIssue(
  number: number,
  reason: 'completed' | 'not_planned' = 'completed'
): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log(`  → GITHUB_TOKEN not set; skipping close of #${number}`);
    return false;
  }

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${number}`, {
    method: 'PATCH',
    headers: githubHeaders(token),
    body: JSON.stringify({ state: 'closed', state_reason: reason }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    console.log(`  → Failed to close #${number}: ${err.message ?? res.status}`);
    return false;
  }
  return true;
}

export async function addLabel(number: number, label: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return false;

  const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${number}/labels`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ labels: [label] }),
  });
  return res.ok;
}
