import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
// D1 build stamp (transcript-truth): the deployed commit short hash,
// baked in at build time from Vercel's commit SHA. No prebuild step,
// no generated file, no new dependency: if the variable is absent
// (local build, non-Vercel host) the stamp is the safe fallback
// 'dev' and the build still succeeds. Declared for tsc in
// src/vite-env.d.ts; read in SelfTestPage as __BUILD_SHA__.
const BUILD_SHA = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev';

// 9.5 (2026-11-26): pages are lazy chunks now, which index.html does not
// name. This writes /precache-assets.json (every built JS/CSS chunk) so the
// service worker can keep the WHOLE app offline, not just the first bundle.
// The Whisper worker (~0.9 MB, used by few) is left to on-demand caching.
function precacheList(): Plugin {
  return {
    name: 'precache-list',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => /\.(js|css)$/.test(f) && !/quranAsr\.worker/.test(f))
        .map((f) => '/' + f)
        .sort();
      this.emitFile({ type: 'asset', fileName: 'precache-assets.json', source: JSON.stringify({ build: BUILD_SHA, files }) });
    },
  };
}
export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  plugins: [react(), precacheList()],
  // 9.5: guard — a main chunk past 1 MB means something big slipped back in.
  build: { chunkSizeWarningLimit: 1000 },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 3.17: the same isolation headers as vercel.json, so dev and preview run
  // the ONNX ear multi-threaded like production (crossOriginIsolated).
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  // 10.22: lucide-react is no longer excluded from dependency
  // pre-bundling (the exclude made dev serve hundreds of icon modules one
  // by one). Production builds are unaffected.
});
