// URL state encoder/decoder — EXP-17 + §6.8.
// Three URL shapes: persona permalink, share (= permalink), embed.
//
// Custom personas (Workstream B): personaId='custom' + recipe=<base64url-json>
// is a reserved shape that materialises an ephemeral persona from the
// dimensions in the recipe. The slug 'custom' is reserved and never used by
// a curated persona.

export const DEFAULTS = {
  lfi: 'median',
  seed: 1,
  domain: 'banking',
  // D-10 — UI language. English is the default and stays implicit in URLs
  // so every existing permalink round-trips byte-identically.
  lang: 'en',
};

const VALID_LFI = new Set(['rich', 'median', 'sparse']);
const VALID_DOMAINS = new Set(['banking', 'insurance', 'atm']);
const VALID_LANGS = new Set(['en', 'ar']);
export const CUSTOM_PERSONA_SLUG = 'custom';

export function encodePermalink({
  slugBase = '/commons/sandbox',
  personaId,
  lfi,
  seed,
  domain,
  preview,
  recipe,
  lang,
}) {
  if (!personaId) throw new Error('personaId required');
  const params = new URLSearchParams();
  params.set('lfi', VALID_LFI.has(lfi) ? lfi : DEFAULTS.lfi);
  params.set('seed', String(Number.isFinite(seed) ? seed : DEFAULTS.seed));
  // domain only emitted when it differs from default (keeps banking permalinks unchanged).
  if (VALID_DOMAINS.has(domain) && domain !== DEFAULTS.domain) {
    params.set('domain', domain);
  }
  // lang only emitted when non-default (English stays implicit — D-10).
  if (VALID_LANGS.has(lang) && lang !== DEFAULTS.lang) {
    params.set('lang', lang);
  }
  if (preview) params.set('preview', '1');
  if (personaId === CUSTOM_PERSONA_SLUG && recipe) params.set('recipe', recipe);
  return `${slugBase}/p/${personaId}?${params.toString()}`;
}

export function encodeEmbed({
  slugBase = '',
  personaId,
  lfi,
  endpoint,
  seed,
  height,
  domain,
  preview,
  recipe,
}) {
  const params = new URLSearchParams();
  if (personaId) params.set('persona', personaId);
  if (lfi) params.set('lfi', VALID_LFI.has(lfi) ? lfi : DEFAULTS.lfi);
  if (endpoint) params.set('endpoint', endpoint);
  if (Number.isFinite(seed)) params.set('seed', String(seed));
  if (Number.isFinite(height)) params.set('height', String(height));
  if (VALID_DOMAINS.has(domain) && domain !== DEFAULTS.domain) {
    params.set('domain', domain);
  }
  if (preview) params.set('preview', '1');
  if (personaId === CUSTOM_PERSONA_SLUG && recipe) params.set('recipe', recipe);
  return `${slugBase}/embed?${params.toString()}`;
}

// EXP-28 — raw HTTPS fixture URL. Mirrors the on-disk path the fixture
// package writes: /fixtures/v1/bundles/<persona>/<lfi>/seed-<n>/<file>.json.
// Filename encoding matches `safeName()` in tools/build-fixture-package.mjs.
export function encodeFixtureUrl({ origin = '', personaId, lfi, seed, endpoint }) {
  if (!personaId) throw new Error('personaId required');
  const useLfi = VALID_LFI.has(lfi) ? lfi : DEFAULTS.lfi;
  const useSeed = Number.isFinite(seed) ? seed : DEFAULTS.seed;
  const safeName = (s) => s.replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '');
  const file = `${safeName(endpoint || '/accounts')}.json`;
  return `${origin}/fixtures/v1/bundles/${personaId}/${useLfi}/seed-${useSeed}/${file}`;
}

// Decode the current page URL into a state object. Tolerant: missing fields
// return DEFAULTS, invalid lfi falls back to 'median', NaN seed → 1.
export function decodeFromUrl(url) {
  const u = typeof url === 'string' ? new URL(url, 'http://localhost') : url;
  const params = u.searchParams;

  // Persona permalink: /…/p/<persona_id>
  let personaId = null;
  const m = u.pathname.match(/\/p\/([a-z0-9_-]+)/i);
  if (m) personaId = m[1];
  // Embed shape: ?persona=<id>
  if (!personaId && params.get('persona')) personaId = params.get('persona');

  let lfi = params.get('lfi');
  if (!VALID_LFI.has(lfi)) lfi = DEFAULTS.lfi;

  const seedRaw = params.get('seed');
  const seed =
    seedRaw != null && seedRaw !== '' && Number.isFinite(Number(seedRaw))
      ? Number(seedRaw)
      : DEFAULTS.seed;

  const endpoint = params.get('endpoint') || null;
  const heightRaw = params.get('height');
  const height =
    heightRaw != null && heightRaw !== '' && Number.isFinite(Number(heightRaw))
      ? Number(heightRaw)
      : null;

  const domainRaw = params.get('domain');
  const domain = VALID_DOMAINS.has(domainRaw) ? domainRaw : DEFAULTS.domain;
  // D-10 — UI language. Invalid / missing → English.
  const langRaw = params.get('lang');
  const lang = VALID_LANGS.has(langRaw) ? langRaw : DEFAULTS.lang;
  const preview = params.get('preview') === '1';
  const recipe = personaId === CUSTOM_PERSONA_SLUG ? params.get('recipe') : null;
  // Phase R1.5 — enriched-view toggle. Default OFF; URL opt-in keeps the
  // raw-bundle view as the cold-landing experience (which is what a TPP
  // would see from a real UAE core over Open Finance).
  const enriched = params.get('enriched') === '1';
  // Phase 2.3 — ATM Locator. The selected ATM's ATMId, round-tripped so
  // share-links restore the user's drill-down across a refresh / embed.
  // Domain-scoped — ignored unless `?domain=atm`.
  const atmId = domain === 'atm' ? params.get('atm') : null;

  return { personaId, lfi, seed, endpoint, height, domain, preview, recipe, enriched, atmId, lang };
}

// Update window.location without full reload. Browser-only; safely no-ops in tests.
export function pushState(state) {
  if (typeof window === 'undefined') return;
  const url = encodePermalink({
    slugBase: window.location.pathname.replace(/\/p\/[^?]*.*$/, ''),
    ...state,
  });
  window.history.pushState({}, '', url);
}
