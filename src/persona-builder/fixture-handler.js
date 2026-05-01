// Custom-persona fixture handler — Workstream C plug-point 1.
// Pure-function HTTP handler for URLs of the shape
//   /fixtures/v1/bundles/custom/<recipeHash>/<lfi>/seed-<n>/<filename>.json?recipe=<base64>
// Used by src/sw-fixtures.js (the Service Worker) and the test harness. Kept
// pure so it can be exercised in vitest under jsdom without needing a real
// Service Worker runtime.
//
// EXP-28 / D-11 — same URL contract as the static curated-persona fixtures
// (CORS-permissive headers, v2.1-shaped envelope, identical filename
// encoding). Custom personas live under the reserved `bundles/custom/`
// subtree; curated ones continue to be served as static JSON.

import { decodeRecipe, recipeHash } from './recipe.js';
import { expandRecipe } from './expand.js';
import { buildBundle } from '../generator/index.js';
import { envelopesFromBundle } from '../ui/export.js';

const PATH_RE =
  /\/fixtures\/v1\/bundles\/custom\/([a-z0-9]+)\/(rich|median|sparse)\/seed-(-?\d+)\/(.+)\.json$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

// Reverse the safeName() encoding from tools/build-fixture-package.mjs:
//   `/accounts/{AccountId}/transactions`  →  `accounts__AccountId__transactions`
// Filename can carry either the template `AccountId` placeholder or the
// resolved synthetic id. We honour both.
function filenameToEndpoint(filename, accountIds) {
  if (filename === 'accounts') return '/accounts';
  if (filename === 'parties') return '/parties';
  // Insert `/` for `__` separators.
  const base = '/' + filename.split('__').join('/');
  // If the segment after `/accounts/` is `AccountId` (template form), pick
  // the first resolved id.
  if (base.startsWith('/accounts/AccountId')) {
    if (accountIds.length === 0) return null;
    return base.replace('/accounts/AccountId', `/accounts/${accountIds[0]}`);
  }
  return base;
}

export function isCustomFixtureUrl(url) {
  try {
    const u = new URL(url, 'http://localhost');
    return PATH_RE.test(u.pathname);
  } catch {
    return false;
  }
}

// Returns a structured response { status, body, headers } so the caller
// (Service Worker or test harness) can wrap it in a real Response.
export function handleCustomFixtureRequest(rawUrl, { pools, now } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl, 'http://localhost');
  } catch {
    return error(400, 'invalid URL');
  }
  const m = PATH_RE.exec(parsed.pathname);
  if (!m) return error(404, 'not a custom-persona fixture path');
  const [, hashFromPath, lfi, seedRaw, filename] = m;

  const recipeParam = parsed.searchParams.get('recipe');
  if (!recipeParam) {
    return error(400, 'missing ?recipe= query parameter');
  }
  const recipe = decodeRecipe(recipeParam);
  // Verify the path's recipe-hash segment matches the recipe — guards against
  // accidental cache mixups across recipes that happen to share a path.
  const expectedHash = recipeHash(recipe);
  if (expectedHash !== hashFromPath) {
    return error(409, `recipe hash mismatch: path=${hashFromPath} recipe=${expectedHash}`);
  }

  let persona;
  try {
    persona = expandRecipe(recipe, pools);
  } catch (err) {
    return error(400, `recipe expansion failed: ${err.message ?? err}`);
  }

  const seed = Number(seedRaw);
  if (!Number.isFinite(seed)) return error(400, `invalid seed: ${seedRaw}`);

  const bundle = buildBundle({ persona, lfi, seed, pools, now });
  const accountIds = bundle.accounts.map((a) => a.AccountId);
  const endpoint = filenameToEndpoint(filename, accountIds);
  if (!endpoint) return error(404, `cannot resolve filename: ${filename}`);

  const envelopes = envelopesFromBundle(bundle, {
    personaId: persona.persona_id,
    lfi,
    seed,
    specVersion: 'v2.1',
    specSha: 'live',
    retrievedAt: now ? new Date(now).toISOString() : new Date().toISOString(),
  });
  const env = envelopes[endpoint];
  if (!env) return error(404, `endpoint ${endpoint} not generated`);

  return {
    status: 200,
    headers: { ...CORS_HEADERS },
    body: JSON.stringify(env),
  };
}

function error(status, message) {
  return {
    status,
    headers: { ...CORS_HEADERS },
    body: JSON.stringify({ error: message }),
  };
}
