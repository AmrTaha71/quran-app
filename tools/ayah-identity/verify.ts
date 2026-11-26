// Item 16.11 — one ayah identity across every ayah data source.
// One-time check, NOT shipped in the app (nothing in src/ imports it).
// Standing rule: any NEW ayah data source must pass this same check
// before it is wired in.
//
// Run:
//   npx esbuild tools/ayah-identity/verify.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/ayah-identity.mjs && node /tmp/ayah-identity.mjs
//
// Sources compared:
//   - live quran_verses (snapshot in live-snapshot.json, read-only SQL)
//   - surahs.ts SURAH_AYAH_COUNTS / testRanges SURAH_START_GLOBAL
//   - quranBoundaries JUZ/HIZB/QUARTER_STARTS (ayah-based)
//   - madinahPageStarts (ayah -> page of the scans the app shows)
//   - mushafEditions SURAH_START_PAGES, quranIndex JUZ/HIZB_START_PAGES
//   - wbwManifestJuz30 (the juz-30 Juhani manifest was deleted, item 4.1)
// Exit code 1 when any mismatch is found.
import snap from './live-snapshot.json' with { type: 'json' };
import { SURAH_AYAH_COUNTS } from '../../src/lib/surahs';
import { SURAH_START_GLOBAL, TOTAL_AYAHS } from '../../src/lib/testRanges';
import { JUZ_STARTS, HIZB_STARTS, QUARTER_STARTS } from '../../src/lib/quranBoundaries';
import { MADINAH_PAGE_STARTS, madinahPageOfAyah } from '../../src/lib/madinahPageStarts';
import { SURAH_START_PAGES, TOTAL_MUSHAF_PAGES } from '../../src/lib/mushafEditions';
import { JUZ_START_PAGES, HIZB_START_PAGES } from '../../src/lib/quranIndex';
import { WBW_MANIFEST_JUZ30 } from '../../src/lib/wbwManifestJuz30';

const bad: string[] = [];
const fail = (m: string) => bad.push(m);
const valid = (s: number, a: number) => s >= 1 && s <= 114 && a >= 1 && a <= SURAH_AYAH_COUNTS[s - 1];
const key = (s: number, a: number) => `${s}:${a}`;

// 1. Ayah set: live DB vs the app's surah table.
if (snap.total !== 6236 || snap.distinct !== 6236) fail(`live: total ${snap.total}, distinct ${snap.distinct}`);
if (snap.idNotGlobalOrder !== 0) fail(`live: ${snap.idNotGlobalOrder} rows whose id is not the global order`);
if (snap.emptyText !== 0) fail(`live: ${snap.emptyText} rows with empty text`);
const sum = SURAH_AYAH_COUNTS.reduce((a, b) => a + b, 0);
if (sum !== TOTAL_AYAHS || SURAH_AYAH_COUNTS.length !== 114) fail(`surahs.ts: ${SURAH_AYAH_COUNTS.length} surahs, ${sum} ayat`);
SURAH_AYAH_COUNTS.forEach((c, i) => {
  if (snap.perSurahCounts[i] !== c) fail(`surah ${i + 1}: app ${c} ayat, live ${snap.perSurahCounts[i]}`);
  const g = i === 0 ? 1 : SURAH_START_GLOBAL[i - 1] + SURAH_AYAH_COUNTS[i - 1];
  if (SURAH_START_GLOBAL[i] !== g) fail(`SURAH_START_GLOBAL[${i + 1}] = ${SURAH_START_GLOBAL[i]}, expected ${g}`);
});

// 2. Ayah-based boundaries: (surah, ayah) must agree with global.
for (const [name, t] of [['juz', JUZ_STARTS], ['hizb', HIZB_STARTS], ['quarter', QUARTER_STARTS]] as const) {
  let prev = 0;
  for (const b of t) {
    if (!valid(b.surah, b.ayah)) fail(`${name}: invalid ayah ${key(b.surah, b.ayah)}`);
    else if (SURAH_START_GLOBAL[b.surah - 1] + b.ayah - 1 !== b.global) fail(`${name} ${key(b.surah, b.ayah)}: global ${b.global} is wrong`);
    if (b.global <= prev) fail(`${name}: not increasing at ${key(b.surah, b.ayah)}`);
    prev = b.global;
  }
}

// 3. Page table of the scans: 604 pages, valid ayat, increasing.
if (MADINAH_PAGE_STARTS.length !== TOTAL_MUSHAF_PAGES) fail(`MADINAH_PAGE_STARTS has ${MADINAH_PAGE_STARTS.length} pages`);
MADINAH_PAGE_STARTS.forEach((k, i) => {
  const s = Math.floor(k / 1000), a = k % 1000;
  if (!valid(s, a)) fail(`page ${i + 1}: invalid first ayah ${key(s, a)}`);
  if (i > 0 && k <= MADINAH_PAGE_STARTS[i - 1]) fail(`page ${i + 1}: first ayah not after page ${i}`);
});

// 4. Page tables keyed by page must agree with the scans' ayah -> page.
//    A surah/juz/hizb "starts on page P" when its first ayah is printed on P.
for (const { surah, page } of SURAH_START_PAGES) {
  const p = madinahPageOfAyah(surah, 1);
  if (p !== page) fail(`SURAH_START_PAGES surah ${surah}: table page ${page}, scans page ${p}`);
}
if (SURAH_START_PAGES.length !== 114) fail(`SURAH_START_PAGES has ${SURAH_START_PAGES.length} rows`);
for (const j of JUZ_START_PAGES) {
  const b = JUZ_STARTS[j.number - 1];
  const p = madinahPageOfAyah(b.surah, b.ayah);
  if (p !== j.startPage) fail(`JUZ_START_PAGES juz ${j.number} (${key(b.surah, b.ayah)}): table page ${j.startPage}, scans page ${p}`);
}
for (const h of HIZB_START_PAGES) {
  const b = HIZB_STARTS[h.number - 1];
  const p = madinahPageOfAyah(b.surah, b.ayah);
  if (p !== h.startPage) fail(`HIZB_START_PAGES hizb ${h.number} (${key(b.surah, b.ayah)}): table page ${h.startPage}, scans page ${p}`);
  const jz = JUZ_STARTS.filter((x) => x.global <= b.global).length;
  if (jz !== h.juz) fail(`HIZB_START_PAGES hizb ${h.number}: juz ${h.juz}, ayah-based juz ${jz}`);
}

// 5. Juz-30 manifest: valid juz-30 ayat.
const j30 = JUZ_STARTS[29].global;
const words = snap.juz30Words as Record<string, number>;
for (const k of WBW_MANIFEST_JUZ30) {
  const [s, a] = k.split(':').map(Number);
  if (!valid(s, a) || SURAH_START_GLOBAL[s - 1] + a - 1 < j30) fail(`wbw manifest: ${k} is not a juz-30 ayah`);
}
if (Object.keys(words).length !== TOTAL_AYAHS - j30 + 1) fail(`snapshot: ${Object.keys(words).length} juz-30 ayat`);

console.log(`checked: 6236 ayat, ${MADINAH_PAGE_STARTS.length} pages, ${SURAH_START_PAGES.length} surah pages, ${JUZ_START_PAGES.length} juz pages, ${HIZB_START_PAGES.length} hizb pages, wbw ${WBW_MANIFEST_JUZ30.size}`);
console.log(bad.length ? `MISMATCHES (${bad.length}):\n` + bad.join('\n') : 'no mismatches');
process.exit(bad.length ? 1 : 0);
