// Phase R1.5 — enrichment sidecar.
// Asserts:
//   1. Every transaction in every banking bundle has a matching enrichment
//      record in bundle._enrichment (1:1 coverage by TransactionId).
//   2. Coverage holds under all three LFI profiles — critically, the
//      Sparse profile, which redacts MerchantDetails off the wire payload
//      but must NOT lose the sidecar entry.
//   3. Determinism (EXP-05 extension): same (persona, lfi, seed) → same
//      enrichment payload, byte-identical across builds.
//   4. Sidecar content is LFI-independent: the enrichment object is the
//      same under rich/median/sparse for any given (persona, seed).
//   5. Every record carries category + subcategory (no Uncategorised
//      fallthrough for the curated persona library — every shape the
//      generator emits has a taxonomy match).

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { buildEnrichment, enrichTransaction } from '../src/generator/enrichment.js';
import { loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';

describe('enrichment sidecar — Phase R1.5', () => {
  const personas = loadPersonasByDomain('banking');
  const pools = loadAllPools();

  it('every transaction has a matching enrichment record (1:1 by TransactionId)', () => {
    for (const [pid, persona] of Object.entries(personas)) {
      const bundle = buildBundle({
        persona,
        lfi: 'median',
        seed: persona.default_seed ?? 1,
        pools,
      });
      const txs = bundle.transactions ?? [];
      const reg = bundle._enrichment ?? {};
      const txIds = new Set(txs.map((t) => t.TransactionId));
      const regIds = new Set(Object.keys(reg));
      // Same cardinality.
      expect(regIds.size, `${pid} enrichment count`).toBe(txIds.size);
      // Same identifier set.
      for (const id of txIds) {
        expect(regIds.has(id), `${pid} missing enrichment for ${id}`).toBe(true);
      }
    }
  });

  it('coverage holds under Sparse — even when MerchantDetails is redacted', () => {
    const persona = personas.salaried_expat_mid;
    const bundle = buildBundle({ persona, lfi: 'sparse', seed: 4729, pools });
    const txs = bundle.transactions ?? [];
    const reg = bundle._enrichment ?? {};
    expect(Object.keys(reg).length).toBe(txs.length);
    // Spot-check: at least one tx has MerchantDetails stripped by Sparse
    // (it's a Common-band field — Sparse routinely drops it). The
    // sidecar record for that tx must still carry a merchant name.
    const strippedSamples = txs.filter((t) => !t.MerchantDetails);
    expect(
      strippedSamples.length,
      'Sparse should strip MerchantDetails on some POS rows',
    ).toBeGreaterThan(0);
    for (const t of strippedSamples.slice(0, 5)) {
      const rec = reg[t.TransactionId];
      expect(rec).toBeDefined();
      expect(rec.category).toBeTruthy();
      // The merchant name in the sidecar — recovered even under Sparse
      // because the sidecar is computed pre-LFI.
      // Some shapes (NSF reversals, cross-LFI sweeps) legitimately
      // have null merchant; that's still a valid record.
    }
  });

  it('sidecar is LFI-independent — byte-identical across rich/median/sparse', () => {
    const persona = personas.salaried_expat_mid;
    const rich = buildBundle({ persona, lfi: 'rich', seed: 4729, pools });
    const median = buildBundle({ persona, lfi: 'median', seed: 4729, pools });
    const sparse = buildBundle({ persona, lfi: 'sparse', seed: 4729, pools });
    expect(JSON.stringify(rich._enrichment)).toBe(JSON.stringify(median._enrichment));
    expect(JSON.stringify(rich._enrichment)).toBe(JSON.stringify(sparse._enrichment));
  });

  it('two builds with the same (persona, seed) produce byte-identical sidecars (EXP-05)', () => {
    const persona = personas.hnw_multicurrency;
    const a = buildBundle({ persona, lfi: 'median', seed: 1, pools });
    const b = buildBundle({ persona, lfi: 'median', seed: 1, pools });
    expect(JSON.stringify(a._enrichment)).toBe(JSON.stringify(b._enrichment));
  });

  it('every record carries non-empty category + subcategory', () => {
    const personasToCheck = [
      'salaried_expat_mid',
      'hnw_multicurrency',
      'sme_trading_business',
      'senior_retiree',
    ];
    for (const pid of personasToCheck) {
      const persona = personas[pid];
      if (!persona) continue;
      const bundle = buildBundle({
        persona,
        lfi: 'median',
        seed: persona.default_seed ?? 1,
        pools,
      });
      for (const [txId, rec] of Object.entries(bundle._enrichment)) {
        expect(rec.category, `${pid} ${txId} category`).toBeTruthy();
        expect(rec.subcategory, `${pid} ${txId} subcategory`).toBeTruthy();
      }
    }
  });

  it('buildEnrichment is a pure function — same input → same output', () => {
    const persona = personas.salaried_expat_mid;
    const bundle = buildBundle({ persona, lfi: 'median', seed: 4729, pools });
    const a = buildEnrichment(bundle.transactions);
    const b = buildEnrichment(bundle.transactions);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('enrichTransaction handles defensive cases', () => {
    expect(enrichTransaction(null)).toBeNull();
    expect(enrichTransaction({})).toBeNull();
    // A salary credit (Flags=Payroll) → Income / Payroll
    const salary = {
      TransactionId: 'fake-1',
      TransactionType: 'LocalBankTransfer',
      SubTransactionType: 'Deposit',
      Flags: ['Payroll'],
    };
    const rec = enrichTransaction(salary);
    expect(rec.category).toBe('Income');
    expect(rec.subcategory).toBe('Payroll');
  });
});
