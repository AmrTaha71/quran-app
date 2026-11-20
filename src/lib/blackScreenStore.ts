// Black-screen mode state, shared across routes. The overlay used to be
// local state inside ListenPage, whose wrapper is display:none on every
// other route, so the overlay could never cover the fullscreen Mushaf.
// Now the state lives here and <BlackScreenOverlay /> (mounted once in
// App) renders it above whatever route is showing. It never touches the
// audio engines: opening/closing only flips this flag.
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => {
    try { l(); } catch { /* ignore */ }
  });
}

export function isBlackScreenOpen(): boolean {
  return open;
}

export function openBlackScreen(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeBlackScreen(): void {
  if (!open) return;
  open = false;
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useBlackScreenOpen(): boolean {
  return useSyncExternalStore(subscribe, isBlackScreenOpen, isBlackScreenOpen);
}
