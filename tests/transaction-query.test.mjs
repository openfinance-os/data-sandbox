import { describe, it, expect } from 'vitest';
import { queryTransactions } from '../src/core/transaction-query.js';
const rows = Array.from({ length: 107 }, (_, n) => ({
  TransactionId: String(n).padStart(3, '0'),
  BookingDateTime: '2026-04-10T00:00:00Z',
  Status: n === 0 ? 'Rejected' : 'Booked',
  CreditDebitIndicator: 'Credit',
  Amount: { Amount: '0.10', Currency: n % 2 ? 'USD' : 'AED' },
}));
const envelope = {
  Data: { Transaction: rows },
  Links: { Self: '/a' },
  _scenario: { seed: 1, referenceDate: '2026-05-01T00:00:00Z' },
};
describe('complete transaction retrieval', () => {
  it('rejects malformed filters instead of presenting a false empty result', () => {
    expect(() => queryTransactions(envelope, { minAmount: NaN })).toThrow('amount filter');
    expect(() => queryTransactions(envelope, { status: 'booked' })).toThrow('booking status');
    expect(() => queryTransactions(envelope, { currency: 'usd' })).toThrow('currency');
  });
  it('exhausts equal timestamps exactly once', () => {
    let cursor,
      seen = [];
    do {
      const page = queryTransactions(envelope, { limit: 13, cursor });
      seen.push(...page.Data.Transaction.map((r) => r.TransactionId));
      cursor = page._filter.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(107);
    expect(seen.length).toBe(107);
  });
  it('binds cursors to full scenario and filters', () => {
    const cursor = queryTransactions(envelope, { limit: 3 })._filter.nextCursor;
    expect(() => queryTransactions(envelope, { cursor, currency: 'USD' })).toThrow(
      'different scenario',
    );
    expect(() => queryTransactions({ ...envelope, _scenario: { seed: 2 } }, { cursor })).toThrow();
    expect(() => queryTransactions(envelope, { cursor: 'invalid' })).toThrow();
  });
  it('separates currencies and excludes failed attempts from booked summaries', () => {
    const result = queryTransactions(envelope, { summary: true });
    expect(result._summary.count).toBe(106);
    expect(result._summary.byCurrencyAndStatus.map((g) => g.net)).toEqual(['5.30', '5.30']);
    expect(result._summary.byCurrencyAndStatus.flatMap((g) => g.sourceIds)).not.toContain('000');
    expect(result._summary.byCurrencyAndStatus.every((g) => g.sourceEvidence.nextCursor)).toBe(
      true,
    );
  });
  it('uses the same reference cutoff for totals and paginated evidence even with a future until', () => {
    const future = { ...rows[1], TransactionId: 'future', BookingDateTime: '2026-06-01T00:00:00Z' };
    const r = queryTransactions(
      { ...envelope, Data: { Transaction: [rows[1], future] } },
      { summary: true, until: '2027-01-01' },
    );
    expect(r._summary.count).toBe(1);
    expect(r._summary.byCurrencyAndStatus[0].sourceIds).toEqual(['001']);
  });
});
