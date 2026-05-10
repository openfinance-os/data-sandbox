// EXP-21 anonymous analytics. The PostHog SDK is lazy-loaded on the first
// allowlisted track() call, so the cold path stays clean (EXP-24 budget)
// and a visitor who never interacts emits zero PostHog requests.
//
// Load-bearing invariants (PRD §4.5b / EXP-21):
//   - event names ∈ ALLOWED_EVENTS (any other event drops with a warn).
//   - property keys ∈ ALLOWED_PROP_KEYS (anything else is dropped before
//     it reaches the SDK).
//   - no string longer than 64 chars (defends against accidental free-
//     text capture — search queries, narrative strings, etc).
//   - no nested objects (defends against accidental whole-record capture).
//
// EXP-22 (no persistent identifiers): SDK init below sets
// `persistence: 'memory'` and blacklists `$ip` / `$current_url` etc., so
// a reload is a fresh session from PostHog's perspective. distinctID is
// a per-reload UUID — no cookie, no localStorage. This shim is
// transport-agnostic — it would behave identically against a different
// analytics backend.
//
// Project-key delivery: tools/stage-site.mjs injects
// `<script>window.__POSTHOG_KEY__='...'</script>` from the POSTHOG_KEY
// GitHub Actions secret at deploy time. If the global is unset (local
// `npm run serve`, vitest, or a deploy without the secret) the loader
// short-circuits to `null` and analytics stay off — the EXP-21 contract
// is never violated by a missing-key state, only by a non-allowlisted
// event, which is caught at CI time by tests/analytics-allowlist.test.mjs.

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

const POSTHOG_HOST = 'https://us.i.posthog.com';
// SDK is self-hosted (PR 7) — tools/stage-site.mjs copies
// node_modules/posthog-js/dist/module.slim.js to
// _site/src/vendor/posthog-js-<sha8>.js and writes a config script
// that sets window.__POSTHOG_SDK_URL__ to the hashed filename. The
// fallback below is what local dev / the e2e harness use when no
// config script ran — they either short-circuit on a missing key
// (dev) or stub the import via Playwright route-fulfill (e2e).
const POSTHOG_DEFAULT_SDK_URL = './vendor/posthog-js.js';

let posthogPromise = null;

function loadPosthog() {
  if (posthogPromise) return posthogPromise;
  // Browser-only. Importing this module from Node (vitest, the npm
  // fixture package, the MCP server) must never trigger a network
  // fetch. typeof-window is the cleanest gate.
  if (typeof window === 'undefined') {
    posthogPromise = Promise.resolve(null);
    return posthogPromise;
  }
  const key = window.__POSTHOG_KEY__;
  if (!key || typeof key !== 'string') {
    // Surface this once in DevTools so a maintainer wondering why no
    // events are flowing has a one-line answer in Console instead of
    // having to read the source. Common cause: deployed via Cloudflare
    // Pages (or another non-GH-Actions target) without the POSTHOG_KEY
    // environment variable set on that target. See tools/stage-site.mjs
    // and .github/workflows/deploy.yml for the per-target wiring story.
    if (typeof console !== 'undefined') {
      console.info(
        '[analytics] POSTHOG_KEY not configured (window.__POSTHOG_KEY__ is unset); analytics disabled'
      );
    }
    posthogPromise = Promise.resolve(null);
    return posthogPromise;
  }
  const sdkUrl = window.__POSTHOG_SDK_URL__ || POSTHOG_DEFAULT_SDK_URL;
  const pending = import(/* @vite-ignore */ sdkUrl)
    .then((mod) => {
      const ph = mod.default ?? mod;
      installIngestFailureWarning();
      ph.init(key, {
        api_host: POSTHOG_HOST,
        // EXP-21: every default that captures something we didn't ask for
        // is turned off explicitly. Defense in depth — the property
        // allowlist in sanitise() is the actual gate.
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true,
        // EXP-22: no cookies, no localStorage. distinctID is a fresh
        // UUID per page reload, so PostHog never builds a cross-session
        // identity for an anonymous visitor. crypto.randomUUID is
        // required — modern browsers (Chrome 92+, Safari 15.4+, Firefox
        // 95+) all support it, and EXP-24's mid-tier-mobile target sits
        // well above the floor. If it's missing the init throws and the
        // SDK never starts (analytics off, page still works).
        persistence: 'memory',
        bootstrap: {
          distinctID: crypto.randomUUID(),
        },
        property_blacklist: [
          '$ip',
          '$current_url',
          '$pathname',
          '$referrer',
          '$initial_referrer',
          '$referring_domain',
          '$initial_referring_domain',
          '$host',
          '$browser',
          '$device_id',
          '$user_agent',
        ],
        sanitize_properties: (props) => sanitise(props ?? {}),
        // SDK noise off — the shim already warns on bad input.
        loaded: () => {},
      });
      return ph;
    })
    .catch((err) => {
      if (typeof console !== 'undefined') {
        console.warn('[analytics] PostHog SDK failed to load; will retry on next track()', err);
      }
      // Drop the cached rejection so the next track() call retries. A
      // transient unpkg blip shouldn't kill analytics for the rest of
      // the session.
      if (posthogPromise === pending) posthogPromise = null;
      return null;
    });
  posthogPromise = pending;
  return posthogPromise;
}

export async function track(event, props = {}) {
  if (!ALLOWED_EVENT_SET.has(event)) {
    if (typeof console !== 'undefined') {
      console.warn(`[analytics] event '${event}' is not in the EXP-21 allowlist; dropping`);
    }
    return;
  }
  const sanitised = sanitise(props);
  // Trigger the lazy load on the first allowlisted track() call. Subsequent
  // calls reuse the cached promise.
  const ph = await loadPosthog();
  ph?.capture?.(event, sanitised);
}

// One-shot transport-level guard for ingest rejection. The PostHog SDK
// has no stable cross-version error callback for failed `/e/` POSTs, so
// a revoked key, an Authorized-URLs allowlist mismatch, or a billing
// pause produces a 401/403 in the network tab and silence in the
// console. This wrapper logs once on the first non-2xx response from
// `i.posthog.com` and then restores the original fetch — repeated
// warnings would just be noise on every captured event.
function installIngestFailureWarning() {
  if (typeof window === 'undefined') return;
  const orig = window.fetch;
  if (typeof orig !== 'function') return;
  let warned = false;
  const wrapped = function (input, init) {
    const url =
      typeof input === 'string'
        ? input
        : input && typeof input.url === 'string'
          ? input.url
          : '';
    const result = orig.apply(this, arguments);
    if (!warned && url.includes('i.posthog.com')) {
      Promise.resolve(result)
        .then((res) => {
          if (warned || !res || res.ok) return;
          warned = true;
          if (window.fetch === wrapped) window.fetch = orig;
          if (typeof console !== 'undefined') {
            console.warn(
              `[analytics] PostHog ingest rejected with HTTP ${res.status}; events are not being delivered. ` +
                `Common causes: rotated/revoked POSTHOG_KEY, project Authorized-URLs allowlist excluding this origin, ` +
                `or project billing pause. See tools/stage-site.mjs for the key-injection wiring.`
            );
          }
        })
        .catch(() => {});
    }
    return result;
  };
  window.fetch = wrapped;
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
