// Single source of truth for where the Quran-Lab zipformer ear (~73 MB) is
// kept in the Cache API. Used by the worker (writes it) and quranLabEar
// (checks it). public/sw.js cannot import this module: its KEEP_CACHES list
// repeats the literal 'quranlab-model-v1' — change both together, or every
// deploy wipes the downloaded model.
export const QURANLAB_MODEL_CACHE = 'quranlab-model-v1';
export const QURANLAB_BASE = '/models/quranlab/';
export const QURANLAB_MODEL_URL = `${QURANLAB_BASE}zipformer_p_arabic_v3.int8.onnx`;
