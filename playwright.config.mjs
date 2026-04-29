import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8765',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'python3 -m http.server 8765 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8765/src/index.html',
    timeout: 10_000,
    reuseExistingServer: true,
  },
});
