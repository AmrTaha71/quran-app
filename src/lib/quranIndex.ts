export interface JuzInfo {
  number: number;
  name: string;
  startPage: number;
}

export interface HizbInfo {
  number: number;
  startPage: number;
  juz: number;
}

export const JUZ_START_PAGES: JuzInfo[] = [
  { number: 1, name: 'جزء ١ — آلم', startPage: 1 },
  { number: 2, name: 'جزء ٢ — سيقول', startPage: 22 },
  { number: 3, name: 'جزء ٣ — تلك الرسل', startPage: 42 },
  { number: 4, name: 'جزء ٤ — لن تنالوا', startPage: 62 },
  { number: 5, name: 'جزء ٥ — والمحصنات', startPage: 82 },
  { number: 6, name: 'جزء ٦ — لا يحب الله', startPage: 102 },
  { number: 7, name: 'جزء ٧ — وإذا سمعوا', startPage: 122 },
  { number: 8, name: 'جزء ٨ — ولو أننا', startPage: 142 },
  { number: 9, name: 'جزء ٩ — قال الملأ', startPage: 162 },
  { number: 10, name: 'جزء ١٠ — واعلموا', startPage: 182 },
  { number: 11, name: 'جزء ١١ — يعتذرون', startPage: 202 },
  { number: 12, name: 'جزء ١٢ — وما من دابة', startPage: 222 },
  { number: 13, name: 'جزء ١٣ — وما مكنت', startPage: 242 },
  { number: 14, name: 'جزء ١٤ — ربما', startPage: 262 },
  { number: 15, name: 'جزء ١٥ — سبحان الذي', startPage: 282 },
  { number: 16, name: 'جزء ١٦ — قال ألم', startPage: 302 },
  { number: 17, name: 'جزء ١٧ — اقترب', startPage: 322 },
  { number: 18, name: 'جزء ١٨ — قد نرى', startPage: 342 },
  { number: 19, name: 'جزء ١٩ — وقال الذي', startPage: 362 },
  { number: 20, name: 'جزء ٢٠ — من خلق', startPage: 382 },
  { number: 21, name: 'جزء ٢١ — اتلو ما أوحي', startPage: 402 },
  { number: 22, name: 'جزء ٢٢ — ومن يقنت', startPage: 422 },
  { number: 23, name: 'جزء ٢٣ — وما لي', startPage: 442 },
  { number: 24, name: 'جزء ٢٤ — فمن أظلم', startPage: 462 },
  { number: 25, name: 'جزء ٢٥ — إليه يرد', startPage: 482 },
  { number: 26, name: 'جزء ٢٦ — حم الأحقاف', startPage: 502 },
  { number: 27, name: 'جزء ٢٧ — قال فما خطبكم', startPage: 522 },
  { number: 28, name: 'جزء ٢٨ — قل نزّل', startPage: 542 },
  { number: 29, name: 'جزء ٢٩ — تبارك الذي', startPage: 562 },
  { number: 30, name: 'جزء ٣٠ — عمّ', startPage: 582 },
];

export const HIZB_START_PAGES: HizbInfo[] = [
  { number: 1, startPage: 1, juz: 1 }, { number: 2, startPage: 11, juz: 1 },
  { number: 3, startPage: 22, juz: 2 }, { number: 4, startPage: 32, juz: 2 },
  { number: 5, startPage: 42, juz: 3 }, { number: 6, startPage: 52, juz: 3 },
  { number: 7, startPage: 62, juz: 4 }, { number: 8, startPage: 72, juz: 4 },
  { number: 9, startPage: 82, juz: 5 }, { number: 10, startPage: 92, juz: 5 },
  { number: 11, startPage: 102, juz: 6 }, { number: 12, startPage: 112, juz: 6 },
  { number: 13, startPage: 122, juz: 7 }, { number: 14, startPage: 132, juz: 7 },
  { number: 15, startPage: 142, juz: 8 }, { number: 16, startPage: 152, juz: 8 },
  { number: 17, startPage: 162, juz: 9 }, { number: 18, startPage: 172, juz: 9 },
  { number: 19, startPage: 182, juz: 10 }, { number: 20, startPage: 192, juz: 10 },
  { number: 21, startPage: 202, juz: 11 }, { number: 22, startPage: 212, juz: 11 },
  { number: 23, startPage: 222, juz: 12 }, { number: 24, startPage: 232, juz: 12 },
  { number: 25, startPage: 242, juz: 13 }, { number: 26, startPage: 252, juz: 13 },
  { number: 27, startPage: 262, juz: 14 }, { number: 28, startPage: 272, juz: 14 },
  { number: 29, startPage: 282, juz: 15 }, { number: 30, startPage: 292, juz: 15 },
  { number: 31, startPage: 302, juz: 16 }, { number: 32, startPage: 312, juz: 16 },
  { number: 33, startPage: 322, juz: 17 }, { number: 34, startPage: 332, juz: 17 },
  { number: 35, startPage: 342, juz: 18 }, { number: 36, startPage: 352, juz: 18 },
  { number: 37, startPage: 362, juz: 19 }, { number: 38, startPage: 372, juz: 19 },
  { number: 39, startPage: 382, juz: 20 }, { number: 40, startPage: 392, juz: 20 },
  { number: 41, startPage: 402, juz: 21 }, { number: 42, startPage: 412, juz: 21 },
  { number: 43, startPage: 422, juz: 22 }, { number: 44, startPage: 432, juz: 22 },
  { number: 45, startPage: 442, juz: 23 }, { number: 46, startPage: 452, juz: 23 },
  { number: 47, startPage: 462, juz: 24 }, { number: 48, startPage: 472, juz: 24 },
  { number: 49, startPage: 482, juz: 25 }, { number: 50, startPage: 492, juz: 25 },
  { number: 51, startPage: 502, juz: 26 }, { number: 52, startPage: 512, juz: 26 },
  { number: 53, startPage: 522, juz: 27 }, { number: 54, startPage: 532, juz: 27 },
  { number: 55, startPage: 542, juz: 28 }, { number: 56, startPage: 552, juz: 28 },
  { number: 57, startPage: 562, juz: 29 }, { number: 58, startPage: 572, juz: 29 },
  { number: 59, startPage: 582, juz: 30 }, { number: 60, startPage: 592, juz: 30 },
];

export function getJuzFromPage(page: number): JuzInfo {
  let result = JUZ_START_PAGES[0];
  for (const juz of JUZ_START_PAGES) {
    if (juz.startPage <= page) result = juz;
    else break;
  }
  return result;
}

export function getHizbFromPage(page: number): HizbInfo {
  let result = HIZB_START_PAGES[0];
  for (const hizb of HIZB_START_PAGES) {
    if (hizb.startPage <= page) result = hizb;
    else break;
  }
  return result;
}
