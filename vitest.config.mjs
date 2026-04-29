import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    // E2E specs use Playwright's runner, not Vitest.
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
