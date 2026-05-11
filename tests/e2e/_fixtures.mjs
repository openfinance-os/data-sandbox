// Shared Playwright test fixtures for the e2e suite.
//
// Provides:
//   • `test` — base Playwright test extended with a console / pageerror catcher
//     that fails the test if anything reaches the console at level=error.
//     Opt out with `test.use({ allowConsoleErrors: true })` (e.g. for the
//     analytics stub tests where the stubbed SDK path is benign).
//   • `loadPersona(page, { persona, lfi, seed, endpoint, route })` — collapses
//     the repeated `goto + waitForFunction(coverage-pct)` pattern.
//   • `disableAnimations(page)` — injects a style tag that zeroes out
//     animation / transition durations for visual stability.
//
// Import shape:
//   import { test, expect, loadPersona, disableAnimations } from './_fixtures.mjs';

import { test as base, expect } from '@playwright/test';

export { expect };

export const test = base.extend({
  allowConsoleErrors: [false, { option: true }],
  page: async ({ page, allowConsoleErrors }, run, testInfo) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    await run(page);

    if (!allowConsoleErrors && errors.length) {
      throw new Error(
        `console errors in "${testInfo.title}":\n${errors.join('\n')}`,
      );
    }
  },
});

export async function loadPersona(page, {
  persona = 'salaried_expat_mid',
  lfi = 'median',
  seed = '4729',
  endpoint,
  route = '/src/index.html',
  extraParams = {},
} = {}) {
  const params = new URLSearchParams({ persona, lfi, seed, ...extraParams });
  await page.goto(`${route}?${params.toString()}`);
  await page.waitForFunction(
    () => document.getElementById('coverage-pct')?.textContent !== '—',
  );
  if (endpoint) {
    await page.locator('.nav-endpoint', { hasText: endpoint }).first().click();
    await expect(page.locator('#endpoint-label')).toContainText(endpoint);
  }
}

export async function disableAnimations(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
}
