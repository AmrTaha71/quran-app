// 16.12(b) (owner approval 2026-11-26): grant / revoke admin from the admin
// page. Goes through the SECURITY DEFINER RPCs admin_list_admins /
// admin_grant / admin_revoke (migration 20261126000009): admin_users itself
// stays read-only, and the server refuses non-admins, revoking yourself and
// removing the last admin.
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { askConfirm } from '../../lib/confirmSheet';

type AdminRow = { user_id: string; email: string | null; display_name: string | null; granted_at: string };

function errText(msg: string): string {
  if (/no such user/i.test(msg)) return 'مفيش حساب بالإيميل أو اسم المستخدم ده.';
  if (/cannot revoke self/i.test(msg)) return 'ماينفعش تشيل نفسك من الأدمن.';
  if (/last admin/i.test(msg)) return 'ده آخر أدمن، ماينفعش يتشال.';
  if (/not admin/i.test(msg)) return 'الحساب ده مش أدمن.';
  return 'حصلت مشكلة — جرّب تاني.';
}

export default function AdminsPanel({ selfId }: { selfId: string | null }) {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_admins');
    if (error) { setMsg({ ok: false, text: errText(error.message) }); return; }
    setRows((data ?? []) as AdminRow[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const grant = async () => {
    const w = who.trim();
    if (!w || busy) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc('admin_grant', { who: w });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: errText(error.message) }); return; }
    setWho('');
    setMsg({ ok: true, text: 'اتضاف أدمن.' });
    void load();
  };

  const revoke = async (r: AdminRow) => {
    if (busy) return;
    const name = r.display_name || r.email || 'الحساب ده';
    if (!(await askConfirm({ text: `تشيل «${name}» من الأدمن؟`, confirmLabel: 'شيله', danger: true }))) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc('admin_revoke', { target: r.user_id });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: errText(error.message) }); return; }
    setMsg({ ok: true, text: 'اتشال من الأدمن.' });
    void load();
  };

  return (
    <div dir="rtl" className="bg-white rounded-2xl border border-hairline p-4 space-y-3 mb-4">
      <p className="font-bold text-accent-800 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-700" /> الأدمن</p>
      <p className="text-sm text-accent-600">الأدمن بيراجع التربيطات ويوافق عليها. اكتب إيميل الحساب أو اسم المستخدم وضيفه.</p>
      <div className="flex gap-2">
        <input value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void grant(); }}
          dir="ltr" placeholder="email@example.com" aria-label="إيميل أو اسم المستخدم"
          className="flex-1 min-h-[44px] rounded-lg border border-hairline px-3 text-sm" />
        <button type="button" onClick={() => void grant()} disabled={busy || !who.trim()}
          className="min-h-[44px] px-4 rounded-lg bg-emerald-700 text-white text-sm font-bold flex items-center gap-1 disabled:opacity-50">
          <UserPlus className="w-4 h-4" /> ضيف
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-amber-800'}`}>{msg.text}</p>}
      {rows === null ? (
        <p className="text-sm text-accent-600">جارٍ التحميل…</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.user_id} className="flex items-center gap-2 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-accent-800 truncate">{r.display_name || r.email || r.user_id.slice(0, 8)}{r.user_id === selfId ? ' (إنت)' : ''}</p>
                {r.email && r.display_name && <p className="text-xs text-accent-600 truncate" dir="ltr">{r.email}</p>}
              </div>
              {r.user_id !== selfId && (
                <button type="button" onClick={() => void revoke(r)} disabled={busy}
                  className="min-h-[40px] px-3 rounded-lg border border-red-200 text-red-700 text-sm flex items-center gap-1 disabled:opacity-50">
                  <Trash2 className="w-4 h-4" /> شيل
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
