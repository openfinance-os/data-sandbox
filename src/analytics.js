// EXP-21 anonymous analytics shim. The PostHog SDK isn't loaded here
// (PR 2 wires that) — this file enforces the allowlist + property
// sanitisation so call sites can land first and the SDK swap is
// mechanical. Until the SDK is loaded, every `track()` call is a no-op.
//
// Load-bearing invariants (PRD §4.5b / EXP-21):
//   - event names ∈ ALLOWED_EVENTS (any other event drops with a warn).
//   - property keys ∈ ALLOWED_PROP_KEYS (anything else is dropped before
//     it reaches the SDK).
//   - no string longer than 64 chars (defends against accidental free-
//     text capture — search queries, narrative strings, etc).
//   - no nested objects (defends against accidental whole-record capture).
//
// EXP-22 (no persistent identifiers): the SDK init in PR 2 sets
// `persistence: 'memory'` and blacklists `$ip` / `$current_url` etc., so
// a reload is a fresh session from PostHog's perspective. This shim is
// transport-agnostic — it would behave identically against a different
// analytics backend.

export const ALLOWED_EVENTS = Object.freeze([
  'persona_load',
  'lfi_switch',
  'field_click',
  'endpoint_nav',
  'raw_json_toggle',
  'export',
  'share',
]);

const ALLOWED_EVENT_SET = new Set(ALLOWED_EVENTS);

// Per-event property allowlist. Anything not listed is dropped silently.
// Keep this set tight — every entry here is part of the EXP-21 contract.
export const ALLOWED_PROP_KEYS = Object.freeze([
  // persona_load
  'persona_id',
  'domain',
  'lfi',
  'custom',
  // lfi_switch
  'from',
  'to',
  // field_click
  'status',
  'endpoint',
  // endpoint_nav: endpoint, domain (already listed)
  // raw_json_toggle
  'mode',
  // export
  'format',
  // share
  'kind',
]);

const ALLOWED_PROP_KEY_SET = new Set(ALLOWED_PROP_KEYS);

let posthogPromise = null;

/** @internal — PR 2 sets this. Exported only for tests. */
export function _setPosthogLoader(loader) {
  posthogPromise = loader();
}

export async function track(event, props = {}) {
  if (!ALLOWED_EVENT_SET.has(event)) {
    if (typeof console !== 'undefined') {
      console.warn(`[analytics] event '${event}' is not in the EXP-21 allowlist; dropping`);
    }
    return;
  }
  const sanitised = sanitise(props);
  if (!posthogPromise) return;
  const ph = await posthogPromise;
  ph?.capture?.(event, sanitised);
}

function sanitise(props) {
  const out = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (!ALLOWED_PROP_KEY_SET.has(k)) continue;
    if (v == null) continue;
    if (typeof v === 'object') continue;
    if (typeof v === 'string' && v.length > 64) continue;
    out[k] = v;
  }
  return out;
}
