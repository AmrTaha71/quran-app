// ?debug=1 helper for the tarteel round: a tiny global snapshot of the last «خلصت» (which ear
// ran, what it had heard), shown by RoundDebugOverlay. Off unless the URL asks for it.
export type RoundDebugSnap = { kind: string; finals: string; interim: string; start: number; total: number; via: string };
let snap: RoundDebugSnap | null = null;

export function roundDebugOn(): boolean {
  try {
    if (typeof location === 'undefined') return false;
    return new URLSearchParams(location.search).get('debug') === '1' || /[?&]debug=1(&|$)/.test(location.hash);
  } catch { return false; }
}
export function setRoundDebug(s: RoundDebugSnap): void { snap = s; }
export function getRoundDebug(): RoundDebugSnap | null { return snap; }
