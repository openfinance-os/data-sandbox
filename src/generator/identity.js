// Synthetic identity drawer — EXP-07.
// All names, IBANs, employer names, and merchant names in generated bundles
// originate here, drawing from /synthetic-identity-pool/. tools/lint-pii-leak.mjs
// asserts that nothing else in the codebase emits identity strings.

import { rngPick, rngInt } from '../prng.js';

/**
 * Fabricate a fictional name from (givenNames, surnames) using rng.
 */
export function drawName(rng, namePool) {
  const given = rngPick(rng, namePool.given_names);
  const surname = rngPick(rng, namePool.surnames);
  return { given, surname, full: `${given} ${surname}` };
}

/**
 * Build a deterministic synthetic IBAN of the form "AE07 ...." (length 23).
 * Body digits are deterministic from rng, so the same persona+seed always
 * yields the same IBAN.
 */
export function drawIban(rng, ibanPool, prefix) {
  const chosenPrefix = prefix ?? rngPick(rng, ibanPool.prefix_options);
  // 19 digits after the AE+2 prefix (AE07 + 19 digits = 23 chars).
  let body = '';
  for (let i = 0; i < 19; i++) body += rngInt(rng, 0, 10);
  return `${chosenPrefix}${body}`;
}

export function drawEmployer(rng, employerPool) {
  return rngPick(rng, employerPool.employers);
}

export function drawMerchant(rng, merchantPool) {
  return rngPick(rng, merchantPool.merchants);
}

export function drawCounterpartyBank(rng, bankPool) {
  return rngPick(rng, bankPool.banks);
}
