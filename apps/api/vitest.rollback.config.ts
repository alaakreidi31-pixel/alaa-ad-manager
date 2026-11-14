import { defineConfig } from 'vitest/config';

// Rollback test (pnpm test:rollback): undoes and re-applies a migration
// on the TEST database only.
export default defineConfig({
  test: {
    include: ['src/**/*.rollback-spec.ts'],
    globalSetup: ['./test/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
