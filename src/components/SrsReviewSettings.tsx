import { useState } from 'react';
import { BookOpen, Check } from 'lucide-react';
import { SRS_DEFAULT_INTERVALS_DAYS } from '../lib/srs';
import {
  SRS_INTERVAL_MIN_DAYS, SRS_INTERVAL_MAX_DAYS,
  loadSrsIntervals, parseIntervalInputs, saveSrsIntervals, resetSrsIntervals,
} from '../lib/srsSettings';
import { toArabicIndic } from '../lib/numerals';

// Settings door «مراجعة الآيات الضعيفة» (SRS step 3). One whole-number field
// per review stage, in days. The logic (validation, storage, fallback to the
// defaults) lives in lib/srsSettings.ts. The shared bottom-left back bar is
// provided by the Settings shell, so this card has no back button of its own.

type Msg = { kind: 'ok' | 'err'; text: string } | null;

const toFields = (days: readonly number[]) => days.map((d) => toArabicIndic(d));

export default function SrsReviewSettings() {
  const [draft, setDraft] = useState<string[]>(() => toFields(loadSrsIntervals()));
  const [msg, setMsg] = useState<Msg>(null);

  const edit = (i: number, v: string) => {
    setDraft((d) => d.map((x, j) => (j === i ? v : x)));
    setMsg(null);
  };

  const save = () => {
    const days = parseIntervalInputs(draft);
    if (!days) {
      setMsg({
        kind: 'err',
        text: `اكتب عدد أيام صحيح من ${toArabicIndic(SRS_INTERVAL_MIN_DAYS)} إلى ${toArabicIndic(SRS_INTERVAL_MAX_DAYS)} في كل مرحلة.`,
      });
      return;
    }
    if (!saveSrsIntervals(days)) {
      setMsg({ kind: 'err', text: 'ما اتحفظش، جرّب تاني.' });
      return;
    }
    setDraft(toFields(days));
    setMsg({ kind: 'ok', text: 'تم الحفظ. التغيير بيتطبق على المراجعات الجاية بس.' });
  };

  const reset = () => {
    if (!resetSrsIntervals()) {
      setMsg({ kind: 'err', text: 'ما اتحفظش، جرّب تاني.' });
      return;
    }
    setDraft(toFields(SRS_DEFAULT_INTERVALS_DAYS));
    setMsg({ kind: 'ok', text: 'رجعنا للمواعيد الأصلية.' });
  };

  return (
    <section id="sec-srs" className="glass-card rounded-2xl scroll-mt-36 p-5 md:p-6 lg:p-7">
      <h2 className="text-base md:text-lg font-semibold text-accent-800 flex items-center gap-2 mb-1">
        <BookOpen className="w-5 h-5 text-amber-600" /> مراجعة الآيات الضعيفة
      </h2>
      <p className="text-sm text-accent-600 mb-4">
        الكلمة اللي بتغلط فيها بترجعلك بعد المدد دي، مرحلة بعد مرحلة. اكتب عدد الأيام لكل مرحلة.
      </p>
      {draft.map((v, i) => (
        <div key={i} className="flex items-center justify-between gap-3 mb-3">
          <label htmlFor={`srs-stage-${i}`} className="text-sm font-semibold text-accent-700">
            المرحلة {toArabicIndic(i + 1)}: بعد كام يوم
          </label>
          <input
            id={`srs-stage-${i}`}
            type="text" inputMode="numeric" maxLength={3} value={v}
            onChange={(e) => edit(i, e.target.value)}
            className="w-20 text-center py-2 bg-gray-50 border border-hairline rounded-xl text-base font-bold text-accent-800 focus:outline-none focus:border-emerald-500 transition-smooth"
          />
        </div>
      ))}
      <p className="text-sm text-accent-600 mb-4">
        المواعيد الأصلية: {SRS_DEFAULT_INTERVALS_DAYS.map((d) => toArabicIndic(d)).join('، ')} يوم.
      </p>
      <button onClick={save}
        className="w-full py-3 grad-emerald-door text-white text-base font-bold rounded-xl transition-smooth polish-press polish-focus">
        حفظ
      </button>
      <button onClick={reset}
        className="mt-3 w-full py-3 bg-amber-50 border border-hairline-amber text-accent-700 text-base font-bold rounded-xl transition-smooth polish-press polish-focus">
        رجّع المواعيد الأصلية
      </button>
      {msg && (
        <p role="status" className={`mt-3 flex items-center gap-1.5 text-sm font-semibold ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-amber-link'}`}>
          {msg.kind === 'ok' && <Check className="w-4 h-4" />} {msg.text}
        </p>
      )}
      <p className="mt-3 text-sm text-accent-600">
        الكلمات اللي في المراجعة دلوقتي بتكمل بمواعيدها زي ما هي.
      </p>
    </section>
  );
}
