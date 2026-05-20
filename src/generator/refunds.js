// Phase R5 — refund / reversal transaction shapes.
//
// Real card streams routinely carry refunds (partial credits a few days
// after the original purchase: returned goods, marketplace cancellations,
// post-stay hotel adjustments) and reversals (full credits within hours
// of the original: authorisation voids, declined-after-auth retries that
// nonetheless posted). Enrichment engines have to pair them back to the
// original sale by (merchant + amount + temporal proximity); a fixture
// without any pairs to recover is a quiet gap in the test surface.
//
// This module emits paired refund/reversal transactions as a post-pass
// over an account's already-generated transaction list. Opt-in per
// persona via `enable_refunds: true`. The two SubTransactionType values
// emitted (Refund, Reversal) are both members of AESubTransactionType
// (spec line 4655-4675), so the wire payload stays v2.1-valid without
// any new enum additions.
//
// Determinism (EXP-05): every decision uses a side-channel PRNG keyed
// on the original transaction's TransactionId. It does NOT advance the
// main generator rng, so toggling `enable_refunds` on a persona only
// adds the new refund records — every other transaction stays
// byte-identical. Same mechanism mcc-noise.js uses.
//
// Each emitted refund carries:
//   - CreditDebitIndicator='Credit'                   (it's money back)
//   - SubTransactionType='Refund' | 'Reversal'        (spec enum)
//   - Same MerchantDetails as the original             (enrichment reuse)
//   - TransactionType inherited from the original     (POS / ECommerce)
//   - Narrative prefix 'RFD/' or 'REV/' + merchant token
//   - TransactionId = `${originalId}-rfd` (≤ 210 chars per spec)
//   - _refundOf=<originalTransactionId>               (internal; strips
//     on export; surfaces in the enrichment sidecar as `refundOf` so a
//     TPP can recover the pairing without re-running its own matcher)

import { makePrng, rngInt, rngPick } from '../prng.js';
import { bankishNarrative } from './realism.js';
import { attachBankTransactionCode } from './banking/transaction-codes.js';

// Probability that any one eligible POS / ECommerce purchase spawns a
// refund or reversal. Real-world card refund rates run 1-5% depending
// on segment (e-commerce > in-store); 3% sits in the middle and gives
// each persona a visible handful per month without dominating the feed.
export const DEFAULT_REFUND_RATE = 0.03;

// Of the transactions that do refund, what fraction are full reversals
// (auth-voided within hours, same amount, narrative prefix 'REV/')
// versus refunds (returned-goods style, partial or full amount, days
// later, narrative prefix 'RFD/').
const REVERSAL_SHARE = 0.3;

// Reversal latency band — hours after original posting. Auth-void
// behaviour: settles same-day or next batch.
const REVERSAL_HOUR_BAND = [1, 36];

// Refund latency band — days after original. Returned-goods behaviour:
// e-commerce courier-return windows, store-credit cycles.
const REFUND_DAY_BAND = [2, 14];

// Partial-refund amount fraction band (e.g. 0.4 = refund 40% of the
// original). Refunds always credit at least 25% of the original; full-
// amount refunds are common too (returned single item), so the upper
// bound is 1.0.
const PARTIAL_REFUND_FRACTION_BAND = [0.25, 1.0];

/**
 * Build refund / reversal records for a single account's transaction
 * list. Returns a flat array of new transactions ready to be pushed
 * into the caller's `out` array (and re-sorted by BookingDateTime).
 *
 * Inputs:
 *   transactions   the account's already-generated tx list (the main
 *                  month-loop output for this account)
 *   account        the AECashAccount the txs belong to (for AccountId,
 *                  Currency, _meta)
 *   now            wall-clock anchor used by the generator (so we don't
 *                  emit a refund dated after `now`)
 *   rate           override the per-tx refund probability (default 3%)
 *
 * Returns: array of refund/reversal transactions. Empty when no tx
 * matches the eligibility filter or the persona didn't opt in (the
 * caller is expected to skip the call entirely in the off case).
 */
export function buildRefunds({ transactions, account, now, rate = DEFAULT_REFUND_RATE }) {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];
  const out = [];
  const cap = now ? now.getTime() : Infinity;
  for (const tx of transactions) {
    if (!isEligible(tx)) continue;
    const refund = maybeRefundOne({ tx, account, cap, rate });
    if (refund) out.push(refund);
  }
  return out;
}

