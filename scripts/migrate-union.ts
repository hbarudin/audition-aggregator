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

const BATCH_SIZE = 20;

async function classifyNonUnion(texts: string[]): Promise<(boolean | null)[]> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: `You are classifying theater audition listings. For each piece of text, answer: can non-union actors audition here?
Return ONLY a JSON array of the same length with values: true (non-union actors can audition, including separate non-equity calls or open calls), false (union/AEA members only, non-union explicitly excluded), or null (not mentioned). No prose, no markdown.`,
    messages: [{ role: 'user', content: JSON.stringify(texts) }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return texts.map(() => null);

  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    return texts.map((_, i) => {
      const v = parsed[i];
      return typeof v === 'boolean' ? v : null;
    });
  } catch {
    return texts.map(() => null);
  }
}

async function main() {
  const { data: auditions, error } = await supabase
    .from('auditions')
    .select('id, raw_text, audition_dates, show_name')
    .is('non_union_ok', null);

  if (error) {
    console.error('Failed to fetch auditions:', error.message);
    process.exit(1);
  }

  console.log(`Found ${auditions.length} auditions to classify\n`);

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < auditions.length; i += BATCH_SIZE) {
    const batch = auditions.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(auditions.length / BATCH_SIZE);
    console.log(`Batch ${batchNum}/${totalBatches}...`);

    const texts = batch.map((a) =>
      a.raw_text ?? [a.show_name, a.audition_dates].filter(Boolean).join(' — ') ?? ''
    );

    const results = await classifyNonUnion(texts);

    for (let j = 0; j < batch.length; j++) {
      const value = results[j];
      if (value === null) { skipped++; continue; }

      const { error } = await supabase
        .from('auditions')
        .update({ non_union_ok: value })
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
  console.log(`Skipped (not mentioned): ${skipped}`);
}

main();
