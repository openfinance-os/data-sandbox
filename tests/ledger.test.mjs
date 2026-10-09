import { describe, it, expect } from 'vitest';
import { generateBalances } from '../src/generator/balances.js';
import { generateStatements } from '../src/generator/statements.js';
import { buildBundle, DEFAULT_NOW } from '../src/generator/index.js';
import { loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';
import { minorUnits, formatMinor, postedTransactions, movement } from '../src/core/ledger.js';
import { REFERENCE_DATE } from '../src/core/scenario.js';

describe('posted ledger semantics', () => {
  it('keeps rejected, pending and future amounts out of balances and statements', () => {
    const acc = { AccountId: 'a', Currency: 'AED', _meta: { openingBalance: 0.3 } };
    const tx = (id, status, amount, date = '2026-04-20T00:00:00Z') => ({
      _accountId: 'a',
      TransactionId: id,
      Status: status,
      CreditDebitIndicator: 'Debit',
      BookingDateTime: date,
      Amount: { Amount: amount, Currency: 'AED' },
    });
    const transactions = [
      tx('posted', 'Booked', '0.10'),
      tx('rejected', 'Rejected', '999.00'),
      tx('pending', 'Pending', '500.00'),
      tx('future', 'Booked', '400.00', '2026-06-01T00:00:00Z'),
    ];
    const now = new Date(REFERENCE_DATE);
    expect(generateBalances({ accounts: [acc], transactions, now })[0].Amount.Amount).toBe('0.20');
    const stmts = generateStatements({ accounts: [acc], transactions, now, rng: () => 0.5 });
    expect(stmts.at(-1).ClosingDate).toBe('2026-04-30');
    expect(stmts.at(-1).ClosingBalance.Amount.Amount).toBe('0.20');
    expect(stmts.at(-1).Summary[0].Count).toBe(1);
  });
  it('uses currency minor units without floating-point drift', () => {
    expect(formatMinor(minorUnits('0.10') + minorUnits('0.20'))).toBe('0.30');
    expect(formatMinor(minorUnits('1.234', 'KWD'), 'KWD')).toBe('1.234');
    expect(() => minorUnits('1.001', 'AED')).toThrow();
  });
  it('reconciles every persona account and completed period', () => {
    const pools = loadAllPools();
    expect(DEFAULT_NOW.toISOString()).toBe(REFERENCE_DATE);
    for (const persona of Object.values(loadPersonasByDomain('banking'))) {
      const bundle = buildBundle({ persona, pools, seed: persona.default_seed, lfi: 'rich' });
      for (const acc of bundle.accounts) {
        const rows = postedTransactions(bundle.transactions, {
          accountId: acc.AccountId,
          currency: acc.Currency,
          now: DEFAULT_NOW,
        });
        const expected = minorUnits(acc._meta.openingBalance, acc.Currency) + movement(rows);
        const balance = bundle.balances.find((b) => b._accountId === acc.AccountId);
        expect(
          minorUnits(balance.Amount.Amount, acc.Currency) *
            (balance.CreditDebitIndicator === 'Debit' ? -1 : 1),
        ).toBe(expected);
        const statements = bundle.statements.filter((s) => s._accountId === acc.AccountId);
        let previous = null;
        for (const s of statements) {
          expect(s.ClosingDate < REFERENCE_DATE.slice(0, 10)).toBe(true);
          if (previous) expect(s.OpeningBalance).toEqual(previous.ClosingBalance);
          previous = s;
        }
        expect(previous.ClosingBalance.Amount.Amount).toBe(balance.Amount.Amount);
        expect(previous.ClosingBalance.CreditDebitIndicator).toBe(balance.CreditDebitIndicator);
      }
    }
  });
});
