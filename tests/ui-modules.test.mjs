// @vitest-environment jsdom
//
// Unit coverage for the previously e2e-only UI modules: the EXP-11
// transactions filter/sort engine (src/ui/tx-filter.js), the clipboard
// helper (src/ui/clipboard.js), and the EXP-27 embed-snippet builder
// (src/ui/embed-snippet.js). These are the pure-logic surfaces a refactor
// is most likely to break silently — the Playwright smoke suite exercises
// them only incidentally.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { el } from '../src/shared/dom.js';
import { createTxFilter } from '../src/ui/tx-filter.js';
import { copyToClipboard } from '../src/ui/clipboard.js';
import { createEmbedSnippet } from '../src/ui/embed-snippet.js';

// ─── tx-filter ──────────────────────────────────────────────────────

function emptyTxFilter() {
  return {
    search: '',
    type: '',
    subType: '',
    debitCredit: '',
    dateFrom: '',
    dateTo: '',
    amountFrom: '',
    amountTo: '',
    mcc: '',
  };
}

function makeFilter(overrides = {}) {
  const state = {
    txFilter: { ...emptyTxFilter(), ...overrides },
    txSort: { column: null, dir: 'asc' },
    humanDates: false,
    enriched: false,
    lang: 'en',
  };
  const renderPayload = vi.fn();
  const filter = createTxFilter({ state, el, renderPayload, emptyTxFilter });
  return { state, renderPayload, filter };
}

const ROWS = [
  {
    TransactionInformation: 'POS 1234 LULU HYPERMARKET/DXB',
    TransactionType: 'POS',
    SubTransactionType: 'Purchase',
    CreditDebitIndicator: 'Debit',
    BookingDateTime: '2026-01-05T09:00:00Z',
    Amount: { Amount: '120.50', Currency: 'AED' },
    MerchantDetails: { MerchantCategoryCode: '5411' },
  },
  {
    TransactionInformation: 'SALARY JAN — WPS',
    TransactionType: 'LocalBankTransfer',
    SubTransactionType: 'MoneyTransfer',
    CreditDebitIndicator: 'Credit',
    BookingDateTime: '2026-01-25T06:00:00Z',
    Amount: { Amount: '25000.00', Currency: 'AED' },
  },
  {
    TransactionInformation: 'ATM WDL MALL BRANCH',
    TransactionType: 'ATM',
    SubTransactionType: 'Withdrawal',
    CreditDebitIndicator: 'Debit',
    BookingDateTime: '2026-02-10T18:30:00Z',
    Amount: { Amount: '500.00', Currency: 'AED' },
  },
];

describe('tx-filter — applyFilter (EXP-11)', () => {
  it('passes everything through on the empty filter', () => {
    const { filter } = makeFilter();
    expect(filter.applyFilter(ROWS)).toHaveLength(3);
  });

  it('search matches TransactionInformation case-insensitively', () => {
    const { filter } = makeFilter({ search: 'lulu' });
    const out = filter.applyFilter(ROWS);
    expect(out).toHaveLength(1);
    expect(out[0].TransactionType).toBe('POS');
  });

  it('type / subType / debitCredit are exact matches', () => {
    expect(makeFilter({ type: 'ATM' }).filter.applyFilter(ROWS)).toHaveLength(1);
    expect(makeFilter({ subType: 'Purchase' }).filter.applyFilter(ROWS)).toHaveLength(1);
    expect(makeFilter({ debitCredit: 'Credit' }).filter.applyFilter(ROWS)).toHaveLength(1);
  });

  it('date window compares on the BookingDateTime date part, inclusive', () => {
    const { filter } = makeFilter({ dateFrom: '2026-01-25', dateTo: '2026-01-25' });
    const out = filter.applyFilter(ROWS);
    expect(out).toHaveLength(1);
    expect(out[0].CreditDebitIndicator).toBe('Credit');
  });

  it('amount band is numeric, not lexicographic', () => {
    // Lexicographically '25000.00' < '500.00', so a string comparison would
    // drop the salary row; the numeric parse keeps it.
    const { filter } = makeFilter({ amountFrom: '1000' });
    const out = filter.applyFilter(ROWS);
    expect(out).toHaveLength(1);
    expect(out[0].Amount.Amount).toBe('25000.00');
  });

  it('mcc matches MerchantDetails.MerchantCategoryCode and tolerates rows without it', () => {
    const { filter } = makeFilter({ mcc: '5411' });
    const out = filter.applyFilter(ROWS);
    expect(out).toHaveLength(1);
    expect(out[0].MerchantDetails.MerchantCategoryCode).toBe('5411');
  });
});

