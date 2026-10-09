// Integer minor units keep reconciliation exact. Amount.Currency is the
// booked account currency; InstructedAmount is never added a second time.
export function currencyScale(currency) {
  return { JPY: 0, KRW: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3 }[currency] ?? 2;
}

export function minorUnits(value, currency = 'AED') {
  const scale = currencyScale(currency);
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match || (match[3]?.length ?? 0) > scale)
    throw new Error(`Invalid ${currency} amount: ${value}`);
  const amount = Number(match[2]) * 10 ** scale + Number((match[3] ?? '').padEnd(scale, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Amount exceeds safe minor-unit range');
  return match[1] ? -amount : amount;
}

export function formatMinor(value, currency = 'AED') {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid minor units');
  const scale = currencyScale(currency),
    digits = String(Math.abs(value)).padStart(scale + 1, '0');
  return `${value < 0 ? '-' : ''}${scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits}`;
}

export function postedTransactions(transactions, { accountId, currency, now }) {
  const cutoff = new Date(now).getTime();
  if (!Number.isFinite(cutoff)) throw new Error('Ledger requires a valid cutoff');
  return transactions.filter((t) => {
    if (accountId && (t._accountId ?? t.AccountId) !== accountId) return false;
    if (t.Status !== 'Booked' || Date.parse(t.BookingDateTime) > cutoff) return false;
    if (!Number.isFinite(Date.parse(t.BookingDateTime)))
      throw new Error('Invalid booking timestamp');
    if (currency && t.Amount.Currency !== currency)
      throw new Error(
        `Account/transaction currency mismatch: ${accountId} ${currency} vs ${t.Amount.Currency} ${t.TransactionId}`,
      );
    return true;
  });
}

export function signedMinor(transaction) {
  const value = minorUnits(transaction.Amount.Amount, transaction.Amount.Currency);
  if (value < 0 || !['Credit', 'Debit'].includes(transaction.CreditDebitIndicator))
    throw new Error('Invalid directed amount');
  return transaction.CreditDebitIndicator === 'Credit' ? value : -value;
}

export function movement(transactions) {
  return transactions.reduce((sum, tx) => {
    const next = sum + signedMinor(tx);
    if (!Number.isSafeInteger(next)) throw new Error('Ledger exceeds safe minor-unit range');
    return next;
  }, 0);
}
