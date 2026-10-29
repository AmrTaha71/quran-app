// corrPrompt.ts — small pure helpers for the continuous-mode
// correction prompt (SelfTestPage). Kept DOM-free so the timeout
// race and the context-word rule are unit-testable in node.

export type WithTimeoutResult<T> = { kind: 'value'; value: T } | { kind: 'timeout' };

// Race a promise against a timeout. The race settles exactly once:
// if the timeout fires first, a later resolution is ignored (the
// caller must not act on it — that is what keeps a late
// generate-voice URL from playing over an already-started TTS
// fallback). The timeout is cleared when the value wins, so a fast
// fetch leaves no stray timer behind.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<WithTimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WithTimeoutResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
  });
  return Promise.race([
    promise.then((value): WithTimeoutResult<T> => ({ kind: 'value', value })),
    timeout,
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export interface CorrExpectedWord { orig: string; ayahIdx: number; }

// Miss-interrupt display words: prepend the expected word
// immediately before the first missed word, SAME ayah only, so the
// spoken + displayed correction carries one word of context
// ("هدى للمتقين", not a bare "للمتقين"). Display + speech only:
// the caller passes the original fix indices/norms alongside, so
// grading and fix-credit are untouched. Ayah-initial misses (and
// the range's first word) get no prepend — there is no same-ayah
// predecessor to quote.
export function withPrecedingContextWord(
  words: string[],
  indices: number[],
  expected: CorrExpectedWord[],
): string[] {
  if (indices.length === 0) return words;
  const first = indices[0];
  if (first <= 0 || first >= expected.length) return words;
  if (expected[first - 1].ayahIdx !== expected[first].ayahIdx) return words;
  return [expected[first - 1].orig, ...words];
}
