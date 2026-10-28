/// <reference types="vite/client" />

// D1 build stamp: replaced at build time by the Vite define in
// vite.config.ts (Vercel commit short hash, or 'dev' as fallback).
// Declared here so `tsc --noEmit` passes without any prebuild step.
declare const __BUILD_SHA__: string;
