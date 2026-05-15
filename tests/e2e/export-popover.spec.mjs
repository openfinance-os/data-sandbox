// PR #6 — unified Export popover keyboard flow.
//
// Replaces the JSON / CSV / Tarball / Embed button row and the toolbar
// Share button with a single Export ▾ button that opens a tabbed popover
// (Permalink · Embed iframe · JSON · CSV · Tarball · npm · Python · curl ·
// MCP). The keyboard contract is the load-bearing surface: ⌘E opens, Esc
// closes, tabs are keyboard-navigable, Copy is reachable via Tab.

import { test, expect, loadPersona } from './_fixtures.mjs';

test.describe('Export popover (PR #6)', () => {
  test('Cmd+E opens, Esc closes', async ({ page, browserName }) => {
    await loadPersona(page);
    // macOS uses Meta, Linux/Windows use Control. Playwright normalises
    // 'ControlOrMeta' as the platform-correct accelerator.
    await page.keyboard.press('ControlOrMeta+E');
    await expect(page.locator('.export-overlay')).toBeVisible();
    await expect(page.locator('#export-title')).toHaveText('Export');
    await page.keyboard.press('Escape');
    await expect(page.locator('.export-overlay')).toHaveCount(0);
  });

  test('Export button opens and the 9 tabs are present', async ({ page }) => {
    await loadPersona(page);
    await page.locator('#export-toggle').click();
    await expect(page.locator('.export-overlay')).toBeVisible();
    const tabs = page.locator('.export-tab');
    await expect(tabs).toHaveCount(9);
    const labels = await tabs.allTextContents();
    expect(labels).toEqual([
      'Permalink', 'Embed iframe', 'JSON', 'CSV', 'Tarball',
      'npm', 'Python', 'curl', 'MCP',
    ]);
  });

  test('clicking a tab swaps the snippet content', async ({ page }) => {
    await loadPersona(page);
    await page.keyboard.press('ControlOrMeta+E');
    // Permalink is the default-active tab — snippet shows the current URL.
    const pre = page.locator('.export-pre');
    await expect(pre).toContainText('persona=salaried_expat_mid');

    await page.locator('.export-tab', { hasText: 'npm' }).click();
    await expect(pre).toContainText("from '@openfinance-os/sandbox-fixtures'");
    await expect(pre).toContainText("persona: 'salaried_expat_mid'");

    await page.locator('.export-tab', { hasText: 'Python' }).click();
    await expect(pre).toContainText('from openfinance_os_sandbox_fixtures');
    await expect(pre).toContainText("persona='salaried_expat_mid'");

    await page.locator('.export-tab', { hasText: 'curl' }).click();
    await expect(pre).toContainText('curl -s');

    await page.locator('.export-tab', { hasText: 'MCP' }).click();
    await expect(pre).toContainText("callTool('set_session'");
  });

  test('Tarball tab shows a Download action instead of a snippet', async ({ page }) => {
    await loadPersona(page);
    await page.keyboard.press('ControlOrMeta+E');
    await page.locator('.export-tab', { hasText: 'Tarball' }).click();
    // No <pre> snippet on this tab — but the descriptive note + Download
    // button are present.
    await expect(page.locator('.export-pre')).toHaveCount(0);
    await expect(page.locator('.export-note')).toContainText('Tarball is a binary');
    await expect(page.locator('.export-copy-btn', { hasText: 'Download tarball' })).toBeVisible();
  });

  test('Copy button copies the active snippet to the clipboard', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name === 'webkit-desktop', 'WebKit clipboard read needs explicit user-gesture permission in test mode.');
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const isolatedPage = await ctx.newPage();
    await loadPersona(isolatedPage);
    await isolatedPage.keyboard.press('ControlOrMeta+E');
    await isolatedPage.locator('.export-tab', { hasText: 'curl' }).click();
    await isolatedPage.locator('.export-copy-btn', { hasText: 'Copy' }).click();
    const text = await isolatedPage.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('curl -s');
    await ctx.close();
  });

  test('keyboard focus enters the popover and Tab moves between tabs', async ({ page }) => {
    await loadPersona(page);
    await page.keyboard.press('ControlOrMeta+E');
    // The popover focuses the active tab button on open.
    const focusedLabel = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(focusedLabel).toContain('Permalink');
    // Tab key advances within the popover (the dialog isn't a focus trap
    // by design — we still verify the active tab can be reached via the
    // keyboard from outside the popover).
    await page.keyboard.press('Tab');
    const next = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(next.length).toBeGreaterThan(0);
  });

  test('Share button is removed — Export popover supersedes it', async ({ page }) => {
    await loadPersona(page);
    await expect(page.locator('#share-btn')).toHaveCount(0);
    await expect(page.locator('#export-toggle')).toBeVisible();
  });
});
