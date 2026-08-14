import { defineConfig } from 'vitest/config';

// Deliberately not extending vite.config.ts: that config loads the
// vite-plugin-electron pair, which would try to build and launch the main
// process for a unit-test run.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
