const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
// Generous safety valve, not a budget: a 21k-char page is only ~6k input
// tokens against the model's 200k context, and the median theater page is
// under 3k chars. The previous 8k cap silently discarded most of the longer
// pages, so the parser only ever saw their first audition.
const MAX_TEXT_LENGTH = 100_000;

export interface FetchResult {
  text: string | null;
  status: number; // HTTP status, or 0 for network/timeout errors
}

export async function fetchPage(url: string): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`  → HTTP ${response.status}`);
      return { text: null, status: response.status };
    }

    const html = await response.text();
    const { text, truncated, originalLength } = extractText(html);
    if (truncated) {
      console.log(`  → Page text truncated: ${originalLength} chars reduced to ${MAX_TEXT_LENGTH}`);
    }
    return { text, status: response.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.log(`  → Timeout after ${TIMEOUT_MS / 1000}s`);
    } else {
      console.log(`  → Fetch error: ${err}`);
    }
    return { text: null, status: 0 };
  }
}

function extractText(html: string): { text: string; truncated: boolean; originalLength: number } {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    text: text.slice(0, MAX_TEXT_LENGTH),
    truncated: text.length > MAX_TEXT_LENGTH,
    originalLength: text.length,
  };
}
