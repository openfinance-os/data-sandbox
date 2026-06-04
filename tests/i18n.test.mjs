// @vitest-environment jsdom
//
// Arabic / RTL i18n foundation — D-10. Covers the pure helpers (numeral
// conversion, string lookup, locale normalisation) and the DOM-applying
// helpers (setDocumentLocale / translateChrome) under jsdom. The browser-level
// toggle wiring is exercised by app.js; this guards the module contracts it
// depends on.

import { describe, it, expect, afterEach } from 'vitest';
import {
  LOCALES,
  STRINGS,
  t,
  toArabicIndic,
  localizeDigits,
  setNumeralMode,
  getNumeralMode,
  normalizeLocale,
  directionFor,
  translateChrome,
  setDocumentLocale,
} from '../src/shared/i18n.js';

afterEach(() => {
  // Numeral mode is module-level; reset so cases don't bleed into each other.
  setNumeralMode('latn');
});

describe('numeral conversion', () => {
  it('maps every Western digit to its Arabic-Indic counterpart', () => {
    expect(toArabicIndic('0123456789')).toBe('٠١٢٣٤٥٦٧٨٩');
  });

  it('leaves non-digit characters untouched', () => {
    expect(toArabicIndic('AED 1,250.00')).toBe('AED ١,٢٥٠.٠٠');
  });

  it('localizeDigits is identity in latn mode and converts in arab mode', () => {
    setNumeralMode('latn');
    expect(getNumeralMode()).toBe('latn');
    expect(localizeDigits('25,000')).toBe('25,000');
    setNumeralMode('arab');
    expect(getNumeralMode()).toBe('arab');
    expect(localizeDigits('25,000')).toBe('٢٥,٠٠٠');
  });

  it('setNumeralMode coerces anything other than "arab" to "latn"', () => {
    setNumeralMode('nonsense');
    expect(getNumeralMode()).toBe('latn');
  });
});

describe('locale normalisation + direction', () => {
  it('keeps supported locales and falls back to English', () => {
    expect(normalizeLocale('ar')).toBe('ar');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('fr')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
  });

  it('maps language to writing direction', () => {
    expect(directionFor('ar')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
    expect(directionFor('xx')).toBe('ltr');
  });
});

describe('string catalog', () => {
  it('looks up Arabic strings and falls back to English then the key', () => {
    expect(t('lfi.rich', 'ar')).toBe('وفير');
    expect(t('lfi.rich', 'en')).toBe('Rich');
    // Unknown locale → English value.
    expect(t('lfi.rich', 'fr')).toBe('Rich');
    // Unknown key → the key itself.
    expect(t('does.not.exist', 'ar')).toBe('does.not.exist');
  });

  it('localises the EXP-13 field-status values', () => {
    expect(t('status.mandatory', 'en')).toBe('Mandatory');
    expect(t('status.mandatory', 'ar')).toBe('إلزامي');
    expect(t('status.optional', 'ar')).toBe('اختياري');
    expect(t('status.conditional', 'ar')).toBe('شرطي');
  });

  it('localises the find-box + tx-filter module chrome', () => {
    expect(t('find.searches', 'ar')).toBe('نطاق البحث');
    expect(t('find.noMatches', 'ar')).toBe('لا توجد نتائج.');
    expect(t('find.corpus.personas', 'ar')).toBe('الشخصيات');
    expect(t('txFilter.clear', 'ar')).toBe('مسح عوامل التصفية');
    // English values are unchanged so first paint stays identical.
    expect(t('find.searches', 'en')).toBe('Searches');
  });

  it('localises the export popover chrome + interpolated templates', () => {
    expect(t('export.title', 'ar')).toBe('تصدير');
    expect(t('export.copy', 'ar')).toBe('نسخ');
    // The copied toast template carries a {label} placeholder, not a literal.
    expect(t('export.copiedTpl', 'ar')).toContain('{label}');
    expect(t('export.copiedTpl', 'en').replace('{label}', 'Permalink')).toBe('Permalink copied.');
    // The tarball note carries all three context placeholders.
    for (const tok of ['{persona}', '{lfi}', '{seed}']) {
      expect(t('export.tarballNote', 'ar')).toContain(tok);
    }
    // Format proper-nouns are not in the catalog (stay English literals).
    expect(t('export.tab.json', 'ar')).toBe('export.tab.json');
  });

  it('localises the field-card facet labels + authored value prose', () => {
    expect(t('fc.name', 'ar')).toBe('الاسم');
    expect(t('fc.feedback', 'ar')).toBe('ملاحظات');
    expect(t('fc.reportLink', 'ar')).toContain('←');
    expect(t('fc.piiNo', 'ar')).toContain('PII');
    // English values are unchanged so first paint stays identical.
    expect(t('fc.name', 'en')).toBe('Name');
    expect(t('fc.reportLink', 'en')).toBe('Report an issue with this field →');
  });

  it('localises the guided-tour chrome, titles, and bodies', () => {
    expect(t('tour.skip', 'ar')).toBe('تخطّي');
    expect(t('tour.next', 'ar')).toContain('←'); // RTL arrow flipped
    expect(t('tour.s1.title', 'ar')).toBe('تعرّف على سارة');
    // Step-counter template carries both placeholders.
    expect(t('tour.stepOf', 'ar')).toContain('{n}');
    expect(t('tour.stepOf', 'en').replace('{n}', '2').replace('{total}', '5')).toBe('Step 2 of 5');
    // Technical tokens survive inside the translated body prose.
    expect(t('tour.s2.body', 'ar')).toContain('Flags=Payroll');
    expect(t('tour.s5.body', 'ar')).toContain('MerchantDetails');
    // English unchanged so first paint stays identical.
    expect(t('tour.s1.title', 'en')).toBe('Meet Sara');
  });

  it('English and Arabic catalogs have identical key sets', () => {
    for (const locale of LOCALES) expect(STRINGS[locale]).toBeTruthy();
    const en = Object.keys(STRINGS.en).sort();
    const ar = Object.keys(STRINGS.ar).sort();
    expect(ar).toEqual(en);
  });
});

describe('DOM application', () => {
  it('translateChrome swaps [data-i18n] text and [data-i18n-attr] attributes', () => {
    document.body.innerHTML = `
      <span data-i18n="controls.seed">Seed</span>
      <button data-i18n-attr="title:topbar.find">Find</button>`;
    translateChrome(document, 'ar');
    expect(document.querySelector('[data-i18n]').textContent).toBe(STRINGS.ar['controls.seed']);
    expect(document.querySelector('[data-i18n-attr]').getAttribute('title')).toBe(
      STRINGS.ar['topbar.find'],
    );
  });

  it('setDocumentLocale sets <html lang/dir> + numeral mode and translates', () => {
    document.body.innerHTML = `<span data-i18n="pane.fieldDetail">Field detail</span>`;
    const resolved = setDocumentLocale(document, { lang: 'ar', numerals: 'arab' });
    expect(resolved).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(getNumeralMode()).toBe('arab');
    expect(document.querySelector('[data-i18n]').textContent).toBe(STRINGS.ar['pane.fieldDetail']);
  });

  it('skipChromeWhenDefault leaves the literal English HTML untouched on first paint', () => {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    // Intentionally-stale text the English catalog would overwrite if it ran.
    document.body.innerHTML = `<span data-i18n="controls.seed">ORIGINAL</span>`;
    setDocumentLocale(document, { lang: 'en', numerals: 'latn', skipChromeWhenDefault: true });
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.querySelector('[data-i18n]').textContent).toBe('ORIGINAL');
  });
});
