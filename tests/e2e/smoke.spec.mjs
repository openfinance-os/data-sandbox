// Phase 0 e2e smoke + a11y. Loads the sandbox, asserts the persona list and
// payload table render, switches to the transactions endpoint and asserts the
// row count, then runs axe-core (EXP-23 acceptance gate).

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('renders Sara, switches endpoints, no console errors, axe-clean', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto('/src/index.html');

  // Persona list rendered.
  await expect(page.locator('.persona-card').first()).toBeVisible();
  await expect(page.locator('.persona-card.active')).toHaveCount(1);

  // Top bar pin shows the spec SHA.
  await expect(page.locator('#version-pin')).toContainText('v2.1 @');

  // /accounts table renders. AccountId field-name is visible and the page has
  // at least one Mandatory pill (the AccountId column header).
  await expect(page.locator('.payload-rendered table')).toBeVisible();
  await expect(page.locator('.field-name', { hasText: 'AccountId' }).first()).toBeVisible();
  expect(await page.locator('.pill-solid').count()).toBeGreaterThan(0);

  // Switch to transactions.
  await page.locator('.nav-endpoint', { hasText: '/transactions' }).first().click();
  await expect(page.locator('#endpoint-label')).toContainText('/transactions');
  const rowCount = await page.locator('.payload-rendered table tbody tr').count();
  expect(rowCount).toBeGreaterThanOrEqual(20);

  // Field card opens on click.
  await page.locator('.field-name', { hasText: 'TransactionId' }).first().click();
  await expect(page.locator('#fc-content')).toBeVisible();
  await expect(page.locator('#fc-content')).toContainText('Mandatory');

  // axe-core a11y scan — Phase 0 acceptance for EXP-23.
  const axeResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  if (axeResults.violations.length > 0) {
    console.error('axe violations:', JSON.stringify(axeResults.violations, null, 2));
  }
  expect(axeResults.violations).toEqual([]);

  // No console errors throughout the run.
  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
});

test('determinism — same URL produces same coverage on two loads', async ({ page }) => {
  await page.goto('/src/index.html?lfi=median&seed=4729');
  // Wait for the URL to be normalised by the app (it may rewrite to /p/<id>).
  await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
  const first = await page.locator('#coverage-pct').textContent();
  await page.reload();
  await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
  const second = await page.locator('#coverage-pct').textContent();
  expect(first).toBe(second);
});
