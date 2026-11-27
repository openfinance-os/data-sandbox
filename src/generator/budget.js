// Budget pass — makes each banking bundle's money add up.
//
// Transaction generation draws income and spending independently, so left
// alone a persona can spend more than it earns for 24 months, run a current
// account deep into the red with no credit line, and never repay a card.
// This pass runs once per bundle, after every generator (including the
// cross-LFI mirror ledger) and before balances, statements and enrichment
// are derived, so everything downstream stays consistent with it.
//
// What it guarantees, per bundle (asserted by tests/financial-coherence):
//   1. No booked transaction predates its account's OpeningDate.
//   2. A current account never books below zero. Non-discretionary flows
//      (bills, transfers, sweeps, fees) always post, so the opening balance
//      is sized to cover them. Discretionary spend (card-style purchases,
//      ATM, FX, government payments) that the account cannot cover is
//      declined and does not appear, as a real decline would not.
//   3. Every credit card is paid each month from the primary current
//      account: in full, or a minimum-style partial payment for personas
//      that declare distress signals. Card purchases that would exceed the
//      card's credit limit are declined.
//   4. A secondary current account (a USD account, a second outlet account)
//      is funded by monthly own-account transfers from the primary account
//      and pays out part of each top-up, instead of mirroring the persona's
//      spending in another currency.
//
// Determinism (EXP-05): no wall clock and no main-rng draws. Every random
// choice uses a side-channel PRNG keyed on the persona and account, so the
// pass is a pure function of the generated transactions.

import { makePrng, rngInt } from '../prng.js';
import { minorUnits, signedMinor, formatMinor } from '../core/ledger.js';
import { attachBankTransactionCode } from './banking/transaction-codes.js';
import { bankishNarrative, referenceNumber } from './realism.js';
import { fxRateFor } from './transactions.js';
import { HISTORY_MONTHS } from './constants.js';

// Share of the outstanding card balance repaid each month.
const FULL_PAYMENT = 1;
const DISTRESSED_PAYMENT = 0.2;
// Secondary current accounts receive this share of the primary account's
// average monthly credits as a top-up, and pay out part of it again.
const SECONDARY_TOPUP_SHARE = [0.06, 0.14];
const SECONDARY_PAYOUT_SHARE = [0.55, 0.95];
// Headroom added on top of the smallest balance that keeps a current
// account at or above zero, in AED-equivalent.
const OPENING_HEADROOM_AED = [1500, 6000];

const ordinal = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const byBooking = (a, b) =>
  ordinal(a.BookingDateTime, b.BookingDateTime) || ordinal(a.TransactionId, b.TransactionId);

