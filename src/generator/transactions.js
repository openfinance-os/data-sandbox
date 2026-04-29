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
      const salary = makeSalary({
        rng,
        persona,
        date: dateForDay(monthStart, persona.income.pay_day),
        accountId: account.AccountId,
        currency: account.Currency,
        employerName: drawEmployer(rng, pools.employers),
        txState,
      });
      out.push(salary);
      runningBalance.balance += persona.income.monthly_amount_aed;
    }

    if (account._meta.kind === 'CurrentAccount') {
      for (const c of persona.fixed_commitments ?? []) {
        const day = parseScheduleDay(c.schedule);
        if (day == null) continue;
        const amount = c.amount_aed ?? rngInt(rng, c.amount_aed_band[0], c.amount_aed_band[1] + 1);
        const txDate = dateForDay(monthStart, day);
        out.push(makeFixedCommitment({
          rng, account, date: txDate, amount,
          purpose: c.purpose, kind: c.kind, txState,
        }));
        runningBalance.balance -= amount;
      }

      const groceriesCount = rngInt(rng, 4, 9);
      for (let i = 0; i < groceriesCount; i++) {
        const merchant = drawMerchant(rng, pools.groceries);
        const amount = rngInt(rng, merchant.typical_amount_aed_band[0], merchant.typical_amount_aed_band[1] + 1);
        const day = rngInt(rng, 1, 28);
        out.push(makePosTransaction({
          rng, account, date: dateForDay(monthStart, day),
          amount, merchant, mcc: pools.groceries.mcc, txState,
        }));
        runningBalance.balance -= amount;
      }
      const fuelCount = rngInt(rng, 2, 5);
      for (let i = 0; i < fuelCount; i++) {
        const merchant = drawMerchant(rng, pools.fuel);
        const amount = rngInt(rng, merchant.typical_amount_aed_band[0], merchant.typical_amount_aed_band[1] + 1);
        const day = rngInt(rng, 1, 28);
        out.push(makePosTransaction({
          rng, account, date: dateForDay(monthStart, day),
          amount, merchant, mcc: pools.fuel.mcc, txState,
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
          rng, account, date: dateForDay(monthStart, day),
          amount, merchant, mcc: pools.dining.mcc, txState,
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
          rng, account, date: dateForDay(monthStart, day),
          amount, merchant, mcc: pools.dining.mcc, txState,
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
          rng, account, date: dateForDay(monthStart, day), amount, txState,
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
          rng, account, date: dateForDay(monthStart, day),
          aedAmount, fxAmount, fxCurrency, exchangeRate, txState,
        }));
        runningBalance.balance -= aedAmount;
      }
    }

    // NSF / distressed-borrower signal — rare per-month event for personas
    // whose distress_signals.nsf_events_per_year_band has an upper bound > 0.
    const nsfHi = persona.distress_signals?.nsf_events_per_year_band?.[1] ?? 0;
    if (nsfHi > 0 && account._meta.kind === 'CurrentAccount') {
      // Roughly target the per-month frequency by upper-bound / 12.
      const probability = Math.min(0.5, nsfHi / 12);
      if (rng() < probability) {
        const day = rngInt(rng, 1, 28);
        const amount = rngInt(rng, 250, 1500);
        out.push(makeNsfRejection({
          rng, account, date: dateForDay(monthStart, day), amount, txState,
        }));
        // Rejected transactions don't move the balance, by design.
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

function makeCashDeposit({ rng, account, date, amount, txState }) {
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, date, txState),
    TransactionReference: `CASH${rngInt(rng, 100000, 999999)}`,
    CreditDebitIndicator: 'Credit',
    Status: 'Booked',
    BookingDateTime: isoOf(date),
    TransactionDateTime: isoOf(date),
    ValueDateTime: isoOf(date),
    TransactionInformation: 'Cash deposit (teller)',
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: 'Teller',
    SubTransactionType: 'Deposit',
    _v: rng(),
  };
}

function makeFxTransaction({ rng, account, date, aedAmount, fxAmount, fxCurrency, exchangeRate, txState }) {
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, date, txState),
    TransactionReference: `FX${rngInt(rng, 100000, 999999)}`,
    CreditDebitIndicator: 'Debit',
    Status: 'Booked',
    BookingDateTime: isoOf(date),
    TransactionDateTime: isoOf(date),
    ValueDateTime: isoOf(date),
    TransactionInformation: `International transfer (${fxCurrency})`,
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

function makeNsfRejection({ rng, account, date, amount, txState }) {
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, date, txState),
    TransactionReference: `NSF${rngInt(rng, 100000, 999999)}`,
    CreditDebitIndicator: 'Debit',
    Status: 'Rejected',
    BookingDateTime: isoOf(date),
    TransactionDateTime: isoOf(date),
    ValueDateTime: isoOf(date),
    TransactionInformation: 'Direct debit returned — insufficient funds',
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: 'BillPayments',
    SubTransactionType: 'Reversal',
    _v: rng(),
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

function nextTxId(account, date, txState) {
  txState.counter = (txState.counter + 1) >>> 0;
  return `${account.AccountId}-tx-${date.toISOString().slice(0, 10)}-${String(txState.counter % 100000).padStart(5, '0')}`;
}

function makeSalary({ rng, persona, date, accountId, currency, employerName, txState }) {
  return {
    _accountId: accountId,
    TransactionId: nextTxId({ AccountId: accountId }, date, txState),
    TransactionReference: `SAL${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`,
    CreditDebitIndicator: 'Credit',
    Status: 'Booked',
    BookingDateTime: isoOf(date),
    TransactionDateTime: isoOf(date),
    ValueDateTime: isoOf(date),
    TransactionInformation: `Salary credit — ${employerName}`,
    Amount: { Amount: persona.income.monthly_amount_aed.toFixed(2), Currency: currency },
    TransactionType: 'LocalBankTransfer',
    SubTransactionType: 'Deposit',
    Flags: ['Payroll'],
    _v: rng(),
  };
}

function makeFixedCommitment({ rng, account, date, amount, purpose, kind, txState }) {
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, date, txState),
    TransactionReference: `${purpose.toUpperCase().slice(0, 6)}${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`,
    CreditDebitIndicator: 'Debit',
    Status: 'Booked',
    BookingDateTime: isoOf(date),
    TransactionDateTime: isoOf(date),
    ValueDateTime: isoOf(date),
    TransactionInformation: `${kind === 'standing_order' ? 'Standing order' : 'Direct debit'} — ${purpose.replace(/_/g, ' ')}`,
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: kind === 'standing_order' ? 'LocalBankTransfer' : 'BillPayments',
    SubTransactionType: 'Repayments',
    Flags: [kind === 'standing_order' ? 'StandingOrder' : 'DirectDebit'],
    _v: rng(),
  };
}

function makePosTransaction({ rng, account, date, amount, merchant, mcc, isCreditCard = false, txState }) {
  return {
    _accountId: account.AccountId,
    TransactionId: nextTxId(account, date, txState),
    TransactionReference: `POS${rngInt(rng, 100000, 999999)}`,
    CreditDebitIndicator: 'Debit',
    Status: 'Booked',
    BookingDateTime: isoOf(date),
    TransactionDateTime: isoOf(date),
    ValueDateTime: isoOf(date),
    TransactionInformation: merchant.name,
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: 'POS',
    SubTransactionType: 'Purchase',
    MerchantDetails: { MerchantName: merchant.name, MerchantCategoryCode: mcc },
    _isCreditCard: isCreditCard,
  };
}

void rngPick;
