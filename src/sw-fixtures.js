// Service Worker — Workstream C plug-point 1.
// Intercepts requests of the shape
//   /fixtures/v1/bundles/custom/<recipeHash>/<lfi>/seed-<n>/<filename>.json?recipe=<...>
// and serves them by running expandRecipe + buildBundle in-process. CORS
// headers are permissive so a TPP demo running in a sibling iframe (or a
// foreign-origin page that fetches against this sandbox's origin) gets a
// drop-in equivalent of the static curated-persona fixtures.
//
// Curated-persona URLs (/fixtures/v1/bundles/<persona_id>/...) are NOT
// intercepted — those continue to be served as static JSON by the host.

import {
  isCustomFixtureUrl,
  handleCustomFixtureRequest,
} from './persona-builder/fixture-handler.js';

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
  poolsPromise = fetch('../dist/data.json').then((r) => r.json()).then((d) => d.pools);
  return poolsPromise;
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (!isCustomFixtureUrl(url)) return;

  event.respondWith((async () => {
    try {
      const pools = await loadPools();
      const result = handleCustomFixtureRequest(url, { pools });
      return new Response(result.body, {
        status: result.status,
        headers: result.headers,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: String(err && err.message || err) }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  })());
});