export function balanceBudget({ persona, accounts, transactions, now }) {
  const nowMs = new Date(now).getTime();
  const personaKey = persona.persona_id;
  const byId = new Map(accounts.map((a) => [a.AccountId, a]));
  const currentAccounts = accounts.filter((a) => a._meta.kind === 'CurrentAccount');
  const primary = currentAccounts[0] ?? null;
  const cards = accounts.filter((a) => a._meta.kind === 'CreditCard');
  const counter = { n: 0 };

  // 1. Nothing books before the account existed. Cross-LFI sweep halves are
  //    paired with another bundle and keep their dates.
  let txs = transactions.filter((t) => {
    const acc = byId.get(t._accountId ?? t.AccountId);
    if (!acc || t._crossLfiPairId) return true;
    return t.BookingDateTime >= acc.OpeningDate;
  });

  // 4. Fund secondary current accounts from the primary.
  if (primary) {
    for (const acc of currentAccounts.slice(1)) {
      const hasCredits = txs.some(
        (t) =>
          (t._accountId ?? t.AccountId) === acc.AccountId &&
          t.CreditDebitIndicator === 'Credit' &&
          !t._refundOf,
      );
      if (hasCredits) continue;
      txs.push(...secondaryFunding({ persona, primary, account: acc, txs, nowMs, counter }));
    }
  }

  // 2 + 3. Walk every booked transaction in order, declining what cannot be
  // afforded and inserting monthly card payments.
  const floors = new Map(currentAccounts.map((a) => [a.AccountId, 0]));

  const payDay = clampDay((persona.income?.pay_day ?? 25) + 2);
  const payFraction = persona.distress_signals ? DISTRESSED_PAYMENT : FULL_PAYMENT;
  const paymentEvents = [];
  if (primary) {
    for (const card of cards) {
      if (card.Currency !== primary.Currency) continue;
      // Plan each payment at the card's typical monthly spend, so the
      // primary account keeps that much aside like any other commitment.
      const planned = Math.round(averageMonthlySpend(card, txs, nowMs) * payFraction);
      for (const date of monthlyDates(payDay, nowMs)) {
        const iso = date.toISOString();
        if (iso < card.OpeningDate || iso < primary.OpeningDate) continue;
        paymentEvents.push({ card, date, planned });
      }
    }
  }
  sizeOpeningBalances({
    persona,
    accounts: currentAccounts,
    txs,
    floors,
    nowMs,
    planned: primary
      ? paymentEvents.map((p) => ({
          accountId: primary.AccountId,
          at: isoNoMs(p.date),
          delta: -p.planned,
        }))
      : [],
  });

  const balance = new Map(
    accounts.map((a) => [a.AccountId, minorUnits(a._meta.openingBalance, a.Currency)]),
  );
  // Card balance at the most recent statement cut-off (first of the month).
  const statementBalance = new Map(cards.map((c) => [c.AccountId, balance.get(c.AccountId)]));
  let lastCutoffMonth = null;
  const declined = new Set();
  const kept = [];
  const payments = [];
  const booked = txs.filter((t) => t.Status === 'Booked' && Date.parse(t.BookingDateTime) <= nowMs);
  const bookedSet = new Set(booked);
  const unbooked = txs.filter((t) => !bookedSet.has(t));

  const events = [
    ...booked.map((tx) => ({ at: tx.BookingDateTime, id: tx.TransactionId, tx })),
    ...paymentEvents.map((p) => ({
      at: isoNoMs(p.date),
      id: `${p.card.AccountId}-pay-${isoNoMs(p.date)}`,
      payment: p,
    })),
  ].sort((a, b) => ordinal(a.at, b.at) || ordinal(a.id, b.id));

  // Flows that always post can push a current account down later on, so a
  // purchase or card payment today must leave room for them. reserve[i] is
  // the deepest dip those later flows cause after event i (zero or less).
  const reserve = new Array(events.length).fill(0);
  const dip = new Map();
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const accountId = ev.payment ? primary.AccountId : (ev.tx._accountId ?? ev.tx.AccountId);
    reserve[i] = dip.get(accountId) ?? 0;
    if (ev.payment) {
      dip.set(accountId, Math.min(0, reserve[i] - ev.payment.planned));
    } else if (!ev.tx._discretionary && !ev.tx._refundOf && floors.has(accountId)) {
      dip.set(accountId, Math.min(0, signedMinor(ev.tx) + reserve[i]));
    }
  }

  for (const [i, ev] of events.entries()) {
    const month = ev.at.slice(0, 7);
    if (month !== lastCutoffMonth) {
      for (const c of cards) statementBalance.set(c.AccountId, balance.get(c.AccountId));
      lastCutoffMonth = month;
    }

    if (ev.payment) {
      const { card, date } = ev.payment;
      const owed = -statementBalance.get(card.AccountId);
      if (owed <= 0) continue;
      const available = balance.get(primary.AccountId) + reserve[i] - floors.get(primary.AccountId);
      const due = Math.round(owed * payFraction);
      const amount = Math.min(due, Math.max(0, available));
      if (amount <= 0) continue;
      const [debit, credit] = cardPayment({ primary, card, date, amount, personaKey, counter });
      balance.set(primary.AccountId, balance.get(primary.AccountId) - amount);
      balance.set(card.AccountId, balance.get(card.AccountId) + amount);
      // A payment reduces what is owed from this statement.
      statementBalance.set(card.AccountId, statementBalance.get(card.AccountId) + amount);
      payments.push(debit, credit);
      continue;
    }

    const tx = ev.tx;
    const accountId = tx._accountId ?? tx.AccountId;
    const acc = byId.get(accountId);
    if (tx._refundOf && declined.has(tx._refundOf)) continue;
    // Refunds are optional extras (enable_refunds only ADDS records), so they
    // never feed a decision: leaving them out of the running balance keeps
    // every other transaction identical whether refunds are on or off. The
    // real balance is only ever higher than the one decided on.
    if (!acc || tx._refundOf) {
      kept.push(tx);
      continue;
    }
    const delta = signedMinor(tx);
    const next = balance.get(accountId) + delta;
    if (delta < 0 && tx._discretionary) {
      const limit =
        acc._meta.kind === 'CreditCard' && acc._meta.creditLimitAed != null
          ? -minorUnits(acc._meta.creditLimitAed, acc.Currency)
          : floors.get(accountId);
      if (limit != null && next + reserve[i] < limit) {
        declined.add(tx.TransactionId);
        continue;
      }
    }
    balance.set(accountId, next);
    kept.push(tx);
  }

  const out = [...kept, ...payments, ...unbooked.filter((t) => !declined.has(t._refundOf))];
  out.sort(byBooking);
  return out;
}

