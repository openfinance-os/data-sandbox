// EXP-18 — Underwriting Scenario calculator.
// Pinned formulas per PRD §4.4. Pure functions of (persona, bundle).
//
// Phase 1.5 illustrative formulas — generic, not tied to any specific
// institution's underwriting policy. Each signal exposes its source-field
// contributors so a user can audit how the number was computed.

const ZERO_VOLUME_GUARD = { tx: 50, distinctMonths: 6 };

const FREQUENCY_TO_MONTHLY = {
  Annual: 1 / 12,
  Quarterly: 1 / 3,
  Monthly: 1,
  Fortnightly: 26 / 12,
  Weekly: 52 / 12,
  Daily: 30,
  HalfYearly: 1 / 6,
};

// Pinned mid-market FX rates (AED per unit of foreign currency). Same
// snapshot the FX generator uses, so EXP-18 multi-currency normalisation
// is internally consistent.
const FX_TO_AED = {
  AED: 1,
  USD: 3.6725,
  EUR: 3.95,
  GBP: 4.6,
  INR: 0.044,
  PKR: 0.013,
  PHP: 0.063,
};

function toAed(amount, currency) {
  const rate = FX_TO_AED[currency] ?? 1;
  return amount * rate;
}

function isWithinTrailing12Months(tx, now) {
  const d = new Date(tx.BookingDateTime);
  const horizon = new Date(now.getTime());
  horizon.setUTCMonth(horizon.getUTCMonth() - 12);
  return d >= horizon && d <= now;
}

/**
 * Low-volume guard — trigger when the persona doesn't have enough activity
 * for stable affordability inference. PRD §4.4: <50 transactions OR <6
 * distinct months in the trailing 12-month window.
 */
export function lowVolumeGuard(transactions, now) {
  const inWindow = transactions.filter((t) => isWithinTrailing12Months(t, now));
  const distinctMonths = new Set(
    inWindow.map((t) => t.BookingDateTime.slice(0, 7)),
  ).size;
  const triggered =
    inWindow.length < ZERO_VOLUME_GUARD.tx
    || distinctMonths < ZERO_VOLUME_GUARD.distinctMonths;
  return {
    triggered,
    txCount: inWindow.length,
    distinctMonths,
    reason: triggered
      ? `Only ${inWindow.length} transactions across ${distinctMonths} distinct months in the trailing 12 — below the (${ZERO_VOLUME_GUARD.tx} tx, ${ZERO_VOLUME_GUARD.distinctMonths} months) inference floor.`
      : null,
  };
}

/**
 * Implied monthly net income — PRD §4.4 pinned formula chain:
 *   1. Trailing-12-month average of credits where Flags includes 'Payroll'.
 *   2. Fallback A: largest recurring credit on the same calendar day each
 *      month, recurrence ≥ 3.
 *   3. Fallback B: monthly average of credits from the top recurring
 *      counterparty (clustered by CreditorName), ≥ 6 inflows in 12 months.
 *   4. Final fallback: '—' with explanatory tooltip.
 */
export function computeImpliedIncome(transactions, now) {
  const inWindow = transactions
    .filter((t) => isWithinTrailing12Months(t, now))
    .filter((t) => t.CreditDebitIndicator === 'Credit' && t.Status === 'Booked');

  // Primary: Flags includes 'Payroll'
  const payrollCredits = inWindow.filter((t) => Array.isArray(t.Flags) && t.Flags.includes('Payroll'));
  if (payrollCredits.length >= 6) {
    const sumAed = payrollCredits.reduce((acc, t) => acc + toAed(parseFloat(t.Amount.Amount), t.Amount.Currency), 0);
    return {
      value: sumAed / 12,
      currency: 'AED',
      source: 'primary',
      sourceLabel: 'Trailing-12mo average of Payroll-flagged credits',
      contributors: payrollCredits.map((t) => ({
        TransactionId: t.TransactionId,
        BookingDateTime: t.BookingDateTime,
        Amount: t.Amount,
        CreditorName: t.CreditorName,
        Flags: t.Flags,
      })),
    };
  }

  // Fallback A: largest recurring credit on same calendar day each month
  const byDay = new Map();
  for (const t of inWindow) {
    const day = new Date(t.BookingDateTime).getUTCDate();
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(t);
  }
  let bestDay = null;
  for (const [day, txns] of byDay) {
    if (txns.length < 3) continue;
    if (!bestDay || txns.length > bestDay.txns.length) bestDay = { day, txns };
  }
  if (bestDay) {
    const sumAed = bestDay.txns.reduce((acc, t) => acc + toAed(parseFloat(t.Amount.Amount), t.Amount.Currency), 0);
    return {
      value: sumAed / 12,
      currency: 'AED',
      source: 'fallback-a',
      sourceLabel: `Fallback A — largest recurring credit on day ${bestDay.day} (${bestDay.txns.length} occurrences)`,
      contributors: bestDay.txns.map((t) => ({
        TransactionId: t.TransactionId,
        BookingDateTime: t.BookingDateTime,
        Amount: t.Amount,
        CreditorName: t.CreditorName,
      })),
    };
  }

  // Fallback B: top recurring counterparty (CreditorName cluster)
  const byCounterparty = new Map();
  for (const t of inWindow) {
    const key = t.CreditorName ?? '(unnamed)';
    if (!byCounterparty.has(key)) byCounterparty.set(key, []);
    byCounterparty.get(key).push(t);
  }
  let bestCp = null;
  for (const [cp, txns] of byCounterparty) {
    if (txns.length < 6) continue;
    if (!bestCp || txns.length > bestCp.txns.length) bestCp = { cp, txns };
  }
  if (bestCp) {
    const sumAed = bestCp.txns.reduce((acc, t) => acc + toAed(parseFloat(t.Amount.Amount), t.Amount.Currency), 0);
    return {
      value: sumAed / 12,
      currency: 'AED',
      source: 'fallback-b',
      sourceLabel: `Fallback B — top recurring counterparty "${bestCp.cp}" (${bestCp.txns.length} inflows)`,
      contributors: bestCp.txns.map((t) => ({
        TransactionId: t.TransactionId,
        BookingDateTime: t.BookingDateTime,
        Amount: t.Amount,
        CreditorName: t.CreditorName,
      })),
    };
  }

  return {
    value: null,
    currency: 'AED',
    source: 'none',
    sourceLabel: 'Insufficient income-cadence signal — adjust to your own segment-specific policy.',
    contributors: [],
  };
}

