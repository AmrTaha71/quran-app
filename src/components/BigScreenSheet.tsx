// «اعرض على الشاشة الكبيرة» (2026-11-09): how to put the app on a TV.
// Two ways: (1) AirPlay / screen mirroring — the TV shows exactly the
// phone/iPad screen; (2) TV browser + code — the TV shows the big view
// and the phone becomes the remote (built on the shared room).
import { Cast, X, Smartphone, Tv } from 'lucide-react';

export default function BigScreenSheet({ onClose, onRemote }: { onClose: () => void; onRemote: () => void }) {
  const tvUrl = typeof window !== 'undefined' ? `${window.location.host}/tv` : '';
  return (
    <div dir="rtl" className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-emerald-800 flex items-center gap-2"><Cast className="w-6 h-6" /> اعرض على الشاشة الكبيرة</h2>
          <button onClick={onClose} aria-label="إغلاق" className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="rounded-xl border-2 border-emerald-200 p-4 space-y-2">
          <p className="font-bold text-accent-900 flex items-center gap-2"><Smartphone className="w-5 h-5" /> الطريقة الأولى: اعكس شاشتك (الأسهل)</p>
          <p className="text-sm text-accent-700">التلفزيون بيعرض نفس اللي على الآيفون أو الآيباد بالظبط.</p>
          <ol className="text-sm text-accent-800 list-decimal pr-5 space-y-1">
            <li>خلي الجهاز والتلفزيون على نفس الواي فاي.</li>
            <li>انزل من أعلى يمين الشاشة (مركز التحكم).</li>
            <li>دوس «انعكاس الشاشة» (Screen Mirroring) واختار التلفزيون.</li>
          </ol>
          <p className="text-xs text-accent-500">التلفزيون لازم يدعم AirPlay (أغلب تلفزيونات LG وSamsung الحديثة بتدعمه).</p>
        </div>

        <div className="rounded-xl border-2 border-amber-200 p-4 space-y-2">
          <p className="font-bold text-accent-900 flex items-center gap-2"><Tv className="w-5 h-5" /> الطريقة التانية: التلفزيون شاشة والموبايل ريموت</p>
          <p className="text-sm text-accent-700">التلفزيون يعرض الآية كبيرة، وإنت تتحكم من موبايلك.</p>
          <ol className="text-sm text-accent-800 list-decimal pr-5 space-y-1">
            <li>افتح متصفح التلفزيون واكتب الرابط ده (مرة واحدة، وبعدين احفظه):</li>
          </ol>
          <p dir="ltr" className="text-center font-bold text-slate-800 bg-slate-50 rounded-lg p-2 break-all">{tvUrl}</p>
          <ol start={2} className="text-sm text-accent-800 list-decimal pr-5 space-y-1">
            <li>التلفزيون هيعرض كود من 6 حروف.</li>
            <li>دوس الزرار ده واكتب الكود.</li>
          </ol>
          <button onClick={onRemote} className="w-full min-h-[52px] rounded-xl grad-amber-door text-white font-bold">
            افتح الريموت ودخّل الكود
          </button>
        </div>
      </div>
    </div>
  );
}
