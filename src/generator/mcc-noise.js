// Phase R3 — MCC noise applier.
//
// Real card networks misroute MCCs constantly: a petrol-station's
// convenience aisle rings as grocery, a sit-down cafe as fast-food, a
// pharmacy inside a supermarket as the umbrella grocery code. The
// `MerchantDetails.MerchantCategoryCode` field on a real Open Finance
// transaction is what the bank actually saw on the wire — not
// necessarily the merchant's correct ISO 18245 code.
//
// This module flips a small fraction of POS / ECommerce transaction
// MCCs to wrong-but-plausible alternatives drawn from
// `mcc-confusion.yaml`. The sidecar's `mcc` field continues to carry
// the corrected ground-truth (sourced from the merchant pool's
// canonical MCC, stashed on the tx as `_trueMcc`), so a TPP testing
// MCC-correction logic can score the engine end-to-end against a
// known-truth column.
//
// EXP-05 invariant: the noise decision uses a side-channel PRNG keyed
// on TransactionId, so it doesn't advance the bundle's main rng.
// Adding/tuning the noise rate or confusion table only changes the
// MCCs of misrouted transactions — every other downstream rng draw
// stays byte-identical.

import { makePrng } from '../prng.js';

export const DEFAULT_MCC_NOISE_RATE = 0.05;

/**
 * Roll the dice on whether this transaction's MCC misroutes, and if
 * so pick a plausible wrong code from the confusion table. Returns
 * `{ mcc, misrouted, reason }`. When the table has no entry for the
 * correct MCC, the rng draw is skipped entirely (no side-channel rng
 * consumed) and the correct MCC passes through unchanged.
 *
 * Inputs:
 *   correctMcc       string (3-4 char ISO 18245) — the canonical MCC
 *                    from the merchant pool.
 *   transactionId    string — the tx's spec-mandatory id. Used as the
 *                    seed for the side-channel rng. Each tx's noise
 *                    decision is independent of every other tx and of
 *                    the bundle's main rng state.
 *   confusionTable   indexed { correctMcc → [{ wrong, reason }] } —
 *                    from indexPools().mccConfusion. Pass undefined
 *                    or null to disable noise entirely.
 *   rate             probability of misrouting. Default 5%.
 */
export function maybeMisrouteMcc({ correctMcc, transactionId, confusionTable, rate = DEFAULT_MCC_NOISE_RATE }) {
  if (!correctMcc || !confusionTable) {
    return { mcc: correctMcc, misrouted: false, reason: null };
  }
  const entries = confusionTable[correctMcc];
  if (!entries || entries.length === 0) {
    return { mcc: correctMcc, misrouted: false, reason: null };
  }
  // Side-channel rng — keyed on TransactionId + a fixed salt so two
  // different decisions on the same tx don't collide if R5 later adds
  // another tx-level side-channel.
  const sideRng = makePrng(transactionId, 'mcc-noise-r3');
  if (sideRng() >= rate) {
    return { mcc: correctMcc, misrouted: false, reason: null };
  }
  // Uniform pick across the entries — equal weight by design. Weights
  // can land in a follow-up if a confusion family needs to bias one
  // wrong code over another.
  const idx = Math.floor(sideRng() * entries.length) % entries.length;
  const pick = entries[idx];
  return { mcc: pick.wrong, misrouted: true, reason: pick.reason };
}
