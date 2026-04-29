// URL state encoder/decoder — EXP-17 + §6.8.
// Three URL shapes: persona permalink, share (= permalink), embed.

export const DEFAULTS = {
  lfi: 'median',
  seed: 1,
};

const VALID_LFI = new Set(['rich', 'median', 'sparse']);

export function encodePermalink({ slugBase = '/commons/sandbox', personaId, lfi, seed }) {
  if (!personaId) throw new Error('personaId required');
  const params = new URLSearchParams();
  params.set('lfi', VALID_LFI.has(lfi) ? lfi : DEFAULTS.lfi);
  params.set('seed', String(Number.isFinite(seed) ? seed : DEFAULTS.seed));
  return `${slugBase}/p/${personaId}?${params.toString()}`;
}

export function encodeEmbed({ slugBase = '', personaId, lfi, endpoint, seed, height }) {
  const params = new URLSearchParams();
  if (personaId) params.set('persona', personaId);
  if (lfi) params.set('lfi', VALID_LFI.has(lfi) ? lfi : DEFAULTS.lfi);
  if (endpoint) params.set('endpoint', endpoint);
  if (Number.isFinite(seed)) params.set('seed', String(seed));
  if (Number.isFinite(height)) params.set('height', String(height));
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

  return { personaId, lfi, seed, endpoint, height };
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
