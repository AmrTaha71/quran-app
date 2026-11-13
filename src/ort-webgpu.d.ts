// onnxruntime-web's webgpu entry ships no .d.ts of its own; same API as the main entry.
declare module 'onnxruntime-web/webgpu' {
  export * from 'onnxruntime-common';
}
