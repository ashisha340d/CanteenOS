import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // config/index.ts reads real env at import time; these tests only exercise pure/lazy
    // logic (no live DB connection is ever opened by resolveConflict/resolveCursor or
    // resolveMediaPath), but JWT_SECRET must still be present for the module to load.
    setupFiles: ['./tests/setup.ts'],
  },
});
