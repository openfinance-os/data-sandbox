// Pure UI utility functions — no DOM state, no module-scope side effects.
// Extracted from src/app.js to keep the orchestrator focused on wiring.
// Each function here is a pure transform; importers never need to construct
// or close over a state object.

// `el` now lives in shared/dom.js (single canonical builder). Re-exported
// here so the many `import { el } from '.../app/utils.js'` call sites keep
// working unchanged.
export { el } from '../shared/dom.js';
// Route display-number formatting through the active numeral mode (D-10).
// Default mode is 'latn', so this is an identity transform until the user
// opts into Arabic-Indic numerals.
import { localizeDigits } from '../shared/i18n.js';

/**
 * Parse a build-time SVG string and return the live <svg> element. The
 * source SVGs come from tools/build-avatars.mjs — a closed allow-list of
 * generator output, no user data interpolated — so DOMParser is used to
 * avoid touching innerHTML while still producing a real DOM node the
 * caller can append. Returns null if the input cannot be parsed.
 */
export function svgFromString(s) {
  if (!s) return null;
  const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg') return null;
  return document.importNode(root, true);
}

/**
 * True if a v2.1 field name conventionally carries an ISO date / datetime.
 * Used to drive the date-humanise toggle on /transactions.
 */
export function isDateField(name) {
  return /(?:Date|DateTime)$/.test(name);
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Dubai',
  timeZoneName: 'short',
  hour12: false,
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
  return localizeDigits(n.toLocaleString(undefined, { maximumFractionDigits: 0 }));
}