/**
 * Total fixed commitments — sum of NextPaymentAmount across active standing
 * orders + average PreviousPaymentAmount across active direct debits, all
 * normalised to monthly via the resource's Frequency. Multi-currency amounts
 * normalised to AED at the pinned snapshot rate.
 */
export function computeFixedCommitments(standingOrders, directDebits) {
  const contributors = [];
  let totalMonthlyAed = 0;
  for (const so of standingOrders ?? []) {
    if (so.StandingOrderStatusCode && so.StandingOrderStatusCode !== 'Active') continue;
    const amount = parseFloat(so.NextPaymentAmount?.Amount ?? '0');
    const currency = so.NextPaymentAmount?.Currency ?? 'AED';
    const frequencyToMonthly = FREQUENCY_TO_MONTHLY.Monthly;
    const monthlyAed = toAed(amount, currency) * frequencyToMonthly;
    if (Number.isFinite(monthlyAed)) {
      totalMonthlyAed += monthlyAed;
      contributors.push({
        kind: 'standing_order',
        StandingOrderId: so.StandingOrderId,
        Reference: so.Reference,
        Amount: so.NextPaymentAmount,
        monthlyAed,
      });
    }
  }
  for (const dd of directDebits ?? []) {
    if (dd.DirectDebitStatusCode && dd.DirectDebitStatusCode !== 'Active') continue;
    const amount = parseFloat(dd.PreviousPaymentAmount?.Amount ?? '0');
    const currency = dd.PreviousPaymentAmount?.Currency ?? 'AED';
    const factor = FREQUENCY_TO_MONTHLY[dd.Frequency] ?? 1;
    const monthlyAed = toAed(amount, currency) * factor;
    if (Number.isFinite(monthlyAed)) {
      totalMonthlyAed += monthlyAed;
      contributors.push({
        kind: 'direct_debit',
        DirectDebitId: dd.DirectDebitId,
        Name: dd.Name,
        Frequency: dd.Frequency,
        Amount: dd.PreviousPaymentAmount,
        monthlyAed,
      });
    }
  }
  return { value: totalMonthlyAed, currency: 'AED', contributors };
}

/**
 * Implied DBR = commitments / income, expressed as percentage.
 * Undefined if income is null/zero/negative.
 */
export function computeDBR(income, commitments) {
  if (!income.value || income.value <= 0) {
    return { value: null, reason: 'Implied monthly net income is null or non-positive.' };
  }
  const dbr = commitments.value / income.value;
  return { value: dbr, label: `${(dbr * 100).toFixed(1)}%` };
}

/**
 * NSF / distress event count — Status=Rejected OR debit posting on a day
 * the account's ClosingBooked balance was negative. Phase 1.5 minimum
 * counts only Status=Rejected (we don't yet emit per-day balance series).
 */
export function computeNsfCount(transactions, now) {
  const inWindow = transactions
    .filter((t) => isWithinTrailing12Months(t, now))
    .filter((t) => t.Status === 'Rejected');
  return {
    value: inWindow.length,
    contributors: inWindow.map((t) => ({
      TransactionId: t.TransactionId,
      BookingDateTime: t.BookingDateTime,
      Amount: t.Amount,
      TransactionInformation: t.TransactionInformation,
    })),
  };
}

/**
 * Compute all four signals. The low-volume guard wraps the result —
 * downstream UIs should suppress DBR display when triggered.
 */
export function computeUnderwriting(bundle, now = new Date()) {
  const guard = lowVolumeGuard(bundle.transactions ?? [], now);
  const income = computeImpliedIncome(bundle.transactions ?? [], now);
  const commitments = computeFixedCommitments(bundle.standingOrders ?? [], bundle.directDebits ?? []);
  const dbr = guard.triggered
    ? { value: null, reason: 'Suppressed — low-volume guard triggered (see top of panel).' }
    : computeDBR(income, commitments);
  const nsf = computeNsfCount(bundle.transactions ?? [], now);
  return { guard, income, commitments, dbr, nsf };
}

export const UNDERWRITING_FOOTNOTE =
  'Generic / illustrative. Not tied to any specific institution\'s underwriting policy. Adjust to your own policy when applying.';
