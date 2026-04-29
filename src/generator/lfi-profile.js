// LFI profile filter — §8.3, EXP-04.
// Applies the Rich/Median/Sparse populate-rate calibration to a generated
// bundle as a post-generation field-redaction filter. Mandatory fields are
// never redacted (NG / EXP-04 acceptance).

import { mulberry32, seedFromTuple } from '../prng.js';

// v1 calibration of populate probabilities — single source of truth (§8.3).
const MEDIAN_PROBABILITY = {
  Universal: 1.0,
  Common: 0.7,
  Variable: 0.4,
  Rare: 0.1,
  Unknown: 0.0,
};

// Phase 0 starter: a small allowlist of optional fields with their bands.
// Phase 1 will move this into the spec parser so band lookups are spec-driven.
// `path` is the dotted SPEC path; `band` is one of the keys above.
const OPTIONAL_FIELD_BANDS = [
  // Account
  { path: 'Account.Nickname', band: 'Common' },
  { path: 'Account.OpeningDate', band: 'Common' },
  // Transaction
  { path: 'Transaction.TransactionInformation', band: 'Universal' },
  { path: 'Transaction.MerchantDetails', band: 'Variable' },
  { path: 'Transaction.MerchantDetails.MerchantCategoryCode', band: 'Variable' },
  { path: 'Transaction.MerchantDetails.MerchantName', band: 'Common' },
  { path: 'Transaction.CreditorName', band: 'Common' },
  { path: 'Transaction.Flags', band: 'Common' },
  { path: 'Transaction.ValueDateTime', band: 'Universal' },
  // Balance
  { path: 'Balance.CreditLine', band: 'Variable' },
];

function shouldKeep(profile, band, rng) {
  if (profile === 'rich') return band !== 'Unknown';
  if (profile === 'sparse') return band === 'Universal';
  // median
  const p = MEDIAN_PROBABILITY[band] ?? 0;
  return rng() < p;
}

/**
 * Apply the LFI profile to a bundle. Bundle is mutated in place and returned.
 * `personaId`/`seed` are used to seed an *independent* PRNG stream for
 * populate decisions, derived from the same tuple per EXP-05.
 */
export function applyLfiProfile({ bundle, personaId, lfi, seed }) {
  const rng = mulberry32(seedFromTuple(personaId, `lfi:${lfi}`, seed));

  const decisions = new Map();
  function decide(path, band) {
    const cacheKey = `${path}|${band}`;
    if (!decisions.has(cacheKey)) {
      decisions.set(cacheKey, shouldKeep(lfi, band, rng));
    }
    return decisions.get(cacheKey);
  }

  // Apply per-resource redactions.
  for (const acc of bundle.accounts ?? []) {
    if (!decide('Account.Nickname', 'Common')) delete acc.Nickname;
    if (!decide('Account.OpeningDate', 'Common')) delete acc.OpeningDate;
  }

  for (const tx of bundle.transactions ?? []) {
    if (!decide('Transaction.TransactionInformation', 'Universal')) delete tx.TransactionInformation;
    if (!decide('Transaction.ValueDateTime', 'Universal')) delete tx.ValueDateTime;
    if (!decide('Transaction.Flags', 'Common')) delete tx.Flags;
    if (!decide('Transaction.TransactionReference', 'Common')) delete tx.TransactionReference;
    if (tx.MerchantDetails) {
      if (!decide('Transaction.MerchantDetails.MerchantCategoryCode', 'Variable')) {
        delete tx.MerchantDetails.MerchantCategoryCode;
      }
      if (!decide('Transaction.MerchantDetails.MerchantName', 'Common')) {
        delete tx.MerchantDetails.MerchantName;
      }
      if (!decide('Transaction.MerchantDetails', 'Variable')) {
        delete tx.MerchantDetails;
      }
    }
  }

  for (const bal of bundle.balances ?? []) {
    if (!decide('Balance.CreditLine', 'Variable') && bal.CreditLine) delete bal.CreditLine;
  }

  bundle._lfiProfile = lfi;
  return bundle;
}

export function getOptionalFieldBands() {
  return OPTIONAL_FIELD_BANDS.slice();
}

export function medianProbability(band) {
  return MEDIAN_PROBABILITY[band] ?? 0;
}
