// Insurance-domain LFI profile filter — §8.3, EXP-04.
// Applies the Rich/Median/Sparse populate-rate calibration to a generated
// insurance bundle as a post-generation field-redaction filter. Mandatory
// fields are never redacted (NG / EXP-04 acceptance).
//
// Path literals here are insurance-shaped (PolicyHolder, Premium, Product)
// and tested-equal to spec/lfi-bands.insurance.yaml via tests/lfi-bands.test.mjs.
// MEDIAN_PROBABILITY is duplicated from the banking module by intent: the
// calibration is global per §8.3, but the shouldKeep / decide engine stays
// domain-local until a generic walker lands.

import { mulberry32, seedFromTuple } from '../../prng.js';

const MEDIAN_PROBABILITY = {
  Universal: 1.0,
  Common: 0.7,
  Variable: 0.4,
  Rare: 0.1,
  Unknown: 0.0,
};

const OPTIONAL_FIELD_BANDS = [
  { path: 'PolicyHolder.Salutation', band: 'Common' },
  { path: 'Premium.PaymentMode', band: 'Common' },
  { path: 'Product.AdditionalDrivers', band: 'Variable' },
  { path: 'Product.CarFinance', band: 'Variable' },
];

function shouldKeep(profile, band, rng) {
  if (profile === 'rich') return band !== 'Unknown';
  if (profile === 'sparse') return band === 'Universal';
  // median
  const p = MEDIAN_PROBABILITY[band] ?? 0;
  return rng() < p;
}

/**
 * Apply the LFI profile to an insurance bundle. Bundle is mutated in place
 * and returned. `personaId`/`seed` seed an *independent* PRNG stream
 * (same tuple shape as banking, distinct stream from the generator's RNG).
 */
export function applyInsuranceLfiProfile({ bundle, personaId, lfi, seed }) {
  const rng = mulberry32(seedFromTuple(personaId, `lfi:${lfi}`, seed));

  const decisions = new Map();
  function decide(path, band) {
    const cacheKey = `${path}|${band}`;
    if (!decisions.has(cacheKey)) {
      decisions.set(cacheKey, shouldKeep(lfi, band, rng));
    }
    return decisions.get(cacheKey);
  }

  for (const policy of bundle.motorPolicies ?? []) {
    if (policy.PolicyHolder && !decide('PolicyHolder.Salutation', 'Common')) {
      delete policy.PolicyHolder.Salutation;
    }
    if (policy.Premium && !decide('Premium.PaymentMode', 'Common')) {
      delete policy.Premium.PaymentMode;
    }
    if (policy.Product) {
      if (!decide('Product.AdditionalDrivers', 'Variable')) {
        delete policy.Product.AdditionalDrivers;
      }
      if (!decide('Product.CarFinance', 'Variable')) {
        delete policy.Product.CarFinance;
      }
    }
  }

  bundle._lfiProfile = lfi;
  return bundle;
}

export function getOptionalFieldBands() {
  return OPTIONAL_FIELD_BANDS.slice();
}
