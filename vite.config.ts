import { defineConfig } from 'vitest/config';

// Relative base so the same build works on GitHub Pages sub-paths, file:// WebViews and Capacitor.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: { host: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
