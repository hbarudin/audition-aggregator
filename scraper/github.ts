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
