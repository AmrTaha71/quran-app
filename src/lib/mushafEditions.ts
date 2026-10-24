export interface MushafEdition {
  id: string;
  name: string;
  description: string;
  imageUrl: (page: number) => string;
}

const QURANHUB_CDN = 'https://cdn.jsdelivr.net/gh/QuranHub/quran-pages-images@main';

export const MUSHAF_EDITIONS: MushafEdition[] = [
  {
    id: 'madinah',
    name: 'مصحف المدينة المنورة',
    description: 'طبعة مجمع الملك فهد — الخط الأصلي',
    imageUrl: (page: number) => `https://cdn.jsdelivr.net/gh/sufone/medina-mushaf@master/png-d150/${page}.png`,
  },
  {
    id: 'tajweed',
    name: 'مصحف التجويد الملون',
    description: 'مصحف ملون بقواعد التجويد — دار المعرفة',
    imageUrl: (page: number) => `${QURANHUB_CDN}/ayat/tajweed/${page}.png`,
  },
  {
    id: 'warsh',
    name: 'مصحف ورش',
    description: 'قراءة ورش عن نافع — مجمع الملك فهد',
    imageUrl: (page: number) => `${QURANHUB_CDN}/kfgqpc/warsh/${page}.jpg`,
  },
  {
    id: 'hafs',
    name: 'مصحف حفص (الخط الواسط)',
    description: 'رواية حفص عن عاصم — مجمع الملك فهد',
    imageUrl: (page: number) => `${QURANHUB_CDN}/kfgqpc/hafs-wasat/${page}.jpg`,
  },
];

export const TOTAL_MUSHAF_PAGES = 604;

export const SURAH_START_PAGES: { surah: number; page: number }[] = [
  { surah: 1, page: 1 }, { surah: 2, page: 2 }, { surah: 3, page: 50 },
  { surah: 4, page: 77 }, { surah: 5, page: 106 }, { surah: 6, page: 128 },
  { surah: 7, page: 151 }, { surah: 8, page: 177 }, { surah: 9, page: 187 },
  { surah: 10, page: 208 }, { surah: 11, page: 221 }, { surah: 12, page: 235 },
  { surah: 13, page: 249 }, { surah: 14, page: 255 }, { surah: 15, page: 262 },
  { surah: 16, page: 267 }, { surah: 17, page: 282 }, { surah: 18, page: 293 },
  { surah: 19, page: 305 }, { surah: 20, page: 312 }, { surah: 21, page: 322 },
  { surah: 22, page: 332 }, { surah: 23, page: 342 }, { surah: 24, page: 350 },
  { surah: 25, page: 359 }, { surah: 26, page: 367 }, { surah: 27, page: 377 },
  { surah: 28, page: 385 }, { surah: 29, page: 396 }, { surah: 30, page: 404 },
  { surah: 31, page: 411 }, { surah: 32, page: 415 }, { surah: 33, page: 418 },
  { surah: 34, page: 428 }, { surah: 35, page: 434 }, { surah: 36, page: 440 },
  { surah: 37, page: 446 }, { surah: 38, page: 453 }, { surah: 39, page: 458 },
  { surah: 40, page: 467 }, { surah: 41, page: 477 }, { surah: 42, page: 483 },
  { surah: 43, page: 489 }, { surah: 44, page: 496 }, { surah: 45, page: 499 },
  { surah: 46, page: 502 }, { surah: 47, page: 507 }, { surah: 48, page: 511 },
  { surah: 49, page: 515 }, { surah: 50, page: 518 }, { surah: 51, page: 520 },
  { surah: 52, page: 523 }, { surah: 53, page: 526 }, { surah: 54, page: 528 },
  { surah: 55, page: 531 }, { surah: 56, page: 534 }, { surah: 57, page: 537 },
  { surah: 58, page: 542 }, { surah: 59, page: 545 }, { surah: 60, page: 548 },
  { surah: 61, page: 549 }, { surah: 62, page: 550 }, { surah: 63, page: 551 },
  { surah: 64, page: 552 }, { surah: 65, page: 553 }, { surah: 66, page: 554 },
  { surah: 67, page: 556 }, { surah: 68, page: 558 }, { surah: 69, page: 561 },
  { surah: 70, page: 563 }, { surah: 71, page: 566 }, { surah: 72, page: 568 },
  { surah: 73, page: 570 }, { surah: 74, page: 572 }, { surah: 75, page: 574 },
  { surah: 76, page: 577 }, { surah: 77, page: 578 }, { surah: 78, page: 581 },
  { surah: 79, page: 583 }, { surah: 80, page: 585 }, { surah: 81, page: 586 },
  { surah: 82, page: 587 }, { surah: 83, page: 587 }, { surah: 84, page: 589 },
  { surah: 85, page: 590 }, { surah: 86, page: 591 }, { surah: 87, page: 591 },
  { surah: 88, page: 592 }, { surah: 89, page: 593 }, { surah: 90, page: 594 },
  { surah: 91, page: 595 }, { surah: 92, page: 595 }, { surah: 93, page: 596 },
  { surah: 94, page: 596 }, { surah: 95, page: 597 }, { surah: 96, page: 597 },
  { surah: 97, page: 598 }, { surah: 98, page: 598 }, { surah: 99, page: 599 },
  { surah: 100, page: 599 }, { surah: 101, page: 600 }, { surah: 102, page: 600 },
  { surah: 103, page: 601 }, { surah: 104, page: 601 }, { surah: 105, page: 601 },
  { surah: 106, page: 602 }, { surah: 107, page: 602 }, { surah: 108, page: 602 },
  { surah: 109, page: 603 }, { surah: 110, page: 603 }, { surah: 111, page: 603 },
  { surah: 112, page: 604 }, { surah: 113, page: 604 }, { surah: 114, page: 604 },
];

export function getSurahStartPage(surahNo: number): number {
  const entry = SURAH_START_PAGES.find((s) => s.surah === surahNo);
  return entry ? entry.page : 1;
}
