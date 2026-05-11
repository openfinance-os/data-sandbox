import { defineConfig, devices } from '@playwright/test';

const PORT = 8765;
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const VISUAL_FILE = /visual\.spec\.mjs/;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  // HTML report is always produced; CI also emits the GitHub annotations
  // reporter so failures surface inline on PRs.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  // Visual baselines: tolerate 1% pixel drift (font/AA jitter), tight enough
  // to catch real layout / colour regressions. Tighten once baselines settle.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: ORIGIN,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: DESKTOP_VIEWPORT },
      testIgnore: VISUAL_FILE,
    },
    {
      name: 'firefox-desktop',
      use: { ...devices['Desktop Firefox'], viewport: DESKTOP_VIEWPORT },
      testIgnore: VISUAL_FILE,
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'], viewport: DESKTOP_VIEWPORT },
      testIgnore: VISUAL_FILE,
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testIgnore: VISUAL_FILE,
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'] },
      testIgnore: VISUAL_FILE,
    },
    {
      // Visual baselines run only here. Pinned to Chromium-Linux (CI parity);
      // baselines regenerated via the e2e-update-baselines workflow_dispatch.
      name: 'visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: DESKTOP_VIEWPORT,
        deviceScaleFactor: 1,
      },
      testMatch: VISUAL_FILE,
    },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind ${HOST}`,
    url: `${ORIGIN}/src/index.html`,
    timeout: 10_000,
    reuseExistingServer: true,
  },
});
