// 6.10 (2026-11-26): an in-app confirm sheet instead of window.confirm.
// Native confirm dialogs look foreign, and some WebViews block them (the
// call then returns false and the action silently never happens).
// askConfirm() resolves true/false; <ConfirmHost/> (mounted once in App)
// shows the sheet. Pure module: no DOM, so it is unit-testable.
export type ConfirmRequest = {
  text: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

let current: Pending | null = null;
const listeners = new Set<(p: Pending | null) => void>();

export function askConfirm(req: ConfirmRequest | string): Promise<boolean> {
  const r = typeof req === 'string' ? { text: req } : req;
  // A second ask while one is open answers the first one "no".
  if (current) current.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { ...r, resolve };
    listeners.forEach((l) => l(current));
  });
}

export function answerConfirm(ok: boolean): void {
  const p = current;
  current = null;
  listeners.forEach((l) => l(null));
  p?.resolve(ok);
}

export function subscribeConfirm(fn: (p: Pending | null) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}
