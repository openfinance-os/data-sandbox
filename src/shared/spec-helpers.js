// Spec-helpers — drives the UI's status badges and field cards from the
// parsed SPEC.json (EXP-01 / EXP-13 / EXP-14). Hand-authored field-status
// tables are forbidden — this module is the only consumer that interprets
// the parsed spec into UI-shaped records.

/**
 * @typedef {Object} SpecField
 * @property {string} path     - dotted path within the response, e.g. "Data.Account.Status"
 * @property {string} name     - leaf name
 * @property {string} type     - "string" | "object" | "array" | "integer" | "number" | "boolean"
 * @property {string} status   - "mandatory" | "optional" | "conditional"
 * @property {string=} format
 * @property {string[]=} enum
 * @property {string=} description
 */

const STATUS = Object.freeze({
  MANDATORY: 'mandatory',
  OPTIONAL: 'optional',
  CONDITIONAL: 'conditional',
});

export function statusBadge(status) {
  switch (status) {
    case STATUS.MANDATORY:
      return { label: 'M', shape: 'pill-solid', text: 'Mandatory' };
    case STATUS.CONDITIONAL:
      return { label: 'C', shape: 'pill-conditional', text: 'Conditional' };
    case STATUS.OPTIONAL:
    default:
      return { label: 'O', shape: 'pill-dashed', text: 'Optional' };
  }
}

/**
 * Build a flat list of leaf fields (filtering out the array/object container
 * rows the parser emits) for a given endpoint.
 */
export function leafFields(spec, endpointPath) {
  const e = spec.endpoints[endpointPath];
  if (!e) return [];
  return e.fields.filter((f) => f.type !== 'object' && f.type !== 'array');
}

/** Counts of mandatory/optional/conditional fields for a single endpoint. */
export function countByStatus(spec, endpointPath) {
  const fields = leafFields(spec, endpointPath);
  const out = { mandatory: 0, optional: 0, conditional: 0, total: fields.length };
  for (const f of fields) out[f.status] = (out[f.status] ?? 0) + 1;
  return out;
}

/**
 * Compute the "% of optional fields actually populated" metric (EXP-15) for
 * a bundle. Phase-0 implementation: walks the bundle's accounts/balances/
 * transactions and probes the small set of optional fields the LFI filter
 * touches. Phase 1 expands this to use the full SPEC.json structure.
 */
export function coverage(bundle) {
  const probes = [];
  for (const a of bundle.accounts ?? []) {
    probes.push(['Account.Nickname', a.Nickname != null]);
    probes.push(['Account.OpeningDate', a.OpeningDate != null]);
  }
  for (const t of bundle.transactions ?? []) {
    probes.push(['Transaction.TransactionInformation', t.TransactionInformation != null]);
    probes.push(['Transaction.Flags', Array.isArray(t.Flags) && t.Flags.length > 0]);
    probes.push(['Transaction.MerchantDetails', t.MerchantDetails != null]);
    if (t.MerchantDetails) {
      probes.push(['Transaction.MerchantDetails.MerchantCategoryCode', t.MerchantDetails.MerchantCategoryCode != null]);
      probes.push(['Transaction.MerchantDetails.MerchantName', t.MerchantDetails.MerchantName != null]);
    }
  }
  for (const b of bundle.balances ?? []) {
    probes.push(['Balance.CreditLine', Array.isArray(b.CreditLine)]);
  }
  const populated = probes.filter(([, ok]) => ok).length;
  const total = probes.length || 1;
  return { populated, total, pct: Math.round((populated / total) * 100) };
}

export { STATUS };
