// EXP-11 transactions filter + sort. Renders the filter bar above the
// /transactions table and provides the row-narrowing / sort helpers
// the payload renderer applies before rendering. Pure UI module —
// takes state, the DOM helper, the renderPayload trigger, and the
// emptyTxFilter factory as deps so it can live outside src/app.js.

import { t } from '../shared/i18n.js';

// C-P3 — debounce window for text-ish filter inputs. Each keystroke updates
// state immediately but the (full-table) re-render waits for a typing pause.
const FILTER_DEBOUNCE_MS = 150;

export function createTxFilter(deps) {
  const { state, el, renderPayload, emptyTxFilter, updateUrl } = deps;

  // C-P3 — debounced re-render with caret preservation. renderPayload()
  // rebuilds the whole filter bar, so the focused input is destroyed on every
  // render; we re-focus its successor and restore the recorded caret range
  // (the old setTimeout+focus() jumped the caret to end-of-input).
  let debounceTimer = null;
  let pendingFocus = null; // { name, start, end }

  function scheduleFilterRender(target) {
    pendingFocus = {
      name: target.name,
      // selectionStart/End throw or return null on date/number inputs —
      // capture defensively, restore only when we got real offsets.
      start: safeSelection(target, 'selectionStart'),
      end: safeSelection(target, 'selectionEnd'),
    };
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      renderPayload();
      const focusInfo = pendingFocus;
      pendingFocus = null;
      if (!focusInfo) return;
      const next = document.querySelector(`.tx-filter-bar [name="${focusInfo.name}"]`);
      if (!next) return;
      next.focus();
      if (
        focusInfo.start != null &&
        focusInfo.end != null &&
        typeof next.setSelectionRange === 'function'
      ) {
        try {
          next.setSelectionRange(focusInfo.start, focusInfo.end);
        } catch {
          // Input types without selection support (date/number) — focus alone
          // is the best we can restore.
        }
      }
    }, FILTER_DEBOUNCE_MS);
  }

  function safeSelection(target, prop) {
    try {
      return target[prop];
    } catch {
      return null;
    }
  }

  function renderTxFilterBar(_allRows) {
    const f = state.txFilter;
    const bar = el('div', { class: 'tx-filter-bar', attrs: { role: 'search' } });
    bar.appendChild(
      filterInput(
        'search',
        'search',
        f.search,
        t('txFilter.searchPlaceholder', state.lang),
        t('txFilter.searchLabel', state.lang),
      ),
    );
    bar.appendChild(
      filterSelect('type', f.type, t('txFilter.typeLabel', state.lang), [
        ['', 'TransactionType: any'],
        ['POS', 'POS'],
        ['ECommerce', 'ECommerce'],
        ['ATM', 'ATM'],
        ['BillPayments', 'BillPayments'],
        ['LocalBankTransfer', 'LocalBankTransfer'],
        ['SameBankTransfer', 'SameBankTransfer'],
        ['InternationalTransfer', 'InternationalTransfer'],
        ['Teller', 'Teller'],
        ['Cheque', 'Cheque'],
        ['Other', 'Other'],
      ]),
    );
    bar.appendChild(
      filterSelect('subType', f.subType, t('txFilter.subTypeLabel', state.lang), [
        ['', 'SubTransactionType: any'],
        ['Purchase', 'Purchase'],
        ['Reversal', 'Reversal'],
        ['Refund', 'Refund'],
        ['Withdrawal', 'Withdrawal'],
        ['Deposit', 'Deposit'],
        ['MoneyTransfer', 'MoneyTransfer'],
        ['Repayments', 'Repayments'],
        ['Fee', 'Fee'],
        ['Interest', 'Interest'],
      ]),
    );
    bar.appendChild(
      filterSelect('debitCredit', f.debitCredit, t('txFilter.debitCreditLabel', state.lang), [
        ['', 'Debit/Credit: any'],
        ['Debit', 'Debit only'],
        ['Credit', 'Credit only'],
      ]),
    );
    bar.appendChild(
      filterInput('dateFrom', 'date', f.dateFrom, '', t('txFilter.dateFrom', state.lang)),
    );
    bar.appendChild(filterInput('dateTo', 'date', f.dateTo, '', t('txFilter.dateTo', state.lang)));
    bar.appendChild(
      filterInput(
        'amountFrom',
        'number',
        f.amountFrom,
        t('txFilter.amountFromPlaceholder', state.lang),
        t('txFilter.amountFromLabel', state.lang),
      ),
    );
    bar.appendChild(
      filterInput(
        'amountTo',
        'number',
        f.amountTo,
        t('txFilter.amountToPlaceholder', state.lang),
        t('txFilter.amountToLabel', state.lang),
      ),
    );
    bar.appendChild(
      filterInput(
        'mcc',
        'text',
        f.mcc,
        t('txFilter.mcc', state.lang),
        t('txFilter.mccLabel', state.lang),
      ),
    );
    // Date humanise toggle — flips ISO datetimes to human format.
    const humanLabel = el('label', { class: 'filter-toggle' });
    const humanCheckbox = el('input', { attrs: { type: 'checkbox' } });
    humanCheckbox.checked = !!state.humanDates;
    humanCheckbox.addEventListener('change', (e) => {
      state.humanDates = e.target.checked;
      renderPayload();
    });
    humanLabel.appendChild(humanCheckbox);
    humanLabel.appendChild(document.createTextNode(` ${t('txFilter.humanDates', state.lang)}`));
    bar.appendChild(humanLabel);

    // Phase R1.5 — "Show enriched" toggle. OFF (default) renders the raw
    // v2.1 wire envelope as a UAE core would serve it. ON joins the
    // enrichment sidecar by TransactionId and overlays a clean merchant
    // name + Category + Subcategory columns. Pure render-time toggle;
    // generator output is unchanged. Persists in URL via updateUrl.
    const enrichLabel = el('label', {
      class: 'filter-toggle',
      attrs: {
        title:
          'Overlay enrichment-engine output: clean merchant, category, subcategory. Raw mode (off) is what a UAE core actually emits over Open Finance.',
      },
    });
    const enrichCheckbox = el('input', { attrs: { type: 'checkbox' } });
    enrichCheckbox.checked = !!state.enriched;
    enrichCheckbox.addEventListener('change', (e) => {
      state.enriched = e.target.checked;
      if (typeof updateUrl === 'function') updateUrl();
      renderPayload();
    });
    enrichLabel.appendChild(enrichCheckbox);
    enrichLabel.appendChild(document.createTextNode(` ${t('txFilter.showEnriched', state.lang)}`));
    bar.appendChild(enrichLabel);

    const clear = el('button', {
      class: 'filter-clear',
      text: t('txFilter.clear', state.lang),
      onClick: () => {
        state.txFilter = emptyTxFilter();
        renderPayload();
      },
    });
    bar.appendChild(clear);
    return bar;
  }

  function filterInput(name, type, value, placeholder, ariaLabel) {
    const input = el('input', {
      attrs: {
        type,
        name,
        value: value ?? '',
        placeholder: placeholder || '',
        'aria-label': ariaLabel ?? placeholder ?? name,
      },
    });
    input.addEventListener('input', (e) => {
      state.txFilter[name] = e.target.value;
      // C-P3 — state updates per keystroke; the table re-render (which
      // destroys and rebuilds this input) is debounced, and the caret is
      // restored on the rebuilt input.
      scheduleFilterRender(e.target);
    });
    return input;
  }

  function filterSelect(name, value, ariaLabel, options) {
    const select = el('select', { attrs: { name, 'aria-label': ariaLabel ?? name } });
    for (const [v, label] of options) {
      const opt = el('option', { text: label, attrs: { value: v } });
      if (v === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', (e) => {
      state.txFilter[name] = e.target.value;
      renderPayload();
    });
    return select;
  }

  function applyFilter(rows) {
    const f = state.txFilter;
    return rows.filter((r) => {
      if (f.search) {
        const hay = String(r.TransactionInformation ?? '').toLowerCase();
        if (!hay.includes(f.search.toLowerCase())) return false;
      }
      if (f.type && r.TransactionType !== f.type) return false;
      if (f.subType && r.SubTransactionType !== f.subType) return false;
      if (f.debitCredit && r.CreditDebitIndicator !== f.debitCredit) return false;
      if (f.dateFrom && r.BookingDateTime?.slice(0, 10) < f.dateFrom) return false;
      if (f.dateTo && r.BookingDateTime?.slice(0, 10) > f.dateTo) return false;
      const amt = parseFloat(r.Amount?.Amount ?? '0');
      if (f.amountFrom !== '' && amt < parseFloat(f.amountFrom)) return false;
      if (f.amountTo !== '' && amt > parseFloat(f.amountTo)) return false;
      if (f.mcc && r.MerchantDetails?.MerchantCategoryCode !== f.mcc) return false;
      return true;
    });
  }

  function applySort(rows) {
    const { column, dir } = state.txSort;
    if (!column) return rows;
    const sign = dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const av = readSortValue(a, column);
      const bv = readSortValue(b, column);
      if (av == null && bv == null) return 0;
      if (av == null) return -sign;
      if (bv == null) return sign;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      return String(av).localeCompare(String(bv)) * sign;
    });
  }

  function readSortValue(row, column) {
    const v = row[column];
    if (v == null) return null;
    if (column === 'Amount' && v.Amount) return parseFloat(v.Amount);
    return v;
  }

  function toggleSort(column) {
    if (state.txSort.column === column) {
      state.txSort.dir = state.txSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.txSort = { column, dir: 'asc' };
    }
    renderPayload();
  }

  return { renderTxFilterBar, applyFilter, applySort, toggleSort };
}
