import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['sharp', 'onnxruntime-node'],
    },
  },
  optimizeDeps: {
    exclude: ['sharp', 'onnxruntime-node', '@huggingface/transformers'],
  },
});
