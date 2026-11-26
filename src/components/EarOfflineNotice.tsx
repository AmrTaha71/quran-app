// 15.8 (2026-11-26): offline tasmee', the two missing pieces.
// - mode 'health' (lobby): the device ear was downloaded before but its
//   files are gone (iOS can clear storage) -> ask to download again.
// - mode 'offer' (after the first finished test): offer the one-time
//   download so the next tasmee' works without the internet, with an
//   explicit yes (never a silent ~100 MB pull).
import { useEffect, useState } from 'react';
import { earHealthCheck, earDownloadConsented, setEarDownloadConsent, preloadEarLab, earLabOn, earOnMobileData, type EarHealth } from '../lib/quranLabEar';
import { EAR_DOWNLOAD_MB } from '../lib/earModelCache';

const OFFER_SEEN_KEY = 'quran-ear-offer-seen-v1';

export default function EarOfflineNotice({ mode }: { mode: 'health' | 'offer' }) {
  const [health, setHealth] = useState<EarHealth | null>(null);
  const [started, setStarted] = useState(false);
  const [hidden, setHidden] = useState(() => { if (mode !== 'offer') return false; try { return localStorage.getItem(OFFER_SEEN_KEY) === '1'; } catch { return false; } });
  useEffect(() => { let alive = true; void earHealthCheck().then((h) => { if (alive) setHealth(h); }); return () => { alive = false; }; }, []);
  if (!earLabOn() || health === null || hidden) return null;
  const mb = EAR_DOWNLOAD_MB.toLocaleString('ar-EG');
  const download = () => { setEarDownloadConsent(); preloadEarLab(true); setStarted(true); };
  const dismiss = () => { try { localStorage.setItem(OFFER_SEEN_KEY, '1'); } catch { /* ignore */ } setHidden(true); };
  if (mode === 'health' && health === 'missing') {
    return (
      <div className="bg-amber-50 border border-hairline-amber rounded-2xl p-4 space-y-2" role="status">
        <p className="font-bold text-amber-800">أذن الجهاز اتمسحت من التخزين</p>
        <p className="text-sm text-accent-700 leading-relaxed">الجهاز مسح ملفاتها عشان يوفّر مساحة، فالتسميع من غير نت مش هيشتغل لحد ما تنزّلها تاني (حوالي {mb} ميجا){earOnMobileData() ? ' — الأفضل على واي فاي' : ''}.</p>
        <button type="button" onClick={download} disabled={started}
          className="min-h-[44px] px-4 rounded-xl grad-emerald-door text-white text-sm font-bold disabled:opacity-60 polish-press">{started ? 'بينزّل…' : 'نزّلها تاني'}</button>
      </div>
    );
  }
  if (mode === 'offer' && health === 'never' && !earDownloadConsented()) {
    return (
      <div className="bg-emerald-50 border border-hairline-emerald rounded-2xl p-4 space-y-2">
        <p className="font-bold text-emerald-900">تسمّع من غير إنترنت المرة الجاية؟</p>
        <p className="text-sm text-accent-700 leading-relaxed">نزّل «أذن الجهاز» مرة واحدة (حوالي {mb} ميجا) وتسمّع بعدها في أي مكان من غير نت.{earOnMobileData() ? ' انت دلوقتي على بيانات الموبايل.' : ''}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => { download(); dismiss(); }} className="flex-1 min-h-[44px] rounded-xl grad-emerald-door text-white text-sm font-bold polish-press">{started ? 'بينزّل…' : 'نزّلها'}</button>
          <button type="button" onClick={dismiss} className="flex-1 min-h-[44px] rounded-xl bg-white border border-hairline text-sm font-semibold text-accent-700">مش دلوقتي</button>
        </div>
      </div>
    );
  }
  return null;
}
