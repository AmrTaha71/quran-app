// corr-verify-test.mjs — equivalence test for the position-keyed
// correction mode (Phase 1). Proves the server-side port in
// supabase/functions/generate-voice/corrVerify.ts rebuilds EXACTLY
// the spoken text the client builds (withPrecedingContextWord +
// correctionSpeechText from src/lib), on real seeded ayah texts.
// Run: node scripts/corr-verify-test.mjs (from the repo root).
// Exit non-zero on ANY mismatch — a divergence must fail closed
// (400) in production, never generate from unverified input.

import { buildSync } from 'esbuild';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const outDir = join(tmpdir(), 'corr-verify-test');
mkdirSync(outDir, { recursive: true });

function bundle(entry, outFile) {
  const out = join(outDir, outFile);
  buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' });
  return require(out);
}

const client = bundle('src/lib/arabicNormalize.ts', 'client-normalize.cjs');
const corrPrompt = bundle('src/lib/corrPrompt.ts', 'client-corrprompt.cjs');
const server = bundle('supabase/functions/generate-voice/corrVerify.ts', 'server-verify.cjs');

const { normalizeArabic, correctionSpeechText } = client;
const { withPrecedingContextWord } = corrPrompt;
const { buildCorrSpokenText } = server;

// cleanToken mirrors SelfTestPage.tsx (one line, same regex).
const cleanToken = (t) => t.replace(/[^\u0621-\u064A]/g, '');
// expectedWordList mirrors SelfTestPage.tsx exactly.
function expectedWordList(ayahText) {
  return ayahText
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ orig: w, norm: cleanToken(normalizeArabic(w)) }))
    .filter((x) => x.norm.length > 0 && /[\u0621-\u064A]/.test(x.norm));
}

