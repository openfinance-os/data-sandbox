// Transaction generation — narrative-coherent, EXP-06.
// Salaries arrive on payday with Flags=Payroll; rent direct debits hit 0–3
// days after; merchant categories cluster (groceries, fuel, dining); FX only
// on FX-active personas; cash deposits only on cash-heavy personas.
//
// All wall-clock dependence is removed: callers pass a `now` anchor that is
// deterministic from the build (typically SPEC_PIN.retrieved), preserving
// EXP-05 across cold starts. The transaction-id counter is scoped to the
// caller's `txState` object so two buildBundle invocations don't collide.

import { rngInt, rngPick } from '../prng.js';
import { drawMerchant, drawEmployer } from './identity.js';
import {
  bankishNarrative,
  weekdayBias,
  pickPostingTime,
  withPostingTime,
  fractionalAmount,
  valueDateOffset,
  referenceNumber,
  pendingForRecent,
} from './realism.js';

const TWELVE_MONTHS = 12;

export function generateTransactions({ persona, account, rng, pools, runningBalance, now, txState }) {
  const out = [];
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);

  for (let m = TWELVE_MONTHS - 1; m >= 0; m--) {
    const monthStart = new Date(today);
    monthStart.setDate(1);
    monthStart.setMonth(monthStart.getMonth() - m);

    if (persona.income && persona.income.flag_payroll && account._meta.kind === 'CurrentAccount') {
      const salaryDate = weekdayBias(dateForDay(monthStart, persona.income.pay_day), rng);
      const salary = makeSalary({
        rng,
        persona,
        date: salaryDate,
        accountId: account.AccountId,
        currency: account.Currency,
        employerName: drawEmployer(rng, pools.employers),
        txState,
        now,
      });
      out.push(salary);
      runningBalance.balance += persona.income.monthly_amount_aed;
    }

    if (account._meta.kind === 'CurrentAccount') {
      for (const c of persona.fixed_commitments ?? []) {
        const day = parseScheduleDay(c.schedule);
        if (day == null) continue;
        const amount = c.amount_aed ?? rngInt(rng, c.amount_aed_band[0], c.amount_aed_band[1] + 1);
        const txDate = weekdayBias(dateForDay(monthStart, day), rng);
        out.push(makeFixedCommitment({
          rng, account, date: txDate, amount,
          purpose: c.purpose, kind: c.kind, txState, now,
        }));
        runningBalance.balance -= amount;
      }

      const groceriesCount = rngInt(rng, 4, 9);
      for (let i = 0; i < groceriesCount; i++) {
        const merchant = drawMerchant(rng, pools.groceries);
        const amount = rngInt(rng, merchant.typical_amount_aed_band[0], merchant.typical_amount_aed_band[1] + 1);
        const day = rngInt(rng, 1, 28);
        out.push(makePosTransaction({
          rng, account, date: weekdayBias(dateForDay(monthStart, day), rng, 0.4),
          amount, merchant, mcc: pools.groceries.mcc, txState, now, mccCategory: 'GRC',
        }));
        runningBalance.balance -= amount;
      }
      const fuelCount = rngInt(rng, 2, 5);
      for (let i = 0; i < fuelCount; i++) {
        const merchant = drawMerchant(rng, pools.fuel);
        const amount = rngInt(rng, merchant.typical_amount_aed_band[0], merchant.typical_amount_aed_band[1] + 1);
        const day = rngInt(rng, 1, 28);
        out.push(makePosTransaction({
          rng, account, date: weekdayBias(dateForDay(monthStart, day), rng, 0.4),
          amount, merchant, mcc: pools.fuel.mcc, txState, now, mccCategory: 'FUEL',
        }));
        runningBalance.balance -= amount;
      }
      const diningCount = rngInt(
        rng,
        persona.spend_profile?.dining_per_month_count_band?.[0] ?? 4,
        (persona.spend_profile?.dining_per_month_count_band?.[1] ?? 12) + 1
      );
      for (let i = 0; i < diningCount; i++) {
        const merchant = drawMerchant(rng, pools.dining);
        const amount = rngInt(rng, merchant.typical_amount_aed_band[0], merchant.typical_amount_aed_band[1] + 1);
        const day = rngInt(rng, 1, 28);
        out.push(makePosTransaction({
          rng, account, date: weekdayBias(dateForDay(monthStart, day), rng, 0.3),
          amount, merchant, mcc: pools.dining.mcc, txState, now, mccCategory: 'DIN',
        }));
        runningBalance.balance -= amount;
      }
    }

    if (account._meta.kind === 'CreditCard') {
      const txCount = rngInt(rng, 6, 14);
      for (let i = 0; i < txCount; i++) {
        const merchant = drawMerchant(rng, pools.dining);
        const amount = rngInt(rng, 80, 600);
        const day = rngInt(rng, 1, 28);
        out.push(makePosTransaction({
          rng, account, date: weekdayBias(dateForDay(monthStart, day), rng, 0.3),
          amount, merchant, mcc: pools.dining.mcc, txState, now, mccCategory: 'DIN',
          isCreditCard: true,
        }));
      }
    }

    // Cash deposits — only on cash-heavy personas (EXP-06).
    if (persona.cash_deposit_activity && account._meta.kind === 'CurrentAccount') {
      const lo = persona.cash_deposits_per_month_band?.[0] ?? 3;
      const hi = persona.cash_deposits_per_month_band?.[1] ?? 10;
      const count = rngInt(rng, lo, hi + 1);
      const amtLo = persona.cash_deposit_amount_aed_band?.[0] ?? 500;
      const amtHi = persona.cash_deposit_amount_aed_band?.[1] ?? 5000;
      for (let i = 0; i < count; i++) {
        const day = rngInt(rng, 1, 28);
        const amount = rngInt(rng, amtLo, amtHi + 1);
        out.push(makeCashDeposit({
          rng, account, date: weekdayBias(dateForDay(monthStart, day), rng, 0.85), amount, txState, now,
        }));
        runningBalance.balance += amount;
      }
    }

    // FX transactions — only on FX-active personas (EXP-06).
    if (persona.fx_activity && account._meta.kind === 'CurrentAccount') {
      const lo = persona.fx_transactions_per_month_band?.[0] ?? 1;
      const hi = persona.fx_transactions_per_month_band?.[1] ?? 4;
      const count = rngInt(rng, lo, hi + 1);
      for (let i = 0; i < count; i++) {
        const day = rngInt(rng, 1, 28);
        const fxCurrency = rngPick(rng, persona.fx_currencies ?? ['USD', 'EUR', 'GBP']);
        const fxAmount = rngInt(rng, 200, 5000);
        const exchangeRate = fxRateFor(fxCurrency);
        const aedAmount = Math.round(fxAmount * exchangeRate);
        out.push(makeFxTransaction({
          rng, account, date: weekdayBias(dateForDay(monthStart, day), rng, 0.9),
          aedAmount, fxAmount, fxCurrency, exchangeRate, txState, now,
        }));
        runningBalance.balance -= aedAmount;
      }
    }

    // NSF / distressed-borrower signal — rare per-month event. Real cores
    // emit BOTH the failed attempt (Rejected) AND a small return-fee debit
    // (Booked) charged to the customer for the bounce.
    const nsfHi = persona.distress_signals?.nsf_events_per_year_band?.[1] ?? 0;
    if (nsfHi > 0 && account._meta.kind === 'CurrentAccount') {
      const probability = Math.min(0.5, nsfHi / 12);
      if (rng() < probability) {
        const day = rngInt(rng, 1, 28);
        const amount = rngInt(rng, 250, 1500);
        const nsfDate = weekdayBias(dateForDay(monthStart, day), rng, 0.7);
        const purpose = rngPick(rng, ['DEWA', 'TELCO', 'LOAN', 'INSUR']);
        out.push(makeNsfRejection({
          rng, account, date: nsfDate, amount, txState, now, purpose,
        }));
        // Bounce fee — small Booked debit the customer pays for the rejection.
        const feeAmount = rngPick(rng, [25, 50, 100]);
        out.push(makeNsfFee({
          rng, account, date: nsfDate, amount: feeAmount, txState, now, purpose,
        }));
        runningBalance.balance -= feeAmount;
      }
    }
  }

  out.sort((a, b) => a.BookingDateTime.localeCompare(b.BookingDateTime));
  return out;
}

