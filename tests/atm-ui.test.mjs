// Phase 2.3 — ATM Locator UX revision.
// Covers the three load-bearing pieces of the directory-browser UI without
// pulling in a full DOM: (a) the URL round-trip for `?atm=<ATMId>`,
// (b) the shared field-tree renderer (used by both insurance + ATM domains),
// (c) the ATM bundle shape feeding the picker / payload renderer.

import { describe, it, expect } from 'vitest';
import { decodeFromUrl, encodePermalink } from '../src/url.js';
import { renderFieldTree } from '../src/ui/field-tree.js';
import { buildAtmBundle } from '../src/generator/atm/index.js';
import { loadPersona } from '../tools/load-fixtures.mjs';

// Minimal `el` stub mirroring the signature used by src/app.js / src/ui/*.
// Builds a plain-object tree we can introspect without a real DOM.
function makeEl() {
  return function el(tag, opts = {}, ...children) {
    const node = {
      tag,
      class: opts.class ?? null,
      attrs: opts.attrs ?? {},
      text: opts.text ?? null,
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    };
    for (const c of children) if (c) node.children.push(c);
    return node;
  };
}

function walkText(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.text === 'string' && node.text.length > 0) out.push(node.text);
  for (const child of node.children ?? []) walkText(child, out);
  return out;
}

describe('ATM URL contract — Phase 2.3', () => {
  it('decodes ?domain=atm&atm=<ATMId> into a populated atmId', () => {
    const url =
      'http://localhost/?domain=atm&lfi=median&seed=47131&atm=LFI-ATM-MEDIAN-001-ATM-0007';
    const parsed = decodeFromUrl(url);
    expect(parsed.domain).toBe('atm');
    expect(parsed.atmId).toBe('LFI-ATM-MEDIAN-001-ATM-0007');
  });

  it('ignores the atm param outside the ATM domain', () => {
    const url = 'http://localhost/?domain=banking&atm=LFI-ATM-MEDIAN-001-ATM-0007';
    const parsed = decodeFromUrl(url);
    expect(parsed.domain).toBe('banking');
    expect(parsed.atmId).toBeNull();
  });

  it('accepts atm as a valid domain in encodePermalink', () => {
    const link = encodePermalink({
      slugBase: '/commons/sandbox',
      personaId: 'atm_directory',
      lfi: 'median',
      seed: 47131,
      domain: 'atm',
    });
    expect(link).toContain('domain=atm');
    expect(link).toContain('lfi=median');
    expect(link).toContain('seed=47131');
  });
});

describe('renderFieldTree — shared helper', () => {
  it('renders scalar values as a leaf with the value text', () => {
    const el = makeEl();
    const node = renderFieldTree('hello', new Map(), el);
    expect(node.tag).toBe('span');
    expect(node.class).toContain('value-leaf');
    expect(node.text).toBe('hello');
  });

  it('renders null / undefined as the em-dash placeholder', () => {
    const el = makeEl();
    expect(renderFieldTree(null, new Map(), el).text).toBe('—');
    expect(renderFieldTree(undefined, new Map(), el).text).toBe('—');
  });

  it('strips underscore-prefixed keys (generator-internal markers)', () => {
    const el = makeEl();
    const node = renderFieldTree({ Public: 'visible', _internal: 'hidden' }, new Map(), el);
    const texts = walkText(node);
    expect(texts).toContain('Public');
    expect(texts).toContain('visible');
    expect(texts).not.toContain('_internal');
    expect(texts).not.toContain('hidden');
  });

  it('attaches a status badge when the field name is in the meta map', () => {
    const el = makeEl();
    const fieldsByName = new Map([
      ['ATMId', { name: 'ATMId', status: 'mandatory', type: 'string' }],
    ]);
    const node = renderFieldTree({ ATMId: 'A-001' }, fieldsByName, el);
    const texts = walkText(node);
    // Status badge label 'M' for mandatory.
    expect(texts).toContain('M');
    expect(texts).toContain('ATMId');
    expect(texts).toContain('A-001');
  });

  it('recurses into arrays with [i] markers and nested objects', () => {
    const el = makeEl();
    const node = renderFieldTree({ Items: [{ Name: 'alpha' }, { Name: 'beta' }] }, new Map(), el);
    const texts = walkText(node);
    expect(texts).toContain('[0]');
    expect(texts).toContain('[1]');
    expect(texts).toContain('alpha');
    expect(texts).toContain('beta');
  });
});

describe('ATM bundle shape feeds the picker rail', () => {
  const persona = loadPersona('atm_directory');
  const now = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

  it('every ATM exposes the picker-rail fields (ATMId, district, town, Availability)', () => {
    const bundle = buildAtmBundle({ persona, lfi: 'rich', seed: 47131, now });
    expect(bundle.domain).toBe('atm');
    expect(Array.isArray(bundle.atms)).toBe(true);
    expect(bundle.atms.length).toBeGreaterThan(0);
    for (const atm of bundle.atms) {
      expect(typeof atm.ATMId).toBe('string');
      expect(typeof atm.Location?.PostalAddress?.DistrictName).toBe('string');
      expect(typeof atm.Location?.PostalAddress?.TownName).toBe('string');
      // Availability is band Common — present under Rich, may be absent
      // under Sparse. The picker tolerates missing Availability.
      if (atm.Availability) {
        expect(['Available', 'UnderMaintenance', 'Unavailable']).toContain(atm.Availability.Status);
      }
    }
  });

  it('Sparse profile shrinks the fleet relative to Rich (LFI redaction layering)', () => {
    const rich = buildAtmBundle({ persona, lfi: 'rich', seed: 47131, now });
    const sparse = buildAtmBundle({ persona, lfi: 'sparse', seed: 47131, now });
    expect(sparse.atms.length).toBeLessThan(rich.atms.length);
  });

  it('the same (lfi, seed) produces byte-identical ATMIds — replay determinism', () => {
    const a = buildAtmBundle({ persona, lfi: 'median', seed: 47131, now });
    const b = buildAtmBundle({ persona, lfi: 'median', seed: 47131, now });
    expect(a.atms.map((x) => x.ATMId)).toEqual(b.atms.map((x) => x.ATMId));
  });
});
