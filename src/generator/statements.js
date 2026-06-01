// /accounts/{AccountId}/statements generation.
// AEStatements requires AccountId, AccountSubType, Statements[]. Each
// statement requires StatementId, StatementDate, OpeningDate, ClosingDate,
// OpeningBalance, ClosingBalance, Summary.

import { rngInt } from '../prng.js';
import { HISTORY_MONTHS as STATEMENT_HISTORY_MONTHS } from './constants.js';

// Statement window — imported from ./constants.js so it stays in lock-step
// with the transaction + cross-LFI ledger windows by construction (a TPP can
// pull a comparable two-year statement history alongside the tx stream).

export function generateStatements({ accounts, transactions, rng, now }) {
  const out = [];
  for (const acc of accounts) {
    const accTx = transactions.filter((t) => t._accountId === acc.AccountId);
    let opening = acc._meta.openingBalance;
    // Walk backward STATEMENT_HISTORY_MONTHS calendar months, emitting one
    // statement per month.
    for (let m = STATEMENT_HISTORY_MONTHS - 1; m >= 0; m--) {
      const monthStart = new Date(now.getTime());
      // setDate(1) BEFORE setMonth so a month-end `now` can't overflow into
      // the wrong month (e.g. Mar 31 → Feb 31 → Mar 3).
      monthStart.setUTCDate(1);
      monthStart.setUTCMonth(monthStart.getUTCMonth() - m);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthEnd = new Date(monthStart);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      monthEnd.setUTCDate(0);
      monthEnd.setUTCHours(23, 59, 59, 0);

      const monthTx = accTx.filter((t) => {
        const d = new Date(t.BookingDateTime);
        return d >= monthStart && d <= monthEnd;
      });
      let closing = opening;
      let credits = 0;
      let debits = 0;
      for (const t of monthTx) {
        const a = parseFloat(t.Amount.Amount);
        if (t.CreditDebitIndicator === 'Credit') {
          credits += a;
          closing += a;
        } else {
          debits += a;
          closing -= a;
        }
      }
      const summary = [];
      if (credits > 0) {
        summary.push({
          CreditDebitIndicator: 'Credit',
          SubTransactionType: 'Deposit',
          Amount: { Amount: credits.toFixed(2), Currency: acc.Currency },
          Count: monthTx.filter((t) => t.CreditDebitIndicator === 'Credit').length,
        });
      }
      if (debits > 0) {
        summary.push({
          CreditDebitIndicator: 'Debit',
          SubTransactionType: 'Purchase',
          Amount: { Amount: debits.toFixed(2), Currency: acc.Currency },
          Count: monthTx.filter((t) => t.CreditDebitIndicator === 'Debit').length,
        });
      }
      out.push({
        _accountId: acc.AccountId,
        StatementId: `${acc.AccountId}-stmt-${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`,
        StatementReference: `STMT-${rngInt(rng, 1000, 9999)}`,
        StatementDate: dateOf(monthEnd),
        OpeningDate: dateOf(monthStart),
        ClosingDate: dateOf(monthEnd),
        OpeningBalance: signedAmount(opening, acc.Currency),
        ClosingBalance: signedAmount(closing, acc.Currency),
        Summary: summary,
      });
      opening = closing;
    }
  }
  return out;
}

function signedAmount(value, currency) {
  return {
    CreditDebitIndicator: value >= 0 ? 'Credit' : 'Debit',
    Amount: { Amount: Math.abs(value).toFixed(2), Currency: currency },
  };
}

function isoOf(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function dateOf(date) {
  return date.toISOString().slice(0, 10);
}
void isoOf;
