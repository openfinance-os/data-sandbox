import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    // E2E specs use Playwright's runner, not Vitest.
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Vitest 4 dropped the default per-test timeout from 30 s to 5 s.
    // Several suites here iterate the full persona × LFI × endpoint matrix
    // in a single it() (spec-validation, enrichment, replay) and flake at
    // 5 s on cold/loaded runners. Match the MCP workspace config's 30 s.
    testTimeout: 30_000,
    // Inline PR annotations on CI failures (Playwright already does this
    // via its 'github' reporter; vitest needs opting in).
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
