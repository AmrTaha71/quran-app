// «عرفتنا منين؟» — asked once, before the welcome screens. Pick as many as
// apply (or none); the answer goes to the referral_sources table.
import { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { pressFeedback } from '../lib/pressFeedback';

export const REFERRAL_DONE_KEY = 'quran-referral-done';

const OPTIONS = [
  'واتساب', 'تيليجرام', 'فيسبوك', 'إنستجرام', 'إكس (تويتر)', 'تيك توك', 'يوتيوب', 'سناب شات', 'لينكدإن',
  'صديق أو قريب رشّحه لي', 'رسالة على الإيميل', 'موقع أو صفحة أخبار', 'متجر التطبيقات', 'بحث في جوجل',
  'مسجد أو حلقة تحفيظ', 'مدرسة أو جامعة', 'قناة أو شيخ', 'إعلان',
];

export default function ReferralSurvey({ onDone }: { onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const finish = async (send: boolean) => {
    try { localStorage.setItem(REFERRAL_DONE_KEY, '1'); } catch { /* ignore */ }
    if (send && (picked.length || other.trim())) {
      try {
        const { data } = await supabase.auth.getSession();
        await supabase.from('referral_sources').insert({ sources: picked, other_text: other.trim() || null, user_id: data.session?.user.id ?? null });
      } catch { /* the answer is optional */ }
    }
    onDone();
  };
  return (
    <div dir="rtl" className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl max-h-[92dvh] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-2xl font-bold font-display-ar text-ink">عرفتنا منين؟</h2>
          <button onClick={() => void finish(false)} aria-label="تخطي" className="text-sm text-ink-3 flex items-center gap-1"><X className="w-4 h-4" /> تخطي</button>
        </div>
        <p className="text-sm text-ink-2 mt-1 mb-3">اختار واحد أو أكتر</p>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((o) => (
            <button key={o} onPointerDown={pressFeedback} onClick={() => toggle(o)}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border-2 ${picked.includes(o) ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-ink-2 border-hairline'}`}>{o}</button>
          ))}
        </div>
        <input value={other} onChange={(e) => setOther(e.target.value)} maxLength={80} placeholder="غير كده؟ اكتب هنا"
          className="mt-3 w-full border rounded-xl px-3 py-2.5 text-base" aria-label="مصدر آخر" />
        <button onClick={() => void finish(true)} onPointerDown={pressFeedback}
          className="btn-3d mt-4 w-full py-3.5 bg-emerald-600 text-white text-base font-bold rounded-2xl">تمام</button>
      </div>
    </div>
  );
}
