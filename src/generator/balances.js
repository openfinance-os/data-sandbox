import { postedTransactions, minorUnits, movement, formatMinor } from '../core/ledger.js';
// Balance generation — derives a Booked balance per account at "now" from
// the persona's opening balance + 24 completed months of posted cash flow.

export function generateBalances({ accounts, transactions, now }) {
  const balances = [];
  for (const acc of accounts) {
    const accTx = postedTransactions(transactions, {
      accountId: acc.AccountId,
      currency: acc.Currency,
      now,
    });
    const booked = minorUnits(acc._meta.openingBalance, acc.Currency) + movement(accTx);

    // v2.1 AEActiveCurrencyAndAmount_SimpleType regex requires non-negative
    // strings; sign is carried separately in CreditDebitIndicator.
    const absAmount = formatMinor(Math.abs(booked), acc.Currency);
    const balance = {
      _accountId: acc.AccountId,
      Amount: { Amount: absAmount, Currency: acc.Currency },
      CreditDebitIndicator: booked >= 0 ? 'Credit' : 'Debit',
      Type: 'InterimBooked',
      DateTime: new Date(now.getTime()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    // Optional CreditLine block — only for credit-card accounts.
    if (acc._meta.kind === 'CreditCard' && acc._meta.creditLimitAed != null) {
      balance.CreditLine = [
        {
          Included: true,
          Type: 'Credit',
          Amount: {
            Amount: formatMinor(minorUnits(acc._meta.creditLimitAed, acc.Currency), acc.Currency),
            Currency: acc.Currency,
          },
        },
        {
          Included: true,
          Type: 'Available',
          Amount: {
            Amount: formatMinor(
              Math.max(0, minorUnits(acc._meta.creditLimitAed, acc.Currency) + booked),
              acc.Currency,
            ),
            Currency: acc.Currency,
          },
        },
      ];
    }
    balances.push(balance);
  }
  return balances;
}
