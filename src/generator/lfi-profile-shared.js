// Shared LFI-profile redaction kernel — §8.3, EXP-04.
// The Rich/Median/Sparse populate-rate calibration is global across
// domains; each domain module (banking/, insurance/, atm/) keeps its own
// band table and redaction body (the path literals stay domain-shaped and
// tested against spec/lfi-bands.<domain>.yaml), but the probability table,
// keep/drop rule, PRNG stream derivation, and decision cache live here.
//
// Determinism contract (EXP-05): the redaction PRNG is an *independent*
// stream seeded from (personaId, `lfi:<profile>`, seed) — never the
// generator's main stream — so mandatory content is identical across
// Rich/Median/Sparse for the same (persona, seed). Under rich/sparse,
// shouldKeep() consumes no draw; under median it consumes exactly one.
// Callers must not reorder decide() call sites without re-verifying
// byte-identity of the fixture corpus.

import { mulberry32, seedFromTuple } from '../prng.js';

// v1 calibration of populate probabilities — single source of truth (§8.3).
export const MEDIAN_PROBABILITY = {
  Universal: 1.0,
  Common: 0.7,
  Variable: 0.4,
  Rare: 0.1,
  Unknown: 0.0,
};

export function shouldKeep(profile, band, rng) {
  if (profile === 'rich') return band !== 'Unknown';
  if (profile === 'sparse') return band === 'Universal';
  // median
  const p = MEDIAN_PROBABILITY[band] ?? 0;
  return rng() < p;
}

/** Independent redaction PRNG stream for (personaId, lfi, seed). */
export function redactionRng(personaId, lfi, seed) {
  return mulberry32(seedFromTuple(personaId, `lfi:${lfi}`, seed));
}

/**
 * Cached per-(path, band) decider used by banking + insurance: one keep/drop
 * decision per field path applies to every record of that type in the
 * bundle. (ATM intentionally does NOT use this — its directory draws per
 * record so a Median directory varies across terminals.)
 */
export function makeCachedDecider(lfi, rng) {
  const decisions = new Map();
  return function decide(path, band) {
    const cacheKey = `${path}|${band}`;
    if (!decisions.has(cacheKey)) {
      decisions.set(cacheKey, shouldKeep(lfi, band, rng));
    }
    return decisions.get(cacheKey);
  };
}
