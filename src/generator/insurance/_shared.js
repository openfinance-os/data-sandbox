// Shared assembly helpers for the per-line insurance bundle builders in
// `src/generator/insurance/index.js`. Pure data wrappers — no PRNG draws,
// no I/O. Each helper isolates a v2.1 envelope sub-shape that every
// per-line builder repeats verbatim, so refactors stay byte-identical
// (EXP-05) and the per-line files stay focused on line-specific knobs.

/**
 * v2.1 InsurancePolicyDetail body shape, shared by every line.
 * The PolicyHolder / Identity / Product / Claims / Premium objects come
 * from the per-line generators; this just nails the envelope key order.
 */
export function makePolicyDetail({ insurancePolicyId, policyHolder, identity, product, claims, premium }) {
  return {
    InsurancePolicyId: insurancePolicyId,
    PolicyHolder: policyHolder,
    Identity: identity,
    Product: product,
    Claims: claims,
    Premium: premium,
  };
}

/**
 * v2.1 InsurancePolicySummary shape (the row in `/policies` envelopes).
 * `policyStatus` defaults to 'New' — every Phase 2.1 persona's policy is
 * freshly issued; widen the API when a builder needs Renewed/Lapsed/etc.
 */
export function makePolicySummary({ insurancePolicyId, policyNumber, startDate, endDate, policyStatus = 'New' }) {
  return {
    InsurancePolicyId: insurancePolicyId,
    PolicyNumber: policyNumber,
    PolicyStatus: policyStatus,
    PolicyStartDate: startDate,
    PolicyEndDate: endDate,
  };
}

/**
 * v2.1 payment-details envelope body. `bankName` is line-specific (motor
 * uses CarFinance.BankName when present, life uses FinanceAgainstPolicy,
 * home uses the pre-resolved mortgage bank, the rest pick a random
 * counterparty bank) — so callers compute it themselves and pass in.
 */
export function makePaymentDetails({ accountIban, name, bankName }) {
  return {
    Account: { Identification: accountIban, SchemeName: 'IBAN', Name: `${name.given} ${name.surname}` },
    Bank: { Name: bankName },
  };
}

/**
 * Bundle-level identity block used by every per-line builder. Mirrors the
 * shape consumed downstream by lint-pii-leak and the export pipeline.
 */
export function makeBundleIdentity({ name, persona }) {
  return {
    fullName: `${name.given} ${name.surname}`,
    given: name.given,
    surname: name.surname,
    namePoolId: persona.demographics.nationality_pool,
  };
}

/**
 * Pick a counterparty-bank name uniformly from the resolved banks pool.
 * One PRNG draw — keep it inline at the same call-site that did
 * `p.banks.banks[Math.floor(rng() * p.banks.banks.length)].name` before
 * the extraction so draw order remains deterministic per (persona, lfi, seed).
 */
export function pickRandomBankName(banks, rng) {
  return banks.banks[Math.floor(rng() * banks.banks.length)].name;
}
