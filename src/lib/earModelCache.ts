// Single source of truth for where the Quran-Lab zipformer ear (~73 MB) is
// kept in the Cache API. Used by the worker (writes it) and quranLabEar
// (checks it). public/sw.js cannot import this module: its KEEP_CACHES list
// repeats the literal 'quranlab-model-v1' — change both together, or every
// deploy wipes the downloaded model.
// 3.7: the cache name carries the model version. Shipping a new model under
// the same URL: bump QURANLAB_MODEL_VERSION (and the literal in sw.js
// KEEP_CACHES); the worker then downloads it fresh and deletes the old cache.
export const QURANLAB_MODEL_VERSION = 1;
export const QURANLAB_MODEL_CACHE_PREFIX = 'quranlab-model-v';
export const QURANLAB_MODEL_CACHE = `${QURANLAB_MODEL_CACHE_PREFIX}${QURANLAB_MODEL_VERSION}`;
export const QURANLAB_BASE = '/models/quranlab/';
export const QURANLAB_MODEL_URL = `${QURANLAB_BASE}zipformer_p_arabic_v3.int8.onnx`;