describe('tx-filter — applySort + toggleSort', () => {
  it('Amount sorts numerically and dir flips on repeated toggle', () => {
    const { state, filter, renderPayload } = makeFilter();
    filter.toggleSort('Amount');
    expect(state.txSort).toEqual({ column: 'Amount', dir: 'asc' });
    let sorted = filter.applySort(ROWS);
    expect(sorted.map((r) => r.Amount.Amount)).toEqual(['120.50', '500.00', '25000.00']);

    filter.toggleSort('Amount');
    expect(state.txSort.dir).toBe('desc');
    sorted = filter.applySort(ROWS);
    expect(sorted.map((r) => r.Amount.Amount)).toEqual(['25000.00', '500.00', '120.50']);
    expect(renderPayload).toHaveBeenCalledTimes(2);
  });

  it('applySort does not mutate the input array and a null column is a no-op', () => {
    const { state, filter } = makeFilter();
    state.txSort = { column: 'BookingDateTime', dir: 'desc' };
    const input = ROWS.slice();
    const sorted = filter.applySort(input);
    expect(sorted).not.toBe(input);
    expect(input.map((r) => r.TransactionType)).toEqual(['POS', 'LocalBankTransfer', 'ATM']);
    state.txSort = { column: null, dir: 'asc' };
    expect(filter.applySort(input)).toBe(input);
  });
});

describe('tx-filter — renderTxFilterBar', () => {
  it('renders a search-role bar whose controls write through to state and re-render', () => {
    const { state, filter, renderPayload } = makeFilter();
    const bar = filter.renderTxFilterBar(ROWS);
    document.body.appendChild(bar);
    expect(bar.getAttribute('role')).toBe('search');

    const search = bar.querySelector('input[name="search"]');
    search.value = 'salary';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(state.txFilter.search).toBe('salary');

    const type = bar.querySelector('select[name="type"]');
    type.value = 'ATM';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.txFilter.type).toBe('ATM');

    bar.querySelector('.filter-clear').click();
    expect(state.txFilter).toEqual(emptyTxFilter());
    expect(renderPayload).toHaveBeenCalled();
    bar.remove();
  });
});

// ─── clipboard ──────────────────────────────────────────────────────

describe('clipboard — copyToClipboard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses navigator.clipboard.writeText and shows a role=status toast', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    copyToClipboard('hello', 'Copied!');
    expect(writeText).toHaveBeenCalledWith('hello');
    await Promise.resolve(); // let the .then() callback run
    const toast = document.querySelector('.copy-toast');
    expect(toast).toBeTruthy();
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toBe('Copied!');
  });

  it('falls back to the textarea + execCommand path when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);
    copyToClipboard('fallback-text', 'Done');
    await Promise.resolve();
    await Promise.resolve(); // writeText rejection → fallbackCopy
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    // The fallback textarea cleans itself up on success.
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('.copy-toast')?.textContent).toBe('Done');
  });

  it('keeps the textarea visible for manual copy when execCommand throws', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => {
      throw new Error('denied');
    });
    copyToClipboard('manual', 'Done');
    const ta = document.querySelector('textarea');
    expect(ta).toBeTruthy();
    expect(ta.style.opacity).toBe('1');
    expect(document.querySelector('.copy-toast')?.textContent).toMatch(/Copy blocked/);
  });

  it('replaces an existing toast instead of stacking', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    copyToClipboard('a', 'first');
    await Promise.resolve();
    copyToClipboard('b', 'second');
    await Promise.resolve();
    const toasts = document.querySelectorAll('.copy-toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].textContent).toBe('second');
  });
});

// ─── embed-snippet ──────────────────────────────────────────────────

describe('embed-snippet — buildEmbedSnippet (EXP-27)', () => {
  const OVERVIEW_PSEUDO = '/__overview';
  const UNDERWRITING_PSEUDO = '/__underwriting';

  function makeSnippet(stateOverrides = {}) {
    const state = {
      personaId: 'salaried_expat_mid',
      lfi: 'median',
      endpoint: '/accounts',
      seed: 4729,
      ...stateOverrides,
    };
    return createEmbedSnippet({ state, OVERVIEW_PSEUDO, UNDERWRITING_PSEUDO });
  }

  it('builds an iframe pinned to persona / lfi / endpoint / seed with the embed.html path', () => {
    const snippet = makeSnippet().buildEmbedSnippet();
    expect(snippet).toMatch(/^<iframe src="/);
    expect(snippet).toContain('/embed.html?');
    expect(snippet).toContain('persona=salaried_expat_mid');
    expect(snippet).toContain('lfi=median');
    expect(snippet).toContain('seed=4729');
    expect(snippet).toContain('height=600');
    expect(snippet).toContain('title="Open Finance Data Sandbox · salaried_expat_mid · median"');
    expect(snippet).toContain('loading="lazy"');
  });

  it('remaps the pseudo-endpoints to the transactions endpoint', () => {
    for (const pseudo of [OVERVIEW_PSEUDO, UNDERWRITING_PSEUDO]) {
      const snippet = makeSnippet({ endpoint: pseudo }).buildEmbedSnippet();
      expect(snippet).toContain(
        `endpoint=${encodeURIComponent('/accounts/{AccountId}/transactions')}`,
      );
      expect(snippet).not.toContain('__overview');
      expect(snippet).not.toContain('__underwriting');
    }
  });
});
