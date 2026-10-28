import { defineConfig } from 'vite';
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
export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
