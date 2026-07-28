// @vitest-environment jsdom
//
// Arabic / RTL i18n foundation — D-10. Covers the pure helpers (numeral
// conversion, string lookup, locale normalisation) and the DOM-applying
// helpers (setDocumentLocale / translateChrome) under jsdom. The browser-level
// toggle wiring is exercised by app.js; this guards the module contracts it
// depends on.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('English and Arabic catalogs have identical key sets', () => {
    for (const locale of LOCALES) expect(STRINGS[locale]).toBeTruthy();
    const en = Object.keys(STRINGS.en).sort();
    const ar = Object.keys(STRINGS.ar).sort();
    expect(ar).toEqual(en);
  });
});

describe('data-i18n key coverage — the HTML ↔ catalog contract', () => {
  // Every data-i18n / data-i18n-attr key referenced in the app-shell HTML
  // must exist in STRINGS for BOTH locales — a missing key silently renders
  // the raw key (or stale English) with no other signal.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  function keysInHtml(relPath) {
    const html = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    const keys = new Set();
    let m;
    const textRe = /data-i18n="([^"]+)"/g;
    while ((m = textRe.exec(html))) keys.add(m[1]);
    const attrRe = /data-i18n-attr="([^"]+)"/g;
    while ((m = attrRe.exec(html))) {
      for (const pair of m[1].split(';')) {
        const [, key] = pair.split(':').map((s) => s && s.trim());
        if (key) keys.add(key);
      }
    }
    return [...keys];
  }

  it('every data-i18n key in src/index.html exists in STRINGS for both locales', () => {
    const keys = keysInHtml('src/index.html');
    expect(keys.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      const missing = keys.filter((k) => STRINGS[locale][k] === undefined);
      expect(missing, `keys missing from STRINGS.${locale}`).toEqual([]);
    }
  });

  it('the English catalog values match the literal HTML text (first-paint no-op contract)', () => {
    // Re-applying the 'en' locale must be a visual no-op (keeps the LTR
    // visual baselines valid): each element's data-i18n key must resolve to
    // exactly the text the HTML already carries.
    const html = fs.readFileSync(path.join(repoRoot, 'src/index.html'), 'utf8');
    const re = /data-i18n="([^"]+)"[^>]*>([^<]*)</g;
    let m;
    let checked = 0;
    while ((m = re.exec(html))) {
      const [, key, literal] = m;
      const trimmed = literal
        .replace(/\s+/g, ' ')
        .trim()
        // Decode the basic entities the static HTML uses.
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      if (!trimmed) continue; // element whose text is populated at runtime
      expect(STRINGS.en[key], `STRINGS.en['${key}'] vs literal HTML`).toBe(trimmed);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
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
