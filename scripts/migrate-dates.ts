import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const anthropic = new Anthropic();

const BATCH_SIZE = 50;

interface DateResult {
  start: string | null;
  end: string | null;
}

function isoDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

async function parseDateStrings(strings: string[]): Promise<DateResult[]> {
  const today = new Date().toISOString().split('T')[0];
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: `Today is ${today}. You will receive a JSON array of audition date strings. Return ONLY a JSON array of the same length, where each element is {"start": "YYYY-MM-DD" | null, "end": "YYYY-MM-DD" | null}. "start" is the earliest audition date; "end" is the latest (same as start for single-day auditions). Use null for either field if the date is vague or unparseable (e.g. "TBD", "ongoing", "rolling", no year given). No prose, no markdown.`,
    messages: [{ role: 'user', content: JSON.stringify(strings) }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return strings.map(() => ({ start: null, end: null }));

  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    return strings.map((_, i) => {
      const v = parsed[i];
      if (!v || typeof v !== 'object') return { start: null, end: null };
      const obj = v as Record<string, unknown>;
      return { start: isoDate(obj.start), end: isoDate(obj.end) };
    });
  } catch {
    return strings.map(() => ({ start: null, end: null }));
  }
}

async function main() {
  const { data: auditions, error } = await supabase
    .from('auditions')
    .select('id, audition_dates')
    .not('audition_dates', 'is', null);

  if (error) {
    console.error('Failed to fetch auditions:', error.message);
    process.exit(1);
  }

  console.log(`Found ${auditions.length} auditions to migrate\n`);

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < auditions.length; i += BATCH_SIZE) {
    const batch = auditions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(auditions.length / BATCH_SIZE);
    console.log(`Batch ${batchNum}/${totalBatches}...`);

    const results = await parseDateStrings(batch.map((a) => a.audition_dates!));

    for (let j = 0; j < batch.length; j++) {
      const { start, end } = results[j];
      if (!start && !end) { skipped++; continue; }

      const { error } = await supabase
        .from('auditions')
        .update({ audition_date_start: start, audition_date_end: end })
        .eq('id', batch[j].id);

      if (error) {
        console.log(`  ✕ ${batch[j].id}: ${error.message}`);
      } else {
        updated++;
      }
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Updated:  ${updated}`);
  console.log(`Skipped (unparseable): ${skipped}`);
}

main();
