// Banking-domain LFI profile filter — §8.3, EXP-04.
// Applies the Rich/Median/Sparse populate-rate calibration to a generated
// banking bundle as a post-generation field-redaction filter. Mandatory
// fields are never redacted (NG / EXP-04 acceptance).
//
// Per-domain redaction lives next to the per-domain generator. Insurance
// has (will have) its own at src/generator/insurance/lfi-profile.js once
// bands are calibrated (slice 6c). Path literals here are banking-shaped
// (Account, Transaction, Balance) and tested-equal to
// spec/lfi-bands.banking.yaml via tests/lfi-bands.test.mjs.

import { mulberry32, seedFromTuple } from '../../prng.js';

// v1 calibration of populate probabilities — single source of truth (§8.3).
const MEDIAN_PROBABILITY = {
  Universal: 1.0,
  Common: 0.7,
  Variable: 0.4,
  Rare: 0.1,
  Unknown: 0.0,
};

// Optional-field band table — mirrors the bands the redaction body below
// applies. Source of truth is spec/lfi-bands.banking.yaml (loaded by the spec
// parser into dist/SPEC.json `bandOverrides`); tests/lfi-bands.test.mjs asserts
// this constant matches the YAML so the two cannot drift.
// Phase 2.1+: Insurance and other domains will pass their own bands map; the
// redaction body's path literals will follow when generic walker lands.
const OPTIONAL_FIELD_BANDS = [
  // Account
  { path: 'Account.Nickname', band: 'Common' },
  { path: 'Account.OpeningDate', band: 'Common' },
  // Transaction
  { path: 'Transaction.TransactionInformation', band: 'Universal' },
  { path: 'Transaction.ValueDateTime', band: 'Universal' },
  { path: 'Transaction.Flags', band: 'Common' },
  { path: 'Transaction.TransactionReference', band: 'Common' },
  { path: 'Transaction.MerchantDetails', band: 'Variable' },
  { path: 'Transaction.MerchantDetails.MerchantCategoryCode', band: 'Variable' },
  { path: 'Transaction.MerchantDetails.MerchantName', band: 'Common' },
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
