/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative, so the built page works wherever it is served from. GitHub
  // Pages puts a project site under /<repo>/, and a build with the default
  // absolute base asks for /assets/... at the ORIGIN root -- one directory
  // above the site, which is a blank page and four 404s. './' costs nothing
  // locally and removes the repo name from the build, so renaming the repo
  // or moving to a custom domain needs no change here.
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Standalone engine workbenches live beside the game so they can reuse
      // the exact production render code without booting a match.
      input: {
        main: 'index.html',
        terrain: 'terrain.html',
        trees: 'trees.html',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/threeStub.ts'],
    // Search/headless-match tests do real work (hundreds of plan
    // evaluations); under parallel load the 5s default flakes.
    testTimeout: 30_000,
  },
});
