import { defineConfig } from '@playwright/test';

const PORT = 8765;
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: ORIGIN,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind ${HOST}`,
    url: `${ORIGIN}/src/index.html`,
    timeout: 10_000,
    reuseExistingServer: true,
  },
});
