// The recognizer the round tests (and the oral mutashabihat) listen with: the
// device ear (Quran-Lab) once it is loaded, else the browser's SpeechRecognition,
// else none (the caller falls back to self-grading). Same choice as the tasmee'
// test (SelfTestPage).
import { QuranLabRecognition, earLabOn, earLabUsable, earDownloadConsented } from './quranLabEar';

import type { Rec } from './speechResults';
export { readResults } from './speechResults';
export type { Rec, RecEvent } from './speechResults';

/** `startWord`: index in `expectedNorms` of the first word NOT already said (the device ear
 *  starts aligning there). Pass the whole ayah + the index after the heard prompt. The browser
 *  engine has no word list, so it ignores both. */
export function createRecognizer(expectedNorms: string[], startWord = 0): { rec: Rec; kind: 'lab' | 'browser' } | null {
  const W = window as unknown as { SpeechRecognition?: new () => Rec & Record<string, unknown>; webkitSpeechRecognition?: new () => Rec & Record<string, unknown> };
  const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
  const useLab = earLabUsable() || (!SR && earLabOn() && earDownloadConsented());
  if (useLab) return { rec: new QuranLabRecognition(expectedNorms.map((norm) => ({ norm, ayahIdx: 0 })), startWord) as unknown as Rec, kind: 'lab' };
  if (SR) {
    const r = new SR();
    r.lang = 'ar-SA';
    r.continuous = true;
    r.interimResults = true;
    return { rec: r, kind: 'browser' };
  }
  return null;
}
