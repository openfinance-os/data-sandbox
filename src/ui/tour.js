// Tell-me-a-story walkthrough — PRD §5.4. A 5-step tour that walks a
// first-time visitor through Sara's salaried-expat persona, the
// transaction salary marker, the standing-order cross-link, the
// field card, and the LFI profile mechanic. Pure UI module — takes its
// state and helpers as deps so it can live outside src/app.js
// without a circular import.

import { trapFocus } from '../shared/dom.js';
import { t } from '../shared/i18n.js';

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

  // D-10 — step copy (title + body) lives in the i18n catalog under tour.sN.*;
  // each step keeps its setup() to drive the live demo. Render reads the
  // active locale at paint time.
  const TOUR_STEPS = [
    {
      titleKey: 'tour.s1.title',
      bodyKey: 'tour.s1.body',
      setup: () => setPersona('salaried_expat_mid', 'median'),
    },
    {
      titleKey: 'tour.s2.title',
      bodyKey: 'tour.s2.body',
      setup: () => {
        state.endpoint = '/accounts/{AccountId}/transactions';
        state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
        state.txFilter = emptyTxFilter();
        state.txFilter.search = 'Salary';
      },
    },
    {
      titleKey: 'tour.s3.title',
      bodyKey: 'tour.s3.body',
      setup: () => {
        state.endpoint = '/accounts/{AccountId}/standing-orders';
        state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
        state.txFilter = emptyTxFilter();
        state.txHighlight = new Set();
        state.crossLink = null;
      },
    },
    {
      titleKey: 'tour.s4.title',
      bodyKey: 'tour.s4.body',
      setup: () => {
        // No state change — just nudge the user.
      },
    },
    {
      titleKey: 'tour.s5.title',
      bodyKey: 'tour.s5.body',
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
    const lang = state.lang;
    const card = el('div', { class: 'tour-card' });
    card.appendChild(
      el('div', {
        class: 'tour-step-num',
        text: t('tour.stepOf', lang)
          .replace('{n}', String(state.tourStep + 1))
          .replace('{total}', String(TOUR_STEPS.length)),
      }),
    );
    card.appendChild(el('h3', { text: t(step.titleKey, lang), attrs: { id: 'tour-title' } }));
    card.appendChild(el('p', { text: t(step.bodyKey, lang) }));
    const actions = el('div', { class: 'tour-actions' });
    actions.appendChild(
      el('button', { class: 'tour-skip', text: t('tour.skip', lang), onClick: closeTour }),
    );
    const right = el('div', { attrs: { style: 'display:flex;gap:6px' } });
    if (state.tourStep > 0) {
      right.appendChild(
        el('button', {
          text: t('tour.back', lang),
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
        text: isLast ? t('tour.finish', lang) : t('tour.next', lang),
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
