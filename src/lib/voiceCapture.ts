// The recognizer the round tests (and the oral mutashabihat) listen with: the
// device ear (Quran-Lab) once it is loaded, else the browser's SpeechRecognition,
// else none (the caller falls back to self-grading). Same choice as the tasmee'
// test (SelfTestPage).
import { QuranLabRecognition, earLabOn, earLabUsable, earDownloadConsented } from './quranLabEar';

export type RecEvent = { resultIndex: number; results: ArrayLike<{ isFinal?: boolean; [i: number]: { transcript?: string; isFinal?: boolean } }> };
export type Rec = {
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

export function createRecognizer(expectedNorms: string[]): { rec: Rec; kind: 'lab' | 'browser' } | null {
  const W = window as unknown as { SpeechRecognition?: new () => Rec & Record<string, unknown>; webkitSpeechRecognition?: new () => Rec & Record<string, unknown> };
  const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
  const useLab = earLabUsable() || (!SR && earLabOn() && earDownloadConsented());
  if (useLab) return { rec: new QuranLabRecognition(expectedNorms.map((norm) => ({ norm, ayahIdx: 0 })), 0) as unknown as Rec, kind: 'lab' };
  if (SR) {
    const r = new SR();
    r.lang = 'ar-SA';
    r.continuous = true;
    r.interimResults = true;
    return { rec: r, kind: 'browser' };
  }
  return null;
}

/** Add the finals / interim of one recognition event to the running text. */
export function readResults(e: RecEvent, finals: string): { finals: string; interim: string } {
  let inter = '';
  let fin = finals;
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const res = e.results[i];
    const tr = res[0]?.transcript || '';
    if (!tr) continue;
    if (res.isFinal || res[0]?.isFinal) fin = `${fin} ${tr}`.trim(); else inter += ` ${tr}`;
  }
  return { finals: fin, interim: inter.trim() };
}
