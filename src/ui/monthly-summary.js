// Monthly summary roll-up rendered above the /transactions table — one row
// per month of the persona's transaction window (24 since Phase R1) with
// credit / debit counts, sums, net, and an NSF count. Pure UI module; takes
// el and the shared formatAmount helper as deps.
import { minorUnits, currencyScale } from '../core/ledger.js';
import { REFERENCE_DATE } from '../core/scenario.js';

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Dubai',
});

export function createMonthlySummary(deps) {
  const { el, formatAmount } = deps;

  function renderMonthlySummary(rows) {
    const buckets = new Map();
    for (const r of rows) {
      const d = new Date(r.BookingDateTime);
      if (Number.isNaN(d.getTime()) || d > new Date(REFERENCE_DATE)) continue;
      const currency = r.Amount.Currency;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}|${currency}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          label: `${MONTH_FORMATTER.format(d)} · ${currency}`,
          creditCount: 0,
          creditSum: 0,
          debitCount: 0,
          debitSum: 0,
          nsfCount: 0,
          currency: r.Amount?.Currency ?? '',
        });
      }
      const b = buckets.get(key);
      const amt = minorUnits(r.Amount.Amount, currency);
      if (r.Status === 'Rejected') {
        b.nsfCount += 1;
        continue; // rejected debits don't move balance, exclude from credit/debit sums
      }
      if (r.Status !== 'Booked') continue;
      if (r.CreditDebitIndicator === 'Credit') {
        b.creditCount += 1;
        b.creditSum += amt;
      } else {
        b.debitCount += 1;
        b.debitSum += amt;
      }
    }
    const ordered = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));

    const det = el('details', { class: 'tx-monthly', attrs: { open: 'open' } });
    const summary = el('summary');
    summary.appendChild(el('span', { text: 'Monthly summary' }));
    summary.appendChild(
      el('span', {
        class: 'roll-badge',
        text: `${new Set(ordered.map((m) => m.key.split('|')[0])).size} months · booked amounts by currency; rejected attempts shown separately`,
      }),
    );
    det.appendChild(summary);

    const table = el('table');
    const thead = el('thead');
    const headRow = el('tr');
    for (const h of ['Month', 'Credits', 'Σ credits', 'Debits', 'Σ debits', 'Net', 'NSF']) {
      headRow.appendChild(el('th', { text: h }));
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const m of ordered) {
      const money = (value) => formatAmount(value / 10 ** currencyScale(m.currency));
      const tr = el('tr', { class: m.nsfCount > 0 ? 'has-nsf' : null });
      tr.appendChild(el('td', { text: m.label }));
      tr.appendChild(el('td', { text: String(m.creditCount) }));
      tr.appendChild(el('td', { text: money(m.creditSum) }));
      tr.appendChild(el('td', { text: String(m.debitCount) }));
      tr.appendChild(el('td', { text: money(m.debitSum) }));
      tr.appendChild(el('td', { text: money(m.creditSum - m.debitSum) }));
      tr.appendChild(el('td', { text: m.nsfCount > 0 ? String(m.nsfCount) : '—' }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    det.appendChild(table);
    return det;
  }

  return { renderMonthlySummary };
}
