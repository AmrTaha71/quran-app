// 10.3 + 10.13 (2026-11-26): in Settings > diagnostics (admin only): the
// app build, the service-worker shell cache the device runs, and the
// local error log. Answers «هل عندك النسخة الجديدة؟» without asking.
import { useEffect, useState } from 'react';
import { readErrorLog, type ErrorLogEntry } from '../lib/errorReporting';

declare const __BUILD_SHA__: string;

export default function DiagErrorsCard() {
  const [log, setLog] = useState<ErrorLogEntry[]>(readErrorLog);
  const [shell, setShell] = useState('…');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const names = typeof caches !== 'undefined' ? await caches.keys() : [];
        const s = names.filter((n) => n.startsWith('quran-shell-')).sort().pop();
        if (alive) setShell(s || 'لا يوجد');
      } catch { if (alive) setShell('غير متاح'); }
    })();
    return () => { alive = false; };
  }, []);
  return (
    <details open className="glass-card rounded-2xl p-5 md:p-6 lg:p-7">
      <summary className="text-base md:text-lg font-semibold text-accent-800 cursor-pointer">النسخة وسجل الأخطاء</summary>
      <p dir="ltr" className="text-left text-xs text-accent-700 mt-2">build {__BUILD_SHA__} · {shell}</p>
      <p className="text-xs text-accent-400 leading-relaxed mt-2 mb-3">آخر ٣٠ خطأ على الجهاز ده بس (مش بيتبعتوا لأي مكان). مفيش فيه أي بيانات حساب.</p>
      <button onClick={() => setLog(readErrorLog())} className="mb-3 px-4 py-2 grad-emerald-door text-white text-sm font-bold rounded-xl polish-press">تحديث</button>
      {log.length === 0 ? (
        <p className="text-sm text-ink-2">مفيش أخطاء متسجلة.</p>
      ) : (
        <pre dir="ltr" className="text-left text-xs leading-relaxed text-accent-700 bg-gray-50 rounded-xl p-3 overflow-auto max-h-72 whitespace-pre-wrap break-words">
          {[...log].reverse().map((e) => `${new Date(e.t).toLocaleString('en-GB')} [${e.scope}] ${e.route} ${e.build}\n  ${e.msg}`).join('\n')}
        </pre>
      )}
    </details>
  );
}
