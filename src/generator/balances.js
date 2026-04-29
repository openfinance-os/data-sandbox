// Balance generation — derives a Booked balance per account at "now" from
// the persona's opening balance + 12 months of net cash flow on that account.

export function generateBalances({ accounts, transactions, now }) {
  const balances = [];
  for (const acc of accounts) {
    const accTx = transactions.filter((t) => t._accountId === acc.AccountId);
    let booked = acc._meta.openingBalance;
    for (const t of accTx) {
      const a = parseFloat(t.Amount.Amount);
      booked += t.CreditDebitIndicator === 'Credit' ? a : -a;
    }
    booked = Math.round(booked * 100) / 100;

    // v2.1 AEActiveCurrencyAndAmount_SimpleType regex requires non-negative
    // strings; sign is carried separately in CreditDebitIndicator.
    const absAmount = Math.abs(booked).toFixed(2);
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
            Amount: acc._meta.creditLimitAed.toFixed(2),
            Currency: acc.Currency,
          },
        },
        {
          Included: true,
          Type: 'Available',
          Amount: {
            Amount: Math.max(0, acc._meta.creditLimitAed + booked).toFixed(2),
            Currency: acc.Currency,
          },
        },
      ];
    }
    balances.push(balance);
  }
  return balances;
}
