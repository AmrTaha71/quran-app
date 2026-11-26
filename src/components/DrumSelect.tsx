// قائمة اختيار بالبكرة (2026-11-13): drop-in for <select>. Shows the current
// choice on a button; tapping opens a bottom sheet with the drum reel.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DrumReel } from './DrumReel';

export default function DrumSelect<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled,
  className = '',
  id,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(0);
  // iOS Safari: a touch that drifts a few px on the sheet scrolls the page behind and the tap is lost
  // (buttons just "wobble"). Lock the page while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  // Escape closes the sheet (keyboard / desktop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const cur = Math.max(0, options.findIndex((o) => o.value === value));
  // drum-select-tap-2 (2026-11-26): «تم» / «إلغاء» did nothing on the
  // owner's phone (stuck until the browser Back). Belt and braces:
  // the sheet is portalled to <body> (no transformed or stacking
  // ancestor can capture or hide it), sits above every app layer, the
  // buttons sit in their own raised layer above the 3D drum (iOS Safari
  // does not clip 3D rows to overflow:hidden), and they act on
  // pointerup as well as click (a tap right after the drum's momentum
  // scroll can lose its click on iOS). `acted` stops a double action.
  const acted = useRef(false);
  const downOn = useRef<'ok' | 'cancel' | null>(null);
  const finish = (commit: boolean) => {
    if (acted.current) return;
    acted.current = true;
    if (commit) onChange(options[draft].value);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => { acted.current = false; downOn.current = null; setDraft(cur); setOpen(true); }}
        className={`w-full min-h-[48px] px-3 rounded-xl bg-white border border-hairline-emerald text-accent-800 font-semibold flex items-center justify-between gap-2 disabled:opacity-50 polish-press ${className}`}
      >
        <span className="truncate">{options[cur]?.label ?? ''}</span>
        <span aria-hidden="true" className="text-[#B98C36]">▾</span>
      </button>
      {open && createPortal(
        <div dir="rtl" role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[2500] bg-black/50 flex items-end sm:items-center justify-center p-3" style={{ overscrollBehavior: 'contain' }} onClick={() => finish(false)}>
          <div className="w-full max-w-md bg-[#FBF7EE] rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-center font-bold text-emerald-900">{label}</p>
            <div style={{ position: 'relative', zIndex: 0, isolation: 'isolate' }}>
              <DrumReel labels={options.map((o) => o.label)} index={draft} label={label} onIndex={setDraft} />
            </div>
            <div className="grid grid-cols-2 gap-2" style={{ position: 'relative', zIndex: 10, transform: 'translateZ(200px)' }}>
              <button type="button" onPointerDown={() => { downOn.current = 'cancel'; }} onPointerUp={() => { if (downOn.current === 'cancel') finish(false); }} onClick={() => finish(false)} style={{ touchAction: 'manipulation' }} className="min-h-[48px] rounded-xl bg-white border border-hairline-emerald text-accent-800 font-bold">إلغاء</button>
              <button type="button" onPointerDown={() => { downOn.current = 'ok'; }} onPointerUp={() => { if (downOn.current === 'ok') finish(true); }} onClick={() => finish(true)} style={{ touchAction: 'manipulation' }} className="min-h-[48px] rounded-xl grad-emerald-door text-white font-bold">تم</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
