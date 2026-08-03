/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/threeStub.ts'],
    // Search/headless-match tests do real work (hundreds of plan
    // evaluations); under parallel load the 5s default flakes.
    testTimeout: 30_000,
  },
});
