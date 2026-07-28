// C-A1 / C-A2 keyboard accessibility (EXP-23). axe-core can't catch these —
// a click-only div and a mouse-only sort pass every static rule — so this
// spec drives the two affordances with a real keyboard:
//   1. persona cards: Tab reaches a card's activation button, Enter switches
//      the active persona;
//   2. sortable transaction headers: Tab reaches a column header, Enter
//      toggles the sort and aria-sort reflects the new state.
//
// Console / pageerror catcher is provided globally by `_fixtures.mjs` — any
// console error fails the test.

import { test, expect, loadPersona } from './_fixtures.mjs';

// Press Tab until document.activeElement matches `selector` (evaluated in the
// page). Returns true when reached; false when maxTabs presses weren't enough.
async function tabUntilFocused(page, selector, maxTabs = 80) {
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press('Tab');
    const matched = await page.evaluate(
      (sel) => document.activeElement?.matches?.(sel) ?? false,
      selector,
    );
    if (matched) return true;
  }
  return false;
}

test('persona card is reachable by Tab and activates with Enter — C-A1', async ({ page }) => {
  await loadPersona(page);

  // Tab from the top of the page until focus lands on the activation button
  // of a card that is NOT already active.
  const reached = await tabUntilFocused(page, '.persona-card:not(.active) button.persona-name');
  expect(reached, 'Tab never reached an inactive persona card').toBe(true);

  const targetId = await page.evaluate(
    () => document.activeElement.closest('.persona-card')?.dataset.personaId,
  );
  expect(targetId).toBeTruthy();
  expect(targetId).not.toBe('salaried_expat_mid');

  await page.keyboard.press('Enter');

  // The activated card becomes the active persona (card highlight + topbar).
  await expect(page.locator(`.persona-card[data-persona-id="${targetId}"]`)).toHaveClass(/active/);
  await expect(page.locator('.persona-card.active')).toHaveCount(1);
});

test('transactions column header sorts via keyboard and reflects aria-sort — C-A2', async ({
  page,
}) => {
  await loadPersona(page, { endpoint: '/transactions' });

  const firstTh = page.locator('.payload-rendered th.sortable').first();
  await expect(firstTh).toBeVisible();
  // Headers are in the tab order.
  await expect(firstTh).toHaveAttribute('tabindex', '0');
  await expect(firstTh).toHaveAttribute('scope', 'col');
  // No column is sorted on first render.
  expect(await page.locator('.payload-rendered th[aria-sort]').count()).toBe(0);

  // Anchor focus in the filter bar (no re-render on focus), then Tab until a
  // sortable header receives focus.
  await page.locator('.tx-filter-bar [name="mcc"]').focus();
  const reached = await tabUntilFocused(page, '.payload-rendered th.sortable', 60);
  expect(reached, 'Tab never reached a sortable column header').toBe(true);

  const col = await page.evaluate(() => document.activeElement.dataset.col);
  expect(col).toBeTruthy();

  // Enter sorts ascending; the rebuilt header carries aria-sort and focus is
  // restored to the same column.
  await page.keyboard.press('Enter');
  const sortedTh = page.locator(`.payload-rendered th[data-col="${col}"]`);
  await expect(sortedTh).toHaveAttribute('aria-sort', 'ascending');
  expect(await page.evaluate(() => document.activeElement.dataset.col)).toBe(col);

  // Enter again flips to descending.
  await page.keyboard.press('Enter');
  await expect(sortedTh).toHaveAttribute('aria-sort', 'descending');

  // Only the sorted column carries aria-sort (ARIA authoring guidance).
  expect(await page.locator('.payload-rendered th[aria-sort]').count()).toBe(1);
});
