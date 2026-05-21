// ATM-domain LFI profile filter — §8.3, EXP-04.
// Applies the Rich/Median/Sparse populate-rate calibration to a
// generated ATM directory bundle as a post-generation field-redaction
// filter. Mandatory fields (LFIId, LFIBrandId, ATMId, SupportedCurrencies,
// Location with PostalAddress + GeoLocation) are NEVER redacted.
//
// Path literals here are ATM-shaped (Atm.<field>) and tested-equal to
// spec/lfi-bands.atm.yaml via tests/lfi-bands.test.mjs. MEDIAN_PROBABILITY
// is duplicated from the banking / insurance modules by intent — the
// global per-§8.3 calibration is shared, but the per-domain redaction
// body stays local until a generic walker lands.

import { mulberry32, seedFromTuple } from '../../prng.js';

const MEDIAN_PROBABILITY = {
  Universal: 1.0,
  Common: 0.7,
  Variable: 0.4,
  Rare: 0.1,
  Unknown: 0.0,
};

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

function shouldKeep(profile, band, rng) {
  if (profile === 'rich') return band !== 'Unknown';
  if (profile === 'sparse') return band === 'Universal';
  const p = MEDIAN_PROBABILITY[band] ?? 0;
  return rng() < p;
}

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
  const rng = mulberry32(seedFromTuple(personaId, `lfi:${lfi}`, seed));

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
