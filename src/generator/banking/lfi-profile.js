// Banking-domain LFI profile filter — §8.3, EXP-04.
// Applies the Rich/Median/Sparse populate-rate calibration to a generated
// banking bundle as a post-generation field-redaction filter. Mandatory
// fields are never redacted (NG / EXP-04 acceptance).
//
// Per-domain redaction lives next to the per-domain generator (insurance:
// src/generator/insurance/lfi-profile.js, atm: src/generator/atm/).
// The probability table + keep/drop rule + decision cache are shared via
// src/generator/lfi-profile-shared.js. Path literals here are
// banking-shaped (Account, Transaction, Balance) and tested-equal to
// spec/lfi-bands.banking.yaml via tests/lfi-bands.test.mjs.

import { redactionRng, makeCachedDecider } from '../lfi-profile-shared.js';

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
  // Slice 7: counterparty fields on Transaction (D-14 cross-LFI mirror).
  // Common = kept under Rich, ~70% under Median, stripped under Sparse.
  { path: 'Transaction.CreditorAccount', band: 'Common' },
  { path: 'Transaction.DebtorAccount', band: 'Common' },
  { path: 'Transaction.CreditorAgent', band: 'Common' },
  { path: 'Transaction.DebtorAgent', band: 'Common' },
  // Balance
  { path: 'Balance.CreditLine', band: 'Variable' },
];

/**
 * Apply the LFI profile to a bundle. Bundle is mutated in place and returned.
 * `personaId`/`seed` are used to seed an *independent* PRNG stream for
 * populate decisions, derived from the same tuple per EXP-05.
 */
export function applyLfiProfile({ bundle, personaId, lfi, seed }) {
  const decide = makeCachedDecider(lfi, redactionRng(personaId, lfi, seed));

  // Apply per-resource redactions.
  for (const acc of bundle.accounts ?? []) {
    if (!decide('Account.Nickname', 'Common')) delete acc.Nickname;
    if (!decide('Account.OpeningDate', 'Common')) delete acc.OpeningDate;
  }

  for (const tx of bundle.transactions ?? []) {
    if (!decide('Transaction.TransactionInformation', 'Universal'))
      delete tx.TransactionInformation;
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
    // Slice 7: counterparty fields on Transaction.
    // WPS payroll-credit exception: real LFIs always populate
    // DebtorAgent + DebtorAccount on salary credits because the CBUAE
    // WPS reconciliation requires traceable employer→employee identity.
    // The `_isPayroll` marker (set in transactions.js → makeSalary) opts
    // these two paths out of the LFI populate-rate filter so income
    // verification stays usable on Sparse as well as Rich/Median.
    const payrollPinned = tx._isPayroll === true;
    if (tx.CreditorAccount && !decide('Transaction.CreditorAccount', 'Common'))
      delete tx.CreditorAccount;
    if (tx.DebtorAccount && !payrollPinned && !decide('Transaction.DebtorAccount', 'Common'))
      delete tx.DebtorAccount;
    if (tx.CreditorAgent && !decide('Transaction.CreditorAgent', 'Common')) delete tx.CreditorAgent;
    if (tx.DebtorAgent && !payrollPinned && !decide('Transaction.DebtorAgent', 'Common'))
      delete tx.DebtorAgent;
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
