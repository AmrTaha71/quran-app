import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Offline support + automatic updates: the service worker
// (public/sw.js) runtime-caches the app shell and the Mushaf pages
// the user actually visited — failures are silent (offline is an
// enhancement, never a crash). Updates: the worker is network-first
// for navigations and uses skipWaiting + clients.claim, so a new
// deploy reaches an installed app by itself — no reinstall, no
// re-add. Two additions make that prompt in practice: (1) an update
// check runs on launch and whenever the app returns to the
// foreground (installed apps are often resumed, not reloaded, so the
// browser's own schedule alone can lag days); (2) when a new worker
// takes over, a small dismissible banner offers a one-tap reload —
// never a forced reload, so nothing interrupts a prayer or a
// recitation in progress. The banner only appears on a real update:
// on first install there is no previous controller, so it stays
// hidden.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      const hadController = !!navigator.serviceWorker.controller;
      let bannerShown = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || bannerShown) return;
        bannerShown = true;
        const bar = document.createElement('div');
        bar.setAttribute('dir', 'rtl');
        bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;background:#065f46;color:#fff;font-family:inherit;font-size:15px;box-shadow:0 4px 18px rgba(0,0,0,.3);';
        const text = document.createElement('span');
        text.style.flex = '1';
        text.textContent = 'نسخة جديدة من التطبيق متاحة';
        const btn = document.createElement('button');
        btn.textContent = 'حدّث الآن';
        btn.style.cssText = 'background:#f0c85a;color:#065f46;border:0;border-radius:10px;padding:8px 14px;font-size:15px;font-weight:700;cursor:pointer;';
        btn.onclick = () => window.location.reload();
        const close = document.createElement('button');
        close.textContent = '✕';
        close.setAttribute('aria-label', 'إغلاق');
        close.style.cssText = 'background:transparent;color:#fff;border:0;font-size:16px;cursor:pointer;padding:4px;';
        close.onclick = () => bar.remove();
        bar.append(text, btn, close);
        document.body.appendChild(bar);
      });
    }).catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
