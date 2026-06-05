// D-10 — Arabic / RTL regression coverage.
//
// Guards the load-bearing pieces of the parallel-text UI: the locale toggle
// flips <html dir/lang> and translates the app-shell chrome, the Arabic
// persona content (name_ar) lazy-merges from dist/data.i18n.json rather than
// the eagerly-preloaded data.json (the EXP-24 perf split), and the numeral
// toggle switches digit systems independently of language.
import { test, expect, loadPersona } from './_fixtures.mjs';

// salaried_expat_mid (Sara) is a stable banking persona used across the e2e
// suite; it carries both name_ar and narrative_ar. Its Arabic given name is
// distinctive enough to assert against without colliding with chrome strings.
const PERSONA = 'salaried_expat_mid';
const EN_NAME = 'Sara';
const AR_NAME = 'سارة';

test.describe('Arabic / RTL (D-10)', () => {
  test('?lang=ar sets dir/lang, translates chrome, and renders the Arabic persona name', async ({
    page,
  }) => {
    await loadPersona(page, { persona: PERSONA, extraParams: { lang: 'ar' } });

    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar');

    // App-shell chrome is translated (the LFI control label).
    await expect(page.locator('[data-i18n="controls.lfi"]')).toHaveText('ملف المؤسسة المالية');

    // name_ar is split out of the eager data.json yet renders in the topbar —
    // proves the lazy overlay merged before first paint.
    await expect(page.locator('#topbar-persona-name')).toContainText(AR_NAME);
  });

  test('Arabic persona content is lazy — not in the eagerly-preloaded data.json', async ({
    page,
  }) => {
    await loadPersona(page);
    // data.json is preloaded on the critical path; it must NOT carry the
    // opt-in Arabic payload (keeps the default English Lighthouse path lean).
    const eager = await (await page.request.get('/dist/data.json')).text();
    expect(eager).not.toContain('name_ar');
    expect(eager).not.toContain('narrative_ar');
    // The overlay, fetched on demand, holds it.
    const overlay = await (await page.request.get('/dist/data.i18n.json')).json();
    expect(overlay.ar[PERSONA].name_ar).toContain(AR_NAME);
    expect(overlay.ar[PERSONA].narrative_ar).toBeTruthy();
  });

  test('runtime language toggle lazily localizes a previously-English persona', async ({
    page,
  }) => {
    await loadPersona(page, { persona: PERSONA });
    await expect(page.locator('#topbar-persona-name')).toContainText(EN_NAME);

    // Switch to Arabic via the topbar toggle → dir flips, overlay lazy-merges,
    // persona name re-renders localized.
    await page.locator('#lang-seg button[data-lang="ar"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#topbar-persona-name')).toContainText(AR_NAME);
  });

  test('numeral toggle switches digit systems independently of language', async ({ page }) => {
    await loadPersona(page, { persona: PERSONA, extraParams: { lang: 'ar' } });

    const arab = page.locator('#numeral-seg button[data-numerals="arab"]');
    const latn = page.locator('#numeral-seg button[data-numerals="latn"]');
    // Arabic UI defaults to Arabic-Indic numerals (independent toggle, D-10).
    await expect(arab).toHaveAttribute('aria-checked', 'true');

    // Flip to Western digits — language stays Arabic, only the numeral system changes.
    await latn.click();
    await expect(latn).toHaveAttribute('aria-checked', 'true');
    await expect(arab).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