function fxRateFor(ccy) {
  // Pinned mid-market rate snapshot (AED per unit of foreign currency).
  // Phase 1.5 EXP-18 multi-currency normalisation will publish this table
  // alongside the spec SHA so it's deterministic across rebuilds.
  switch (ccy) {
    case 'USD': return 3.6725;
    case 'EUR': return 3.95;
    case 'GBP': return 4.6;
    case 'INR': return 0.044;
    case 'PKR': return 0.013;
    case 'PHP': return 0.063;
    default: return 1.0;
  }
}

function makeCashDeposit({ rng, account, date, amount, txState, now }) {
  const posted = applyPostingTime(date, rng);
  const branch = String(rngInt(rng, 100, 999));
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, posted, txState),
    TransactionReference: referenceNumber(rng, 'Teller', posted),
    CreditDebitIndicator: 'Credit',
    Status: maybePending(posted, now, rng),
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: isoOf(posted),
    TransactionInformation: bankishNarrative('CSH', ['DEP', `BR${branch}`]),
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: 'Teller',
    SubTransactionType: 'Deposit',
    _v: rng(),
  };
}

function makeFxTransaction({ rng, account, date, aedAmount, fxAmount, fxCurrency, exchangeRate, txState, now }) {
  const posted = applyPostingTime(date, rng);
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, posted, txState),
    TransactionReference: referenceNumber(rng, 'InternationalTransfer', posted),
    CreditDebitIndicator: 'Debit',
    Status: maybePending(posted, now, rng),
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: valueDateOf(posted, 'InternationalTransfer', rng),
    TransactionInformation: bankishNarrative('FX', [`${account.Currency}-${fxCurrency}`, 'IBT']),
    Amount: { Amount: aedAmount.toFixed(2), Currency: account.Currency },
    TransactionType: 'InternationalTransfer',
    SubTransactionType: 'MoneyTransfer',
    CurrencyExchange: {
      SourceCurrency: account.Currency,
      TargetCurrency: fxCurrency,
      UnitCurrency: account.Currency,
      ExchangeRate: parseFloat(exchangeRate.toFixed(4)),
      InstructedAmount: { Amount: fxAmount.toFixed(2), Currency: fxCurrency },
    },
    _v: rng(),
  };
}

