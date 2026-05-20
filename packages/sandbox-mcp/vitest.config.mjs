import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    exclude: ['node_modules/**'],
    // determinism.test.mjs spawns two MCP server subprocesses for every
    // persona × lfi and replays the journey — runs ~5s locally, slower
    // on CI. Vitest 4 lowered the default test timeout from 30s → 5s, so
    // bump explicitly. All other tests finish in milliseconds.
    testTimeout: 30000,
  },
});
