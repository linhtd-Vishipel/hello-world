/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ARTIFACT=1: build một khối JS duy nhất để nhúng vào trang Artifact (scripts/build-artifact.mjs)
const artifact = process.env.ARTIFACT === '1';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: artifact ? 2000 : 1200,
    outDir: artifact ? 'dist-artifact' : 'dist',
    rollupOptions: {
      output: artifact ? { inlineDynamicImports: true } : { manualChunks: { exceljs: ['exceljs'] } },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
