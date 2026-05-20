// EXP-18 Underwriting Scenario panel and at-a-glance strip. Renders the
// four illustrative signals (income, fixed commitments, implied DBR,
// NSF count) above /transactions and on the /underwriting pseudo-
// endpoint, with formula tooltips and source-field contributors.
// Pure UI module — computeUnderwriting and the disclaimer footnote
// are pure functions imported from shared/; state, the DOM helper,
// formatAmount, the navigator/payload triggers, and the pseudo-
// endpoint id come in via deps.

import { computeUnderwriting, UNDERWRITING_FOOTNOTE } from '../shared/underwriting.js';

export function createUnderwriting(deps) {
  const {
    state,
    el,
    formatAmount,
    renderNavigator,
    renderPayload,
    UNDERWRITING_PSEUDO,
    openFieldCard,
  } = deps;

  // PR #5 — deep-pin map: each underwriting card's source-field disclosure
  // exposes a button that switches the active endpoint and opens the
  // primary spec field that drives the signal. The fields are illustrative
  // (not exhaustive), driven by PRD §4.4. DBR is derived and has no
  // single source field, so it's omitted from the map.
  const DEEP_PIN_MAP = Object.freeze({
    income: {
      endpoint: '/accounts/{AccountId}/transactions',
      fieldName: 'Flags',
      accountFirst: true,
    },
    commitments: {
      endpoint: '/accounts/{AccountId}/standing-orders',
      fieldName: 'NextPaymentAmount',
      accountFirst: true,
    },
    nsf: {
      endpoint: '/accounts/{AccountId}/transactions',
      fieldName: 'Status',
      accountFirst: true,
    },
  });
  function deepPinSourceField(signalKey) {
    const target = DEEP_PIN_MAP[signalKey];
    if (!target || typeof openFieldCard !== 'function') return;
    if (target.accountFirst) {
      const firstAcc = state.bundle?.accounts?.[0]?.AccountId ?? null;
      state.selectedAccountId = firstAcc;
    }
    state.endpoint = target.endpoint;
    renderNavigator();
    renderPayload();
    openFieldCard(target.fieldName);
  }

  // Compact 4-stat strip docked above /transactions. Click "Open full panel →"
  // to pivot to the EXP-18 endpoint for source fields and formulas. Honours
  // the EXP-18 low-volume guard with an inline notice. Plain <div>, not
  // <details> — a focusable button inside <summary> would trip the
  // axe-core nested-interactive rule (WCAG 4.1.2 / EXP-23).
  function renderUnderwritingStrip() {
    const now = new Date(state.data.buildInfo.nowIso);
    const r = computeUnderwriting(state.bundle, now);
    const strip = el('div', {
      class: 'uw-strip',
      attrs: { role: 'region', 'aria-label': 'Underwriting at-a-glance' },
    });
    const head = el('div', { class: 'uw-strip-head' });
    head.appendChild(el('span', { class: 'uw-strip-eyebrow', text: 'Underwriting at-a-glance' }));
    if (r.guard.triggered) {
      head.appendChild(el('span', { class: 'uw-strip-guard', text: 'Low-volume guard active' }));
    }
    head.appendChild(
      el('button', {
        class: 'uw-strip-jump',
        attrs: {
          type: 'button',
          title:
            'Open the full Underwriting Scenario panel — formulas, source fields, contributors.',
        },
        text: 'Open full panel →',
        onClick: () => {
          state.endpoint = UNDERWRITING_PSEUDO;
          state.selectedAccountId = null;
          renderNavigator();
          renderPayload();
        },
      }),
    );
    strip.appendChild(head);

    const grid = el('div', { class: 'uw-strip-grid' });
    const stats = [
      {
        title: 'Income',
        value:
          r.income.value != null ? `${formatAmount(r.income.value)} ${r.income.currency}` : '—',
        sub: r.income.sourceLabel,
      },
      {
        title: 'Fixed commitments',
        value: `${formatAmount(r.commitments.value)} ${r.commitments.currency}`,
        sub: `${r.commitments.contributors.length} active`,
      },
      {
        title: 'Implied DBR',
        value: r.dbr.value != null ? r.dbr.label : '—',
        sub: r.dbr.value != null ? 'Commitments ÷ income' : (r.dbr.reason ?? 'Undefined'),
      },
      {
        title: 'NSF events',
        value: String(r.nsf.value),
        sub: r.nsf.value > 0 ? 'Trailing 12 months' : 'None in window',
      },
    ];
    for (const s of stats) {
      const card = el('div', { class: 'uw-strip-card' });
      card.appendChild(el('div', { class: 'uw-strip-title', text: s.title }));
      card.appendChild(el('div', { class: 'uw-strip-value', text: s.value }));
      card.appendChild(el('div', { class: 'uw-strip-sub', text: s.sub }));
      grid.appendChild(card);
    }
    strip.appendChild(grid);
    return strip;
  }

  function renderUnderwritingPanel(body) {
    const now = new Date(state.data.buildInfo.nowIso);
    const result = computeUnderwriting(state.bundle, now);

    const wrap = el('div', { class: 'uw-panel' });
    wrap.appendChild(
      el('h2', { class: 'uw-title', text: 'Underwriting Scenario — illustrative signals' }),
    );
    wrap.appendChild(
      el('p', {
        class: 'uw-disclaimer',
        text: UNDERWRITING_FOOTNOTE,
      }),
    );

    if (result.guard.triggered) {
      wrap.appendChild(
        el('div', {
          class: 'uw-guard',
          attrs: { role: 'status' },
          text: `Low-volume guard triggered. ${result.guard.reason} Off-the-shelf affordability formulas don't generalise to this segment — DBR is suppressed below.`,
        }),
      );
    }

    const grid = el('div', { class: 'uw-grid' });
    grid.appendChild(
      renderUwSignal({
        signalKey: 'income',
        title: 'Implied monthly net income',
        value:
          result.income.value != null
            ? `${formatAmount(result.income.value)} ${result.income.currency}`
            : '—',
        sub: result.income.sourceLabel,
        contributors: result.income.contributors,
        formula:
          'Trailing-12-month average of credits where Flags=Payroll. ' +
          'Fallback A: largest recurring credit on the same calendar day each month (≥3 occurrences). ' +
          'Fallback B: monthly average of credits from the top recurring counterparty (≥6 inflows). ' +
          'Final fallback: "—" with persona-specific guidance.',
        contributorRender: renderTxContributor,
      }),
    );
    grid.appendChild(
      renderUwSignal({
        signalKey: 'commitments',
        title: 'Total fixed commitments (monthly)',
        value: `${formatAmount(result.commitments.value)} ${result.commitments.currency}`,
        sub: `${result.commitments.contributors.length} active commitments — standing orders + direct debits, normalised to monthly via the resource's Frequency, multi-currency converted to AED at the pinned snapshot rate.`,
        contributors: result.commitments.contributors,
        formula:
          'Σ (NextPaymentAmount on active StandingOrders) + Σ (PreviousPaymentAmount on active DirectDebits, normalised by Frequency).',
        contributorRender: renderCommitmentContributor,
      }),
    );
    grid.appendChild(
      renderUwSignal({
        signalKey: 'dbr',
        title: 'Implied DBR',
        value: result.dbr.value != null ? result.dbr.label : '—',
        sub:
          result.dbr.value != null
            ? 'Commitments ÷ income, expressed as percentage. Treat values >50% as a stretch indicator; >100% means the persona is structurally unable to meet commitments from inferred income.'
            : (result.dbr.reason ?? 'Undefined.'),
        contributors: [],
        formula: 'Implied DBR = Total fixed commitments / Implied monthly net income.',
      }),
    );
    grid.appendChild(
      renderUwSignal({
        signalKey: 'nsf',
        title: 'NSF / distress event count',
        value: String(result.nsf.value),
        sub:
          result.nsf.value > 0
            ? `${result.nsf.value} rejected debit${result.nsf.value === 1 ? '' : 's'} in the trailing 12 months — see /transactions for the rows.`
            : 'No rejected debits in the trailing 12 months.',
        contributors: result.nsf.contributors,
        formula:
          'Count of transactions in trailing 12 months where Status=Rejected. Phase 1.5 minimum — Phase 2 widens to "debit posted on a day where ClosingBooked balance for that account became negative".',
        contributorRender: renderTxContributor,
      }),
    );
    wrap.appendChild(grid);
    body.appendChild(wrap);
  }

  function renderUwSignal({
    signalKey,
    title,
    value,
    sub,
    contributors,
    formula,
    contributorRender,
  }) {
    const card = el('div', { class: 'uw-card' });
    const header = el('div', { class: 'uw-card-header' });
    header.appendChild(el('div', { class: 'uw-card-title', text: title }));
    header.appendChild(el('div', { class: 'uw-card-value', text: value }));
    card.appendChild(header);
    card.appendChild(el('div', { class: 'uw-card-sub', text: sub }));

    const formulaDet = el('details', { class: 'uw-card-formula' });
    formulaDet.appendChild(el('summary', { text: 'Formula' }));
    formulaDet.appendChild(el('p', { text: formula }));
    card.appendChild(formulaDet);

    if (contributors && contributors.length > 0) {
      const det = el('details', { class: 'uw-card-contrib' });
      det.appendChild(el('summary', { text: `Source fields (${contributors.length})` }));
      // PR #5 — deep-pin button: switch the active endpoint and open the
      // primary spec field that drives this signal in the Field Detail
      // pane. Skips signals with no single source field (DBR is derived).
      const pinTarget = DEEP_PIN_MAP[signalKey];
      if (pinTarget && typeof openFieldCard === 'function') {
        const pinBtn = el('button', {
          class: 'uw-pin-btn',
          attrs: {
            type: 'button',
            title: `Open ${pinTarget.fieldName} in the Field Detail pane on ${pinTarget.endpoint}.`,
            'aria-label': `Pin ${pinTarget.fieldName} field card on ${pinTarget.endpoint}`,
          },
          text: `Pin ${pinTarget.fieldName} →`,
        });
        pinBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          deepPinSourceField(signalKey);
        });
        det.appendChild(pinBtn);
      }
      const list = el('ul');
      for (const c of contributors.slice(0, 30)) list.appendChild(contributorRender(c));
      if (contributors.length > 30) {
        list.appendChild(el('li', { text: `…${contributors.length - 30} more.` }));
      }
      det.appendChild(list);
      card.appendChild(det);
    }
    return card;
  }

  function renderTxContributor(c) {
    const li = el('li');
    const date = c.BookingDateTime?.slice(0, 10) ?? '—';
    const amt = c.Amount
      ? `${formatAmount(parseFloat(c.Amount.Amount))} ${c.Amount.Currency}`
      : '—';
    const tail = c.CreditorName
      ? ` · ${c.CreditorName}`
      : c.TransactionInformation
        ? ` · ${c.TransactionInformation}`
        : '';
    li.textContent = `${date} · ${amt}${tail}`;
    return li;
  }

  function renderCommitmentContributor(c) {
    const li = el('li');
    const id = c.StandingOrderId || c.DirectDebitId || '?';
    const label = c.Reference || c.Name || c.kind;
    const amt = c.Amount ? `${c.Amount.Amount} ${c.Amount.Currency}` : '—';
    const freq = c.Frequency ? ` (${c.Frequency})` : '';
    const monthly = `≈ ${formatAmount(c.monthlyAed)} AED/mo`;
    li.textContent = `${id} · ${label} · ${amt}${freq} → ${monthly}`;
    return li;
  }

  return { renderUnderwritingStrip, renderUnderwritingPanel };
}
