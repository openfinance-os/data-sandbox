// Transaction generation — narrative-coherent, EXP-06.
// Salaries arrive on payday with Flags=Payroll; rent direct debits hit 0–3
// days after; merchant categories cluster (groceries, fuel, dining); FX only
// on FX-active personas; cash deposits only on cash-heavy personas.
//
// All wall-clock dependence is removed: callers pass a `now` anchor that is
// deterministic from the build (typically SPEC_PIN.retrieved), preserving
// EXP-05 across cold starts. The transaction-id counter is scoped to the
// caller's `txState` object so two buildBundle invocations don't collide.

import { makePrng, rngInt, rngPick } from '../prng.js';
import { drawMerchant, drawEmployer, drawCounterparty } from './identity.js';
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
import { vatTreatmentForPool, computeVatBreakdown } from './vat.js';

const TWELVE_MONTHS = 12;

// Per-category knobs for the merchant-spend loop. The PRNG draw order across
// categories is load-bearing for EXP-05 (deterministic-replay), so this list
// is iterated in declaration order and each category contributes the same
// sequence of draws as the pre-refactor inline loops did:
//   1× count via monthlyCountFromSpend, then per-tx: drawMerchant → rngInt
//   amount → rngInt day → weekdayBias internal draws → optional pending mark.
// `weekdayBiasFactor` and `defaultCountBand` reproduce the per-loop literals
// from the pre-extraction version.
const SPEND_CATEGORIES = [
  { id: 'groceries', mccCategory: 'GRC',  weekdayBiasFactor: 0.4, defaultCountBand: [4, 9],
    countBandKey: 'groceries_per_month_count_band', aedBandKey: 'groceries_aed_per_month_band' },
  { id: 'fuel',      mccCategory: 'FUEL', weekdayBiasFactor: 0.4, defaultCountBand: [2, 5],
    countBandKey: 'fuel_per_month_count_band',      aedBandKey: 'fuel_aed_per_month_band' },
  { id: 'dining',    mccCategory: 'DIN',  weekdayBiasFactor: 0.3, defaultCountBand: [4, 12],
    countBandKey: 'dining_per_month_count_band',    aedBandKey: 'dining_aed_per_month_band' },
];

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

      for (const cat of SPEND_CATEGORIES) {
        const pool = pools[cat.id];
        const count = monthlyCountFromSpend({
          rng,
          countBand: persona.spend_profile?.[cat.countBandKey],
          aedBand: persona.spend_profile?.[cat.aedBandKey],
          pool,
          defaultBand: cat.defaultCountBand,
        });
        for (let i = 0; i < count; i++) {
          const merchant = drawMerchant(rng, pool);
          const amount = rngInt(rng, merchant.typical_amount_aed_band[0], merchant.typical_amount_aed_band[1] + 1);
          const day = rngInt(rng, 1, 28);
          out.push(makePosTransaction({
            rng, account, date: weekdayBias(dateForDay(monthStart, day), rng, cat.weekdayBiasFactor),
            amount, merchant, mcc: pool.mcc, txState, now, mccCategory: cat.mccCategory,
          }));
          runningBalance.balance -= amount;
        }
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

    // Slice 10 — B2B inflows / outflows from cash_flow manifest block,
    // with UAE VAT breakdowns. Only on the FIRST CurrentAccount in the
    // bundle (typical SME operating account); other accounts get the
    // existing flows unchanged.
    if (
      account._meta.kind === 'CurrentAccount' &&
      idxOfCurrentAccount(persona, account) === 0 &&
      persona.cash_flow
    ) {
      const cf = persona.cash_flow;
      if (cf.customer_inflows?.counterparty_pool && pools.counterparties) {
        const pool = pools.counterparties[cf.customer_inflows.counterparty_pool];
        if (pool) {
          const lo = cf.customer_inflows.monthly_amount_aed_band?.[0] ?? 10000;
          const hi = cf.customer_inflows.monthly_amount_aed_band?.[1] ?? 50000;
          const cadence = cf.customer_inflows.invoice_cadence ?? 'monthly';
          const perMonth = cadenceToCount(cadence);
          for (let i = 0; i < perMonth; i++) {
            const day = rngInt(rng, 1, 28);
            const gross = rngInt(rng, lo, hi + 1) / perMonth;
            const txDate = weekdayBias(dateForDay(monthStart, day), rng);
            out.push(makeB2bInflow({
              rng, account, date: txDate, grossAmount: Math.round(gross),
              counterparty: drawCounterparty(rng, pool),
              poolId: cf.customer_inflows.counterparty_pool,
              txState, now,
            }));
            runningBalance.balance += Math.round(gross);
          }
        }
      }
      if (cf.supplier_outflows?.counterparty_pool && pools.counterparties) {
        const pool = pools.counterparties[cf.supplier_outflows.counterparty_pool];
        if (pool) {
          const lo = cf.supplier_outflows.monthly_amount_aed_band?.[0] ?? 5000;
          const hi = cf.supplier_outflows.monthly_amount_aed_band?.[1] ?? 30000;
          // Suppliers are paid less frequently than customers invoice —
          // assume monthly cadence (one paid invoice per supplier per month).
          for (let i = 0; i < 1; i++) {
            const day = rngInt(rng, 1, 28);
            const gross = rngInt(rng, lo, hi + 1);
            const txDate = weekdayBias(dateForDay(monthStart, day), rng);
            out.push(makeB2bOutflow({
              rng, account, date: txDate, grossAmount: gross,
              counterparty: drawCounterparty(rng, pool),
              poolId: cf.supplier_outflows.counterparty_pool,
              txState, now,
            }));
            runningBalance.balance -= gross;
          }
        }
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
    // AETransaction spec has no top-level CreditorName field. The employer
    // (the debtor on a salary credit) lives in DebtorAccount.Name —
    // AECashAccount6_1 permits Name. Underwriting / downstream readers
    // pick this up via the spec-correct path. The IBAN draw uses a
    // side-channel PRNG seeded on (accountId, posted-iso-date) so the
    // main `rng` state is preserved — no downstream tx-count drift on
    // personas whose transaction sequence depends on rng position.
    DebtorAgent: { SchemeName: 'BICFI', Identification: 'SYNAEAA', Name: employerName },
    DebtorAccount: {
      SchemeName: 'IBAN',
      Identification: synthEmployerIbanFor(accountId, posted),
      Name: employerName,
    },
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

// Resolve a per-month transaction count from a persona's spend_profile.
// Personas may declare either an explicit count band (`*_per_month_count_band`)
// or an AED-spend band (`*_aed_per_month_band`). The AED form is what most
// curated personas use; we derive a count from the band's mid-point divided
// by the merchant pool's average typical-tx amount.
function monthlyCountFromSpend({ rng, countBand, aedBand, pool, defaultBand }) {
  if (Array.isArray(countBand) && countBand.length === 2) {
    return rngInt(rng, countBand[0], countBand[1] + 1);
  }
  if (Array.isArray(aedBand) && aedBand.length === 2) {
    const monthlyAed = rngInt(rng, aedBand[0], aedBand[1] + 1);
    if (monthlyAed === 0) return 0;
    const avgTx = poolAverageTypicalAed(pool);
    if (!Number.isFinite(avgTx) || avgTx <= 0) return rngInt(rng, defaultBand[0], defaultBand[1] + 1);
    return Math.max(1, Math.round(monthlyAed / avgTx));
  }
  return rngInt(rng, defaultBand[0], defaultBand[1] + 1);
}

function poolAverageTypicalAed(pool) {
  const merchants = pool?.merchants ?? [];
  if (merchants.length === 0) return NaN;
  let sum = 0;
  for (const m of merchants) {
    const band = m.typical_amount_aed_band;
    if (Array.isArray(band) && band.length === 2) sum += (band[0] + band[1]) / 2;
  }
  return sum / merchants.length;
}

void rngPick;

// ─── Slice 10: B2B + VAT helpers ────────────────────────────────────────

function idxOfCurrentAccount(persona, account) {
  // Position of `account` among the persona's CurrentAccounts. Used to
  // gate the B2B-flow generation to the first operating account only.
  let n = 0;
  for (const spec of persona.accounts ?? []) {
    if (spec.type !== 'CurrentAccount') continue;
    const expectedId = `${persona.persona_id.replace(/_/g, '-')}-acct-${String(persona.accounts.indexOf(spec) + 1).padStart(2, '0')}`;
    if (expectedId === account.AccountId) return n;
    n += 1;
  }
  return -1;
}

function cadenceToCount(cadence) {
  // Translates persona.cash_flow.customer_inflows.invoice_cadence into
  // a per-month invoice count. Monthly = 1, biweekly = 2, weekly = 4,
  // irregular ~= 1.5.
  switch (cadence) {
    case 'weekly':   return 4;
    case 'biweekly': return 2;
    case 'monthly':  return 1;
    case 'irregular': return 2;
    default: return 1;
  }
}

function makeB2bInflow({ rng, account, date, grossAmount, counterparty, poolId, txState, now }) {
  const posted = applyPostingTime(date, rng);
  const treatment = vatTreatmentForPool(poolId);
  return {
    _accountId: account.AccountId,
    _vatBreakdown: computeVatBreakdown(grossAmount, account.Currency, treatment),
    TransactionId: nextTxId(account, posted, txState),
    TransactionReference: referenceNumber(rng, 'LocalBankTransfer', posted, 'INV'),
    CreditDebitIndicator: 'Credit',
    Status: maybePending(posted, now, rng),
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: valueDateOf(posted, 'LocalBankTransfer', rng),
    TransactionInformation: bankishNarrative('IBT', ['INVOICE', 'CR', counterparty.slice(0, 12).toUpperCase()]),
    Amount: { Amount: grossAmount.toFixed(2), Currency: account.Currency },
    TransactionType: 'LocalBankTransfer',
    SubTransactionType: 'MoneyTransfer',
    DebtorAgent: { SchemeName: 'BICFI', Identification: 'SYNAEAA', Name: counterparty },
    DebtorAccount: { SchemeName: 'IBAN', Identification: synthCounterpartyIban(rng), Name: counterparty },
  };
}

function makeB2bOutflow({ rng, account, date, grossAmount, counterparty, poolId, txState, now }) {
  const posted = applyPostingTime(date, rng);
  const treatment = vatTreatmentForPool(poolId);
  // International suppliers go via InternationalTransfer (cross-border);
  // local b2b via LocalBankTransfer. Heuristic on poolId.
  const isIntl = poolId === 'b2b_intl' || poolId === 'cloud_suppliers';
  const txType = isIntl ? 'InternationalTransfer' : 'LocalBankTransfer';
  return {
    _accountId: account.AccountId,
    _vatBreakdown: computeVatBreakdown(grossAmount, account.Currency, treatment),
    TransactionId: nextTxId(account, posted, txState),
    TransactionReference: referenceNumber(rng, txType, posted, 'AP'),
    CreditDebitIndicator: 'Debit',
    Status: maybePending(posted, now, rng),
    BookingDateTime: isoOf(posted),
    TransactionDateTime: isoOf(posted),
    ValueDateTime: valueDateOf(posted, txType, rng),
    TransactionInformation: bankishNarrative(isIntl ? 'IBT' : 'LBT', ['SUPP', counterparty.slice(0, 12).toUpperCase()]),
    Amount: { Amount: grossAmount.toFixed(2), Currency: account.Currency },
    TransactionType: txType,
    SubTransactionType: 'MoneyTransfer',
    CreditorAgent: { SchemeName: 'BICFI', Identification: 'SYNAEAA', Name: counterparty },
    CreditorAccount: [
      { SchemeName: 'IBAN', Identification: synthCounterpartyIban(rng), Name: counterparty },
    ],
  };
}

function synthEmployerIbanFor(accountId, posted) {
  // Side-channel deterministic IBAN keyed on (accountId, posted-iso-date)
  // so the main generator rng state is unaffected — adding the salary
  // DebtorAccount.Identification post-hoc must not shift downstream
  // tx-count distributions for any persona.
  const isoDate = posted.toISOString().slice(0, 10);
  const sideRng = makePrng(accountId, 'salary-debtor-iban', isoDate);
  let account = '';
  for (let i = 0; i < 16; i++) account += rngInt(sideRng, 0, 10);
  const bban = '999' + account;
  return `AE${b2bIbanCheck(bban)}${bban}`;
}

function synthCounterpartyIban(rng) {
  // Mod-97-valid synthetic counterparty IBAN. Bank_code "999" tags it
  // as anonymous-synthetic (not bound to any named pool bank).
  let account = '';
  for (let i = 0; i < 16; i++) account += rngInt(rng, 0, 10);
  const bban = '999' + account;
  return `AE${b2bIbanCheck(bban)}${bban}`;
}

function b2bIbanCheck(bban) {
  // Inline mod-97 to avoid an extra import. Same logic as
  // identity.js#mod97IbanCheck for the AE country case.
  // AE expanded: A=10, E=14 → "1014".
  const concat = bban + '1014' + '00';
  let r = 0;
  for (const ch of concat) r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return (98 - r).toString().padStart(2, '0');
}
