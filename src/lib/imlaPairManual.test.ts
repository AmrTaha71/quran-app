// Run: node --test src/lib/imlaPairManual.test.ts
// The live IndoPak text splits some words in two that the page prints as one (16.11 check:
// 84 ayat). Every such split must be in IMLA_PAIR_ALT, so the spoken one-word form passes.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';

const root = new URL('../../', import.meta.url).pathname;
type Bundle = {
  expectedWordList: (t: string) => { orig: string; norm: string }[];
  IMLA_PAIR_ALT: Record<string, string[]>;
  alignSpoken: (e: string[], s: string) => { matched: boolean[]; allMatched: boolean };
};
let B: Bundle;
before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imla-pair-'));
  const entry = path.join(dir, 'entry.ts');
  fs.writeFileSync(entry, [
    `import '${root}src/pages/SelfTestPage.tsx';`,
    `export { expectedWordList } from '${root}src/lib/expectedWords.ts';`,
    `export { IMLA_PAIR_ALT } from '${root}src/lib/imlaAlt.ts';`,
    `export { alignSpoken } from '${root}src/lib/alignBridge.ts';`,
  ].join('\n'));
  buildSync({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(dir, 'out.mjs'), logLevel: 'error', jsx: 'automatic',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x.test"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"k"', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env': '{}' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.wasm': 'empty', '.onnx': 'empty' },
  });
  B = await import(path.join(dir, 'out.mjs'));
});

// The split tokens exactly as the live quran_verses text has them (read 2026-11-26).
const SPLITS: [string, string][] = [
  ['2:31', 'اَنۭۡ بِـُٔوۡنِيۡ'], ['2:33', 'اَنۭۡ بِئۡهُمۡ'], ['2:33', 'اَنۭۡ بَاَهُمۡ'], ['2:61', 'تُنۭۡ بِتُ'], ['2:91', 'اَنۭۡ بِيَآءَ'],
  ['2:181', 'بَعۡدَ مَا'], ['2:261', 'اَنۭۡ بَتَتۡ'], ['2:261', 'سُنۭۡ بُلَةٍ'], ['3:37', 'وَّاَنۭۡ بَتَهَا'], ['3:44', 'اَنۭۡ بَآءِ'],
  ['3:112', 'الۡاَنۭۡ بِيَآءَ'], ['3:165', 'اَوَ لَمَّا٘'], ['4:36', 'بِالۡجَنۭۡ بِ'], ['4:78', 'اَيۡنَ مَا'], ['4:83', 'يَسۡتَنۭۡ بِطُوۡنَهٗ'],
  ['6:5', 'اَنۭۡ بٰٓؤُا'], ['6:111', 'وَ حَشَرۡنَا'], ['7:101', 'اَنۭۡ بَآئِهَاۚ'], ['7:160', 'فَانۭۡ بَجَسَتۡ'], ['8:41', 'وَ لِلرَّسُوۡلِ'],
  ['8:58', 'فَانۭۡ بِذۡ'], ['9:46', 'انۭۡ بِعَاثَهُمۡ'], ['10:12', 'لِجَنۭۡ بِهٖ٘'], ['10:32', 'فَمَا ذَا'], ['10:53', 'وَيَسۡتَنۭۡ بِـُٔوۡنَكَ'],
  ['11:6', 'وَ يَعۡلَمُ'], ['12:29', 'لِذَنۭۡ بِكِۚۖ'], ['12:43', 'سُنۭۡ بُلٰتٍ'], ['12:47', 'سُنۭۡ بُلِهٖ٘'], ['15:19', 'وَاَنۭۡ بَتۡنَا'],
  ['16:11', 'يُنۭۡ بِتُ'], ['17:90', 'يَنۭۡ بُوۡعًاۙ'], ['19:92', 'يَنۭۡ بَغِيۡ'], ['22:5', 'وَاَنۭۡ بَتَتۡ'], ['23:20', 'تَنۭۡ بُتُ'],
  ['26:7', 'اَنۭۡ بَتۡنَا'], ['26:14', 'ذَنۭۡ بٌ'], ['27:60', 'تُنۭۡ بِتُوۡا'], ['28:66', 'الۡاَنۭۡ بَآءُ'], ['29:40', 'بِذَنۭۡ بِهٖۚ'],
  ['31:10', 'فَاَنۭۡ بَتۡنَا'], ['33:20', 'اَنۭۡ بَآئِكُمۡؕ'], ['37:17', 'اَوَ اٰبَآؤُنَا'], ['37:130', 'اِلۡ يَاسِيۡنَ'], ['39:56', 'جَنۭۡ بِ'],
  ['40:3', 'الذَّنۭۡ بِ'], ['48:2', 'ذَنۭۡ بِكَ'], ['55:39', 'ذَنۭۡ بِهٖ٘'], ['56:6', 'مُّنۭۡ بَثًّاۙ'], ['58:1', 'وَ تَشۡتَكِيۡ٘'],
  ['59:2', 'مَّا نِعَتُهُمۡ'], ['66:3', 'اَنۭۡ بَاَكَ'], ['67:11', 'بِذَنۭۡ بِهِمۡۚ'], ['71:17', 'اَنۭۡ بَتَكُمۡ'], ['72:16', 'وَّاَنۡ لَّوِ'],
  ['79:33', 'وَ لِاَنۡعَامِكُمۡؕ'], ['81:9', 'ذَنۭۡ بٍ'], ['91:12', 'انۭۡ بَعَثَ'], ['91:14', 'بِذَنۭۡ بِهِمۡ'], ['104:4', 'لَيُنۭۡ بَذَنَّ'],
];

describe('IndoPak split words are one spoken word (16.11 follow-up)', () => {
  it('every split pair of the live text is in IMLA_PAIR_ALT', () => {
    const missing = SPLITS.filter(([, raw]) => !B.IMLA_PAIR_ALT[B.expectedWordList(raw).map((w) => w.norm).join(' ')]);
    assert.deepEqual(missing, []);
  });
  it('104:4 said as «كلا لينبذن في الحطمة» is all correct', () => {
    const exp = B.expectedWordList('كَلَّا لَيُنۭۡ بَذَنَّ فِي الۡحُطَمَةِؗۖ').map((w) => w.norm);
    assert.equal(B.alignSpoken(exp, 'كلا لينبذن في الحطمة').allMatched, true);
  });
  it('91:12 said as «إذ انبعث أشقاها» is all correct', () => {
    const exp = B.expectedWordList('اِذِ انۭۡ بَعَثَ اَشۡقٰىهَا').map((w) => w.norm);
    assert.equal(B.alignSpoken(exp, 'إذ انبعث أشقاها').allMatched, true);
  });
});
