// Custom-persona recipe codec — Workstream B.
// A recipe is a compact JSON object describing the dimensions a TPP picked
// in the Custom Persona Builder. It encodes to a base64url string that fits
// in a `recipe` URL query parameter; decoding is tolerant of missing fields
// (filled from defaults) so URLs survive future recipe-shape additions.
//
// EXP-05 determinism: the same recipe object always serialises to the same
// base64url string (canonical form: keys sorted, defaults stripped). The
// recipe hash (djb2 of canonical JSON) is mixed into the generator's PRNG
// seed tuple so two recipes yielding the same persona shape but different
// dimension choices never collide on PRNG state.

import { DEFAULTS as URL_DEFAULTS } from '../url.js';

export const SEGMENTS = ['Retail', 'SME', 'Corporate'];
export const PARTY_TYPES = ['Sole', 'Joint', 'Delegate'];
export const ACCOUNT_KINDS = ['CurrentAccount', 'Savings', 'CreditCard', 'Mortgage', 'Finance'];

// Default recipe — the shape the encoder strips and the decoder reinstates.
// Keep this minimal; preset tables live in dimensions.js.
export const RECIPE_DEFAULTS = Object.freeze({
  segment: 'Retail',
  name_pool: 'expat_indian',
  age_band: '28-38',
  emirate: 'dubai',
  income_band: 'mid', // dimensions.js maps this to (monthly_amount_aed, variability)
  flag_payroll: true,
  employer_pool: 'tech_freezone',
  products: ['CurrentAccount'],
  card_limit: 'mid',
  spend_intensity: 'med',
  fx_activity: false,
  cash_deposit: false,
  distress: 'none',
  // Org block applies when segment != Retail. Defaults are inert; the
  // expander only consults them when segment is non-retail.
  legal_name_pool: 'sme_mainland',
  signatory_pool: 'expat_arab',
  signatory_account_role: 'Principal',
  signatory_party_type: 'Sole',
  // Cash-flow defaults; expander only applies when segment != Retail.
  cash_flow_intensity: 'med',
  customer_inflow_pool: 'b2b_local',
  supplier_outflow_pool: 'b2b_intl',
  invoice_cadence: 'monthly',
  // Stress tags advisory only; not CI-checked for custom personas.
  stress_tags: [],
});

// Stable canonicalisation: sort keys alphabetically, omit values equal to
// the default. The output is deterministic for any equivalent input.
// Non-plain-object inputs (strings, numbers, arrays) are treated as empty —
// spreading a string would otherwise leak character-indexed keys.
export function canonicalise(recipe) {
  const safe =
    recipe && typeof recipe === 'object' && !Array.isArray(recipe) ? recipe : {};
  const merged = { ...RECIPE_DEFAULTS, ...safe };
  const out = {};
  for (const k of Object.keys(merged).sort()) {
    const v = merged[k];
    const def = RECIPE_DEFAULTS[k];
    if (Array.isArray(v) && Array.isArray(def)) {
      if (v.length === def.length && v.every((x, i) => x === def[i])) continue;
      out[k] = [...v];
      continue;
    }
    if (v === def) continue;
    out[k] = v;
  }
  return out;
}

// Browser- and Node-portable base64url encode/decode. We avoid Buffer to keep
// this module runnable in the browser without polyfills.
function utf8ToBytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  // Fallback (older Node): UTF-16 → UTF-8 manually. Custom recipes are ASCII
  // by construction so this path is rarely hit.
  const out = [];
  for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
  return Uint8Array.from(out);
}

function bytesToUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function base64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s) {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeRecipe(recipe) {
  const canonical = canonicalise(recipe);
  const json = JSON.stringify(canonical);
  return base64urlEncode(utf8ToBytes(json));
}

export function decodeRecipe(encoded) {
  if (!encoded) return { ...RECIPE_DEFAULTS };
  let parsed;
  try {
    parsed = JSON.parse(bytesToUtf8(base64urlDecode(encoded)));
  } catch {
    return { ...RECIPE_DEFAULTS };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...RECIPE_DEFAULTS };
  }
  return { ...RECIPE_DEFAULTS, ...parsed };
}

// djb2 over the canonical JSON form. Stable across machines + Node/browser.
// Returned as an unsigned 32-bit int rendered in base36 for compact use as
// a path segment in the on-demand fixture URL (Workstream C).
export function recipeHash(recipe) {
  const canonical = canonicalise(recipe);
  const json = JSON.stringify(canonical);
  let h = 5381;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) + h + json.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// Validate that a decoded recipe references only known enum / pool values.
// Returns { ok: true } or { ok: false, errors: [...] }. Used by the UI to
// warn the user; the expander throws on the same conditions so the URL
// never produces a bundle if the recipe is invalid.
export function validateRecipe(recipe, indexedPools) {
  const errors = [];
  const r = { ...RECIPE_DEFAULTS, ...(recipe ?? {}) };
  if (!SEGMENTS.includes(r.segment)) errors.push(`segment ${r.segment} invalid`);
  if (!indexedPools.namesByPoolId[r.name_pool]) {
    errors.push(`name_pool ${r.name_pool} unknown`);
  }
  if (r.employer_pool && !indexedPools.employersByPoolId[r.employer_pool]) {
    errors.push(`employer_pool ${r.employer_pool} unknown`);
  }
  if (Array.isArray(r.products)) {
    for (const p of r.products) {
      if (!ACCOUNT_KINDS.includes(p)) errors.push(`product ${p} invalid`);
    }
  }
  if (r.segment !== 'Retail') {
    if (!(indexedPools.organisationsByPoolId ?? {})[r.legal_name_pool]) {
      errors.push(`legal_name_pool ${r.legal_name_pool} unknown`);
    }
    if (!indexedPools.namesByPoolId[r.signatory_pool]) {
      errors.push(`signatory_pool ${r.signatory_pool} unknown`);
    }
    if (!PARTY_TYPES.includes(r.signatory_party_type)) {
      errors.push(`signatory_party_type ${r.signatory_party_type} invalid`);
    }
    if (!(indexedPools.counterpartiesByPoolId ?? {})[r.customer_inflow_pool]) {
      errors.push(`customer_inflow_pool ${r.customer_inflow_pool} unknown`);
    }
    if (!(indexedPools.counterpartiesByPoolId ?? {})[r.supplier_outflow_pool]) {
      errors.push(`supplier_outflow_pool ${r.supplier_outflow_pool} unknown`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

void URL_DEFAULTS;
