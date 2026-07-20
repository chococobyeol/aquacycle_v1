import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The ecology suites intentionally fast-forward long simulated periods and
    // are CPU-bound. Running several of them at once starves Vitest workers and
    // causes wall-clock timeouts that do not occur in the simulation itself.
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
