import { defineConfig } from 'vitest/config';

// Unit tests (pnpm test): no database needed.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