// A card's average monthly purchases (minor units) over the months it is
// open in the window.
function averageMonthlySpend(card, txs, nowMs) {
  const debits = txs.filter(
    (t) =>
      (t._accountId ?? t.AccountId) === card.AccountId &&
      t.Status === 'Booked' &&
      t.CreditDebitIndicator === 'Debit' &&
      Date.parse(t.BookingDateTime) <= nowMs,
  );
  if (debits.length === 0) return 0;
  const months = new Set(debits.map((t) => t.BookingDateTime.slice(0, 7))).size;
  const total = debits.reduce((sum, t) => sum + minorUnits(t.Amount.Amount, t.Amount.Currency), 0);
  return total / Math.max(1, months);
}

// Smallest opening balance that keeps each current account at or above its
// floor when only flows that always post are counted, plus some headroom.
function sizeOpeningBalances({ persona, accounts, txs, floors, nowMs, planned }) {
  for (const acc of accounts) {
    const own = txs
      .filter(
        (t) =>
          (t._accountId ?? t.AccountId) === acc.AccountId &&
          t.Status === 'Booked' &&
          Date.parse(t.BookingDateTime) <= nowMs &&
          !t._discretionary &&
          !t._refundOf,
      )
      .map((t) => ({ at: t.BookingDateTime, id: t.TransactionId, delta: signedMinor(t) }));
    for (const p of planned) {
      if (p.accountId === acc.AccountId)
        own.push({ at: p.at, id: `~plan-${p.at}`, delta: p.delta });
    }
    own.sort((a, b) => ordinal(a.at, b.at) || ordinal(a.id, b.id));
    let running = minorUnits(acc._meta.openingBalance, acc.Currency);
    let low = running;
    for (const t of own) {
      running += t.delta;
      if (running < low) low = running;
    }
    const floor = floors.get(acc.AccountId);
    if (low >= floor) continue;
    const rng = makePrng(persona.persona_id, 'budget-opening', acc.AccountId);
    const headroomAed = rngInt(rng, OPENING_HEADROOM_AED[0], OPENING_HEADROOM_AED[1] + 1);
    const headroom = minorUnits(Math.round(headroomAed / fxRateFor(acc.Currency)), acc.Currency);
    const opening = minorUnits(acc._meta.openingBalance, acc.Currency) + (floor - low) + headroom;
    acc._meta.openingBalance = Number(formatMinor(opening, acc.Currency));
  }
}

