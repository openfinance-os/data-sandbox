// ATM-domain LFI profile filter — §8.3, EXP-04.
// Applies the Rich/Median/Sparse populate-rate calibration to a
// generated ATM directory bundle as a post-generation field-redaction
// filter. Mandatory fields (LFIId, LFIBrandId, ATMId, SupportedCurrencies,
// Location with PostalAddress + GeoLocation) are NEVER redacted.
//
// Path literals here are ATM-shaped (Atm.<field>) and tested-equal to
// spec/lfi-bands.atm.yaml via tests/lfi-bands.test.mjs. The probability
// table + keep/drop rule come from src/generator/lfi-profile-shared.js;
// unlike banking/insurance this module does NOT use the cached decider —
// see applyAtmLfiProfile below.

import { redactionRng, shouldKeep } from '../lfi-profile-shared.js';

const OPTIONAL_FIELD_BANDS = [
  { path: 'Atm.SupportedLanguages', band: 'Universal' },
  { path: 'Atm.Services', band: 'Universal' },
  { path: 'Atm.SupportedCurrencies', band: 'Universal' },
  { path: 'Atm.IsAccess24Hour', band: 'Common' },
  { path: 'Atm.Availability', band: 'Common' },
  { path: 'Atm.Availability.OperatingHours', band: 'Variable' },
  { path: 'Atm.Accessibility', band: 'Variable' },
  { path: 'Atm.MinimumPossibleAmount', band: 'Variable' },
  { path: 'Atm.MaximumPossibleAmount', band: 'Variable' },
  { path: 'Atm.Branch', band: 'Common' },
  { path: 'Atm.ATMFee', band: 'Variable' },
  { path: 'Atm.Notes', band: 'Rare' },
  { path: 'Atm.Links', band: 'Rare' },
];

/**
 * Apply the LFI profile to an ATM directory bundle. Each ATM record
 * gets independent per-field decisions so a Median directory shows
 * variability across terminals (the redaction PRNG is consumed once
 * per (record, field) — distinct from the deterministic cache used
 * in banking / insurance where a single decision applies to all
 * records of one type).
 *
 * SupportedCurrencies is mandatory in the spec but band Universal
 * here for documentation parity; the redaction body never deletes
 * it because `band === 'Universal'` always returns true.
 */
export function applyAtmLfiProfile({ bundle, personaId, lfi, seed }) {
  const rng = redactionRng(personaId, lfi, seed);

  function decide(band) {
    return shouldKeep(lfi, band, rng);
  }

  for (const atm of bundle.atms ?? []) {
    if (!decide('Universal') && atm.SupportedLanguages) delete atm.SupportedLanguages;
    if (!decide('Universal') && atm.Services) delete atm.Services;
    if (!decide('Common') && atm.IsAccess24Hour !== undefined) delete atm.IsAccess24Hour;
    if (atm.Availability) {
      if (!decide('Variable') && atm.Availability.OperatingHours) {
        delete atm.Availability.OperatingHours;
      }
      if (!decide('Common')) delete atm.Availability;
    }
    if (!decide('Variable') && atm.Accessibility) delete atm.Accessibility;
    if (!decide('Variable') && atm.MinimumPossibleAmount) delete atm.MinimumPossibleAmount;
    if (!decide('Variable') && atm.MaximumPossibleAmount) delete atm.MaximumPossibleAmount;
    if (!decide('Common') && atm.Branch) delete atm.Branch;
    if (!decide('Variable') && atm.ATMFee) delete atm.ATMFee;
    if (!decide('Rare') && atm.Notes) delete atm.Notes;
    if (!decide('Rare') && atm.Links) delete atm.Links;
  }

  bundle._lfiProfile = lfi;
  return bundle;
}

export function getOptionalFieldBands() {
  return OPTIONAL_FIELD_BANDS.slice();
}
