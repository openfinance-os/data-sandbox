// Phase R3 — MCC noise.
// Asserts:
//   1. Bounded rate — across a high-volume persona, roughly 5% of MCC-
//      bearing transactions carry a misrouted MCC (allowing wide
//      tolerance for binomial variance).
//   2. The wire `MerchantCategoryCode` only ever lands on a value the
//      confusion table declares as a plausible misrouting target for
//      the merchant's canonical MCC. Never an arbitrary code.
//   3. Sidecar `mcc` always carries the canonical (corrected) MCC —
//      this is the trustworthy taxonomy key, regardless of whether
//      the wire field was flipped.
//   4. When misrouted: `mccRaw` carries the wire value, `mccMisrouted`
//      is true, `mccMisroutingReason` is populated. When not:
//      `mccRaw` is null, `mccMisrouted` is false.
//   5. Determinism (EXP-05): same (persona, seed) → same misrouting
//      decisions across two builds, byte-identical. The side-channel
//      rng keyed on TransactionId is the mechanism — and the side
//      channel does NOT advance the main rng, so adding/tuning the
//      confusion table doesn't shift downstream transaction draws.
//   6. The corrected MCC drives taxonomy lookup — a petrol-station
//      misrouted to grocery (5411) still enriches as 'Transport / Fuel'
//      because `_trueMcc` (5541) wins the taxonomy lookup.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';
import { maybeMisrouteMcc, DEFAULT_MCC_NOISE_RATE } from '../src/generator/mcc-noise.js';

describe('Phase R3 MCC noise', () => {
  const personas = loadPersonasByDomain('banking');
  const pools = loadAllPools();

  it('confusion table is loaded as an indexed { correctMcc → [{wrong, reason}] } map', () => {
    expect(pools.mccConfusion).toBeTruthy();
    // Spot-check a known mapping from the YAML.
    expect(pools.mccConfusion['5541']).toBeTruthy();
    expect(pools.mccConfusion['5541'].some((e) => e.wrong === '5411')).toBe(true);
    expect(pools.mccConfusion['5541'].some((e) => e.reason)).toBe(true);
  });

  it('misrouting rate stays within bounds across a high-volume persona', () => {
    const bundle = buildBundle({
      persona: personas.hnw_multicurrency,
      lfi: 'median',
      seed: 1,
      pools,
    });
    const records = Object.values(bundle._enrichment).filter((r) => r.mcc);
    expect(records.length).toBeGreaterThan(1000);
    const misrouted = records.filter((r) => r.mccMisrouted);
    const rate = misrouted.length / records.length;
    // Target is 5%. Allow generous binomial tolerance (1.5% – 9%) for
    // sample variance on a ~2.4k draw.
    expect(rate, `actual misrouting rate ${rate.toFixed(4)}`).toBeGreaterThan(0.015);
    expect(rate, `actual misrouting rate ${rate.toFixed(4)}`).toBeLessThan(0.09);
  });

  it('every wire MCC is either the canonical or a plausible target from the confusion table', () => {
    const bundle = buildBundle({
      persona: personas.salaried_expat_mid,
      lfi: 'median',
      seed: 4729,
      pools,
    });
    for (const tx of bundle.transactions) {
      const wire = tx.MerchantDetails?.MerchantCategoryCode;
      const rec = bundle._enrichment[tx.TransactionId];
      if (!wire || !rec) continue;
      const correct = rec.mcc; // corrected ground-truth
      if (!rec.mccMisrouted) {
        // Unflipped — wire equals corrected.
        expect(wire).toBe(correct);
      } else {
        // Flipped — wire is one of the declared plausible targets.
        const entries = pools.mccConfusion[correct] ?? [];
        const targets = entries.map((e) => e.wrong);
        expect(
          targets,
          `tx ${tx.TransactionId} flipped to ${wire} for canonical ${correct}`,
        ).toContain(wire);
        expect(rec.mccRaw).toBe(wire);
        expect(rec.mccMisroutingReason, `tx ${tx.TransactionId} reason missing`).toBeTruthy();
      }
    }
  });

  it('sidecar mcc is always the corrected ground-truth (drives taxonomy)', () => {
    // Salaried Expat carries reliable fuel spend (band 400–700 AED/mo);
    // HNW doesn't draw from the fuel pool under its archetype defaults.
    // Rich LFI keeps MerchantName populated on every POS row so the
    // merchant-name filter resolves; the enrichment sidecar is LFI-
    // independent so the corrected-MCC check is the same under any
    // profile (we just need a profile that exposes MerchantName so the
    // test predicate can match by merchant).
    const bundle = buildBundle({
      persona: personas.salaried_expat_mid,
      lfi: 'rich',
      seed: 4729,
      pools,
    });
    // Filter to fuel-pool merchants (canonical 5541) and check that any
    // misrouted ones still enrich as Transport / Fuel.
    const fuelMerchants = new Set([
      'Beacon Fuel Co.',
      'Crestline Petroleum',
      'Northstar Energy Stations',
      'Ridgepoint Fuel',
    ]);
    const fuelTxs = bundle.transactions.filter((t) =>
      fuelMerchants.has(t.MerchantDetails?.MerchantName ?? ''),
    );
    expect(fuelTxs.length).toBeGreaterThan(0);
    for (const t of fuelTxs) {
      const rec = bundle._enrichment[t.TransactionId];
      expect(rec.mcc).toBe('5541');
      expect(rec.category).toBe('Transport');
      expect(rec.subcategory).toBe('Fuel');
    }
  });

  it('two builds with the same (persona, seed) produce byte-identical misrouting decisions (EXP-05)', () => {
    const a = buildBundle({ persona: personas.hnw_multicurrency, lfi: 'median', seed: 1, pools });
    const b = buildBundle({ persona: personas.hnw_multicurrency, lfi: 'median', seed: 1, pools });
    expect(JSON.stringify(a._enrichment)).toBe(JSON.stringify(b._enrichment));
  });

  it('maybeMisrouteMcc returns the canonical when the confusion table has no entry', () => {
    const r = maybeMisrouteMcc({
      correctMcc: '9999',
      transactionId: 'abc',
      confusionTable: pools.mccConfusion,
    });
    expect(r.mcc).toBe('9999');
    expect(r.misrouted).toBe(false);
  });

  it('maybeMisrouteMcc returns the canonical when confusion table is absent', () => {
    const r = maybeMisrouteMcc({
      correctMcc: '5541',
      transactionId: 'abc',
      confusionTable: null,
    });
    expect(r.mcc).toBe('5541');
    expect(r.misrouted).toBe(false);
  });

  it('default noise rate is 5%', () => {
    expect(DEFAULT_MCC_NOISE_RATE).toBe(0.05);
  });
});
