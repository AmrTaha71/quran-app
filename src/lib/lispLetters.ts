// Item 17.1: letters the user cannot pronounce the usual way (a lisp —
// e.g. ر said as غ or ل). A spoken word that differs from an expected
// word ONLY at these letters (swapped for any one letter, or dropped)
// is taken as that word: it does not stop the pointer, is not a
// mistake, never reaches «أخطائي» and does not touch the score. Each
// such swap is kept in a small diagnostics ring only.
export const LISP_KEY = 'quran-lisp-letters';
export const LISP_CHOICES = ['ر', 'س', 'ش', 'ز', 'ص', 'ث', 'ذ', 'ظ', 'ل', 'ق', 'ك', 'ج', 'غ', 'خ', 'ح', 'ع'] as const;

export function loadLispLetters(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LISP_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length === 1) : [];
  } catch { return []; }
}
export function saveLispLetters(letters: string[]): void {
  try { localStorage.setItem(LISP_KEY, JSON.stringify([...new Set(letters)])); } catch { /* ignore */ }
}

/** True when `said` is `want` with only lisp letters swapped (one for one) or dropped. */
export function lispEquivalent(said: string, want: string, letters: Set<string>): boolean {
  if (said === want || letters.size === 0) return false;
  const a = [...said], b = [...want];
  // Walk both; a lisp letter in `want` may be matched by any one letter or skipped.
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const k = `${i},${j}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (j === b.length) r = i === a.length;
    else if (letters.has(b[j])) r = (i < a.length && go(i + 1, j + 1)) || go(i, j + 1);
    else r = i < a.length && a[i] === b[j] && go(i + 1, j + 1);
    memo.set(k, r);
    return r;
  };
  return go(0, 0);
}

export const lispSwaps: { said: string; as: string; at: number }[] = [];

/** Rewrite spoken tokens that are lisp-equivalent to an expected word into that word. */
export function applyLisp(expected: string[], spoken: string[], letters: string[] = loadLispLetters()): string[] {
  if (letters.length === 0) return spoken;
  const set = new Set(letters);
  const exact = new Set(expected);
  return spoken.map((t) => {
    if (exact.has(t)) return t;
    const w = expected.find((e) => lispEquivalent(t, e, set));
    if (!w) return t;
    const lastSwap = lispSwaps[lispSwaps.length - 1];
    if (!lastSwap || lastSwap.said !== t || lastSwap.as !== w) lispSwaps.push({ said: t, as: w, at: Date.now() });
    if (lispSwaps.length > 50) lispSwaps.shift();
    return w;
  });
}
