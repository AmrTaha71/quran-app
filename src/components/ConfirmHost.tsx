// 6.10: the one confirm sheet for the whole app (see lib/confirmSheet).
import { useEffect, useState } from 'react';
import { subscribeConfirm, answerConfirm, type ConfirmRequest } from '../lib/confirmSheet';
import { useEscapeClose } from '../lib/useEscape';

export default function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  useEffect(() => subscribeConfirm((p) => setReq(p ? { text: p.text, confirmLabel: p.confirmLabel, cancelLabel: p.cancelLabel, danger: p.danger } : null)), []);
  useEscapeClose(!!req, () => answerConfirm(false));
  if (!req) return null;
  return (
    <div className="fixed inset-0 z-[3000] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={() => answerConfirm(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-sheet-text" dir="rtl"
        className="bg-cream rounded-3xl shadow-2xl w-full max-w-md p-5 space-y-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}>
        <p id="confirm-sheet-text" className="text-base font-semibold text-ink leading-relaxed whitespace-pre-line">{req.text}</p>
        <div className="flex gap-3">
          <button type="button" onClick={() => answerConfirm(true)}
            className={`flex-1 min-h-[48px] rounded-2xl font-bold polish-press ${req.danger ? 'bg-red-600 text-white' : 'grad-emerald-door text-white'}`}>
            {req.confirmLabel ?? 'أيوه'}
          </button>
          <button type="button" onClick={() => answerConfirm(false)}
            className="flex-1 min-h-[48px] rounded-2xl font-bold border border-hairline bg-white text-ink polish-press">
            {req.cancelLabel ?? 'لأ، ارجع'}
          </button>
        </div>
      </div>
    </div>
  );
}
