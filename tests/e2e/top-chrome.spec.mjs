// PR-10 — compressed top chrome.
//
// The standalone .persona-hero strip is gone. The active persona's
// avatar + name + tagline now live inside the topbar's left edge
// (#topbar-persona). The synthetic disclaimer is a 4 px stripe at the
// page top plus a "SYNTHETIC ⓘ" chip in the topbar's run-state area;
// clicking the chip opens a popover with the full text; Esc closes it.
//
// EXP-22 regression guard: clicking the chip (which is the new
// dismissable affordance equivalent) must NOT write to localStorage —
// the previous .banner localStorage carve-out is removed.

import { test, expect, loadPersona } from './_fixtures.mjs';

test.describe('top chrome compression (PR-10)', () => {
  test('topbar carries the active persona slot, no standalone hero', async ({ page }) => {
    await loadPersona(page, { persona: 'gig_variable_income' });
    // The persona name is rendered inside #topbar-persona-name.
    const name = page.locator('#topbar-persona-name');
    await expect(name).toBeVisible();
    await expect(name).toContainText('Priya');
    // Standalone hero is gone.
    await expect(page.locator('#persona-hero')).toHaveCount(0);
    await expect(page.locator('.persona-hero')).toHaveCount(0);
  });

  test('topbar persona refreshes on persona-card click', async ({ page }) => {
    await loadPersona(page, { persona: 'salaried_expat_mid' });
    await expect(page.locator('#topbar-persona-name')).toContainText('Sara');
    // PR-11 — the dropdown is gone; persona switching is driven solely by
    // clicking a card in the left-pane persona library.
    await page
      .locator('.persona-card[data-persona-id="hnw_multicurrency"]')
      .click();
    await expect(page.locator('#topbar-persona-name')).toContainText('Layla');
  });

  test('persona dropdown is removed (PR-11)', async ({ page }) => {
    await loadPersona(page);
    await expect(page.locator('#persona-select')).toHaveCount(0);
    // The persona showcase still renders inside .controls-scenario so the
    // merged pill stays intact.
    await expect(page.locator('.controls-scenario #topbar-persona')).toBeVisible();
  });

  test('SYNTHETIC chip opens and closes the disclaimer popover', async ({ page }) => {
    await loadPersona(page);
    const chip = page.locator('#banner-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#banner-popover')).toBeHidden();

    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#banner-popover')).toBeVisible();
    await expect(page.locator('#banner-popover')).toContainText('UAE Open Finance Standards v2.1');

    // Esc closes.
    await page.keyboard.press('Escape');
    await expect(page.locator('#banner-popover')).toBeHidden();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
  });

  test('thin synthetic stripe is at the page top, always visible', async ({ page }) => {
    await loadPersona(page);
    const stripe = page.locator('.banner-stripe');
    await expect(stripe).toBeVisible();
    const height = await stripe.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(6);
    expect(height).toBeGreaterThanOrEqual(2);
  });

  test('opening the SYNTHETIC popover writes nothing to storage (EXP-22)', async ({ page, context }) => {
    await loadPersona(page);
    await page.locator('#banner-chip').click();
    await expect(page.locator('#banner-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    const ls = await page.evaluate(() => Object.keys(window.localStorage));
    const ss = await page.evaluate(() => Object.keys(window.sessionStorage));
    expect(ls).toEqual([]);
    expect(ss).toEqual([]);
    const cookies = await context.cookies('http://127.0.0.1:8765');
    expect(cookies).toEqual([]);
  });

  test('attribution wordmark is in the topbar, not duplicated as a 2-line block', async ({ page }) => {
    await loadPersona(page);
    // The wordmark lives inside the topbar as a single inline span.
    const attr = page.locator('.topbar-attribution');
    await expect(attr).toContainText('Open Finance Data Sandbox');
    await expect(attr).toContainText('OF-OS Commons');
    // No standalone .brand block anywhere.
    await expect(page.locator('.brand')).toHaveCount(0);
  });
});