const fixture = JSON.parse(readFileSync('scripts/corr-verify-fixture.json', 'utf-8'));
const byKey = new Map(fixture.map((r) => [`${r.surah_no}:${r.ayah_no}`, r]));
const ayahTexts = new Map(fixture.map((r) => [r.id, r.ayah_text]));
const expectedByKey = new Map(
  fixture.map((r) => [`${r.surah_no}:${r.ayah_no}`, expectedWordList(r.ayah_text)]),
);

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra}`);
  if (!cond) failures++;
}
function eq(name, clientSpoken, serverSpoken) {
  check(`${name} (client === server)`, clientSpoken === serverSpoken,
    ` [${clientSpoken === null ? 'null' : clientSpoken.length} chars]`);
  if (clientSpoken !== serverSpoken) {
    console.log(`  client: ${JSON.stringify(clientSpoken)}`);
    console.log(`  server: ${JSON.stringify(serverSpoken)}`);
  }
}

// Simulate the client's continuous-mode correction for one ayah:
// missed = word positions within the ayah; context prepends the
// same-ayah predecessor (range simulation for multi-ayah spans uses
// the range expected list + range indices).
function clientSpokenFor(rangeAyahs, missedRangeIndices) {
  // rangeAyahs: [{key, ayahIdx}] in range order; missedRangeIndices:
  // indices into the concatenated range expected list.
  // Rebuild the range expected list with ayahIdx (index of the ayah
  // in the range), exactly like SelfTestPage's contExpected.
  const rangeExpected2 = [];
  rangeAyahs.forEach((r, ai) => {
    expectedByKey.get(r.key).forEach((w) => rangeExpected2.push({ ...w, ayahIdx: ai }));
  });
  const missedWords = missedRangeIndices.map((i) => rangeExpected2[i].orig);
  const spokenWords = withPrecedingContextWord(missedWords, missedRangeIndices, rangeExpected2);
  const shape = spokenWords.length > missedWords.length ? 'context' : 'bare';
  // Positions: per missed word, (ayah id, word position within ayah).
  const positions = missedRangeIndices.map((i) => {
    const e = rangeExpected2[i];
    const ayahKey = rangeAyahs[e.ayahIdx].key;
    const id = byKey.get(ayahKey).id;
    let w = 0;
    for (let j = 0; j < i; j++) if (rangeExpected2[j].ayahIdx === e.ayahIdx) w++;
    return { id, w };
  });
  return { spoken: correctionSpeechText(spokenWords), shape, positions };
}

function runCase(name, rangeKeys, missedRangeIndices) {
  const rangeAyahs = rangeKeys.map((key) => ({ key }));
  const { spoken, shape, positions } = clientSpokenFor(rangeAyahs, missedRangeIndices);
  const serverSpoken = buildCorrSpokenText(ayahTexts, positions, shape);
  eq(name, spoken, serverSpoken);
  return spoken;
}

// A: 2:2 last word (للمتقين) with context (هدى).
{
  const list = expectedByKey.get('2:2');
  const last = list.length - 1;
  const spoken = runCase('A 2:2 context (هدى + للمتقين)', ['2:2'], [last]);
  check('A spoken has 2 words', spoken.split(' ').length === 2);
}
// B: 2:1 muqatta'at with maddah -> letter names.
{
  const spoken = runCase('B 2:1 muqatta-at', ['2:1'], [0]);
  check('B expands to letter names', spoken === 'ألف لام ميم', ` [got ${JSON.stringify(spoken)}]`);
}
// C: 105:1 plain ألم must NOT expand.
{
  const spoken = runCase('C 105:1 plain ألم', ['105:1'], [0]);
  // Seeded 105:1 word carries diacritics (أَلَمْ), so assert on the
  // gate itself: one word, no letter-name expansion.
  check('C stays one word, no expansion', spoken.split(' ').length === 1 && !spoken.includes('ألف'), ` [got ${JSON.stringify(spoken)}]`);
}
// D: 68:1 ن -> نون.
{
  const spoken = runCase('D 68:1 ن', ['68:1'], [0]);
  check('D expands to نون', spoken === 'نون', ` [got ${JSON.stringify(spoken)}]`);
}
// E: 36:1 يس -> ياء سين.
{
  const spoken = runCase('E 36:1 يس', ['36:1'], [0]);
  check('E expands to ياء سين', spoken === 'ياء سين', ` [got ${JSON.stringify(spoken)}]`);
}
// F: multi-ayah span 2:2 last + 2:3 first two, context from 2:2.
{
  const list2 = expectedByKey.get('2:2');
  const range = ['2:2', '2:3'];
  const missed = [list2.length - 1, list2.length, list2.length + 1];
  runCase('F span 2:2->2:3 context', range, missed);
}
// G: ayah-initial bare (2:3 first word, no predecessor).
{
  const spoken = runCase('G 2:3 ayah-initial bare', ['2:3'], [0]);
  check('G single word', spoken.split(' ').length === 1);
}
// H: 2:263 غني حليم context pair.
{
  const list = expectedByKey.get('2:263');
  const halim = list.findIndex((w) => w.norm === 'حليم');
  const spoken = runCase('H 2:263 context (غني + حليم)', ['2:263'], [halim]);
  check('H context is غني', spoken.startsWith(list[halim - 1].orig.replace(/[\u06D6-\u06ED\u08D3-\u08FF]/g, '')) || spoken.split(' ').length === 2);
}
// I: 64:6 غني حميد context pair.
{
  const list = expectedByKey.get('64:6');
  const hamid = list.findIndex((w) => w.norm === 'حميد');
  runCase('I 64:6 context (غني + حميد)', ['64:6'], [hamid]);
}
// J: pause-mark stripping — 2:3 last word carries U+06D9.
{
  const list = expectedByKey.get('2:3');
  const spoken = runCase('J 2:3 last word mark stripped', ['2:3'], [list.length - 1]);
  check('J mark U+06D9 stripped', !spoken.includes('\u06D9'), ` [got ${JSON.stringify(spoken)}]`);
}
// K: negative cases — server must fail closed (null).
{
  const id23 = byKey.get('2:3').id;
  check('K1 context on ayah-initial -> null',
    buildCorrSpokenText(ayahTexts, [{ id: id23, w: 0 }], 'context') === null);
  check('K2 out-of-range word -> null',
    buildCorrSpokenText(ayahTexts, [{ id: id23, w: 999 }], 'bare') === null);
  check('K3 unknown ayah -> null',
    buildCorrSpokenText(ayahTexts, [{ id: 999999, w: 0 }], 'bare') === null);
  check('K4 empty positions -> null',
    buildCorrSpokenText(ayahTexts, [], 'bare') === null);
}

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nALL EQUIVALENCE CASES PASS');
