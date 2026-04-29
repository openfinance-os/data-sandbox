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
  await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
  const first = await page.locator('#coverage-pct').textContent();
  await page.reload();
  await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
  const second = await page.locator('#coverage-pct').textContent();
  expect(first).toBe(second);
});

test('transactions filter narrows the row set — EXP-11', async ({ page }) => {
  await page.goto('/src/index.html?persona=hnw_multicurrency&lfi=median&seed=1');
  await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
  await page.locator('.nav-endpoint', { hasText: '/transactions' }).first().click();
  const beforeCount = await page.locator('.payload-rendered tbody tr').count();
  expect(beforeCount).toBeGreaterThan(0);
  await page.locator('select[name="type"]').selectOption('InternationalTransfer');
  await page.waitForTimeout(150);
  const afterCount = await page.locator('.payload-rendered tbody tr').count();
  expect(afterCount).toBeLessThan(beforeCount);
  expect(afterCount).toBeGreaterThan(0);
});

test('cross-link from standing-orders highlights matching transactions — EXP-12', async ({ page }) => {
  await page.goto('/src/index.html?persona=salaried_emirati_affluent&lfi=median&seed=1');
  await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
  await page.locator('.nav-endpoint', { hasText: '/standing-orders' }).first().click();
  await page.locator('.payload-rendered tbody tr').first().click();
  await expect(page.locator('.cross-link-banner')).toBeVisible();
  await expect(page.locator('#endpoint-label')).toContainText('/transactions');
  // Back button restores the prior endpoint.
  await page.locator('.cross-link-banner button').click();
  await expect(page.locator('#endpoint-label')).toContainText('/standing-orders');
});

test('embed page renders chrome-less view with status badges — EXP-27', async ({ page }) => {
  await page.goto('/src/embed.html?persona=salaried_expat_mid&lfi=median&endpoint=/accounts/{AccountId}/transactions&seed=4729&height=600');
  await expect(page.locator('.embed-strip')).toBeVisible();
  await expect(page.locator('.payload-rendered table')).toBeVisible();
  expect(await page.locator('.pill-solid').count()).toBeGreaterThan(0);
  expect(await page.locator('.payload-rendered tbody tr').count()).toBeGreaterThan(5);
  // No topbar, no persona library.
  await expect(page.locator('.persona-pane')).toHaveCount(0);
});

test('field card shows all 9 elements + Report-an-issue link', async ({ page }) => {
  await page.goto('/src/index.html?persona=salaried_expat_mid&lfi=median&seed=4729');
  await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
  await page.locator('.nav-endpoint', { hasText: '/transactions' }).first().click();
  await page.locator('.field-name', { hasText: 'TransactionId' }).first().click();
  const fc = page.locator('#fc-content');
  await expect(fc).toBeVisible();
  // Status, Type, Format, Enum, Example, Conditional, Real LFIs, Spec, Feedback labels visible.
  for (const k of ['Status', 'Type', 'Format', 'Enum', 'Example', 'Conditional', 'Real LFIs', 'Spec', 'Feedback']) {
    await expect(fc).toContainText(k);
  }
  // Spec citation is a link to the upstream pinned SHA.
  const specLink = fc.locator('a').first();
  const href = await specLink.getAttribute('href');
  expect(href).toMatch(/^https:\/\/github\.com\/Nebras-Open-Finance\/api-specs\/blob\//);
  // Report-an-issue link goes to a github.com /issues/new prefilled URL.
  const reportLink = page.locator('.fc-report-link');
  const reportHref = await reportLink.getAttribute('href');
  expect(reportHref).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/new\?/);
});
