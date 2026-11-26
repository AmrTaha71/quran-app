// Item 16.9 (2026-11-26): «امتى المقرئ يوقفك على الغلطة؟» for the rounds of «اختبار الترتيل»
// and «الاختبار الشامل». Stored on its own key (see roundJudge.ts). This only sets WHEN the
// reciter cuts in on an unfixed mistake; the self-test correction timing (2.6) is separate.
import { useState } from 'react';
import { ROUND_CUT_LABEL, loadRoundCutMode, saveRoundCutMode, type RoundCutMode } from '../lib/roundJudge';

const MODES: RoundCutMode[] = ['10s', '15s', 'ayah-end'];

export default function RoundCutPicker() {
  const [mode, setMode] = useState<RoundCutMode>(loadRoundCutMode);
  return (
    <div className="mb-3">
      <p className="text-sm text-accent-700 mb-1">لو غلطت ومصلّحتش، المقرئ يوقفك امتى؟</p>
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); saveRoundCutMode(m); }}
            className={`py-3 px-1 rounded-xl text-sm font-bold ${mode === m ? 'grad-amber-door text-white' : 'bg-gray-100 text-accent-700'}`}>
            {ROUND_CUT_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="text-xs text-accent-600 mt-1">قبلها تقدر تصلّح نفسك. ٣ كلمات غلط ورا بعض أو آخر الآية بيوقفوك في كل الأحوال.</p>
    </div>
  );
}
