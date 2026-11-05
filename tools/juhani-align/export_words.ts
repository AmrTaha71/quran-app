// Run from the repo root:
//   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npx tsx tools/juhani-align/export_words.ts
// Writes tools/juhani-align/work/words.json:
//   { "78:1": { "orig": ["عَمَّ", ...], "norm": ["عم", ...] }, ... }
// using the app's OWN tokenizer (src/lib/expectedWords.ts), so word
// numbering in the manifest can never drift from what SelfTest grades.
// NOT RUN. If anon select on quran_verses is blocked, use a service key
// locally (never commit it).
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expectedWordList } from '../../src/lib/expectedWords';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
const supabase = createClient(url, key);

async function main() {
  const out: Record<string, { orig: string[]; norm: string[] }> = {};
  const PAGE = 1000;
  for (let from = 1; from <= 6236; from += PAGE) {
    const { data, error } = await supabase
      .from('quran_verses')
      .select('id, surah_no, ayah_no, ayah_text')
      .gte('id', from)
      .lte('id', Math.min(from + PAGE - 1, 6236))
      .order('id', { ascending: true });
    if (error) throw error;
    for (const r of data ?? []) {
      const words = expectedWordList(r.ayah_text as string);
      out[`${r.surah_no}:${r.ayah_no}`] = { orig: words.map((w) => w.orig), norm: words.map((w) => w.norm) };
    }
  }
  const n = Object.keys(out).length;
  if (n !== 6236) console.warn(`WARNING: expected 6236 ayahs, got ${n}`);
  mkdirSync('tools/juhani-align/work', { recursive: true });
  writeFileSync('tools/juhani-align/work/words.json', JSON.stringify(out));
  console.log(`wrote ${n} ayahs`);
}
main().catch((e) => { console.error(e); process.exit(1); });
