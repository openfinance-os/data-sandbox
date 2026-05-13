// Extended-spend dispatch — Phase R1 of ENRICHMENT_REALISM_PLAN.md.
//
// The legacy 3-category loop in transactions.js (groceries / fuel / dining) is
// preserved verbatim for backwards-compatibility with the existing replay
// fingerprints. This module layers ADDITIONAL categories on top, gated per
// persona archetype, so a salaried-expat persona starts accruing ride-hailing
// + e-commerce + healthcare + subscriptions on top of the legacy spine,
// without changing how the legacy categories draw.
//
// Each entry contributes the same fixed PRNG draw pattern as the legacy loop
// (1× count → per-tx: drawMerchant → amount → day → weekdayBias → optional
// pending mark), so EXP-05 determinism is preserved as long as (a) the
// categories iterate in declaration order and (b) every archetype-default
// table here is treated as immutable once published.
//
// `default_band` is the [lo, hi] per-month transaction-count band the
// extended loop draws from. `aedBandKey` / `countBandKey` let a persona
// manifest override the default via its `spend_profile` block (same shape
// as the legacy bands).

export const EXTENDED_SPEND_CATEGORIES = [
  {
    id: 'ride_hailing',
    poolKey: 'ride_hailing',
    mccCategory: 'TXI',
    weekdayBiasFactor: 0.3,
    countBandKey: 'ride_hailing_per_month_count_band',
    aedBandKey: 'ride_hailing_aed_per_month_band',
  },
  {
    id: 'ecommerce',
    poolKey: 'ecommerce',
    mccCategory: 'ECM',
    weekdayBiasFactor: 0.4,
    countBandKey: 'ecommerce_per_month_count_band',
    aedBandKey: 'ecommerce_aed_per_month_band',
    isEcommerce: true,
  },
  {
    id: 'healthcare',
    poolKey: 'healthcare',
    mccCategory: 'HLTH',
    weekdayBiasFactor: 0.5,
    countBandKey: 'healthcare_per_month_count_band',
    aedBandKey: 'healthcare_aed_per_month_band',
  },
  {
    id: 'transport',
    poolKey: 'transport',
    mccCategory: 'TRNS',
    weekdayBiasFactor: 0.5,
    countBandKey: 'transport_per_month_count_band',
    aedBandKey: 'transport_aed_per_month_band',
  },
  {
    id: 'government',
    poolKey: 'government',
    mccCategory: 'GOV',
    weekdayBiasFactor: 0.6,
    countBandKey: 'government_per_month_count_band',
    aedBandKey: 'government_aed_per_month_band',
    transactionType: 'BillPayments',
  },
  {
    id: 'entertainment',
    poolKey: 'entertainment',
    mccCategory: 'ENT',
    weekdayBiasFactor: 0.2,
    countBandKey: 'entertainment_per_month_count_band',
    aedBandKey: 'entertainment_aed_per_month_band',
  },
  {
    id: 'subscriptions',
    poolKey: 'subscriptions',
    mccCategory: 'SUB',
    weekdayBiasFactor: 0.4,
    countBandKey: 'subscriptions_per_month_count_band',
    aedBandKey: 'subscriptions_aed_per_month_band',
    isEcommerce: true,
  },
  {
    id: 'travel_air',
    poolKey: 'travel_air',
    mccCategory: 'AIR',
    weekdayBiasFactor: 0.4,
    countBandKey: 'travel_air_per_month_count_band',
    aedBandKey: 'travel_air_aed_per_month_band',
    isEcommerce: true,
  },
  {
    id: 'travel_hotel',
    poolKey: 'travel_hotel',
    mccCategory: 'HOT',
    weekdayBiasFactor: 0.4,
    countBandKey: 'travel_hotel_per_month_count_band',
    aedBandKey: 'travel_hotel_aed_per_month_band',
  },
  {
    id: 'education',
    poolKey: 'education',
    mccCategory: 'EDU',
    weekdayBiasFactor: 0.5,
    countBandKey: 'education_per_month_count_band',
    aedBandKey: 'education_aed_per_month_band',
  },
  {
    id: 'telecom',
    poolKey: 'telecom',
    mccCategory: 'TEL',
    weekdayBiasFactor: 0.5,
    countBandKey: 'telecom_per_month_count_band',
    aedBandKey: 'telecom_aed_per_month_band',
  },
  {
    id: 'atm',
    poolKey: 'atm',
    mccCategory: 'ATM',
    weekdayBiasFactor: 0.5,
    countBandKey: 'atm_per_month_count_band',
    aedBandKey: 'atm_aed_per_month_band',
    transactionType: 'ATM',
    subTransactionType: 'Withdrawal',
    creditDebit: 'Debit',
  },
];

// Archetype → default per-month transaction-count band per category.
// Missing keys mean "this archetype doesn't spend on this category by
// default" (count band = [0, 0]). A persona's own `spend_profile` block
// can always override.
//
// Bands are intentionally small (single digits) — the goal is to broaden
// the category surface, not to inflate volumes. Total bundle volume grows
// modestly (typical Retail persona: +12-25 tx/month across all new
// categories combined).
const ZERO = [0, 0];

