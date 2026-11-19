// «التعرف على التلاوة على جهازك» (W4-B, 2026-11-19, decision 6).
// The Quran-Lab device ear is the default for tasmee'. First visit: ask
// once (≈100 MB, Wi-Fi preferred, warning on mobile data); after that the
// model loads automatically on every visit (from the Cache API after the
// first download). Until it is ready, or if it fails, the test quietly uses
// the browser ear: this card never blocks the test.
// File hosting is unchanged (public/models/quranlab); moving it is a
// separate decision.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, CheckCircle2 } from 'lucide-react';
import {
  earLabOn, earDownloadConsented, setEarDownloadConsent, earModelCached,
  preloadEarLab, getEarLabState, subscribeEarLab,
} from '../lib/quranLabEar';

type Conn = { type?: string; effectiveType?: string; saveData?: boolean };
function onMobileData(): boolean {
  const c = (navigator as unknown as { connection?: Conn }).connection;
  if (!c) return false; // unknown (e.g. Safari): no warning, the ask already says Wi-Fi
  return c.type === 'cellular' || c.saveData === true;
}

function startDownload(): void {
  setEarDownloadConsent();
  // Ask the browser to keep the cache (Safari may evict unused site data).
  try { void navigator.storage?.persist?.(); } catch { /* not supported */ }
  preloadEarLab();
}

export default function EarDownloadCard() {
  const st = useSyncExternalStore(subscribeEarLab, getEarLabState, getEarLabState);
  const [consented, setConsented] = useState(earDownloadConsented);
  const [later, setLater] = useState(false);
  const [waitWifi, setWaitWifi] = useState(false);
  const on = earLabOn();

  // Automatic load after the one-time consent (or when an earlier ear-lab
  // visit already cached the model). On mobile data with nothing cached
  // yet, wait for a tap instead of pulling 100 MB unasked.
  useEffect(() => {
    if (!on || st.status === 'loading' || st.status === 'ready') return;
    let dead = false;
    void earModelCached().then((cached) => {
      if (dead) return;
      if (cached) { setEarDownloadConsent(); setConsented(true); preloadEarLab(); return; }
      if (!earDownloadConsented()) return;
      if (onMobileData()) { setWaitWifi(true); return; }
      preloadEarLab();
    });
    return () => { dead = true; };
    // Run once per mount; status changes are handled by the card itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!on) return null;

  if (st.status === 'ready') {
    return (
      <p dir="rtl" className="flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">
        <CheckCircle2 className="w-4 h-4" /> التعرف على التلاوة على جهازك جاهز — بيسمعك من غير إنترنت
      </p>
    );
  }

  if (st.status === 'loading') {
    const pct = st.total > 0 ? Math.min(100, Math.round((st.loaded / st.total) * 100)) : 0;
    return (
      <div dir="rtl" className="bg-white border border-hairline rounded-xl px-3 py-2 space-y-1">
        <p className="text-xs text-accent-700">بنجهّز التعرف على التلاوة على جهازك{pct > 0 ? ` — ${pct.toLocaleString('ar-EG')}٪` : '…'} (تقدر تسمّع دلوقتي عادي)</p>
        <div className="h-1.5 rounded-full bg-emerald-100 overflow-hidden">
          <div className="h-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (st.status === 'error') {
    return (
      <div dir="rtl" className="bg-white border border-hairline rounded-xl px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-xs text-accent-700">التحميل ما كملش — التسميع شغال عادي. نحاول تاني؟</p>
        <button type="button" onClick={startDownload} className="min-h-[40px] px-3 rounded-lg bg-emerald-700 text-white text-xs font-bold">حاول تاني</button>
      </div>
    );
  }

  // idle
  if (consented && !waitWifi) return null; // auto-load is about to start
  if (later) return null;
  const mobile = onMobileData();
  return (
    <div dir="rtl" className="bg-white border border-hairline-amber rounded-2xl p-3 space-y-2">
      <p className="font-semibold text-accent-800 text-sm">التعرف على التلاوة على جهازك (بدون إنترنت)</p>
      <p className="text-xs text-accent-600 leading-snug">
        بنحمّله مرة واحدة (حوالي ١٠٠ ميجا)، والأفضل على الواي فاي. بعدها بيسمعك على جهازك من غير إنترنت.
      </p>
      {mobile && (
        <p className="text-xs text-amber-link leading-snug">إنت على بيانات الموبايل دلوقتي — ممكن تستنى لحد ما تكون على واي فاي.</p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => { setConsented(true); setWaitWifi(false); startDownload(); }}
          className="flex-1 min-h-[44px] rounded-xl bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-1.5">
          <Download className="w-4 h-4" /> حمّل (حوالي ١٠٠ ميجا مرة واحدة)
        </button>
        <button type="button" onClick={() => setLater(true)}
          className="min-h-[44px] px-3 rounded-xl bg-white border border-hairline text-accent-700 text-sm">بعدين</button>
      </div>
    </div>
  );
}
