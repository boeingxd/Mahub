import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The first test in a file pays for loading Fastify, which can take ~6 s
    // on Windows (antivirus scans every file). vitest's default is 5 s.
    testTimeout: 15_000,
    // Builds a fresh mahub_test database before the database tests (test/db/).
    globalSetup: ['./test/db/globalSetup.ts'],
    hookTimeout: 60_000,
  },
});
