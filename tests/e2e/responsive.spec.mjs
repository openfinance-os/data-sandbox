// PR #1 — responsive panel collapse.
//
// Below NARROW_PANE_BREAKPOINT_PX (1280) the navigator gets squeezed if both
// side panes are open simultaneously, so the UI:
//   (a) auto-collapses the field-detail pane on first load,
//   (b) keeps a mutex on subsequent manual expand — expanding one side pane
//       auto-collapses the opposite,
//   (c) leaves both states user-restorable via the existing pane-rail
//       chevrons.
//
// The 1100–1279 band is the test window. ≤1099 px has its own overlay model
// (existing behavior, untouched). ≥1280 px keeps the two-panes-open layout.

import { test, expect, loadPersona } from './_fixtures.mjs';

test.describe('responsive panel collapse (PR #1)', () => {
  test('auto-collapses field-detail at 1200 px on first load', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await loadPersona(page);
    const root = page.locator('#three-pane');
    await expect(root).toHaveClass(/right-collapsed/);
    await expect(root).not.toHaveClass(/left-collapsed/);
    // The pane-rail chevron for the field-detail pane is the restoration
    // affordance — it must be reachable.
    const rightRail = page.locator('.field-detail .pane-rail');
    await expect(rightRail).toBeVisible();
  });

  test('manual expand triggers narrow-viewport mutex', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await loadPersona(page);
    const root = page.locator('#three-pane');
    // Both panes start with field-detail auto-collapsed; expand it via the
    // rail. The opposite (persona-pane) should auto-collapse so the
    // navigator never gets squeezed between two simultaneously-open panes.
    await page.locator('.field-detail .pane-rail').click();
    await expect(root).not.toHaveClass(/right-collapsed/);
    await expect(root).toHaveClass(/left-collapsed/);

    // Reverse it: expand persona-pane → field-detail auto-collapses.
    await page.locator('.persona-pane .pane-rail').click();
    await expect(root).toHaveClass(/right-collapsed/);
    await expect(root).not.toHaveClass(/left-collapsed/);
  });

  test('no auto-collapse at 1280 px or wider', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadPersona(page);
    const root = page.locator('#three-pane');
    await expect(root).not.toHaveClass(/right-collapsed/);
    await expect(root).not.toHaveClass(/left-collapsed/);
  });

  test('payload table keeps a min-width safety floor', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await loadPersona(page, { endpoint: '/transactions' });
    // Table is wider than its parent's available width when both pane state
    // is squeezed; min-width: 520 keeps cell content from breaking mid-word.
    const tableWidth = await page
      .locator('.payload-rendered table')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(tableWidth).toBeGreaterThanOrEqual(520);
  });

  test('resizing into the narrow band auto-collapses one pane', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadPersona(page);
    const root = page.locator('#three-pane');
    await expect(root).not.toHaveClass(/right-collapsed/);

    await page.setViewportSize({ width: 1200, height: 800 });
    // matchMedia('change') fires asynchronously; poll briefly.
    await expect(root).toHaveClass(/right-collapsed/);
  });
});

// Phone layout — the locked-chrome model (body: 100svh + overflow:hidden)
// works on desktop/tablet because the topbar is a short strip. On a phone the
// wrapped persona / LFI / seed / language controls stack taller than the
// viewport, and with the body locked there was no way to scroll down to the
// persona library or payload: the site was unnavigable (iPhone Safari report).
// At phone breakpoints the body unlocks to normal document scrolling.
test.describe('phone layout — document scrolls so chrome cannot trap the panes', () => {
  test('iPhone portrait: body scrolls and the payload table is reachable', async ({ page }) => {
    // iPhone 14 portrait. Land directly on a table-rendering endpoint
    // (/accounts) — the wrapped topbar is ~360px tall here, so the table sits
    // well below the fold and is only reachable if the document scrolls.
    await page.setViewportSize({ width: 390, height: 664 });
    await loadPersona(page, { persona: 'salaried_expat_mid', endpoint: '/accounts' });

    // Locked-chrome is off on phones — the body is a normal scroll container.
    const bodyOverflowY = await page.evaluate(() => getComputedStyle(document.body).overflowY);
    expect(bodyOverflowY).toBe('visible');

    // The tall wrapped topbar pushes the payload below the fold; it must be
    // reachable by scrolling the document (the failure mode this guards).
    const table = page.locator('.payload-rendered table').first();
    await table.scrollIntoViewIfNeeded();
    await expect(table).toBeInViewport();

    // The persona library is also reachable.
    await expect(page.locator('.persona-card').first()).toBeVisible();
  });

  test('iPhone landscape: short viewport also unlocks document scroll', async ({ page }) => {
    // iPhone 14 landscape — wider than 760px but short, so the
    // short-landscape arm of the media query must still apply.
    await page.setViewportSize({ width: 844, height: 390 });
    await loadPersona(page, { persona: 'salaried_expat_mid', endpoint: '/accounts' });

    const bodyOverflowY = await page.evaluate(() => getComputedStyle(document.body).overflowY);
    expect(bodyOverflowY).toBe('visible');

    const table = page.locator('.payload-rendered table').first();
    await table.scrollIntoViewIfNeeded();
    await expect(table).toBeInViewport();
  });

  test('tablet/iPad landscape (1024×690) keeps the locked-chrome model', async ({ page }) => {
    // Regression boundary: the iPad guard viewport must NOT fall into the
    // phone window — its topbar fits, so the chrome stays pinned and the
    // document does not scroll (mirrors top-chrome.spec.mjs).
    await page.setViewportSize({ width: 1024, height: 690 });
    await loadPersona(page, { persona: 'salaried_expat_mid' });
    const bodyOverflowY = await page.evaluate(() => getComputedStyle(document.body).overflowY);
    expect(bodyOverflowY).toBe('hidden');
  });
});