function makeNsfRejection({ rng, account, date, amount, txState, now, purpose = 'DD' }) {
  const posted = applyPostingTime(date, rng);
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, posted, txState),
    TransactionReference: referenceNumber(rng, 'BillPayments', posted, purpose),
    CreditDebitIndicator: 'Debit',
    Status: 'Rejected',
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: isoOf(posted),
    TransactionInformation: bankishNarrative('DD', ['RTRN', 'INSF FUNDS']),
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: 'BillPayments',
    SubTransactionType: 'Reversal',
    _v: rng(),
  };
}

function makeNsfFee({ rng, account, date, amount, txState, now, purpose = 'DD' }) {
  // Bounce fee — the small Booked debit the customer pays for the rejection.
  // Real cores often post this same-day or T+1 with TransactionType=BillPayments.
  const posted = applyPostingTime(date, rng);
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, posted, txState),
    TransactionReference: referenceNumber(rng, 'BillPayments', posted, 'NSFE'),
    CreditDebitIndicator: 'Debit',
    Status: 'Booked',
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: valueDateOf(posted, 'BillPayments', rng),
    TransactionInformation: bankishNarrative('FEE', ['NSF', purpose]),
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: 'BillPayments',
    SubTransactionType: 'Fee',
    _v: rng(),
    _now: now,
  };
}

function parseScheduleDay(schedule) {
  const m = /^monthly_(\d{1,2})$/.exec(schedule);
  if (m) return parseInt(m[1], 10);
  return null;
}

