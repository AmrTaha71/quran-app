// «اديني كلمتين كمان» for mutashabihat (W4-L): the words that follow the clue inside
// one of its ayat, as written in the mushaf (with tashkeel). Never names the surah.
import { expectedWordList } from './expectedWords';

/** `count` words right after the clue inside ayahText ('' when the clue is not found
 *  or nothing follows it). */
export function wordsAfterClue(clue: string, ayahText: string, count: number): string {
  const c = expectedWordList(clue).map((w) => w.norm);
  const a = expectedWordList(ayahText);
  if (c.length === 0) return '';
  for (let i = 0; i + c.length <= a.length; i++) {
    if (c.every((w, j) => a[i + j].norm === w)) {
      return a.slice(i + c.length, i + c.length + count).map((w) => w.orig).join(' ');
    }
  }
  return '';
}
