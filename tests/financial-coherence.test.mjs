// Financial coherence gate — the money in every banking bundle adds up.
//
// Schema validation proves each payload is well-formed; it says nothing
// about whether a persona's finances are believable. Before this gate,
// current accounts ran hundreds of thousands of dirhams overdrawn with no
// credit line, credit cards were never repaid and ran past their limits,
// and the gig-worker persona had no income at all. src/generator/budget.js
// fixes that; this suite keeps it fixed for every banking persona at every
// LFI profile, at the persona's published default seed.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';
import { minorUnits, signedMinor } from '../src/core/ledger.js';

const pools = loadAllPools();
const personas = Object.values(loadPersonasByDomain('banking')).filter(
  (p) => p.persona_id !== 'atm_directory',
);
const LFIS = ['rich', 'median', 'sparse'];

const ordinal = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

function bookedFor(bundle, account) {
  return bundle.transactions
    .filter((t) => t._accountId === account.AccountId && t.Status === 'Booked')
    .sort(
      (a, b) =>
        ordinal(a.BookingDateTime, b.BookingDateTime) || ordinal(a.TransactionId, b.TransactionId),
    );
}

function runningBalances(account, booked) {
  let balance = minorUnits(account._meta.openingBalance, account.Currency);
  const points = [];
  for (const t of booked) {
    balance += signedMinor(t);
    points.push({ at: t.BookingDateTime, balance, tx: t });
  }
  return { closing: balance, points };
}

describe('financial coherence', () => {
  it('covers every banking persona', () => {
    expect(personas.length).toBe(29);
  });

  for (const persona of personas) {
    for (const lfi of LFIS) {
      describe(`${persona.persona_id} / ${lfi}`, () => {
        const bundle = buildBundle({ persona, lfi, seed: persona.default_seed, pools });
        const accounts = bundle.accounts;

        it('books nothing before an account opened', () => {
          for (const acc of accounts) {
            if (!acc.OpeningDate) continue;
            const early = bookedFor(bundle, acc).filter(
              (t) => !t._crossLfiPairId && t.BookingDateTime < acc.OpeningDate,
            );
            expect(
              early.map((t) => t.TransactionId),
              acc.AccountId,
            ).toEqual([]);
          }
        });

        it('never takes a current account below zero', () => {
          for (const acc of accounts.filter((a) => a._meta.kind === 'CurrentAccount')) {
            const { points } = runningBalances(acc, bookedFor(bundle, acc));
            const overdrawn = points.find((p) => p.balance < 0);
            expect(
              overdrawn ? `${overdrawn.at} ${overdrawn.balance / 100}` : null,
              acc.AccountId,
            ).toBeNull();
          }
        });

        it('keeps every credit card within its limit', () => {
          for (const acc of accounts.filter((a) => a._meta.kind === 'CreditCard')) {
            if (acc._meta.creditLimitAed == null) continue;
            const limit = minorUnits(acc._meta.creditLimitAed, acc.Currency);
            const { points } = runningBalances(acc, bookedFor(bundle, acc));
            const over = points.find((p) => -p.balance > limit);
            expect(over ? `${over.at} ${over.balance / 100}` : null, acc.AccountId).toBeNull();
          }
        });

        it('repays every credit card each month it owes money', () => {
          for (const acc of accounts.filter((a) => a._meta.kind === 'CreditCard')) {
            const booked = bookedFor(bundle, acc);
            const { points } = runningBalances(acc, booked);
            const owedMonths = new Set();
            let balance = minorUnits(acc._meta.openingBalance, acc.Currency);
            if (balance < 0 && booked[0]) owedMonths.add(booked[0].BookingDateTime.slice(0, 7));
            for (const p of points) if (p.balance < 0) owedMonths.add(p.at.slice(0, 7));
            const paidMonths = new Set(
              booked
                .filter((t) => t.CreditDebitIndicator === 'Credit')
                .map((t) => t.BookingDateTime.slice(0, 7)),
            );
            const months = [...owedMonths].sort();
            // A balance owed in one month is paid in the next one; the latest
            // month's payment may not be due yet.
            const unpaid = months
              .slice(0, -1)
              .filter((m) => !paidMonths.has(nextMonth(m)) && !paidMonths.has(m));
            expect(unpaid, acc.AccountId).toEqual([]);
          }
        });

        it('gives every account that spends a source of funds', () => {
          for (const acc of accounts) {
            const booked = bookedFor(bundle, acc);
            const debits = booked.filter((t) => t.CreditDebitIndicator === 'Debit').length;
            const credits = booked.filter((t) => t.CreditDebitIndicator === 'Credit').length;
            if (debits > 0)
              expect(credits, `${acc.AccountId} has debits but no credits`).toBeGreaterThan(0);
          }
        });

        if (persona.income) {
          it('pays the declared income into the primary current account', () => {
            const primary = accounts.find((a) => a._meta.kind === 'CurrentAccount');
            const credits = bookedFor(bundle, primary).filter(
              (t) => t.CreditDebitIndicator === 'Credit',
            );
            expect(credits.length).toBeGreaterThan(0);
          });
        }
      });
    }
  }
});

function nextMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
