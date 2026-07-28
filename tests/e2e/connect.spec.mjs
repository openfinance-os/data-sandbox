// T-09 — /connect consumer consent-journey walkthrough e2e.
//
// Covers the repo's largest frontend surface (src/connect.html +
// src/connect.js), which previously had zero tests of any kind:
//   • J1 (bank's own connector → Claude): full walk — pick profile → pick
//     bank → share (discovery → SCA → consent → token) → connected state
//     renders live fixture data.
//   • J2 (regulated multi-LFI aggregation): persona → scope → LFI picker,
//     then on through the Al Tareq consent flow to the Consent Manager
//     modal (open + contents + close).
//   • One AxeBuilder wcag2a/2aa scan on the hub view (same pattern as
//     smoke.spec.mjs).
//
// Served by the shared playwright.config.mjs webServer (python http.server
// on the repo root). That server has no /fixtures/v1/ tree — the staged
// `_site/` is gitignored and not guaranteed present — so `/fixtures/v1/*`
// requests are fulfilled from the BUILT fixture package
// (packages/sandbox-fixtures/), whose bundles/<persona>/<lfi>/seed-<n>/
// layout is byte-identical to what stage-site.mjs publishes. This keeps the
// spec hermetic after `npm run build:fixtures` and avoids 404 console noise
// tripping the shared console-error catcher.
//
// The shared console-error catcher from _fixtures.mjs is active: any
// console.error / pageerror fails these tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './_fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, '../../packages/sandbox-fixtures');
const FIXTURES_BUILT = fs.existsSync(path.join(PKG_DIR, 'manifest.json'));

// Route /fixtures/v1/* → packages/sandbox-fixtures/*.
async function routeFixtures(page) {
  await page.route('**/fixtures/v1/**', (route) => {
    const url = new URL(route.request().url());
    const rel = url.pathname.replace(/^.*\/fixtures\/v1\//, '');
    const file = path.join(PKG_DIR, rel);
    if (file.startsWith(PKG_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: fs.readFileSync(file, 'utf8'),
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test.beforeEach(() => {
  test.skip(!FIXTURES_BUILT, 'fixture package not built — run `npm run build:fixtures`');
});

test('J1 — pick profile → pick bank → share → connected state renders fixture data', async ({
  page,
}) => {
  await routeFixtures(page);
  await page.goto('/src/connect.html');

  // Hub → Journey 1.
  await page.locator('#open-j1').click();
  await expect(page.locator('#journey-j1')).toBeVisible();

  // Step 1 — pick a persona (Sara, the canonical banking persona).
  await page.locator('#persona-grid [data-persona-id="salaried_expat_mid"]').click();
  const next = page.locator('#btn-next');
  await expect(next).toBeEnabled();
  await expect(next).toContainText('Continue as');
  await next.click();

  // Step 2 — pick a bank (LFI profile card). resetInstitutionSelection()
  // pre-selects a default profile for the persona, so clicking the first
  // card yields 1 or 2 selected — assert the share CTA, not an exact count.
  await expect(page.locator('#step-2')).toBeVisible();
  await page.locator('#institutions-body .inst-card').first().click();
  await expect(next).toContainText(/Share with Claude \(\d+\)/);
  await next.click();

  // Step 3 — share: discovery → SCA → consent → token.
  const status = page.locator('#wizard-status');
  await expect(status).toContainText('Sub-step 3a');
  await next.click(); // discovery → sca
  await expect(status).toContainText('Sub-step 3b');
  await next.click(); // sca → consent
  await expect(status).toContainText('Sub-step 3c');
  await next.click(); // consent → token (mints the ConsentId)
  await expect(status).toContainText('Sub-step 3d');
  await next.click(); // token → step 4 (back in chat)

  // Step 4 — connected. Summary line + live fixture fetch (watermarked
  // envelopes from the fixture corpus) must both render.
  await expect(page.locator('#step-4')).toBeVisible();
  await expect(status).toContainText('Bearer issued');
  await expect(page.locator('#connected-body')).toContainText('Connected as');
  await expect(page.locator('#connected-body .watermark-banner')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#connected-body .watermark-banner')).toContainText('SYNTHETIC');
});

test('J2 — persona + scope steps, then Al Tareq flow through to the Consent Manager modal', async ({
  page,
}) => {
  await routeFixtures(page);
  await page.goto('/src/connect.html');

  // Hub → Journey 2.
  await page.locator('#open-j2').click();
  await expect(page.locator('#journey-j2')).toBeVisible();

  // Step 1 — pick a persona.
  await page.locator('#j2-persona-grid [data-persona-id="salaried_expat_mid"]').click();
  const next = page.locator('#j2-btn-next');
  await expect(next).toBeEnabled();
  await next.click();

  // Step 2 — pick consent scope (single-LFI).
  await expect(page.locator('#j2-step-2')).toBeVisible();
  await page.locator('#j2-scope-grid .scope-card', { hasText: 'Single LFI' }).click();
  await expect(next).toContainText('Continue (single)');
  await next.click();

  // First two steps walked — step 3 (LFI picker) is now visible.
  await expect(page.locator('#j2-step-3')).toBeVisible();
  await page.locator('#j2-lfi-body .inst-card').first().click();
  await expect(next).toContainText('Open Al Tareq consent (1 LFI)');
  await next.click();

  // Step 4 sub-steps: TPP launchpad → Al Tareq CAAP → SCA → Consent Manager.
  const status = page.locator('#j2-wizard-status');
  await expect(status).toContainText('Sub-step 4a');
  await next.click();
  await expect(status).toContainText('Sub-step 4b');
  await next.click();
  await expect(status).toContainText('Sub-step 4c');
  await next.click(); // mints the ConsentId for the single LFI → manager
  await expect(status).toContainText('Sub-step 4d');
  await expect(status).toContainText('1 ConsentId active');

  // Open the Consent Manager modal from the portal link.
  await page.locator('.consent-manager-link').click();
  const modal = page.locator('#consent-manager-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#cm-title')).toContainText('My Consents');
  // The freshly minted J2 consent record is listed with a ConsentId.
  await expect(modal.locator('#consent-manager-body')).toContainText('ConsentId');

  // Close restores the journey view.
  await page.locator('#consent-manager-close').click();
  await expect(modal).toBeHidden();
  await expect(page.locator('#journey-j2')).toBeVisible();
});

test('hub view is axe-clean (wcag2a/2aa) — EXP-23', async ({ page }) => {
  await routeFixtures(page);
  await page.goto('/src/connect.html');
  // Hub is the default view; wait for the journey cards to render.
  await expect(page.locator('#open-j1')).toBeVisible();
  await expect(page.locator('#open-j2')).toBeVisible();

  const axeResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  if (axeResults.violations.length > 0) {
    console.error('axe violations:', JSON.stringify(axeResults.violations, null, 2));
  }
  expect(axeResults.violations).toEqual([]);
});
