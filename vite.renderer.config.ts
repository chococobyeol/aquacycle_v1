import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  root: path.resolve(__dirname, 'src/renderer'),
  publicDir: path.resolve(__dirname, 'src/renderer/public'),
  plugins: [react()],
  optimizeDeps: {
    include: ['pixi.js', 'eventemitter3'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '.vite/renderer/main_window'),
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
