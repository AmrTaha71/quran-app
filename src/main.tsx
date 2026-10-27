import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Offline support: the service worker (public/sw.js) runtime-caches the
// app shell and the Mushaf pages the user actually visited — it is
// registered once, failures are silent (offline is an enhancement,
// never a crash).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
