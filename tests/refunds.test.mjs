// Phase R5 — refund / reversal transaction shapes.
//
// Asserts:
//   1. A persona that opts in (`enable_refunds: true`) actually emits
//      refund / reversal transactions, paired to original purchases.
//   2. The opt-in default off: every other curated persona produces a
//      bundle with zero refund records. Without that guarantee, R5
//      would have leaked into snapshots / underwriting maths.
//   3. Each refund passes basic shape checks:
//        - CreditDebitIndicator='Credit'
//        - SubTransactionType ∈ { 'Refund', 'Reversal' } (spec enum)
//        - Booked status
//        - MerchantDetails matches the original
//        - TransactionInformation starts with 'RFD/' or 'REV/'
//        - Refund-side amount ≤ original amount
//        - BookingDateTime is strictly after the original's
//   4. Determinism (EXP-05): same (persona, lfi, seed) → byte-identical
//      refund records across two builds.
//   5. Side-channel rng invariant: toggling `enable_refunds` only ADDS
//      records — every non-refund tx stays byte-identical across the
//      two runs. This is the headline EXP-05 guarantee for the opt-in.
//   6. The enrichment sidecar carries `refundOf` + `refundKind` for
//      every credit half, and they're null on the original.
//   7. The pairing is recoverable: every refund's `refundOf` resolves
//      to a real original TransactionId in the same bundle.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { loadPersona, loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';

const REFUND_SUBTYPES = new Set(['Refund', 'Reversal']);

// Discriminate R5 refunds from the pre-existing NSF `Reversal` shape:
// R5 emits paired credits whose `TransactionId` ends in `-rfd` (the
// convention in `src/generator/refunds.js`). NSF reversals reuse the
// `Reversal` enum value but ride the BillPayments rail with no `-rfd`
// suffix. The pair lookup `findRefunds()` below is the canonical filter.
function findR5Refunds(bundle) {
  return bundle.transactions.filter(
    (t) => REFUND_SUBTYPES.has(t.SubTransactionType) && t.TransactionId.endsWith('-rfd'),
  );
}