function isEligible(tx) {
  if (!tx) return false;
  if (tx.CreditDebitIndicator !== 'Debit') return false;
  if (tx.SubTransactionType !== 'Purchase') return false;
  if (tx.Status === 'Rejected') return false;
  if (!tx.MerchantDetails?.MerchantName) return false;
  const tt = tx.TransactionType;
  return tt === 'POS' || tt === 'ECommerce';
}

function maybeRefundOne({ tx, account, cap, rate }) {
  const sideRng = makePrng(tx.TransactionId, 'refund-r5');
  if (sideRng() >= rate) return null;

  const isReversal = sideRng() < REVERSAL_SHARE;
  const original = parseOriginal(tx);
  if (!original) return null;

  const postedMs = isReversal
    ? original.postedMs +
      hoursToMs(rngInt(sideRng, REVERSAL_HOUR_BAND[0], REVERSAL_HOUR_BAND[1] + 1))
    : original.postedMs + daysToMs(rngInt(sideRng, REFUND_DAY_BAND[0], REFUND_DAY_BAND[1] + 1));
  // Don't post a refund after `now`. If the latency would overshoot the
  // wall-clock anchor, skip — a TPP wouldn't see it yet either.
  if (postedMs > cap) return null;

  // Reversal = full original amount. Refund = partial fraction (still
  // includes 1.0 at the top of the band, so "full refund" cases land).
  const originalAmount = Number(tx.Amount?.Amount ?? 0);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) return null;
  const refundAmount = isReversal
    ? originalAmount
    : roundAmount(originalAmount * fractionInBand(sideRng, PARTIAL_REFUND_FRACTION_BAND));
  if (refundAmount <= 0) return null;

  // Don't snap to a batch-posting slot here — that would risk landing the
  // refund at a time-of-day BEFORE the original (e.g. original at 18:00,
  // +1h reversal → 19:00 → snapped to the next morning's 04:15 slot would
  // become earlier in wall-clock than the original on the same day). The
  // offset already lands on a realistic latency window; we keep the raw
  // ms timestamp so refund > original strictly holds.
  const stamped = new Date(postedMs);
  const subType = isReversal ? 'Reversal' : 'Refund';
  const tag = isReversal ? 'REV' : 'RFD';

  const merchantToken = String(tx.MerchantDetails.MerchantName)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const refSuffix = String(rngInt(sideRng, 100000, 999999));

  return attachBankTransactionCode({
    _accountId: account.AccountId,
    TransactionId: `${tx.TransactionId}-rfd`,
    TransactionReference: `${tag}${refSuffix}`,
    CreditDebitIndicator: 'Credit',
    Status: 'Booked',
    BookingDateTime: isoOf(stamped),
    TransactionDateTime: isoOf(stamped),
    ValueDateTime: isoOf(stamped),
    TransactionInformation: bankishNarrative(tag, [
      merchantToken,
      rngPick(sideRng, ['ORIG', 'REF', 'CARD']),
    ]),
    Amount: { Amount: refundAmount.toFixed(2), Currency: account.Currency },
    TransactionType: tx.TransactionType,
    SubTransactionType: subType,
    // MerchantDetails reused verbatim — the wire MCC and merchant name
    // mirror the original, so a TPP's pairing logic finds the same
    // merchant identity on both halves. We DON'T propagate the
    // original's misrouted-MCC ground-truth onto the refund; the
    // enrichment record reads through `_refundOf` to look up the
    // original's enrichment when it needs the corrected MCC.
    MerchantDetails: { ...tx.MerchantDetails },
    _refundOf: tx.TransactionId,
    _refundKind: subType,
    _mccCategory: tx._mccCategory ?? null,
  });
}

function parseOriginal(tx) {
  const ms = Date.parse(tx.BookingDateTime);
  if (!Number.isFinite(ms)) return null;
  return { postedMs: ms };
}

function fractionInBand(rng, band) {
  // Band is [lo, hi] floats; uniform draw at 2-decimal resolution so
  // the result lines up cleanly with amount rounding.
  const lo = band[0];
  const hi = band[1];
  const steps = Math.round((hi - lo) * 100);
  const draw = rngInt(rng, 0, steps + 1);
  return Number((lo + draw / 100).toFixed(2));
}

function roundAmount(amount) {
  // POS / ECommerce amounts carry 2dp on the wire. Round to 2dp to
  // match the original's fils-precision shape.
  return Math.round(amount * 100) / 100;
}

function hoursToMs(h) {
  return h * 60 * 60 * 1000;
}
function daysToMs(d) {
  return d * 24 * 60 * 60 * 1000;
}

function isoOf(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
