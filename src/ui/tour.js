// Tell-me-a-story walkthrough — PRD §5.4. A 5-step tour that walks a
// first-time visitor through Sara's salaried-expat persona, the
// transaction salary marker, the standing-order cross-link, the
// field card, and the LFI profile mechanic. Pure UI module — takes its
// state and helpers as deps so it can live outside src/app.js
// without a circular import.

import { trapFocus } from '../shared/dom.js';

export function createTour(deps) {
  const {
    state,
    el,
    setPersona,
    emptyTxFilter,
    renderNavigator,
    renderPayload,
    renderCoverage,
    onClose,
  } = deps;

  // Dialog a11y state (WCAG 2.4.3 / 2.1.2): the focus-trap teardown for the
  // current step's overlay, the element to restore focus to on close, and the
  // Escape handler (the app-level Escape router doesn't cover the tour).
  let releaseTrap = null;
  let priorFocus = null;
  function onEscape(e) {
    if (e.key === 'Escape') closeTour();
  }

  const TOUR_STEPS = [
    {
      title: 'Meet Sara',
      body: 'Sara is a salaried expat in Dubai. She has two accounts: a current account where her AED 25k salary lands on the 25th, and a credit card. The persona library on the left lets you swap her for dozens of other UAE archetypes — gig worker, SME, HNW multi-currency, joint family, corporate treasury, and more.',
      setup: () => setPersona('salaried_expat_mid', 'median'),
    },
    {
      title: 'Watch the salary marker',
      body: "Open the transactions endpoint on Sara's current account. Notice the monthly salary credit — it carries Flags=Payroll. That's the v2.1 spec-clean way to identify income; everything else (fallbacks, recurrence-clustering) is a workaround for LFIs that don't populate it.",
      setup: () => {
        state.endpoint = '/accounts/{AccountId}/transactions';
        state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
        state.txFilter = emptyTxFilter();
        state.txFilter.search = 'Salary';
      },
    },
    {
      title: 'See the rent commitment',
      body: 'Switch to /standing-orders for the same account. Sara has a rent standing order that hits the 27th of every month — two days after her salary. Click that row and the sandbox jumps to the matching transactions in /transactions, with the cross-link banner offering you a way back.',
      setup: () => {
        state.endpoint = '/accounts/{AccountId}/standing-orders';
        state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
        state.txFilter = emptyTxFilter();
        state.txHighlight = new Set();
        state.crossLink = null;
      },
    },
    {
      title: 'Read the field card',
      body: "Click any field name in the rendered table to open the field card. Every field carries: a status badge (Mandatory / Optional / Conditional, derived live from the OpenAPI spec — never hand-authored), type and format, enum values, an example from the persona, a 'Real LFIs' guidance note, and a deep link to the field on the upstream Nebras GitHub at the pinned SHA.",
      setup: () => {
        // No state change — just nudge the user.
      },
    },
    {
      title: 'Sparse vs Median',
      body: "Switch the LFI profile (top bar) to Sparse. Watch the coverage meter drop and watch optional fields like MerchantDetails / Flags / ValueDateTime / Nickname disappear. That's the Phase-1 minimum your downstream UI and decisioning logic needs to handle. Switch back to Median, then to Rich, and pick a different persona to finish — the URL updates as you go, so you can paste it into a slide deck.",
      setup: () => {},
    },
  ];

  function startTour() {
    priorFocus = document.activeElement;
    document.addEventListener('keydown', onEscape);
    state.tourStep = 0;
    renderTourStep();
  }

  function renderTourStep() {
    const step = TOUR_STEPS[state.tourStep];
    if (!step) {
      closeTour();
      return;
    }
    if (typeof step.setup === 'function') {
      step.setup();
    }
    renderNavigator();
    renderPayload();
    renderCoverage();

    // Remove any existing overlay before mounting a fresh one — release the
    // prior step's focus trap first so listeners don't accumulate.
    releaseTrap?.();
    releaseTrap = null;
    document.getElementById('tour-overlay')?.remove();

    const overlay = el('div', {
      class: 'tour-overlay',
      attrs: {
        id: 'tour-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'tour-title',
      },
    });
    const card = el('div', { class: 'tour-card' });
    card.appendChild(
      el('div', {
        class: 'tour-step-num',
        text: `Step ${state.tourStep + 1} of ${TOUR_STEPS.length}`,
      }),
    );
    card.appendChild(el('h3', { text: step.title, attrs: { id: 'tour-title' } }));
    card.appendChild(el('p', { text: step.body }));
    const actions = el('div', { class: 'tour-actions' });
    actions.appendChild(el('button', { class: 'tour-skip', text: 'Skip', onClick: closeTour }));
    const right = el('div', { attrs: { style: 'display:flex;gap:6px' } });
    if (state.tourStep > 0) {
      right.appendChild(
        el('button', {
          text: 'Back',
          onClick: () => {
            state.tourStep--;
            renderTourStep();
          },
        }),
      );
    }
    const isLast = state.tourStep === TOUR_STEPS.length - 1;
    right.appendChild(
      el('button', {
        class: 'tour-primary',
        text: isLast ? 'Finish' : 'Next →',
        onClick: () => {
          if (isLast) closeTour();
          else {
            state.tourStep++;
            renderTourStep();
          }
        },
      }),
    );
    actions.appendChild(right);
    card.appendChild(actions);
    overlay.appendChild(card);
    // Click-outside dismisses.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeTour();
    });
    document.body.appendChild(overlay);
    releaseTrap = trapFocus(overlay);
    // Move focus into the card for keyboard users.
    card.querySelector('button.tour-primary')?.focus();
  }

  function closeTour() {
    state.tourStep = null;
    releaseTrap?.();
    releaseTrap = null;
    document.removeEventListener('keydown', onEscape);
    document.getElementById('tour-overlay')?.remove();
    state.tourSeen = true;
    // Restore focus to whatever launched the tour (WCAG 2.4.3).
    if (priorFocus && typeof priorFocus.focus === 'function') priorFocus.focus();
    priorFocus = null;
    if (typeof onClose === 'function') onClose();
  }

  return { startTour };
}
