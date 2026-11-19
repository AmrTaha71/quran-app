// «شوف كأدمن / شوف كمستخدم» switch (wave 2, W2-4). Rendered by App for
// real admins only (it renders nothing otherwise). Floats bottom-right
// above the safe area and any fixed bottom chrome; amber while previewing
// as a user so it is obvious the admin view is off.
import { Eye, Shield } from 'lucide-react';
import { setViewAsUser, useAdminView } from '../lib/adminPreview';
import { pressFeedback } from '../lib/pressFeedback';

export default function AdminViewToggle() {
  const { realAdmin, viewAsUser } = useAdminView();
  if (!realAdmin) return null;
  return (
    <div
      className="fixed z-[45] pointer-events-none"
      style={{
        right: 'max(0.75rem, env(safe-area-inset-right))',
        bottom: 'calc(var(--bottom-chrome-h, env(safe-area-inset-bottom, 0px)) + 0.5rem)',
      }}
    >
      <button
        type="button"
        onPointerDown={pressFeedback}
        onClick={() => setViewAsUser(!viewAsUser)}
        aria-pressed={viewAsUser}
        className={`pointer-events-auto inline-flex items-center gap-2 min-h-[44px] px-4 rounded-full text-sm font-bold shadow-lg polish-press ${
          viewAsUser ? 'bg-amber-500 text-white' : 'bg-white/95 text-emerald-800 border border-hairline-emerald'
        }`}
      >
        {viewAsUser ? <Shield className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
        <span>{viewAsUser ? 'بتشوف كمستخدم — شوف كأدمن' : 'شوف كمستخدم'}</span>
      </button>
    </div>
  );
}
