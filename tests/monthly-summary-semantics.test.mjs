// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { createMonthlySummary } from '../src/ui/monthly-summary.js';
it('shows separate currency buckets and booked money, preserving rejected attempt counts', () => {
  const el = (tag, { text, attrs, class: className } = {}) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (className) n.className = className;
    for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v);
    return n;
  };
  const make = (id, amount, currency = 'AED', status = 'Booked') => ({
    TransactionId: id,
    BookingDateTime: '2026-04-05T00:00:00Z',
    Status: status,
    CreditDebitIndicator: 'Credit',
    Amount: { Amount: amount, Currency: currency },
  });
  const view = createMonthlySummary({ el, formatAmount: (n) => n.toFixed(2) }).renderMonthlySummary(
    [
      make('a', '0.10'),
      make('b', '0.20'),
      make('c', '5.00', 'USD'),
      make('p', '99.00', 'AED', 'Pending'),
      make('r', '80.00', 'AED', 'Rejected'),
    ],
  );
  const rows = [...view.querySelectorAll('tbody tr')].map((r) =>
    [...r.children].map((c) => c.textContent),
  );
  expect(rows).toEqual([
    ['Apr 2026 · AED', '2', '0.30', '0', '0.00', '0.30', '1'],
    ['Apr 2026 · USD', '1', '5.00', '0', '0.00', '5.00', '—'],
  ]);
});
