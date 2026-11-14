import { defineConfig } from 'vitest/config';

// Database tests (pnpm test:db): real PostgreSQL, test database only.
export default defineConfig({
  test: {
    include: ['src/**/*.db-spec.ts'],
    globalSetup: ['./test/db/global-setup.ts'],
    setupFiles: ['./test/db/setup-env.ts'],
    // One file at a time: the tests share one database.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
