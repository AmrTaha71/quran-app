// The round tests (RoundRecite) use the SAME aligner as the tasmee'. Since
// 10.6 it lives in lib/wordAligner.ts, so this file reads it directly.
// registerAligner stays (SelfTestPage still calls it) but is no longer needed.
import { alignWords, spokenTokens } from './wordAligner.ts';

type Aligner = (expected: string[], spoken: string[]) => { matched: boolean[]; allMatched: boolean };
let align: Aligner = alignWords;
let tokens: (text: string) => string[] = spokenTokens;
export function registerAligner(a: Aligner, t: (text: string) => string[]): void { align = a; tokens = t; }
export function alignSpoken(expected: string[], spokenText: string): { matched: boolean[]; allMatched: boolean } {
  return align(expected, tokens(spokenText));
}
