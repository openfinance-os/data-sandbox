// Pure UI utility functions — no DOM state, no module-scope side effects.
// Extracted from src/app.js to keep the orchestrator focused on wiring.
// Each function here is a pure transform; importers never need to construct
// or close over a state object.

/**
 * Tiny DOM builder. `el('div', { class: 'foo', text: 'hi', attrs: { id: 'x' },
 * dataset: { kind: 'a' }, onClick: fn }, ...children)` — children may be
 * strings (auto-text-nodes) or HTMLElements. Returns the new HTMLElement.
 */
export function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v == null) continue;
      node.setAttribute(k, String(v));
    }
  }
  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = String(v);
  }
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

/**
 * True if a v2.1 field name conventionally carries an ISO date / datetime.
 * Used to drive the date-humanise toggle on /transactions.
 */
export function isDateField(name) {
  return /(?:Date|DateTime)$/.test(name);
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
  timeZone: 'Asia/Dubai', timeZoneName: 'short', hour12: false,
});

/**
 * Render an ISO timestamp as a Dubai-local human string with a short
 * timezone label — used by the /transactions table when state.humanDates
 * is true. Returns the input unchanged for unparsable inputs.
 */
export function humaniseDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return DATE_FORMATTER.format(d);
}

/**
 * Convert a snake_case archetype slug to a human label
 * ("salaried_expat_mid" → "Salaried Expat Mid").
 */
export function humanArchetype(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Render a stress_coverage term for the persona-card chips. Preserves the
 * canonical PRD Appendix F slug as the tooltip; the visible label fixes
 * common acronyms (DBR, FX, NSF, …) that snake_case mangles.
 */
export function humanStressTerm(t) {
  return t
    .replace(/_/g, ' ')
    .replace(/\bdbr\b/i, 'DBR')
    .replace(/\bfx\b/i, 'FX')
    .replace(/\bnsf\b/i, 'NSF')
    .replace(/\bpep\b/i, 'PEP')
    .replace(/\bkyc\b/i, 'KYC')
    .replace(/\buae\b/i, 'UAE');
}

/**
 * Format an AED amount for the rendered table — integer-ish locale-aware
 * grouping; '—' for non-finite inputs (typical of empty / null amounts).
 */
export function formatAmount(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
