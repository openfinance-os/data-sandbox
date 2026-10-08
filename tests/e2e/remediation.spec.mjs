import { test, expect } from './_fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
test('published links return JSON and unsupported paths return 404', async ({ page, request }) => {
  await page.goto('/src/index.html?persona=salaried_expat_mid');
  await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
  await expect(page.locator('#seed-input')).toHaveValue('4729');
  const response = await request.get(
    '/fixtures/v1/bundles/salaried_expat_mid/median/seed-4729/accounts.json',
  );
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  expect((await response.json())._scenario.corpusVersion).toBe('0.1.0');
  expect(
    (
      await request.get('/fixtures/v1/bundles/salaried_expat_mid/median/seed-123/accounts.json')
    ).status(),
  ).toBe(404);
});
test('guided labs expose tasks and source-backed answers', async ({ page }) => {
  await page.goto('/src/labs.html');
  await expect(page.getByRole('heading', { name: 'Income and fixed commitments' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect answer key' }).first().click();
  await expect(page.locator('#labs pre').nth(1)).toContainText('incomeIds');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('both worked HTTP examples load their real fixture calculations', async ({ page }) => {
  await page.goto('/examples/tpp-budgeting-demo/index.html');
  await expect(page.locator('#total-balance')).toContainText('AED');
  await expect(page.locator('#err')).toBeHidden();
  await expect(page.locator('#account-list li')).not.toHaveCount(0);
  await page.goto('/examples/accounting-multi-bank-demo/index.html');
  await expect(page.locator('#recon-table tbody tr')).not.toHaveCount(0);
  await expect(page.locator('#ledger-table tbody tr')).not.toHaveCount(0);
  await expect(page.locator('#err')).toBeHidden();
});
test('an embed refuses replay with a different corpus version', async ({ page }) => {
  await page.goto('/src/embed.html?persona=salaried_expat_mid&corpus=old');
  await expect(page.locator('#embed-body')).toContainText('pinned package or archive');
});