describe('refunds — Phase R5', () => {
  const pools = loadAllPools();

  it('an opted-in persona emits refund / reversal pairs', () => {
    const persona = loadPersona('sme_ecommerce_marketplace');
    expect(persona.enable_refunds, 'fixture persona must declare enable_refunds').toBe(true);
    const bundle = buildBundle({ persona, lfi: 'rich', seed: persona.default_seed, pools });
    const refunds = findR5Refunds(bundle);
    expect(refunds.length, 'expected at least one R5 refund/reversal').toBeGreaterThan(0);
    // Mix should include both Refund and Reversal across a 24-month bundle
    // at 3% rate with ~70/30 split — at least the Refund half lands.
    const refundCount = refunds.filter((t) => t.SubTransactionType === 'Refund').length;
    expect(refundCount).toBeGreaterThan(0);
  });

  it('every refund passes shape checks (Rich profile keeps MerchantDetails)', () => {
    const persona = loadPersona('sme_ecommerce_marketplace');
    // Rich profile keeps every optional field, so MerchantDetails.MerchantName
    // survives the LFI filter and we can assert the original→refund merchant
    // match end-to-end on the wire. Under Median/Sparse the merchant cue
    // lives only in the narrative + enrichment sidecar.
    const bundle = buildBundle({ persona, lfi: 'rich', seed: persona.default_seed, pools });
    const txById = new Map(bundle.transactions.map((t) => [t.TransactionId, t]));
    const refunds = findR5Refunds(bundle);
    for (const r of refunds) {
      expect(r.CreditDebitIndicator, `${r.TransactionId} cd indicator`).toBe('Credit');
      expect(REFUND_SUBTYPES.has(r.SubTransactionType)).toBe(true);
      expect(r.Status).toBe('Booked');
      expect(r.MerchantDetails?.MerchantName, `${r.TransactionId} merchant name`).toBeTruthy();
      const tag = r.SubTransactionType === 'Reversal' ? 'REV/' : 'RFD/';
      expect(r.TransactionInformation.startsWith(tag)).toBe(true);
      // Spec ceiling on TransactionInformation is 500 chars.
      expect(r.TransactionInformation.length).toBeLessThanOrEqual(500);
      expect(['POS', 'ECommerce']).toContain(r.TransactionType);

      // refundOf-style id link — convention is `${origId}-rfd`.
      expect(r.TransactionId.endsWith('-rfd')).toBe(true);
      const origId = r.TransactionId.slice(0, -'-rfd'.length);
      const orig = txById.get(origId);
      expect(orig, `${r.TransactionId} originating purchase missing`).toBeTruthy();
      expect(orig.MerchantDetails?.MerchantName).toBe(r.MerchantDetails.MerchantName);
      expect(orig.CreditDebitIndicator).toBe('Debit');

      // Refund-side amount ≤ original amount.
      expect(Number(r.Amount.Amount)).toBeLessThanOrEqual(Number(orig.Amount.Amount) + 1e-6);

      // Refund posts AFTER the original.
      expect(r.BookingDateTime > orig.BookingDateTime).toBe(true);
    }
  });

  it('non-opted-in personas emit zero refund records', () => {
    const personas = loadPersonasByDomain('banking');
    for (const [pid, p] of Object.entries(personas)) {
      if (p.enable_refunds) continue;
      const bundle = buildBundle({ persona: p, lfi: 'median', seed: p.default_seed ?? 1, pools });
      const refunds = bundle.transactions.filter((t) => REFUND_SUBTYPES.has(t.SubTransactionType));
      // NSF cores emit a Reversal SubTransactionType on the rejected
      // direct debit half (existing behaviour); those carry
      // TransactionType=BillPayments. Filter to the new R5 shape only.
      const r5 = refunds.filter(
        (t) => t.TransactionType === 'POS' || t.TransactionType === 'ECommerce',
      );
      expect(r5.length, `${pid} unexpectedly emitted R5 refunds`).toBe(0);
    }
  });

  it('determinism (EXP-05): same (persona, seed) → byte-identical refunds', () => {
    const persona = loadPersona('sme_ecommerce_marketplace');
    const a = buildBundle({ persona, lfi: 'median', seed: persona.default_seed, pools });
    const b = buildBundle({ persona, lfi: 'median', seed: persona.default_seed, pools });
    const refundsA = findR5Refunds(a);
    const refundsB = findR5Refunds(b);
    expect(JSON.stringify(refundsA)).toBe(JSON.stringify(refundsB));
  });

  it('toggling enable_refunds only ADDS records — every non-refund tx stays byte-identical', () => {
    // Side-channel rng invariant: refund decisions key on TransactionId
    // and don't advance the main generator rng, so flipping the flag
    // can only add new records, never reshape existing ones.
    const persona = loadPersona('sme_ecommerce_marketplace');
    const withRefunds = buildBundle({ persona, lfi: 'median', seed: persona.default_seed, pools });
    const withoutRefunds = buildBundle({
      persona: { ...persona, enable_refunds: false },
      lfi: 'median',
      seed: persona.default_seed,
      pools,
    });
    const r5Ids = new Set(findR5Refunds(withRefunds).map((t) => t.TransactionId));
    const nonR5A = withRefunds.transactions.filter((t) => !r5Ids.has(t.TransactionId));
    const nonR5B = withoutRefunds.transactions;
    expect(nonR5A.length).toBe(nonR5B.length);
    expect(JSON.stringify(nonR5A)).toBe(JSON.stringify(nonR5B));
    expect(withRefunds.transactions.length).toBeGreaterThan(withoutRefunds.transactions.length);
  });

  it('enrichment sidecar exposes refundOf + refundKind on the credit half', () => {
    const persona = loadPersona('sme_ecommerce_marketplace');
    const bundle = buildBundle({ persona, lfi: 'median', seed: persona.default_seed, pools });
    const refunds = findR5Refunds(bundle);
    expect(refunds.length).toBeGreaterThan(0);
    for (const r of refunds) {
      const rec = bundle._enrichment[r.TransactionId];
      expect(rec, `${r.TransactionId} missing enrichment record`).toBeTruthy();
      const expectedOrig = r.TransactionId.replace(/-rfd$/, '');
      expect(rec.refundOf).toBe(expectedOrig);
      expect(REFUND_SUBTYPES.has(rec.refundKind)).toBe(true);
      // The originating tx's record must NOT carry a refundOf — that
      // field only ever populates on the credit half.
      const origRec = bundle._enrichment[rec.refundOf];
      expect(origRec, 'originating purchase has no enrichment record').toBeTruthy();
      expect(origRec.refundOf).toBeNull();
      expect(origRec.refundKind).toBeNull();
    }
  });

  it('refund TransactionId stays within the v2.1 TransactionId 210-char bound', () => {
    const persona = loadPersona('sme_ecommerce_marketplace');
    const bundle = buildBundle({ persona, lfi: 'median', seed: persona.default_seed, pools });
    const refunds = findR5Refunds(bundle);
    for (const r of refunds) {
      expect(r.TransactionId.length).toBeGreaterThanOrEqual(1);
      expect(r.TransactionId.length).toBeLessThanOrEqual(210);
    }
  });
});
