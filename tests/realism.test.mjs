// Phase R2 — narrative-dirtying grammar.
// Asserts:
//   1. The narrative cap lifted from 22 → 80 chars but stays well under
//      the v2.1 TransactionInformation 500-char ceiling.
//   2. The dirty composer keeps the canonical merchant token as a
//      substring so the existing cross-link / search substring-match
//      logic (app.js:1791-1811) continues to function.
//   3. Determinism: same rng + merchant + registry → byte-identical
//      narrative across two calls.
//   4. Probability gates respect the rng — when rng() returns 1.0
//      (well above any threshold) no helper fires, when 0.0 every
//      helper fires.
//   5. The family-group acronym appears as the leading segment when
//      `parent_group` is declared and rng draws into the prob window.
//   6. DBA-drift swaps the canonical token for a declared variant
//      when triggered.
//   7. Generated bundle narratives all validate against the v2.1
//      TransactionInformation constraint (string, 1-500).

import { describe, it, expect } from 'vitest';
import {
  bankishNarrative,
  buildDirtyPosNarrative,
  aggregatorPrefix,
  terminalSuffix,
  emirateCode,
  dbaDrift,
  parentGroupPrefix,
  fxClutter,
  arabicDescriptor,
} from '../src/generator/realism.js';
import { buildBundle } from '../src/generator/index.js';
import { loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';

const fakeRegistry = {
  falcon_holdings: { id: 'falcon_holdings', name: 'Falcon Holdings Group', acronym: 'FHG' },
};
const fakeMerchant = {
  name: 'Marketmark Hypermarket',
  parent_group: 'falcon_holdings',
  display_variants: ['MMARK HYPRMKT'],
  display_variants_ar: ['SOUQ AL FALCON'],
};

// A deterministic rng that returns a sequence of fixed values — cycles
// through `values` so each rng() call returns the next entry.
function fixedRng(values) {
  let i = 0;
  return () => values[(i++) % values.length];
}

describe('Phase R2 narrative-dirtying grammar', () => {
  it('bankishNarrative cap is now 80 chars and TransactionInformation stays spec-valid', () => {
    const out = bankishNarrative('POS', ['VERY VERY VERY LONG MERCHANT TOKEN THAT EXCEEDS THE OLD 22 CHAR CAP', 'DXB']);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.length).toBeGreaterThan(22);
    // Still well under the v2.1 TransactionInformation 500-char ceiling.
    expect(out.length).toBeLessThan(500);
  });

  it('bankishNarrative preserves * (aggregator marker), / (segment delimiter), and . (FX amount decimal)', () => {
    // The pre-R2 regex stripped * and . — both are load-bearing.
    const out = bankishNarrative('POS', ['TST*MARKETMARK', 'USD 5.50', 'DXB']);
    expect(out).toContain('TST*');
    expect(out).toContain('5.50');
  });

  it('aggregatorPrefix returns "" outside the prob window and a deck entry inside it', () => {
    expect(aggregatorPrefix(fixedRng([0.99]), 'pos', 0.25)).toBe('');
    const inside = aggregatorPrefix(fixedRng([0.0]), 'pos', 0.25);
    expect(inside).toMatch(/\*$|\*\s*$/);
  });

  it('terminalSuffix returns a digit string of length 4-7 when triggered', () => {
    expect(terminalSuffix(fixedRng([0.99]), 0.5)).toBe('');
    const id = terminalSuffix(fixedRng([0.0, 0.5, 0.5, 0.5]), 0.5);
    expect(id).toMatch(/^\d{4,7}$/);
  });

  it('emirateCode draws from the population-weighted UAE-emirate set', () => {
    const set = new Set();
    const rng = (() => { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })();
    for (let i = 0; i < 200; i++) set.add(emirateCode(rng));
    expect(set.has('DXB')).toBe(true);
    expect(set.has('AUH')).toBe(true);
    // 5 of 7 emirates should turn up across 200 draws.
    expect(set.size).toBeGreaterThanOrEqual(5);
  });

  it('dbaDrift returns the canonical fallback outside the prob window', () => {
    const out = dbaDrift(fakeMerchant, fixedRng([0.99]), 'MARKETMARK HYPERMARKET');
    expect(out).toBe('MARKETMARK HYPERMARKET');
  });

  it('dbaDrift returns a normalised variant inside the prob window', () => {
    const out = dbaDrift(fakeMerchant, fixedRng([0.0]), 'MARKETMARK HYPERMARKET', 0.3);
    expect(out).toBe('MMARK HYPRMKT');
  });

  it('parentGroupPrefix returns "" without registry, group, or in-prob-window draw', () => {
    expect(parentGroupPrefix(fakeMerchant, null, fixedRng([0.0]))).toBe('');
    expect(parentGroupPrefix({ name: 'X' }, fakeRegistry, fixedRng([0.0]))).toBe('');
    expect(parentGroupPrefix(fakeMerchant, fakeRegistry, fixedRng([0.99]))).toBe('');
    expect(parentGroupPrefix(fakeMerchant, fakeRegistry, fixedRng([0.0]), 0.25)).toBe('FHG/');
  });

  it('fxClutter produces "<CCY> <amt> <country>" inside the prob window', () => {
    expect(fxClutter('USD', 100, fixedRng([0.99]), 0.7)).toBe('');
    expect(fxClutter('USD', 100, fixedRng([0.0]), 0.7)).toBe('USD 100.00 US');
    expect(fxClutter('GBP', 4.2, fixedRng([0.0]), 0.7)).toBe('GBP 4.20 LDN');
  });

  it('arabicDescriptor returns "" when the merchant has no Arabic variants', () => {
    expect(arabicDescriptor({ name: 'X' }, fixedRng([0.0]), 1.0)).toBe('');
    const ar = arabicDescriptor(fakeMerchant, fixedRng([0.0]), 1.0);
    expect(ar).toBe('SOUQ AL FALCON');
  });

  it('buildDirtyPosNarrative keeps the merchant token as a substring (cross-link safety)', () => {
    const rng = (() => { let s = 7; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })();
    for (let i = 0; i < 50; i++) {
      const out = buildDirtyPosNarrative({
        rng, channel: 'pos', prefix: 'POS', merchant: fakeMerchant, registry: fakeRegistry,
      });
      // Canonical token OR one of the declared display_variants must
      // appear as a substring — never both replaced and absent.
      const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      const haystack = norm(out);
      const candidates = [
        norm('MARKETMARK HYPERMARKET'),
        norm('MMARK HYPRMKT'),
        norm('SOUQ AL FALCON'),
      ];
      const present = candidates.some((c) => haystack.includes(c));
      expect(present, `iter ${i}: ${out}`).toBe(true);
    }
  });

  it('buildDirtyPosNarrative is deterministic on the passed rng', () => {
    const r1 = (() => { let s = 11; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })();
    const r2 = (() => { let s = 11; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })();
    const a = buildDirtyPosNarrative({ rng: r1, channel: 'pos', prefix: 'POS', merchant: fakeMerchant, registry: fakeRegistry });
    const b = buildDirtyPosNarrative({ rng: r2, channel: 'pos', prefix: 'POS', merchant: fakeMerchant, registry: fakeRegistry });
    expect(a).toBe(b);
  });

  it('every generated bundle narrative stays inside the v2.1 TransactionInformation 1-500 bound', () => {
    const personas = loadPersonasByDomain('banking');
    const pools = loadAllPools();
    // Spot-check on the volume-heavy personas (HNW, salaried expat,
    // distressed) — if these stay inside the bound, the lower-volume
    // ones inherit the same realism module so they're safe.
    for (const pid of ['hnw_multicurrency', 'salaried_expat_mid', 'nsf_distressed']) {
      const bundle = buildBundle({ persona: personas[pid], lfi: 'median', seed: 1, pools });
      for (const tx of bundle.transactions) {
        const info = tx.TransactionInformation;
        expect(typeof info, `${pid} ${tx.TransactionId} info type`).toBe('string');
        expect(info.length, `${pid} ${tx.TransactionId} info empty`).toBeGreaterThan(0);
        expect(info.length, `${pid} ${tx.TransactionId} info > 500`).toBeLessThanOrEqual(500);
      }
    }
  });

  it('enrichment sidecar surfaces parentGroup + parentGroupAcronym for parent-grouped merchants', () => {
    const personas = loadPersonasByDomain('banking');
    const pools = loadAllPools();
    const bundle = buildBundle({ persona: personas.salaried_expat_mid, lfi: 'median', seed: 4729, pools });
    // At least one POS tx must have a parent-grouped enrichment record
    // (groceries / dining / ride-hailing / fuel all carry parent_group
    // attributions on some merchants).
    const grouped = Object.values(bundle._enrichment).filter((r) => r.parentGroup);
    expect(grouped.length).toBeGreaterThan(0);
    for (const r of grouped.slice(0, 5)) {
      expect(r.parentGroupAcronym).toBeTruthy();
      expect(r.parentGroupAcronym.length).toBeLessThanOrEqual(5);
    }
  });
});
