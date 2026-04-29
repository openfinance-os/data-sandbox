// Old-core-banking realism helpers — emit transactions that look like what
// a Finacle / T24 / FlexCube / Equation core would actually serve via the
// Open Finance API Hub, not what a UX designer would write. Real banking
// data is uppercase-truncated, slash-separated, weekday-biased, T+1/T+2
// value-dated, batch-clustered, and rough on the edges.

import { rngInt, rngPick } from '../prng.js';

/**
 * Bank-shape narrative — uppercase, slash-separated channel prefix +
 * payload, truncated to a typical 22-char display window.
 *   bankishNarrative('SAL', ['PAYROLL', 'OnyxCompute'])
 *     → "SAL/PAYROLL/ONYXCOMP"
 */
export function bankishNarrative(prefix, parts, maxLen = 22) {
  const cleaned = parts
    .filter(Boolean)
    .map((p) => String(p).toUpperCase().replace(/[^A-Z0-9 ]+/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let out = `${prefix}/${cleaned.join('/')}`;
  if (out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

/**
 * Push a weekend booking date (Sat/Sun in modern UAE) forward to the next
 * working day with high probability. Some transactions still post on
 * weekends (cards, ATM) — that's why we leave a small chance.
 */
export function weekdayBias(date, rng, weekendShiftProbability = 0.7) {
  const d = new Date(date.getTime());
  const dow = d.getUTCDay(); // 0 Sun, 6 Sat
  if ((dow === 6 || dow === 0) && rng() < weekendShiftProbability) {
    while (d.getUTCDay() === 6 || d.getUTCDay() === 0) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return d;
}

// Realistic batch-posting times — most cores process in clusters at
// scheduled batch windows rather than continuously.
const POSTING_SLOTS = [
  { h: 0, m: 30 },   // overnight batch
  { h: 4, m: 15 },   // early-morning settlement
  { h: 8, m: 30 },   // morning posting
  { h: 11, m: 0 },   // mid-day (existing default)
  { h: 13, m: 45 },  // afternoon
  { h: 18, m: 0 },   // EOD batch
  { h: 23, m: 50 },  // late-night cut-off
];
export function pickPostingTime(rng) {
  return rngPick(rng, POSTING_SLOTS);
}
export function withPostingTime(date, slot) {
  const d = new Date(date.getTime());
  d.setUTCHours(slot.h, slot.m, 0, 0);
  return d;
}

/**
 * Add realistic fils noise to a POS amount — most real card transactions
 * carry a fractional component (AED 199.50, AED 87.99) rather than round
 * AED. Receives the integer band amount, returns Number with up to 2dp.
 */
export function fractionalAmount(rng, baseInt) {
  const fils = rngInt(rng, 0, 100);
  // 60% of POS transactions carry .x0 / .x5 / .x9 (typical retail pricing);
  // the rest are random fils.
  if (rng() < 0.6) {
    const tail = rngPick(rng, [0, 25, 50, 75, 90, 95, 99]);
    return Number((baseInt + tail / 100).toFixed(2));
  }
  return Number((baseInt + fils / 100).toFixed(2));
}

/**
 * Value-date drift relative to booking date — typical real-world offsets
 * by transaction type. Most retail cores show same-day for cards, T+1 for
 * domestic transfers, T+2 for cross-border / FX, and same-day again for
 * cash deposits.
 */
export function valueDateOffset(transactionType, rng) {
  switch (transactionType) {
    case 'POS':
    case 'ECommerce':
    case 'ATM':
    case 'Teller':
      return 0;
    case 'BillPayments':
      return rng() < 0.3 ? 1 : 0;
    case 'LocalBankTransfer':
    case 'SameBankTransfer':
      return rng() < 0.5 ? 1 : 0;
    case 'InternationalTransfer':
      return rngPick(rng, [1, 2, 2, 3]);
    default:
      return 0;
  }
}

/**
 * Reference-number formats — real cores use channel-specific patterns and
 * are far less uniform than my Phase 1 placeholders. Per channel:
 *   POS / ECommerce: 6-9 digit auth code or terminal-rolled reference
 *   ATM:             4-digit terminal + 6-digit sequence
 *   BillPayments:    biller code + YYYYMM + 4-digit sequence
 *   Cash/Teller:     branch code + YYYYMMDD + 4-digit sequence
 *   FX/IBT:          SWIFT-like 16-char alphanumeric
 *   StandingOrder:   mandate-id-like alphanum
 */
export function referenceNumber(rng, transactionType, date, hint = '') {
  const yyyymm = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const yyyymmdd = `${yyyymm}${String(date.getUTCDate()).padStart(2, '0')}`;
  switch (transactionType) {
    case 'POS':
    case 'ECommerce': {
      const len = rngPick(rng, [6, 7, 8, 9]);
      const code = String(rngInt(rng, 0, 10 ** len)).padStart(len, '0');
      return rng() < 0.3 ? `AUTH${code}` : code;
    }
    case 'ATM': {
      const term = String(rngInt(rng, 1000, 9999));
      const seq = String(rngInt(rng, 100000, 999999));
      return `ATM${term}${seq}`;
    }
    case 'BillPayments': {
      const biller = (hint || 'BILR').toUpperCase().replace(/[^A-Z]+/g, '').slice(0, 4).padEnd(4, 'X');
      return `${biller}${yyyymm}${String(rngInt(rng, 0, 10000)).padStart(4, '0')}`;
    }
    case 'Teller': {
      const branch = String(rngInt(rng, 100, 999));
      return `BRN${branch}${yyyymmdd}${String(rngInt(rng, 0, 10000)).padStart(4, '0')}`;
    }
    case 'InternationalTransfer': {
      const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
      let s = '';
      for (let i = 0; i < 16; i++) s += chars[Math.floor(rng() * chars.length)];
      return `INW${s}`;
    }
    case 'LocalBankTransfer':
    case 'SameBankTransfer': {
      const seq = String(rngInt(rng, 0, 1e10)).padStart(10, '0');
      return `IPP${seq}`;
    }
    default: {
      const seq = String(rngInt(rng, 100000, 999999));
      return `REF${seq}`;
    }
  }
}

/**
 * Decide whether a transaction at this date is recent enough to render as
 * Pending (auth-hold not yet settled). Real cores show Pending for the
 * last 24-48h depending on rail.
 */
export function pendingForRecent(transactionDate, now, rng) {
  const ageMs = now.getTime() - transactionDate.getTime();
  const days = ageMs / (24 * 60 * 60 * 1000);
  if (days < 0) return false;       // future-dated → not pending
  if (days < 1) return rng() < 0.7; // most recent are pending
  if (days < 2) return rng() < 0.3; // some still pending
  return false;
}
