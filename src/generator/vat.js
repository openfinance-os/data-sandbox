// Slice 10 — UAE VAT enrichment for B2B transactions.
//
// UAE introduced VAT in 2018: 5% standard rate, 0% on certain goods (export
// of goods, qualifying services, basic healthcare and education,
// international transport), and exempt categories (financial services,
// residential rent, local passenger transport, bare land).
//
// For B2B transactions generated from `persona.cash_flow.customer_inflows`
// / `supplier_outflows`, we attach a `_vatBreakdown` underscore-prefixed
// metadata field that strict v2.1 consumers strip but accounting-system
// integrations consume. The transaction's `Amount.Amount` is the GROSS
// (net + vat). The `_vatBreakdown` exposes net, vat_amount, vat_rate,
// vat_category — exactly what an accounting platform needs to file FTA
// returns without re-deriving the breakdown from rules.
//
// VAT_BY_POOL maps the synthetic counterparty pool ids in
// /synthetic-identity-pool/counterparties/*.yaml to the realistic VAT
// treatment for each:
//   - b2b_local            → standard 5% (typical local B2B sale)
//   - b2b_intl             → zero-rated (export of goods/services to
//                            non-GCC; qualifying export of services to
//                            GCC also zero-rated)
//   - aggregator_payors    → standard 5% (delivery aggregators charging
//                            VAT on their gross receipt to merchants)
//   - marketplace_payors   → standard 5% (e-commerce marketplaces;
//                            commission is VAT-bearing)
//   - insurer_payors       → exempt (insurance is a financial service —
//                            payment from a payor to a clinic is the
//                            insurer's reimbursement, exempt from VAT)
//   - cloud_suppliers      → zero-rated (B2B import of services from
//                            outside UAE; reverse charge applies in the
//                            persona's own VAT return — modelled as
//                            zero-rated at the transaction layer)
const VAT_BY_POOL = {
  b2b_local: { rate: 0.05, category: 'standard' },
  b2b_intl: { rate: 0, category: 'zero-rated' },
  aggregator_payors: { rate: 0.05, category: 'standard' },
  marketplace_payors: { rate: 0.05, category: 'standard' },
  insurer_payors: { rate: 0, category: 'exempt' },
  cloud_suppliers: { rate: 0, category: 'zero-rated' },
};

const DEFAULT_VAT = { rate: 0.05, category: 'standard' };

/**
 * Look up the VAT treatment for a counterparty pool id. Returns the
 * default 5% standard for unknown pools — safest accounting assumption.
 */
export function vatTreatmentForPool(poolId) {
  return VAT_BY_POOL[poolId] ?? DEFAULT_VAT;
}

/**
 * Compute the VAT breakdown for a gross AED amount given a rate.
 * Returns { net, vat_amount, vat_rate, vat_category, currency } with
 * net + vat_amount = gross (rounded to fils precision via 2 decimal
 * places). For zero-rated and exempt categories, vat_amount = 0.
 *
 * Pure function — no rng, no side effects.
 */
export function computeVatBreakdown(grossAmount, currency, treatment) {
  const { rate, category } = treatment;
  if (rate === 0) {
    return {
      net: grossAmount.toFixed(2),
      vat_amount: '0.00',
      vat_rate: 0,
      vat_category: category,
      currency,
    };
  }
  // Round-half-to-even is fairer for accounting; JS Math.round is round-
  // half-away-from-zero, which is acceptable for the synthetic ledger.
  const net = grossAmount / (1 + rate);
  const vat = grossAmount - net;
  return {
    net: net.toFixed(2),
    vat_amount: vat.toFixed(2),
    vat_rate: rate,
    vat_category: category,
    currency,
  };
}

export { VAT_BY_POOL };
