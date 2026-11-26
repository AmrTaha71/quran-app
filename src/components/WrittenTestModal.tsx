// 16.2 (phase 6): «اختبار كتابي». The user picks a passage, types it from
// memory, and lib/writtenGrade.ts grades it word by word against the Mushaf
// text of that passage only. For whoever cannot or does not want to use the
// mic; the voice tests stay as they are. Tajweed is not graded (same honesty
// note as the voice tests, 4.4). Logged in the score log as «كتابي».
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import DrumSelect from './DrumSelect';
import { SURAHS, SURAH_AYAH_COUNTS } from '../lib/surahs';
import { loadQuranText, arNum, currentHistoryLevel } from '../lib/roundTest';
import { gradeWritten, type WrittenResult } from '../lib/writtenGrade';
import { addTestHistoryV1 } from '../lib/testHistory';
import { useEscapeClose } from '../lib/useEscape';

const MAX_AYAT = 20;

export default function WrittenTestModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<Map<string, string> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void loadQuranText().then((t) => (t ? setText(t) : setFailed(true))); }, []);
  const [surah, setSurah] = useState(1);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [typed, setTyped] = useState('');
  const [res, setRes] = useState<WrittenResult | null>(null);
  useEscapeClose(true, onClose);

  const count = SURAH_AYAH_COUNTS[surah - 1] ?? 1;
  const ayahOpts = useMemo(() => Array.from({ length: count }, (_, i) => ({ value: i + 1, label: arNum(i + 1) })), [count]);
  const toOpts = useMemo(() => ayahOpts.filter((o) => o.value >= from && o.value < from + MAX_AYAT), [ayahOpts, from]);
  const surahName = SURAHS[surah - 1]?.name ?? '';
  const label = from === to ? `${surahName} ${arNum(from)}` : `${surahName} ${arNum(from)}–${arNum(to)}`;

  const passage = () => {
    if (!text) return '';
    const parts: string[] = [];
    for (let a = from; a <= to; a++) parts.push(text.get(`${surah}:${a}`) ?? '');
    return parts.join(' ');
  };

  const check = () => {
    const p = passage();
    if (!p.trim() || !typed.trim()) return;
    const r = gradeWritten(p, typed);
    setRes(r);
    addTestHistoryV1({
      ts: new Date().toISOString(),
      level: currentHistoryLevel(),
      score: Math.round(r.accuracy * 100),
      correct: r.slots - Math.min(r.slots, r.cost),
      attempted: r.slots,
      completed: true,
      mode: 'ayah',
      ear: 'manual',
      label: `كتابي — ${label}`,
      kind: 'written',
    });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end md:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="اختبار كتابي">
      <div dir="rtl" className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink font-display-ar">اختبار كتابي</h2>
          <button onClick={onClose} aria-label="إغلاق" className="p-2 rounded-full bg-black/5"><X className="w-5 h-5" /></button>
        </div>
        {failed && <p className="text-sm text-amber-800">ما قدرناش نجيب نص المصحف (النت؟). جرّب تاني.</p>}
        {!res ? (
          <>
            <p className="text-sm text-ink-2">اختار المقطع واكتبه من حفظك. التصحيح كلمة بكلمة، والإملاء العادي مقبول (زي «انبا» و«ان با»).</p>
            <DrumSelect label="السورة" value={surah} onChange={(n) => { setSurah(n); setFrom(1); setTo(1); }}
              options={SURAHS.map((s) => ({ value: s.no, label: `${s.no}. ${s.name}` }))} />
            <div className="grid grid-cols-2 gap-2">
              <DrumSelect label="من آية" value={from} onChange={(n) => { setFrom(n); setTo(n); }} options={ayahOpts} />
              <DrumSelect label="لحد آية" value={Math.max(to, from)} onChange={setTo} options={toOpts} />
            </div>
            <textarea value={typed} onChange={(e) => setTyped(e.target.value)} rows={6} dir="rtl"
              placeholder={`اكتب ${label} هنا`}
              className="w-full rounded-xl border border-hairline p-3 text-lg leading-loose font-arabic" />
            <button type="button" onClick={check} disabled={!text || !typed.trim()}
              className="w-full min-h-[52px] grad-emerald-door text-white font-bold rounded-xl disabled:opacity-40 polish-press">صحّح</button>
          </>
        ) : (
          <>
            <p className={`text-2xl font-bold ${res.pass ? 'text-emerald-700' : 'text-amber-700'}`}>
              {res.pass ? 'ممتاز' : 'محتاج مراجعة'} — {arNum(Math.round(res.accuracy * 100))}٪
            </p>
            <p className="text-sm text-ink-2">
              {label}: {arNum(res.slots)} كلمة، الأخطاء {arNum(res.cost)} (المسموح {arNum(res.allowed)})
            </p>
            <p className="text-xl leading-loose font-arabic" dir="rtl">
              {res.words.map((w, i) => (
                <span key={i} className={w.status === 'ok' ? 'text-ink' : 'text-amber-800 underline decoration-2 decoration-amber-500'}
                  title={w.status === 'missing' ? 'ناقصة' : w.status === 'wrong' ? `كتبت: ${w.typed ?? ''}` : undefined}>
                  {w.orig}{' '}
                </span>
              ))}
            </p>
            {res.words.some((w) => w.status !== 'ok') && (
              <ul className="text-sm text-ink-2 space-y-1">
                {res.words.filter((w) => w.status !== 'ok').map((w, i) => (
                  <li key={i}>«{w.orig}»: {w.status === 'missing' ? 'ناقصة' : `كتبت «${w.typed ?? ''}»`}</li>
                ))}
              </ul>
            )}
            {res.extras.length > 0 && <p className="text-sm text-ink-2">كلمات زيادة: {res.extras.join('، ')}</p>}
            <p className="text-xs text-ink-2">التقييم على مستوى الكلمات بس — التجويد مش متقيّم.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setRes(null)} className="min-h-[48px] grad-emerald-door text-white font-bold rounded-xl">حاول تاني</button>
              <button type="button" onClick={() => { setRes(null); setTyped(''); }} className="min-h-[48px] bg-white border-2 border-emerald-700 text-emerald-800 font-bold rounded-xl">مقطع تاني</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