const DEFAULTS = {
  salaried_expat: {
    ride_hailing: [3, 8],
    ecommerce: [2, 6],
    healthcare: [0, 2],
    transport: [1, 3],
    entertainment: [1, 3],
    subscriptions: [2, 4],
    telecom: [0, 1],
    atm: [1, 3],
  },
  salaried_affluent: {
    ride_hailing: [2, 6],
    ecommerce: [3, 8],
    healthcare: [1, 3],
    entertainment: [2, 5],
    subscriptions: [3, 6],
    travel_air: [0, 2],
    travel_hotel: [0, 2],
    education: [0, 1],
    atm: [1, 3],
  },
  hnw: {
    ecommerce: [4, 10],
    healthcare: [1, 3],
    entertainment: [3, 7],
    subscriptions: [4, 7],
    travel_air: [1, 3],
    travel_hotel: [1, 3],
    education: [0, 1],
    atm: [2, 5],
  },
  thin_file: {
    ride_hailing: [4, 10],
    ecommerce: [2, 5],
    transport: [2, 5],
    entertainment: [1, 3],
    subscriptions: [1, 3],
    telecom: [1, 2],
    atm: [1, 3],
  },
  gig_worker: {
    ride_hailing: [2, 5],
    ecommerce: [1, 4],
    transport: [1, 4],
    entertainment: [1, 2],
    subscriptions: [1, 2],
    telecom: [1, 3],
    atm: [3, 8],
  },
  dbr_stretched: {
    ride_hailing: [1, 4],
    ecommerce: [1, 4],
    healthcare: [0, 2],
    transport: [1, 3],
    entertainment: [0, 2],
    subscriptions: [2, 4],
    education: [1, 2],
    atm: [1, 3],
  },
  joint_family: {
    ride_hailing: [2, 5],
    ecommerce: [3, 7],
    healthcare: [1, 3],
    transport: [1, 3],
    entertainment: [1, 3],
    subscriptions: [2, 5],
    education: [1, 2],
    atm: [1, 3],
  },
  senior_retiree: {
    // Intentionally empty — Senior is the load-bearing low-volume guard
    // test case in tests/underwriting.test.mjs (PRD §4.4). Adding any
    // extended-category default here will push the trailing-12-month
    // count over the 50 tx floor, silently disabling the guard. Keep
    // empty so the legacy 3-category POS spine + fixed commitments are
    // the only spend Senior emits, matching the test fixture's intent.
  },
  distressed: {
    // Low discretionary spend, frequent ATM cash-outs, telco top-ups.
    ride_hailing: [0, 2],
    ecommerce: [0, 2],
    healthcare: [0, 1],
    transport: [1, 3],
    subscriptions: [0, 1],
    telecom: [2, 4],
    atm: [3, 6],
  },
  corporate_treasury: {
    // Corporate accounts don't do retail-style POS — keep extended surface
    // empty here. B2B inflows / supplier outflows already cover the
    // operating spine via cash_flow.
  },
  sme_cash: {
    ride_hailing: [1, 3],
    ecommerce: [1, 3],
    transport: [1, 2],
    telecom: [1, 2],
    atm: [2, 5],
  },
  sme_business: {
    ride_hailing: [1, 3],
    ecommerce: [1, 3],
    transport: [1, 2],
    entertainment: [0, 1],
    subscriptions: [1, 3],
    telecom: [1, 2],
    atm: [1, 3],
  },
  sme_clinic: {
    ride_hailing: [1, 3],
    ecommerce: [1, 3],
    healthcare: [1, 2],
    transport: [1, 2],
    subscriptions: [1, 3],
    atm: [1, 3],
  },
  sme_construction: {
    ride_hailing: [1, 3],
    ecommerce: [1, 2],
    transport: [2, 4],
    telecom: [1, 2],
    atm: [2, 5],
  },
  sme_ecommerce: {
    ride_hailing: [1, 3],
    ecommerce: [3, 6],
    transport: [1, 3],
    subscriptions: [2, 5],
    atm: [1, 3],
  },
  sme_fnb: {
    ride_hailing: [1, 3],
    ecommerce: [1, 3],
    transport: [1, 3],
    subscriptions: [1, 3],
    atm: [3, 6],
  },
  sme_trading_emirati: {
    ride_hailing: [1, 2],
    ecommerce: [1, 3],
    transport: [1, 2],
    entertainment: [0, 1],
    subscriptions: [1, 2],
    atm: [2, 5],
  },
  sme_saas: {
    ride_hailing: [1, 3],
    ecommerce: [1, 3],
    transport: [1, 2],
    entertainment: [0, 2],
    subscriptions: [3, 6],
    atm: [1, 2],
  },
};

/**
 * Resolve the per-month count band for a given (archetype, category).
 * Returns [0, 0] (i.e. "skip this category") when an archetype is unknown
 * or doesn't list the category — that keeps the surface area additive for
 * any future archetypes added to the persona library.
 */
export function defaultCountBand(archetype, categoryId) {
  const table = DEFAULTS[archetype];
  if (!table) return ZERO;
  return table[categoryId] ?? ZERO;
}
