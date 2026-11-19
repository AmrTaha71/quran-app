// The tasmee' word aligner lives inside SelfTestPage (not exported, so the page
// stays free of extra exports). The page registers it here at load; the round
// tests (RoundRecite) use the SAME aligner through this bridge.
type Aligner = (expected: string[], spoken: string[]) => { matched: boolean[]; allMatched: boolean };
let align: Aligner | null = null;
let tokens: ((text: string) => string[]) | null = null;
export function registerAligner(a: Aligner, t: (text: string) => string[]): void { align = a; tokens = t; }
export function alignSpoken(expected: string[], spokenText: string): { matched: boolean[]; allMatched: boolean } {
  if (!align || !tokens) return { matched: new Array(expected.length).fill(false), allMatched: false };
  return align(expected, tokens(spokenText));
}