function dateForDay(monthStart, day) {
  const d = new Date(monthStart);
  d.setDate(Math.min(day, 28));
  d.setHours(11, 0, 0, 0);
  return d;
}

function isoOf(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function applyPostingTime(date, rng) {
  return withPostingTime(date, pickPostingTime(rng));
}

function valueDateOf(date, transactionType, rng) {
  const offset = valueDateOffset(transactionType, rng);
  if (offset === 0) return isoOf(date);
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + offset);
  return isoOf(d);
}

function nextTxId(account, date, txState) {
  txState.counter = (txState.counter + 1) >>> 0;
  return `${account.AccountId}-tx-${date.toISOString().slice(0, 10)}-${String(txState.counter % 100000).padStart(5, '0')}`;
}

function makeSalary({ rng, persona, date, accountId, currency, employerName, txState, now }) {
  // Salaries post in the early-morning batch — a bank-core specific tell.
  const posted = withPostingTime(date, { h: 4, m: 30 });
  const employerSlug = String(employerName).split(/\s+/).slice(0, 2).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return {
    _accountId: accountId,
    TransactionId: nextTxId({ AccountId: accountId }, posted, txState),
    TransactionReference: referenceNumber(rng, 'LocalBankTransfer', posted, 'SAL'),
    CreditDebitIndicator: 'Credit',
    Status: 'Booked',
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: isoOf(posted),
    TransactionInformation: bankishNarrative('SAL', ['PAYROLL', employerSlug]),
    CreditorName: employerName, // structured field stays clean for downstream parsing
    Amount: { Amount: persona.income.monthly_amount_aed.toFixed(2), Currency: currency },
    TransactionType: 'LocalBankTransfer',
    SubTransactionType: 'Deposit',
    Flags: ['Payroll'],
    _v: rng(),
    _now: now,
  };
}

function makeFixedCommitment({ rng, account, date, amount, purpose, kind, txState, now }) {
  const posted = applyPostingTime(date, rng);
  const txType = kind === 'standing_order' ? 'LocalBankTransfer' : 'BillPayments';
  const billerHint = purpose.split('_')[0].toUpperCase();
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, posted, txState),
    TransactionReference: referenceNumber(rng, txType, posted, billerHint),
    CreditDebitIndicator: 'Debit',
    Status: maybePending(posted, now, rng),
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: valueDateOf(posted, txType, rng),
    TransactionInformation: bankishNarrative(
      kind === 'standing_order' ? 'SO' : 'DD',
      [billerHint, String(rngInt(rng, 1000, 9999))]
    ),
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: txType,
    SubTransactionType: 'Repayments',
    Flags: [kind === 'standing_order' ? 'StandingOrder' : 'DirectDebit'],
    _v: rng(),
  };
}

function makePosTransaction({ rng, account, date, amount, merchant, mcc, isCreditCard = false, txState, now, mccCategory = 'POS' }) {
  const posted = applyPostingTime(date, rng);
  // Real POS amounts carry fils precision — typical retail pricing patterns.
  const amt = fractionalAmount(rng, amount);
  // Bank narratives often cap at ~22 chars and cram merchant + city. Synthetic
  // pool merchants are 2-3 words; truncate aggressively.
  const merchantToken = merchant.name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, posted, txState),
    TransactionReference: referenceNumber(rng, 'POS', posted),
    CreditDebitIndicator: 'Debit',
    Status: maybePending(posted, now, rng),
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: isoOf(posted),
    TransactionInformation: bankishNarrative('POS', [merchantToken, 'DXB']),
    Amount: { Amount: amt.toFixed(2), Currency: account.Currency },
    TransactionType: 'POS',
    SubTransactionType: 'Purchase',
    MerchantDetails: { MerchantName: merchant.name, MerchantCategoryCode: mcc },
    _isCreditCard: isCreditCard,
    _mccCategory: mccCategory,
  };
}

function maybePending(date, now, rng) {
  if (now && pendingForRecent(date, now, rng)) return 'Pending';
  return 'Booked';
}

void rngPick;
