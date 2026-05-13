// Old-core-banking realism helpers — emit transactions that look like what
// a Finacle / T24 / FlexCube / Equation core would actually serve via the
// Open Finance API Hub, not what a UX designer would write. Real banking
// data is uppercase-truncated, slash-separated, weekday-biased, T+1/T+2
// value-dated, batch-clustered, and rough on the edges.

import { rngInt, rngPick } from '../prng.js';

/**
 * Bank-shape narrative — uppercase, slash-separated channel prefix +
 * payload, truncated to a typical 80-char display window. Phase R2
 * lifted the cap from 22 → 80 to make room for the aggregator/
 * terminal/emirate-code/parent-group/FX-clutter overlays modern UAE
 * cores actually emit. Spec ceiling is 500 chars, so we're well clear.
 *
 *   bankishNarrative('SAL', ['PAYROLL', 'OnyxCompute'])
 *     → "SAL/PAYROLL/ONYXCOMPUTE"
 */
export function bankishNarrative(prefix, parts, maxLen = 80) {
  // Phase R2 — the normaliser keeps `*` (aggregator-prefix marker
  // like `TST*` / `PYPL*` / `STRP*`) and `/` (parent-group separator
  // like `FHG/` and the bankishNarrative's own segment delimiter).
  // Everything else non-alphanumeric is still scrubbed — emoji,
  // unicode noise, accented chars all get dropped.
  const cleaned = parts
    .filter(Boolean)
    .map((p) => String(p).toUpperCase().replace(/[^A-Z0-9 */.]+/g, '').replace(/\s+/g, ' ').trim())
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

// ─── Phase R2 — narrative-dirtying grammar ──────────────────────────────
//
// Every helper below is deterministic on the passed `rng` (EXP-05),
// probability-gated, and composes by string concatenation into the
// same `bankishNarrative` output the legacy path produced. The probs
// are tuned so a typical persona × seed sees a visible MIX of dirty
// shapes without the narrative becoming pure noise — roughly the
// distribution a TPP would see on a real UAE-issued monthly statement.
// Lower probabilities trade realism for snapshot stability; the
// calibration below is the v1 default.

// Payment-rail aggregator prefixes. `TST*` / `SQ *` / `PYPL*` / `STRP*`
// / `APL*` / `GPAY*` are global; `NOON*` / `CRT*` are UAE-locally common.
const POS_AGGREGATORS = ['TST*', 'SQ *', 'PYPL*', 'STRP*', 'APL*', 'GPAY*', 'NOON*', 'CRT*'];
const ECM_AGGREGATORS = ['STRP*', 'PYPL*', 'APL*', 'GPAY*', 'NOON*'];
// Emirate codes — population-weighted. DXB / AUH dominate. Codified
// here so the generator doesn't keep open-coding 'DXB' as a constant.
const EMIRATES = ['DXB', 'DXB', 'DXB', 'DXB', 'AUH', 'AUH', 'AUH', 'SHJ', 'SHJ', 'AJM', 'RAK', 'UAQ', 'FUJ'];

/**
 * Pick a payment-rail aggregator prefix. Defaults to the POS deck;
 * pass 'ecommerce' for the e-commerce subset. Returns the empty
 * string when the rng draw lands outside `prob` — caller concatenates
 * unconditionally.
 */
export function aggregatorPrefix(rng, channel = 'pos', prob = 0.25) {
  if (rng() >= prob) return '';
  const deck = channel === 'ecommerce' ? ECM_AGGREGATORS : POS_AGGREGATORS;
  return rngPick(rng, deck);
}

/**
 * Append a 4-7 digit terminal / merchant ID. Spec-valid (TransactionInfo
 * has no pattern); structured as a separate slash-separated segment so
 * the caller can keep the merchant token a clean substring (so
 * cross-link / search by merchant name still works).
 */
export function terminalSuffix(rng, prob = 0.5) {
  if (rng() >= prob) return '';
  const len = rngInt(rng, 4, 8);
  return String(rngInt(rng, 0, 10 ** len)).padStart(len, '0');
}

/** Population-weighted emirate code (DXB/AUH/SHJ/AJM/RAK/UAQ/FUJ). */
export function emirateCode(rng) {
  return rngPick(rng, EMIRATES);
}

/**
 * DBA-drift display variant. When a merchant pool entry carries
 * `display_variants`, with probability `prob` swap the canonical
 * merchant-name token for one of the variants. Returns the supplied
 * fallback (typically the canonical name) when the merchant doesn't
 * declare variants or the rng draw lands outside `prob`.
 *
 * The headline win: a TPP's name-cleaning step has to recognise that
 * 'MARKETMARK' and 'MMARK HYPRMKT' are the SAME merchant. The
 * enrichment sidecar always resolves to the canonical name, so the
 * "Show enriched" toggle is the visible payoff.
 */
export function dbaDrift(merchant, rng, fallback, prob = 0.3) {
  const variants = Array.isArray(merchant?.display_variants) ? merchant.display_variants : [];
  if (variants.length === 0 || rng() >= prob) return fallback;
  return String(rngPick(rng, variants)).toUpperCase().replace(/[^A-Z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Family-group acronym prefix — UAE-specific realism per the R2 plan.
 * Many international brands here are operated under franchise by large
 * local conglomerates, and a real bank statement routinely shows the
 * group's commercial entity in the narrative (e.g. acquirer-coded
 * 'AFG/IKEA DXB' or 'FHG/CARREFOUR DXB' in our synthetic analog).
 *
 * Returns the empty string when the merchant doesn't declare a
 * parent group OR the registry doesn't resolve OR the rng draw lands
 * outside `prob` — caller concatenates unconditionally.
 */
export function parentGroupPrefix(merchant, registry, rng, prob = 0.25) {
  if (rng() >= prob) return '';
  const groupId = merchant?.parent_group;
  if (!groupId || !registry) return '';
  const acronym = registry[groupId]?.acronym;
  return acronym ? `${acronym}/` : '';
}

/**
 * FX-clutter suffix for cross-currency transactions. Mirrors what a
 * real card scheme appends on the statement: source currency + amount,
 * and (optionally) an originating country code.
 *   'STARBUCKS LDN' + fxClutter(…, 'GBP', 4.20, rng) → ' GBP 4.20 LDN'
 */
const FX_COUNTRIES = { USD: 'US', EUR: 'DE', GBP: 'LDN', INR: 'IN', PKR: 'PK', PHP: 'PH', SAR: 'SA' };
export function fxClutter(currency, foreignAmount, rng, prob = 0.7) {
  if (rng() >= prob) return '';
  const amt = Number.isFinite(foreignAmount) ? foreignAmount.toFixed(2) : '';
  const country = FX_COUNTRIES[currency] ?? '';
  return [currency, amt, country].filter(Boolean).join(' ');
}

/**
 * Arabic-Latin transliterated descriptor — low-probability shape
 * that some UAE acquirers emit for local merchants (e.g.
 * 'MAHATTA WAQOOD' for a fuel station). Mirrors the realism stressor
 * for TPP name-cleaning. The pool must declare `display_variants_ar`
 * to opt in.
 */
export function arabicDescriptor(merchant, rng, prob = 0.1) {
  const variants = Array.isArray(merchant?.display_variants_ar) ? merchant.display_variants_ar : [];
  if (variants.length === 0 || rng() >= prob) return '';
  return String(rngPick(rng, variants)).toUpperCase().replace(/[^A-Z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Compose a Phase R2 dirty POS / ECommerce narrative. Stitches the
 * helpers above into a single function the generator's tx makers call.
 * Keeps the merchant-token substring intact so cross-link / search by
 * merchant name continues to work (app.js:1791-1811 substring match).
 *
 *   channel:   'pos' | 'ecommerce' | 'atm' — picks helper variants
 *   merchant:  pool entry (may carry display_variants, parent_group,
 *              display_variants_ar — all optional)
 *   registry:  family-group registry { <groupId>: { acronym, … } } —
 *              optional; pass undefined to skip parent-group prefix
 *
 * Returns the full TransactionInformation string ready to assign.
 */
export function buildDirtyPosNarrative({ rng, channel, prefix, merchant, registry, fx }) {
  const canonical = String(merchant?.name ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ar = arabicDescriptor(merchant, rng);
  const merchantToken = ar || dbaDrift(merchant, rng, canonical);
  const group = parentGroupPrefix(merchant, registry, rng);
  const agg = aggregatorPrefix(rng, channel);
  const terminal = terminalSuffix(rng);
  const emirate = emirateCode(rng);
  const fxTail = fx ? fxClutter(fx.currency, fx.amount, rng) : '';

  const head = `${group}${agg}${merchantToken}`;
  const parts = [head, emirate];
  if (terminal) parts.splice(1, 0, terminal);
  if (fxTail) parts.push(fxTail);
  return bankishNarrative(prefix, parts);
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
