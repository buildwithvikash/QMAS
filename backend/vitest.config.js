import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setup.js'],
    // One database for the run; files run one after another, tests use unique codes.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
