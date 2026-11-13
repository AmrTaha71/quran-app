// قائمة اختيار بالبكرة (2026-11-13): drop-in for <select>. Shows the current
// choice on a button; tapping opens a bottom sheet with the drum reel.
import { useState } from 'react';
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
  const cur = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => { setDraft(cur); setOpen(true); }}
        className={`w-full min-h-[48px] px-3 rounded-xl bg-white border border-hairline-emerald text-accent-800 font-semibold flex items-center justify-between gap-2 disabled:opacity-50 polish-press ${className}`}
      >
        <span className="truncate">{options[cur]?.label ?? ''}</span>
        <span aria-hidden="true" className="text-[#B98C36]">▾</span>
      </button>
      {open && (
        <div dir="rtl" role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md bg-[#FBF7EE] rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-center font-bold text-emerald-900">{label}</p>
            <DrumReel labels={options.map((o) => o.label)} index={draft} label={label} onIndex={setDraft} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOpen(false)} className="min-h-[48px] rounded-xl bg-white border border-hairline-emerald text-accent-800 font-bold">إلغاء</button>
              <button type="button" onClick={() => { onChange(options[draft].value); setOpen(false); }} className="min-h-[48px] rounded-xl grad-emerald-door text-white font-bold">تم</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
