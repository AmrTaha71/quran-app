// «امسح حسابي» (2026-11-09): deletes the signed-in account and its data
// through the delete-account edge function (identity from the JWT only).
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function DeleteAccountButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async () => {
    if (!window.confirm('متأكد إنك عايز تمسح حسابك؟ كل تقدّمك وإعداداتك هتتمسح، ومش هينفع ترجعها.')) return;
    if (!window.confirm('آخر تأكيد: امسح الحساب نهائيًا؟')) return;
    setBusy(true);
    setMsg('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { setMsg('لازم تكون داخل بحسابك'); setBusy(false); return; }
      const base = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${base}/functions/v1/delete-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg(res.status === 403 ? 'حساب الأدمن بيتمسح من لوحة Supabase' : `ما قدرناش نمسح الحساب دلوقتي${j?.error ? ` (${j.error})` : ''}`);
        setBusy(false);
        return;
      }
      try { localStorage.clear(); } catch { /* ignore */ }
      await supabase.auth.signOut().catch(() => {});
      window.location.hash = '#/home';
      window.location.reload();
    } catch {
      setMsg('في مشكلة في الاتصال — جرّب تاني');
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2" dir="rtl">
      <button type="button" disabled={busy} onClick={() => void run()}
        className="w-full min-h-[48px] rounded-xl border-2 border-red-600 text-red-700 font-bold bg-white disabled:opacity-50">
        {busy ? 'بيتمسح…' : 'امسح حسابي'}
      </button>
      <p className="text-xs text-red-800">بيمسح حسابك وكل بياناتك من السيرفر نهائيًا.</p>
      {msg && <p className="text-sm text-red-700">{msg}</p>}
    </div>
  );
}
