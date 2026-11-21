// تنبيه الهفوة المتكررة (SRS step 5, spec 2026-11-20 §2ب): shown when the same
// letter-pair slip happened a third time (or more). Names the correct word and
// what the app heard. It sits in the page flow (never a modal, never blocks the
// self-test), gold only (same classes as the offline notice), and hides itself
// after a while. The heard text is shown here only; it is not stored.
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { slipNoticeText, type SlipNotice } from '../lib/srsTasmee';

export default function SrsSlipNotice({
  notices,
  onDismiss,
}: {
  notices: SlipNotice[];
  onDismiss: () => void;
}) {
  // The parent passes a fresh arrow every render; keep the latest in a ref so
  // the timer is only restarted when the notices change.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (notices.length === 0) return;
    const id = window.setTimeout(() => dismissRef.current(), 20000);
    return () => window.clearTimeout(id);
  }, [notices]);

  if (notices.length === 0) return null;
  return (
    <div className="text-sm font-medium text-amber-link bg-amber-50 border border-hairline-amber rounded-2xl px-3 py-2 flex items-start gap-2">
      <ul className="flex-1 space-y-1">
        {notices.map((n, i) => (
          <li key={`${n.word}-${i}`}>{slipNoticeText(n)}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="إغلاق"
        className="shrink-0 p-1 rounded-lg polish-press polish-focus"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
