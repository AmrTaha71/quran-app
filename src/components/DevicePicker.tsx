// «أنهي جهاز ده؟» — cascading drums (2026-11-14): type → brand → model → size
// → how it is held. Each reel's options come from the previous reel's choice.
import { useState } from 'react';
import { DrumReel } from './DrumReel';
import { CATS, CAT_LABELS, LEVEL_TITLES, TREES, applyDeviceLayout, guessCat, loadDeviceChoice, saveDeviceChoice, type Cat, type Orient } from '../lib/deviceModel';
import { setLocalDeviceKind, saveDeviceSettings, type DeviceKind } from '../lib/deviceProfile';

const KIND: Record<Cat, DeviceKind> = { phone: 'phone', tablet: 'ipad', desktop: 'desktop', tv: 'tv' };
const ORIENT: { v: Orient; label: string }[] = [{ v: 'portrait', label: 'بالطول' }, { v: 'landscape', label: 'بالعرض' }];

interface Props { userId?: string; onDone: () => void; onClose?: () => void }

export default function DevicePicker({ userId, onDone, onClose }: Props) {
  const prev = loadDeviceChoice();
  const [cat, setCat] = useState<Cat>(prev?.cat ?? guessCat());
  const [bi, setBi] = useState(0);
  const [mi, setMi] = useState(0);
  const [vi, setVi] = useState(0);
  const [oi, setOi] = useState(prev?.orient === 'landscape' ? 1 : 0);

  const brands = Object.keys(TREES[cat]);
  const brand = brands[Math.min(bi, brands.length - 1)];
  const models = Object.keys(TREES[cat][brand]);
  const model = models[Math.min(mi, models.length - 1)];
  const variants = Object.keys(TREES[cat][brand][model]);
  const variant = variants[Math.min(vi, variants.length - 1)];
  const [t1, t2, t3] = LEVEL_TITLES[cat];

  const save = async () => {
    saveDeviceChoice({ cat, brand, model, variant, orient: ORIENT[oi].v });
    setLocalDeviceKind(KIND[cat]);
    applyDeviceLayout();
    if (userId) await saveDeviceSettings(userId, KIND[cat], { brand, model, variant, orient: ORIENT[oi].v }).catch(() => false);
    onDone();
  };
  const col = (title: string, node: React.ReactNode) => (
    <div className="min-w-0"><p className="text-xs font-bold text-emerald-800 text-center mb-1">{title}</p>{node}</div>
  );

  return (
    <div dir="rtl" className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-2" style={{ height: '100dvh' }}>
      <div className="w-full max-w-lg bg-white rounded-2xl px-4 pt-4 space-y-3 overflow-y-auto overscroll-contain" style={{ maxHeight: 'calc(100dvh - 1rem)' }}>
        <h2 className="text-lg font-bold text-emerald-800">أنهي جهاز ده؟</h2>
        <p className="text-xs text-slate-600">لف البكرات: كل واحدة بتحدد اللي بعدها، والتطبيق يتظبط على مقاس شاشتك.</p>
        <div className="grid grid-cols-2 landscape:grid-cols-5 gap-3">
          {col('نوع الجهاز', <DrumReel label="نوع الجهاز" labels={CATS.map((c) => CAT_LABELS[c])} index={CATS.indexOf(cat)} onIndex={(i) => { setCat(CATS[i]); setBi(0); setMi(0); setVi(0); }} />)}
          {col(t1, <DrumReel key={`b-${cat}`} label={t1} labels={brands} index={bi} onIndex={(i) => { setBi(i); setMi(0); setVi(0); }} />)}
          {col(t2, <DrumReel key={`m-${cat}-${brand}`} label={t2} labels={models} index={mi} onIndex={(i) => { setMi(i); setVi(0); }} />)}
          {col(t3, <DrumReel key={`v-${cat}-${brand}-${model}`} label={t3} labels={variants} index={vi} onIndex={setVi} />)}
          {col('ماسك الجهاز إزاي؟', <DrumReel label="اتجاه الجهاز" labels={ORIENT.map((o) => o.label)} index={oi} onIndex={setOi} />)}
        </div>
        <div className="flex gap-2 sticky bottom-0 bg-white py-3 -mx-4 px-4 border-t border-slate-100">
          <button type="button" onClick={save} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold">تمام</button>
          {onClose && <button type="button" onClick={onClose} className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700">إلغاء</button>}
        </div>
      </div>
    </div>
  );
}
