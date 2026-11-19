// Early capture of the browser's install prompt (W3-S5).
//
// Chromium browsers (Android Chrome / Edge / Samsung Internet) fire
// `beforeinstallprompt` once, soon after load. Before this module the
// Settings page listened for it, so the event was lost whenever it fired
// before Settings was opened. main.tsx imports this file at startup, the
// event is kept here, and the install guide in Settings just reads it.
// `appinstalled` clears it. iOS Safari has no such event or API: there the
// guide can only show the manual steps.
export type InstallEvent = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallEvent | null = null;
let installedNow = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Stop the browser's own mini-infobar: our button is the one to tap.
    e.preventDefault();
    deferred = e as unknown as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

export const getInstallPrompt = (): InstallEvent | null => deferred;
export const wasInstalledNow = (): boolean => installedNow;
export function subscribeInstall(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}
/** Shows the system install dialog. Resolves to what the user did. */
export async function runInstallPrompt(): Promise<'accepted' | 'dismissed' | 'failed'> {
  const ev = deferred;
  if (!ev) return 'failed';
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    deferred = null; // a prompt can be used once
    notify();
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'failed';
  }
}
