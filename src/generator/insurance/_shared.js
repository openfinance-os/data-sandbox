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
export function makePolicyDetail({
  insurancePolicyId,
  policyHolder,
  identity,
  product,
  claims,
  premium,
}) {
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
export function makePolicySummary({
  insurancePolicyId,
  policyNumber,
  startDate,
  endDate,
  policyStatus = 'New',
}) {
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
    Account: {
      Identification: accountIban,
      SchemeName: 'IBAN',
      Name: `${name.given} ${name.surname}`,
    },
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
 * v2.1 ActiveOrHistoricAmount shape. Moved here from motor-policy.js —
 * every line's policy + quote builders use it.
 */
export function aed(amount) {
  const num = typeof amount === 'number' ? amount : Number(amount);
  return { Currency: 'AED', Amount: num.toFixed(2) };
}

/**
 * Deterministic 9-digit reference with a per-line prefix — the body shared
 * by every line's `policyNumber()` (MTR-, HOM-, …) and `quoteReference()`
 * (MTRQ-, HOMQ-, …). Exactly one PRNG draw, same arithmetic as the old
 * per-line copies, so output is byte-identical per (persona, lfi, seed).
 */
export function refNumber(prefix, rng) {
  return `${prefix}-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

/**
 * Persona policy.channel → spec PolicyPurchaseChannelType enum. Every line
 * shares the same five-entry base; lines whose spec enum admits more
 * channels (health: TPA, life: InvFinInst, travel/renters/employment:
 * online variants) pass them as `extra`. Kept per-line rather than as one
 * superset map so an unknown channel keeps falling back to 'Other' for
 * lines whose enum doesn't include it.
 */
export function channelMap(extra = {}) {
  return {
    Direct: 'Direct',
    Agent: 'Agent',
    Broker: 'Broker',
    Bank: 'Bank',
    Aggregator: 'Aggregation',
    ...extra,
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
