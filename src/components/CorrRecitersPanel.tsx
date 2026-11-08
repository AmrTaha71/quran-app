// «عايز مين يسمّعلك؟» (2026-11-08): choose the correcting reciter and
// download / delete each one's whole-Quran ayah files for offline
// recitation. Shared by Settings and the first-time prompt in سمّع لنفسك.
import { useRef, useState } from 'react';
import { Download, Trash2, Check, Square } from 'lucide-react';
import { CORR_RECITERS, getCorrReciter, setCorrReciter } from '../lib/juhaniCorr';
import {
  CORR_SIZE_MB, ALL_SIZE_MB, TOTAL_AYAHS, formatSize,
  isDownloaded, downloadedCount, downloadReciter, deleteReciter,
  isJuzDownloaded, downloadedJuzCount, downloadJuz, deleteJuz, juzSizeMb,
} from '../lib/corrDownload';

export default function CorrRecitersPanel({ onChosen }: { onChosen?: () => void }) {
  const [chosen, setChosen] = useState(getCorrReciter());
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<Record<string, number>>({});
  const [, force] = useState(0);
  const [msg, setMsg] = useState('');
  const [openJuz, setOpenJuz] = useState<string | null>(null);
  const [juzBusy, setJuzBusy] = useState<{ f: string; j: number; pct: number } | null>(null);

  const toggleJuz = async (f: string, j: number) => {
    if (busy || juzBusy) return;
    if (isJuzDownloaded(f, j)) {
      if (!window.confirm(`تمسح الجزء ${j} للقارئ ده من جهازك؟`)) return;
      await deleteJuz(f, j);
      force((n) => n + 1);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJuzBusy({ f, j, pct: 0 });
    const r = await downloadJuz(f, j, (d, t) => setJuzBusy({ f, j, pct: Math.round((d / t) * 100) }), ctrl.signal);
    setJuzBusy(null);
    force((n) => n + 1);
    if (r === 'partial') setMsg('شوية ملفات ما نزلتش — دوس على الجزء تاني يكمّل');
  };
  const abortRef = useRef<AbortController | null>(null);
  const queueAllRef = useRef(false);

  // Tapping a reciter asks how much to put on the device, so the user
  // sees he can take just the juz he memorizes (2026-11-08).
  const [askFor, setAskFor] = useState<string | null>(null);
  const choose = (f: string) => {
    setCorrReciter(f); setChosen(f); onChosen?.();
    if (!isDownloaded(f)) setAskFor(f);
  };

  const download = async (f: string): Promise<boolean> => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(f);
    setMsg('');
    const r = await downloadReciter(f, (d) => setProg((p) => ({ ...p, [f]: d })), ctrl.signal);
    setBusy(null);
    force((n) => n + 1);
    if (r === 'partial') setMsg('شوية ملفات ما نزلتش (النت؟) — دوس نزّل تاني يكمّل من مكانه');
    return r === 'done';
  };

  const downloadAll = async () => {
    queueAllRef.current = true;
    for (const r of CORR_RECITERS) {
      if (!queueAllRef.current) break;
      if (isDownloaded(r.folder)) continue;
      const ok = await download(r.folder);
      if (!ok) break;
    }
    queueAllRef.current = false;
  };

  const stop = () => { queueAllRef.current = false; abortRef.current?.abort(); };

  const remove = async (f: string) => {
    if (!window.confirm('تمسح تسجيلات القارئ ده من جهازك؟ تقدر تنزّلها تاني بعدين.')) return;
    await deleteReciter(f);
    setProg((p) => ({ ...p, [f]: 0 }));
    force((n) => n + 1);
  };

  return (
    <div dir="rtl" className="space-y-3">
      <p className="text-sm text-accent-700">
        اختار القارئ اللي يصحّحلك وإنت بتسمّع. ولو نزّلت تسجيلاته على جهازك، تقدر تسمّع معاه <b>من غير إنترنت</b>.
        تقدر تنزّل واحد أو اتنين أو كلهم، وتمسح أي واحد وقت ما تحب.
      </p>
      <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
        عشان التنزيل يفضل محفوظ على الآيفون والآيباد: ثبّت التطبيق على الشاشة الرئيسية الأول (الإعدادات ← تثبيت التطبيق).
      </p>
      {CORR_RECITERS.map((r) => {
        const done = isDownloaded(r.folder);
        const count = prog[r.folder] ?? downloadedCount(r.folder);
        const pct = Math.round((count / TOTAL_AYAHS) * 100);
        const isBusy = busy === r.folder;
        return (
          <div key={r.folder} className={`rounded-xl border p-3 space-y-2 ${chosen === r.folder ? 'border-emerald-500 bg-emerald-50' : 'border-hairline bg-white'}`}>
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => choose(r.folder)} className="flex items-center gap-2 text-right">
                <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${chosen === r.folder ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-accent-300'}`}>
                  {chosen === r.folder && <Check className="w-4 h-4" />}
                </span>
                <span className="font-bold text-accent-900">{r.name}</span>
              </button>
              <span className="text-xs text-accent-600">{formatSize(CORR_SIZE_MB[r.folder] || 0)}</span>
            </div>
            {askFor === r.folder && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 space-y-2">
                <p className="text-sm font-semibold text-accent-900">هيسمّعلك في جزء واحد ولا في القرآن كله؟</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button type="button" onClick={() => { setAskFor(null); setOpenJuz(r.folder); }}
                    className="min-h-[44px] rounded-lg bg-emerald-600 text-white text-sm font-bold">جزء أو أكتر (من {juzSizeMb(r.folder, 1)} ميجا للجزء)</button>
                  <button type="button" disabled={!!busy} onClick={() => { setAskFor(null); void download(r.folder); }}
                    className="min-h-[44px] rounded-lg bg-amber-500 text-white text-sm font-bold disabled:opacity-40">القرآن كله ({formatSize(CORR_SIZE_MB[r.folder] || 0)})</button>
                  <button type="button" onClick={() => setAskFor(null)}
                    className="min-h-[44px] rounded-lg border text-sm">بالنت بس دلوقتي</button>
                </div>
              </div>
            )}
            <button type="button" onClick={() => setOpenJuz(openJuz === r.folder ? null : r.folder)}
              className="text-sm font-semibold text-emerald-700 underline">
              {openJuz === r.folder ? 'اقفل الأجزاء' : `نزّل بالجزء (${downloadedJuzCount(r.folder)} من 30 على جهازك)`}
            </button>
            {openJuz === r.folder && (
              <div className="space-y-1">
                <p className="text-xs text-accent-600">دوس على جزء عشان تنزّله، ودوس على جزء متنزّل (الأخضر) عشان تمسحه.</p>
                <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((j) => {
                    const has = isJuzDownloaded(r.folder, j);
                    const running = juzBusy && juzBusy.f === r.folder && juzBusy.j === j;
                    return (
                      <button key={j} type="button" onClick={() => void toggleJuz(r.folder, j)}
                        className={`min-h-[44px] rounded-lg text-xs font-bold border ${has ? 'bg-emerald-600 text-white border-emerald-600' : running ? 'bg-amber-100 border-amber-400' : 'bg-white border-hairline text-accent-800'}`}>
                        {running ? `${juzBusy!.pct}%` : <>ج{j}<span className="block font-normal opacity-80">{juzSizeMb(r.folder, j)} ميجا</span></>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              {done ? (
                <>
                  <span className="text-xs font-semibold text-emerald-700 flex-1">✓ على جهازك — يشتغل من غير نت</span>
                  <button type="button" onClick={() => remove(r.folder)} className="min-h-[40px] px-3 rounded-lg border border-red-200 text-red-700 text-sm flex items-center gap-1"><Trash2 className="w-4 h-4" /> امسح</button>
                </>
              ) : isBusy ? (
                <>
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} /></div>
                  <span className="text-xs w-10 text-left">{pct}%</span>
                  <button type="button" onClick={stop} className="min-h-[40px] px-3 rounded-lg border text-sm flex items-center gap-1"><Square className="w-4 h-4" /> وقّف</button>
                </>
              ) : (
                <>
                  <span className="text-xs text-accent-600 flex-1">{count > 0 ? `نزل ${pct}% — كمّل` : 'بيشتغل بالنت بس'}</span>
                  <button type="button" disabled={!!busy} onClick={() => void download(r.folder)} className="min-h-[40px] px-3 rounded-lg bg-emerald-600 text-white text-sm flex items-center gap-1 disabled:opacity-40"><Download className="w-4 h-4" /> نزّل القرآن كله</button>
                  {count > 0 && <button type="button" disabled={!!busy} onClick={() => remove(r.folder)} className="min-h-[40px] px-2 rounded-lg border border-red-200 text-red-700"><Trash2 className="w-4 h-4" /></button>}
                </>
              )}
            </div>
          </div>
        );
      })}
      <button type="button" disabled={!!busy} onClick={() => void downloadAll()}
        className="w-full min-h-[48px] rounded-xl grad-amber-door text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40">
        <Download className="w-5 h-5" /> نزّلهم كلهم ({formatSize(ALL_SIZE_MB)}) — تسمّع مع أي قارئ من غير نت
      </button>
      {msg && <p className="text-xs text-amber-800">{msg}</p>}
    </div>
  );
}
