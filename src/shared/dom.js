// Shared DOM helpers — the single home for the tiny builder + the
// rendering primitives that were previously copy-pasted across app.js and
// the ui/* modules. Pure DOM, no app state, no module-scope side effects.

import { statusBadge } from './spec-helpers.js';

/**
 * Tiny DOM builder.
 *   el('div', { class: 'foo', text: 'hi', attrs: { id: 'x' },
 *               dataset: { kind: 'a' }, onClick: fn, onChange: fn,
 *               onInput: fn }, ...children)
 * children may be strings (auto-text-nodes), HTMLElements, or null (skipped).
 * `attrs` skips null/undefined/false values and maps `true` → '' (so a
 * boolean attribute renders as `disabled` rather than `disabled="true"`).
 * Every prior caller passed string attr values, so this is a strict superset
 * of the two implementations it replaces. Returns the new HTMLElement.
 */
export function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v == null || v === false) continue;
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = String(v);
  }
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  if (opts.onChange) node.addEventListener('change', opts.onChange);
  if (opts.onInput) node.addEventListener('input', opts.onInput);
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

/**
 * The status badge `<span class="pill ...">` element for a field status
 * (mandatory / optional / conditional). Returns just the pill span; callers
 * that want a trailing text label append `statusBadge(status).text`
 * themselves (some do, some don't). Consolidates four identical inline
 * builders (field-card, app.js table header, compare-view, hover-preview).
 */
export function statusPill(status) {
  const badge = statusBadge(status);
  return el('span', {
    class: `pill ${badge.shape}`,
    text: badge.label,
    attrs: { 'aria-label': badge.text },
  });
}

/**
 * Sync the rendered/raw view-tab toggle to `view` ('rendered' | 'raw').
 * No-op for whichever element is absent (embed mode reuses a subset of the
 * chrome). Consolidates identical blocks in app.js / ui/insurance / ui/atm.
 */
export function syncViewTabs(view) {
  const rendered = document.getElementById('view-rendered');
  const raw = document.getElementById('view-raw');
  rendered?.classList.toggle('active', view === 'rendered');
  raw?.classList.toggle('active', view === 'raw');
  rendered?.setAttribute('aria-selected', String(view === 'rendered'));
  raw?.setAttribute('aria-selected', String(view === 'raw'));
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableWithin(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (e) => !e.hasAttribute('hidden') && e.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Trap keyboard focus inside `container` (WCAG 2.4.3 / 2.1.2). While active,
 * Tab from the last focusable wraps to the first and Shift+Tab from the first
 * wraps to the last; a Tab fired while focus has escaped the container is
 * pulled back in. Returns a cleanup function — call it when the dialog closes
 * to remove the listener. Listens in the capture phase on `document` so it
 * runs before any per-dialog key handling.
 */
export function trapFocus(container) {
  if (!container) return () => {};
  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const items = focusableWithin(container);
    if (items.length === 0) {
      // Nothing focusable inside — keep focus from leaving entirely.
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = container.contains(active);
    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKeydown, true);
  return () => document.removeEventListener('keydown', onKeydown, true);
}
