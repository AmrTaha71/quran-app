// speechResults.ts — recognizer types + the pure result reader, split out of voiceCapture.ts
// (which pulls in the device-ear module) so they can be unit-tested in plain Node.
export type RecEvent = { resultIndex: number; results: ArrayLike<{ isFinal?: boolean; [i: number]: { transcript?: string; isFinal?: boolean } }> };
export type Rec = {
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

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

/** True when the event carries no transcript at all: the device ear's ~1.5 s keepalive
 *  (`[{ transcript: '' }]`) or an empty list. Such an event says nothing about speech. */
export function isEmptyEvent(e: RecEvent): boolean {
  for (let i = e.resultIndex; i < e.results.length; i++) {
    if (e.results[i]?.[0]?.transcript) return false;
  }
  return true;
}
