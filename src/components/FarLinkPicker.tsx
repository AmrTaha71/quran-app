// Admin: pick the OTHER ayah for a far link (anywhere in the Mushaf). Asks first whether it is on the same
// Mushaf page; then shows that page's ayat as number chips; the chosen ayah appears in a small window beside
// the page list so the admin can check it before linking.
import { useEffect, useState } from 'react';
import { X, Link2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useEscapeClose } from '../lib/useEscape';
import { MADINAH_PAGE_STARTS, madinahPageOfAyah } from '../lib/madinahPageStarts';
import type { QuranVerse } from '../lib/types';

const MAX_PAGE = MADINAH_PAGE_STARTS.length;

async function loadPageVerses(page: number): Promise<QuranVerse[]> {
  const a = MADINAH_PAGE_STARTS[page - 1];
  const b = MADINAH_PAGE_STARTS[page];
  const pair = (code: number) => `and(surah_no.eq.${Math.floor(code / 1000)},ayah_no.eq.${code % 1000})`;
  const codes = b ? [a, b] : [a];
  const { data: ends } = await supabase.from('quran_verses').select('id,surah_no,ayah_no').or(codes.map(pair).join(','));
  const startId = (ends || []).find((r) => r.surah_no === Math.floor(a / 1000) && r.ayah_no === a % 1000)?.id;
  if (startId === undefined) return [];
  const nextId = b ? (ends || []).find((r) => r.surah_no === Math.floor(b / 1000) && r.ayah_no === b % 1000)?.id : undefined;
  let q = supabase.from('quran_verses').select('*').gte('id', startId).order('id', { ascending: true });
  q = nextId !== undefined ? q.lt('id', nextId) : q.limit(40);
  const { data } = await q;
  return (data || []) as QuranVerse[];
}

export default function FarLinkPicker({ from, onPick, onClose }: { from: QuranVerse; onPick: (v: QuranVerse) => void; onClose: () => void }) {
  useEscapeClose(true, onClose);
  const fromPage = madinahPageOfAyah(from.surah_no, from.ayah_no);
  const [same, setSame] = useState<boolean | null>(null);
  const [pageText, setPageText] = useState('');
  const [verses, setVerses] = useState<QuranVerse[]>([]);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<QuranVerse | null>(null);

  const page = same ? fromPage : Number(pageText);
  const pageOk = Number.isInteger(page) && page >= 1 && page <= MAX_PAGE;

  useEffect(() => {
    setChosen(null);
    if (same === null || !pageOk) { setVerses([]); return; }
    let alive = true;
    setLoading(true);
    loadPageVerses(page).then((v) => { if (alive) { setVerses(v); setLoading(false); } }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [same, page, pageOk]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div dir="rtl" role="dialog" aria-modal="true" aria-label="ربط بآية بعيدة" className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-hairline sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2"><Link2 className="w-5 h-5 text-amber-600" /><b className="text-accent-800">ربط بآية تانية</b></div>
          <button onClick={onClose} aria-label="إغلاق" className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs bg-emerald-50 rounded-xl p-2.5">
            <b className="text-emerald-800">{from.surah_name} — آية {from.ayah_no}</b> (صفحة {fromPage})
            <p className="font-arabic text-sm text-accent-700 line-clamp-2 mt-0.5">{from.ayah_text}</p>
          </div>

          <p className="font-semibold text-accent-800 text-sm">الآية التانية في نفس صفحة المصحف؟</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSame(true)} className={`py-2.5 rounded-xl font-semibold text-sm ${same === true ? 'bg-emerald-600 text-white' : 'bg-white border border-hairline-emerald text-accent-800'}`}>أيوه، نفس الصفحة</button>
            <button onClick={() => setSame(false)} className={`py-2.5 rounded-xl font-semibold text-sm ${same === false ? 'bg-emerald-600 text-white' : 'bg-white border border-hairline-emerald text-accent-800'}`}>لا، صفحة تانية</button>
          </div>

          {same === false && (
            <label className="block">
              <span className="text-sm font-semibold text-accent-800">رقم الصفحة (١ – {MAX_PAGE})</span>
              <input inputMode="numeric" value={pageText} onChange={(e) => setPageText(e.target.value.replace(/\D/g, ''))}
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-hairline-emerald text-center text-lg font-bold" placeholder="مثلاً 255" />
            </label>
          )}

          {same !== null && pageOk && (
            <div>
              <p className="text-sm font-semibold text-accent-800 mb-1.5">آيات صفحة {page} — اضغط رقم الآية</p>
              {loading ? (
                <div className="py-4 text-center"><Loader2 className="w-6 h-6 mx-auto animate-spin text-emerald-500" /></div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {verses.map((v) => (
                    <button key={v.id} disabled={v.id === from.id} onClick={() => setChosen(v)}
                      className={`min-w-[2.75rem] px-2 py-1.5 rounded-lg text-sm font-bold disabled:opacity-30 ${chosen?.id === v.id ? 'bg-amber-600 text-white' : 'bg-gray-50 border border-hairline text-accent-800'}`}>
                      {verses.some((x) => x.surah_no !== v.surah_no) ? `${v.surah_no}:${v.ayah_no}` : v.ayah_no}
                    </button>
                  ))}
                  {verses.length === 0 && <p className="text-xs text-red-600">تعذّر تحميل آيات الصفحة.</p>}
                </div>
              )}
            </div>
          )}

          {/* the small window with the other ayah */}
          {chosen && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-bold text-amber-800 mb-1">{chosen.surah_name} — آية {chosen.ayah_no} (صفحة {madinahPageOfAyah(chosen.surah_no, chosen.ayah_no)})</p>
              <p className="font-arabic text-base text-accent-800 leading-loose">{chosen.ayah_text}</p>
            </div>
          )}

          <button disabled={!chosen} onClick={() => chosen && onPick(chosen)}
            className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold disabled:opacity-40">
            اربط الآيتين وسجّل التربيط
          </button>
        </div>
      </div>
    </div>
  );
}
