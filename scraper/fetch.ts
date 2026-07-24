const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_TEXT_LENGTH = 8_000;

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
    return { text: extractText(html), status: response.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.log(`  → Timeout after ${TIMEOUT_MS / 1000}s`);
    } else {
      console.log(`  → Fetch error: ${err}`);
    }
    return { text: null, status: 0 };
  }
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}