function secondaryFunding({ persona, primary, account, txs, nowMs, counter }) {
  const primaryCredits = txs.filter(
    (t) =>
      (t._accountId ?? t.AccountId) === primary.AccountId &&
      t.CreditDebitIndicator === 'Credit' &&
      t.Status === 'Booked' &&
      !t._crossLfiPairId &&
      !t._refundOf,
  );
  const totalAed =
    primaryCredits.reduce((sum, t) => sum + Number(t.Amount.Amount), 0) *
    fxRateFor(primary.Currency);
  const monthlyAed = totalAed / HISTORY_MONTHS;
  if (monthlyAed <= 0) return [];

  const rng = makePrng(persona.persona_id, 'budget-secondary', account.AccountId);
  const rate = fxRateFor(account.Currency) / fxRateFor(primary.Currency);
  const out = [];
  for (const date of monthlyDates(clampDay(rngInt(rng, 3, 12)), nowMs)) {
    const iso = date.toISOString();
    if (iso < account.OpeningDate || iso < primary.OpeningDate) continue;
    const share =
      SECONDARY_TOPUP_SHARE[0] + rng() * (SECONDARY_TOPUP_SHARE[1] - SECONDARY_TOPUP_SHARE[0]);
    const targetAmount = round2((monthlyAed * share) / fxRateFor(account.Currency));
    if (targetAmount <= 0) continue;
    const sourceAmount = round2(targetAmount * rate);
    out.push(
      ...ownTransfer({
        from: primary,
        to: account,
        date,
        sourceAmount,
        targetAmount,
        rate,
        counter,
        rng,
      }),
    );

    const payouts = rngInt(rng, 1, 4);
    const payoutShare =
      SECONDARY_PAYOUT_SHARE[0] + rng() * (SECONDARY_PAYOUT_SHARE[1] - SECONDARY_PAYOUT_SHARE[0]);
    for (let i = 0; i < payouts; i++) {
      const payDate = new Date(date.getTime() + rngInt(rng, 1, 15) * 86400000);
      if (payDate.getTime() > nowMs) continue;
      const amount = round2((targetAmount * payoutShare) / payouts);
      if (amount <= 0) continue;
      out.push(outboundPayment({ account, date: payDate, amount, counter, rng }));
    }
  }
  return out;
}

function ownTransfer({ from, to, date, sourceAmount, targetAmount, rate, counter, rng }) {
  const at = isoNoMs(date);
  const reference = referenceNumber(rng, 'LocalBankTransfer', date, 'OWN');
  const crossCurrency = from.Currency !== to.Currency;
  const fx = crossCurrency
    ? {
        CurrencyExchange: {
          SourceCurrency: from.Currency,
          TargetCurrency: to.Currency,
          UnitCurrency: to.Currency,
          ExchangeRate: rate,
          InstructedAmount: { Amount: targetAmount.toFixed(2), Currency: to.Currency },
        },
      }
    : {};
  const fromIban = ibanOf(from);
  const toIban = ibanOf(to);
  return [
    attachBankTransactionCode({
      _accountId: from.AccountId,
      TransactionId: budgetTxId(from, date, counter),
      TransactionReference: reference,
      CreditDebitIndicator: 'Debit',
      Status: 'Booked',
      BookingDateTime: at,
      TransactionDateTime: at,
      ValueDateTime: at,
      TransactionInformation: bankishNarrative('OWN', ['TRF', 'TO', to.Currency, tail(toIban)]),
      Amount: { Amount: sourceAmount.toFixed(2), Currency: from.Currency },
      ...fx,
      TransactionType: 'LocalBankTransfer',
      SubTransactionType: 'MoneyTransfer',
      CreditorAccount: [{ SchemeName: 'IBAN', Identification: toIban, Name: to.AccountHolderName }],
    }),
    attachBankTransactionCode({
      _accountId: to.AccountId,
      TransactionId: budgetTxId(to, date, counter),
      TransactionReference: reference,
      CreditDebitIndicator: 'Credit',
      Status: 'Booked',
      BookingDateTime: at,
      TransactionDateTime: at,
      ValueDateTime: at,
      TransactionInformation: bankishNarrative('OWN', [
        'TRF',
        'FROM',
        from.Currency,
        tail(fromIban),
      ]),
      Amount: { Amount: targetAmount.toFixed(2), Currency: to.Currency },
      TransactionType: 'LocalBankTransfer',
      SubTransactionType: 'MoneyTransfer',
      DebtorAccount: { SchemeName: 'IBAN', Identification: fromIban, Name: from.AccountHolderName },
    }),
  ];
}

