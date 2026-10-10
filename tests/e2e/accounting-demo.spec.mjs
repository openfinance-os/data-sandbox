import { test, expect } from './_fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';

const DEMO = '/examples/accounting-multi-bank-demo/index.html';
const CLINIC = 'sme_clinic_receivables';
const BASE = `/fixtures/v1/bundles/${CLINIC}`;
const BALANCE = `${BASE}/median/seed-2864/accounts__sme-clinic-receivables-acct-01__balances.json`;

async function clinic(page) {
  await page.goto(DEMO);
  await page.locator('#persona-select').selectOption(CLINIC);
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#watermark')).toContainText(`persona:${CLINIC}`);
}

test('primary balances and generated holders come from the selected fixture envelopes', async ({
  page,
  request,
}) => {
  await clinic(page);
  for (const profile of ['rich', 'median', 'sparse']) {
    await page.locator('#lfi-select').selectOption(profile);
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    const response = await request.get(`${BASE}/${profile}/seed-2864/accounts.json`);
    const accounts = (await response.json()).Data.Account;
    const rows = page
      .locator('#ledger-table tbody tr')
      .filter({ has: page.locator('.role-primary') });
    await expect(rows).toHaveCount(accounts.length);
    for (const [i, account] of accounts.entries()) {
      const balanceResponse = await request.get(
        `${BASE}/${profile}/seed-2864/accounts__${account.AccountId}__balances.json`,
      );
      const balance = (await balanceResponse.json()).Data.Balance[0];
      await expect(rows.nth(i).locator('td').nth(2)).toHaveText(account.AccountId);
      const value = rows.nth(i).locator('td').nth(5);
      await expect(value).toContainText(`${balance.Amount.Amount} ${balance.Amount.Currency}`);
      if (balance.CreditDebitIndicator === 'Debit') await expect(value).toHaveText(/^-\d/);
      else await expect(value).not.toHaveText(/^-/);
      await expect(page.locator('#holder-names')).toContainText(account.AccountHolderName);
    }
    await expect(page.locator('#scenario-name')).toHaveText(
      'Crestline Wellness Clinic LLC — Healthcare Clinic',
    );
    await expect(page.locator('#holder-names')).not.toHaveText(
      await page.locator('#scenario-name').textContent(),
    );
    await expect(page.locator('#recon-table .row-link')).toHaveCount(2);
    await expect(page.locator('#ledger-table tbody tr')).toHaveCount(4);
  }
});

test('a slower old selection cannot replace the latest scenario and profile', async ({ page }) => {
  let release;
  let notify;
  const gate = new Promise((resolve) => (release = resolve));
  const started = new Promise((resolve) => (notify = resolve));
  await page.route(`**${BALANCE}`, async (route) => {
    notify();
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(DEMO);
    await expect(page.locator('#persona-select option')).not.toHaveCount(0);
    const other = await page
      .locator('#persona-select')
      .evaluate(
        (select) =>
          [...select.options].find((option) => option.value !== 'sme_clinic_receivables')?.value,
      );
    await page.locator('#persona-select').selectOption(CLINIC);
    await started;
    await page.locator('#lfi-select').selectOption('rich');
    await page.locator('#persona-select').selectOption(other);
    await page.locator('#lfi-select').selectOption('sparse');
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#watermark')).toContainText(`persona:${other} lfi:sparse`);
    release();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#watermark')).toContainText(`persona:${other} lfi:sparse`);
    await expect(page.locator('#scenario-name')).toHaveText(
      (await page.locator('#persona-select option:checked').textContent()).replace(
        / \([^)]*\)$/,
        '',
      ),
    );
    await expect(page.locator('#ledger-table')).not.toContainText('sme-clinic-receivables');
    await expect(page.locator('#err')).toBeHidden();
  } finally {
    release();
  }
});

test.describe('controlled fixture failures', () => {
  test.use({ allowConsoleErrors: true }); // Expected HTTP 503 messages; page errors remain asserted.

  test('failed or empty balances are explicit and a new selection retries them', async ({
    page,
  }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route(`**${BALANCE}`, (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    );
    await clinic(page);
    const primary = page
      .locator('#ledger-table tbody tr')
      .filter({ has: page.locator('.role-primary') });
    await expect(primary.first().locator('td').nth(5)).toHaveText('Unavailable');
    await expect(primary.nth(1).locator('td').nth(5)).toContainText('AED');
    await expect(page.locator('#load-status')).toContainText('1 balance feed is unavailable');
    await expect(page.locator('#err')).toBeHidden();

    await page.unroute(`**${BALANCE}`);
    await page.route(`**${BALANCE}`, (route) => route.fulfill({ json: { Data: { Balance: [] } } }));
    await page.locator('#lfi-select').selectOption('rich');
    await page.locator('#lfi-select').selectOption('median');
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    await expect(primary.first().locator('td').nth(5)).toHaveText('Not supplied');

    await page.unroute(`**${BALANCE}`);
    await page.locator('#lfi-select').selectOption('rich');
    await page.locator('#lfi-select').selectOption('median');
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    await expect(primary.first().locator('td').nth(5)).toContainText('AED');
    await expect(page.locator('#load-status')).not.toContainText('unavailable');
    expect(pageErrors).toEqual([]);
  });

  test('a failed account load clears old results and recovers on a profile change', async ({
    page,
  }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await clinic(page);
    const accountsUrl = `**${BASE}/rich/seed-2864/accounts.json`;
    await page.route(accountsUrl, (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.locator('#lfi-select').selectOption('rich');
    await expect(page.locator('#err')).toContainText('Choose a scenario or profile to retry');
    await expect(page.locator('#ledger-table tbody tr')).toHaveCount(0);
    await expect(page.locator('#holder-names')).toHaveText('Unavailable');
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    await page.unroute(accountsUrl);
    await page.locator('#lfi-select').selectOption('median');
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#ledger-table tbody tr')).toHaveCount(4);
    await expect(page.locator('#err')).toBeHidden();
    expect(pageErrors).toEqual([]);
  });
});

test('scenario context and scrollable tables work at narrow widths in both themes', async ({
  page,
}) => {
  await clinic(page);
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await expect(page.getByLabel('Scenario:', { exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await page.getByRole('region', { name: 'Consolidated ledger table' }).focus();
    expect(
      await page
        .getByRole('region', { name: 'Consolidated ledger table' })
        .evaluate((element) => element.matches(':focus-visible')),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});
