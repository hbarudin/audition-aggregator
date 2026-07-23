import Anthropic from '@anthropic-ai/sdk';

// Created lazily so the API key is read after dotenv has loaded.
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

export interface ParsedAudition {
  show_name: string | null;
  audition_dates: string | null;
  performance_dates: string | null;
  is_paid: boolean | null;
  is_union: boolean | null;
  housing: 'yes' | 'no' | 'unknown';
  is_expired: boolean;
}

export async function parseAuditions(
  pageText: string,
  theaterName: string
): Promise<ParsedAudition[]> {
  const today = new Date().toISOString().split('T')[0];

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    // Instructions are in the system prompt, scraped content is in the user turn.
    // This separation limits prompt injection from malicious page content.
    system: `You are a data extraction assistant for a theater audition aggregator.
Today's date is ${today}.

Extract audition listings from the theater page content provided and return ONLY a JSON object — no prose, no explanation, no markdown.

Return this exact structure:
{
  "auditions": [
    {
      "show_name": string or null,
      "audition_dates": string or null,
      "performance_dates": string or null,
      "is_paid": true | false | null,
      "is_union": true | false | null,
      "housing": "yes" | "no" | "unknown",
      "is_expired": true | false
    }
  ]
}

Field rules:
- is_expired: true if ALL audition dates are before today's date
- is_paid: true if any compensation is mentioned, false if explicitly volunteer/unpaid, null if unknown
- is_union: true if union/Equity, false if non-union/non-Equity, null if unknown
- housing: "yes" if housing is offered, "no" if explicitly not offered, "unknown" if not mentioned
- If no auditions are currently listed, return { "auditions": [] }`,
    messages: [
      {
        role: 'user',
        content: `Theater: ${theaterName}

[CONTENT]
${pageText}
[/CONTENT]`,
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    // Extract the JSON object even if there's any surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.auditions)) return [];

    return (parsed.auditions as unknown[])
      .map(validateAudition)
      .filter((a): a is ParsedAudition => a !== null);
  } catch {
    console.log(`  → LLM returned invalid JSON`);
    return [];
  }
}

// Validates and coerces LLM output — never trust raw LLM fields directly.
function validateAudition(raw: unknown): ParsedAudition | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;

  const housing =
    a.housing === 'yes' ? 'yes' : a.housing === 'no' ? 'no' : 'unknown';

  return {
    show_name: typeof a.show_name === 'string' ? a.show_name.slice(0, 500) : null,
    audition_dates: typeof a.audition_dates === 'string' ? a.audition_dates.slice(0, 500) : null,
    performance_dates: typeof a.performance_dates === 'string' ? a.performance_dates.slice(0, 500) : null,
    is_paid: typeof a.is_paid === 'boolean' ? a.is_paid : null,
    is_union: typeof a.is_union === 'boolean' ? a.is_union : null,
    housing,
    is_expired: a.is_expired === true,
  };
}