function outboundPayment({ account, date, amount, counter, rng }) {
  const at = isoNoMs(date);
  const international = account.Currency !== 'AED';
  const txType = international ? 'InternationalTransfer' : 'LocalBankTransfer';
  return attachBankTransactionCode({
    _accountId: account.AccountId,
    TransactionId: budgetTxId(account, date, counter),
    TransactionReference: referenceNumber(rng, txType, date, 'PAY'),
    CreditDebitIndicator: 'Debit',
    Status: 'Booked',
    BookingDateTime: at,
    TransactionDateTime: at,
    ValueDateTime: at,
    TransactionInformation: bankishNarrative(international ? 'IBT' : 'LBT', [
      'PAYMENT',
      String(rngInt(rng, 100000, 999999)),
    ]),
    Amount: { Amount: amount.toFixed(2), Currency: account.Currency },
    TransactionType: txType,
    SubTransactionType: 'MoneyTransfer',
  });
}

function cardPayment({ primary, card, date, amount, personaKey, counter }) {
  const at = isoNoMs(date);
  const value = formatMinor(amount, card.Currency);
  const rng = makePrng(personaKey, 'budget-card-payment', `${card.AccountId}-${at}`);
  const reference = referenceNumber(rng, 'LocalBankTransfer', date, 'CCP');
  const cardTail = tail(card.AccountIdentifiers?.[0]?.Identification ?? card.AccountId);
  return [
    attachBankTransactionCode({
      _accountId: primary.AccountId,
      TransactionId: budgetTxId(primary, date, counter),
      TransactionReference: reference,
      CreditDebitIndicator: 'Debit',
      Status: 'Booked',
      BookingDateTime: at,
      TransactionDateTime: at,
      ValueDateTime: at,
      TransactionInformation: bankishNarrative('CCP', ['CARD', 'PAYMENT', cardTail]),
      Amount: { Amount: value, Currency: primary.Currency },
      TransactionType: 'LocalBankTransfer',
      SubTransactionType: 'Repayments',
      CreditorAccount: [
        {
          SchemeName: 'IBAN',
          Identification: ibanOf(card),
          Name: card.AccountHolderName,
        },
      ],
    }),
    attachBankTransactionCode({
      _accountId: card.AccountId,
      TransactionId: budgetTxId(card, date, counter),
      TransactionReference: reference,
      CreditDebitIndicator: 'Credit',
      Status: 'Booked',
      BookingDateTime: at,
      TransactionDateTime: at,
      ValueDateTime: at,
      TransactionInformation: bankishNarrative('CCP', ['PAYMENT', 'RECEIVED', 'THANK', 'YOU']),
      Amount: { Amount: value, Currency: card.Currency },
      TransactionType: 'LocalBankTransfer',
      SubTransactionType: 'Repayments',
      DebtorAccount: {
        SchemeName: 'IBAN',
        Identification: ibanOf(primary),
        Name: primary.AccountHolderName,
      },
    }),
  ];
}

// One date per month across the history window, at `day` of the month,
// 09:00 UTC, never after `now`.
function monthlyDates(day, nowMs) {
  const today = new Date(nowMs);
  today.setUTCHours(0, 0, 0, 0);
  const out = [];
  for (let m = HISTORY_MONTHS; m >= 0; m--) {
    const d = new Date(today);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - m);
    d.setUTCDate(day);
    d.setUTCHours(9, 0, 0, 0);
    if (d.getTime() <= nowMs) out.push(d);
  }
  return out;
}

function budgetTxId(account, date, counter) {
  counter.n += 1;
  return `${account.AccountId}-tx-${date.toISOString().slice(0, 10)}-B${String(counter.n).padStart(4, '0')}`;
}

function ibanOf(account) {
  return account.AccountIdentifiers?.find((i) => i.SchemeName === 'IBAN')?.Identification ?? '';
}

function tail(value) {
  return String(value).slice(-4);
}

function clampDay(day) {
  return Math.min(28, Math.max(1, day));
}

function isoNoMs(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
