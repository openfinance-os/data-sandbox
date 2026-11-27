// OF-OS site bar and system dark mode.
//
// Every page except the chrome-less embed carries the Open Finance OS bar
// linking back to openfinance-os.org. Colours follow prefers-color-scheme
// with no toggle and no storage; the embed and /connect stay light.

import { test, expect } from './_fixtures.mjs';

const PAGES = ['index', 'about', 'integrate', 'connect', 'labs'];

for (const name of PAGES) {
  test(`${name} page links back to Open Finance OS`, async ({ page }) => {
    await page.goto(`/src/${name}.html`);
    const bar = page.locator('nav.site-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Open Finance OS' })).toHaveAttribute(
      'href',
      'https://openfinance-os.org/',
    );
    await expect(bar.getByRole('link', { name: 'Data Sandbox' })).toHaveAttribute(
      'href',
      'index.html',
    );
  });
}

test('embed has no site bar', async ({ page }) => {
  await page.goto('/src/embed.html?persona=salaried_expat_mid&lfi=median');
  await expect(page.locator('nav.site-bar')).toHaveCount(0);
});

const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('explorer and labs follow the system dark setting', async ({ page }) => {
  for (const name of ['index', 'labs']) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`/src/${name}.html`);
    const light = await background(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await background(page);
    expect(dark, name).not.toBe(light);
  }
});

test('embed and connect stay light in dark mode', async ({ page }) => {
  for (const url of [
    '/src/embed.html?persona=salaried_expat_mid&lfi=median',
    '/src/connect.html',
  ]) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(url);
    const light = await background(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await background(page), url).toBe(light);
  }
});

test('dark mode writes nothing to storage', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/src/index.html?persona=salaried_expat_mid');
  await expect(page.locator('nav.site-bar')).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
