// 3.11 (2026-11-26): shows that the Whisper ear is downloading, with its
// percent, instead of a silent screen while tens of MB arrive.
import { useSyncExternalStore } from 'react';
import { getWhisperLoad, subscribeWhisperLoad } from '../lib/quranEar';

export default function WhisperLoadNote() {
  const st = useSyncExternalStore(subscribeWhisperLoad, getWhisperLoad);
  if (st.status !== 'loading') return null;
  return (
    <p className="text-sm text-ink-2 mt-3" role="status" aria-live="polite">
      بيحمّل أذن الجهاز (مرة واحدة)… {st.pct > 0 ? `${st.pct}٪` : ''}
    </p>
  );
}
