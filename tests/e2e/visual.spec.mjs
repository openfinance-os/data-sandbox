// Visual baselines for the load-bearing views. Pinned to Chromium-Linux
// renderings (CI parity) via the `visual` project in playwright.config.mjs.
//
// Baselines live next to this file under `visual.spec.mjs-snapshots/` and
// are regenerated via the `e2e-update-baselines` GitHub Actions workflow
// (workflow_dispatch). macOS / Windows developers should run with
// `--project=chromium-desktop` for normal e2e; only invoke `--project=visual`
// when intentionally regenerating baselines on a Linux runner.
//
// Volatile elements (spec SHA pin, generated seed labels) are masked so that
// legitimate spec re-pinning doesn't churn the baselines.

import { test, expect, loadPersona, disableAnimations } from './_fixtures.mjs';

const PERSONA = 'salaried_expat_mid';

test.beforeEach(async ({ page }) => {
  await disableAnimations(page);
});

function volatileMasks(page) {
  return [page.locator('#version-pin'), page.locator('[data-volatile]')];
}

test('index — accounts endpoint', async ({ page }) => {
  // PR #5 made the Underwriting Summary the banking default landing, so
  // /accounts must be pinned explicitly (EXP-17 honours the URL endpoint).
  // This test was authored pre-PR #5 as "accounts default state" and rotted
  // unnoticed for as long as the visual project never ran in CI (T-02) —
  // the underwriting-panel test below covers the actual default landing.
  await loadPersona(page, { persona: PERSONA, extraParams: { endpoint: '/accounts' } });
  await expect(page.locator('.payload-rendered table')).toBeVisible();
  await expect(page).toHaveScreenshot('index-accounts.png', {
    fullPage: true,
    mask: volatileMasks(page),
  });
});

test('index — transactions endpoint', async ({ page }) => {
  await loadPersona(page, { persona: PERSONA, endpoint: '/transactions' });
  await expect(page.locator('.payload-rendered table')).toBeVisible();
  await expect(page).toHaveScreenshot('index-transactions.png', {
    fullPage: true,
    mask: volatileMasks(page),
  });
});

test('field card open on TransactionId', async ({ page }) => {
  await loadPersona(page, { persona: PERSONA, endpoint: '/transactions' });
  await page.locator('.field-name', { hasText: 'TransactionId' }).first().click();
  await expect(page.locator('#fc-content')).toBeVisible();
  await expect(page).toHaveScreenshot('field-card-open.png', {
    fullPage: true,
    mask: volatileMasks(page),
  });
});

test('compare-LFIs side-by-side', async ({ page }) => {
  await loadPersona(page, { persona: PERSONA, endpoint: '/transactions' });
  await page.locator('#compare-toggle').click();
  await expect(page.locator('.compare-pane')).toBeVisible();
  await expect(page.locator('.compare-half')).toHaveCount(2);
  await expect(page).toHaveScreenshot('compare-mode.png', {
    fullPage: true,
    mask: volatileMasks(page),
  });
});

test('underwriting panel', async ({ page }) => {
  await loadPersona(page, { persona: PERSONA });
  await page.locator('.nav-endpoint', { hasText: 'Underwriting summary' }).click();
  await expect(page.locator('.uw-panel')).toBeVisible();
  await expect(page).toHaveScreenshot('underwriting-panel.png', {
    fullPage: true,
    mask: volatileMasks(page),
  });
});

test('embed chrome-less view', async ({ page }) => {
  await page.goto(
    `/src/embed.html?persona=${PERSONA}&lfi=median&endpoint=/accounts/{AccountId}/transactions&seed=4729&height=600`,
  );
  await expect(page.locator('.embed-strip')).toBeVisible();
  await expect(page.locator('.payload-rendered table')).toBeVisible();
  await expect(page).toHaveScreenshot('embed-chromeless.png', {
    fullPage: true,
    mask: volatileMasks(page),
  });
});
