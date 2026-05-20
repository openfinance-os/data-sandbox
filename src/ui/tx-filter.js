// EXP-11 transactions filter + sort. Renders the filter bar above the
// /transactions table and provides the row-narrowing / sort helpers
// the payload renderer applies before rendering. Pure UI module —
// takes state, the DOM helper, the renderPayload trigger, and the
// emptyTxFilter factory as deps so it can live outside src/app.js.

export function createTxFilter(deps) {
  const { state, el, renderPayload, emptyTxFilter, updateUrl } = deps;

  function renderTxFilterBar(_allRows) {
    const f = state.txFilter;
    const bar = el('div', { class: 'tx-filter-bar', attrs: { role: 'search' } });
    bar.appendChild(filterInput('search', 'search', f.search, 'Search TransactionInformation…'));
    bar.appendChild(
      filterSelect('type', f.type, [
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
      filterSelect('subType', f.subType, [
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
      filterSelect('debitCredit', f.debitCredit, [
        ['', 'Debit/Credit: any'],
        ['Debit', 'Debit only'],
        ['Credit', 'Credit only'],
      ]),
    );
    bar.appendChild(filterInput('dateFrom', 'date', f.dateFrom, '', 'From'));
    bar.appendChild(filterInput('dateTo', 'date', f.dateTo, '', 'To'));
    bar.appendChild(filterInput('amountFrom', 'number', f.amountFrom, 'AED ≥'));
    bar.appendChild(filterInput('amountTo', 'number', f.amountTo, 'AED ≤'));
    bar.appendChild(filterInput('mcc', 'text', f.mcc, 'MCC'));
    // Date humanise toggle — flips ISO datetimes to human format.
    const humanLabel = el('label', { class: 'filter-toggle' });
    const humanCheckbox = el('input', { attrs: { type: 'checkbox' } });
    humanCheckbox.checked = !!state.humanDates;
    humanCheckbox.addEventListener('change', (e) => {
      state.humanDates = e.target.checked;
      renderPayload();
    });
    humanLabel.appendChild(humanCheckbox);
    humanLabel.appendChild(document.createTextNode(' Humanise dates'));
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
    enrichLabel.appendChild(document.createTextNode(' Show enriched'));
    bar.appendChild(enrichLabel);

    const clear = el('button', {
      class: 'filter-clear',
      text: 'Clear filters',
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
      renderPayload();
      setTimeout(() => document.querySelector(`.tx-filter-bar [name="${name}"]`)?.focus(), 0);
    });
    return input;
  }

  function filterSelect(name, value, options) {
    const select = el('select', { attrs: { name, 'aria-label': name } });
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
