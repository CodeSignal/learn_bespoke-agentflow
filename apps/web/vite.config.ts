import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  test: {
    // The design-system submodule (symlinked under public/) ships its own
    // Playwright specs; only this app's unit tests belong to Vitest.
    include: ['src/**/*.test.ts']
  }
});

