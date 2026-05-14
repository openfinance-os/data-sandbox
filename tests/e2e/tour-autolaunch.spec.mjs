// PR #2 — tour auto-launch + button demotion.
//
// On a cold landing (URL with no query params) the 5-step tour overlay
// auto-launches. On Finish / Skip / click-outside, the Tour button demotes
// to a small ⓘ icon for the rest of the session. URL-with-params is
// treated as a returning visitor — no auto-launch, button starts demoted.
//
// State is JS-only per EXP-22 — a refresh re-arms the cold-landing path
// by design (the existing smoke test "identity posture" verifies
// Object.keys(localStorage).toEqual([]) after a load, which this PR
// preserves).

import { test, expect } from './_fixtures.mjs';

test.describe('tour auto-launch (PR #2)', () => {
  test('cold landing auto-opens the tour overlay', async ({ page }) => {
    await page.goto('/src/index.html');
    // Tour overlay appears without any user click. Use a timed expect so
    // we tolerate the rebuildAndRender → startTour latency.
    await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#tour-overlay .tour-step-num')).toContainText('Step 1 of 5');
  });

  test('clicking Skip demotes the Tour button to the ⓘ icon', async ({ page }) => {
    await page.goto('/src/index.html');
    await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: 5000 });
    await page.locator('#tour-overlay .tour-skip').click();
    await expect(page.locator('#tour-overlay')).toHaveCount(0);
    const btn = page.locator('#tour-btn');
    await expect(btn).toHaveClass(/topbar-btn-icon/);
    await expect(btn).toHaveText('ⓘ');
    // aria-label still describes the action for screen readers.
    await expect(btn).toHaveAttribute('aria-label', /tour/i);
  });

  test('completing all 5 steps demotes the Tour button', async ({ page }) => {
    await page.goto('/src/index.html');
    await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: 5000 });
    for (let i = 0; i < 4; i++) {
      await page.locator('#tour-overlay .tour-primary').click();
    }
    await expect(page.locator('#tour-overlay .tour-primary')).toHaveText('Finish');
    await page.locator('#tour-overlay .tour-primary').click();
    await expect(page.locator('#tour-overlay')).toHaveCount(0);
    await expect(page.locator('#tour-btn')).toHaveClass(/topbar-btn-icon/);
  });

  test('URL with query params skips auto-launch and demotes by default', async ({ page }) => {
    await page.goto('/src/index.html?persona=salaried_expat_mid&lfi=median&seed=4729');
    await page.waitForFunction(
      () => document.getElementById('coverage-pct')?.textContent !== '—',
    );
    // No overlay — returning visitor flow.
    await expect(page.locator('#tour-overlay')).toHaveCount(0);
    // Button starts demoted.
    await expect(page.locator('#tour-btn')).toHaveClass(/topbar-btn-icon/);
    // Demoted button is still clickable — replays the tour on demand.
    await page.locator('#tour-btn').click();
    await expect(page.locator('#tour-overlay')).toBeVisible();
  });

  test('refresh on cold landing re-arms the auto-launch (EXP-22)', async ({ page }) => {
    await page.goto('/src/index.html');
    await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: 5000 });
    await page.locator('#tour-overlay .tour-skip').click();
    await expect(page.locator('#tour-overlay')).toHaveCount(0);
    // Refresh — JS-only state resets, EXP-22 forbids storage persistence,
    // and the URL is still empty, so cold landing re-fires.
    await page.reload();
    await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: 5000 });
    // localStorage / sessionStorage must remain empty.
    const ls = await page.evaluate(() => Object.keys(window.localStorage));
    const ss = await page.evaluate(() => Object.keys(window.sessionStorage));
    expect(ls).toEqual([]);
    expect(ss).toEqual([]);
  });
});
