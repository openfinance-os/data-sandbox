// Service Worker — Workstream C plug-point 1 + pagination.
//
// Intercepts two request shapes:
//
//   /fixtures/v1/bundles/custom/<recipeHash>/<lfi>/seed-<n>/<filename>.json
//     [?recipe=<...>][&offset=&limit=]
//     — handled in-process by handleCustomFixtureRequest (expandRecipe +
//     buildBundle), then paginated if offset/limit are set.
//
//   /fixtures/v1/bundles/<persona_id>/<lfi>/seed-<n>/<filename>.json
//     [?offset=&limit=]
//     — falls through to the network unchanged when no pagination params
//     are present. When ?offset= or ?limit= is set, the SW fetches the
//     on-disk static envelope and slices its Data array before returning.
//
// In both modes the response carries spec-correct Links.Self/First/Last and
// Links.Next / Links.Previous so a TPP integrating against the sandbox can
// drive pagination the way it would against a real LFI.
//
// CORS headers are permissive so a TPP demo running in a sibling iframe (or
// a foreign-origin page that fetches against this sandbox's origin) gets a
// drop-in equivalent of the static curated-persona fixtures.

import {
  isCustomFixtureUrl,
  handleCustomFixtureRequest,
} from './persona-builder/fixture-handler.js';
import {
  isCuratedFixtureUrl,
  isPaginatedRequest,
  handleCuratedFixtureRequest,
} from './persona-builder/curated-fixture-handler.js';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Indexed pools are fetched lazily on the first matching request and cached
// in module scope. The SW can be replayed against a different sandbox build
// — the pools manifest will refresh on the next activate.
let poolsPromise = null;
function loadPools() {
  if (poolsPromise) return poolsPromise;
  // The SW is registered with `scope: '../'` so paths are relative to /src/.
  poolsPromise = fetch('../dist/data.json')
    .then((r) => r.json())
    .then((d) => d.pools);
  return poolsPromise;
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  if (isCustomFixtureUrl(url)) {
    event.respondWith(handleCustom(url));
    return;
  }

  if (isCuratedFixtureUrl(url) && isPaginatedRequest(url)) {
    event.respondWith(handleCurated(url));
    return;
  }
  // Curated fixtures without pagination params fall through to the network
  // so the on-disk static JSON serves the request unchanged (zero overhead).
});

async function handleCustom(url) {
  try {
    const pools = await loadPools();
    const result = handleCustomFixtureRequest(url, { pools });
    return new Response(result.body, { status: result.status, headers: result.headers });
  } catch (err) {
    return errorResponse(err);
  }
}

async function handleCurated(url) {
  try {
    const fetchJson = async (staticUrl) => {
      // Bypass our own intercept by routing through fetch() — the SW's match
      // predicate excludes URLs without pagination params, so this resolves
      // straight to the upstream static file.
      const r = await fetch(staticUrl);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    };
    const result = await handleCuratedFixtureRequest(url, { fetchJson });
    return new Response(result.body, { status: result.status, headers: result.headers });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err) {
  // Don't leak internal details (including any stack trace embedded in
  // err.message) into the response body — the SW serves arbitrary
  // cross-origin TPP integrators. Log the detail to the SW console for
  // local debugging and return a generic body to the caller.

  console.error('[sw-fixtures] handler error:', err);
  return new Response(JSON.stringify({ error: 'fixture handler error' }), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
