// Curated-persona fixture handler — Service Worker plug-point.
//
// URLs of the shape
//   /fixtures/v1/bundles/<persona_id>/<lfi>/seed-<n>/<filename>.json[?offset=&limit=]
// are normally served as static JSON by the host. When the Service Worker
// intercepts a request that carries `?offset=` or `?limit=`, this handler
// fetches the underlying static file, slices its Data array, and returns
// the paginated envelope — letting a TPP client navigate a curated persona
// the same way it would a real LFI's Open Finance API (follow Links.Next
// until absent).
//
// Without pagination query params, the SW falls through to the network so
// the on-disk file is returned verbatim (no extra round-trip cost).

import { paginateEnvelope, parsePaginationParams } from '../shared/pagination.js';

const PATH_RE =
  /^\/fixtures\/v1\/bundles\/([a-z0-9_-]+)\/(rich|median|sparse)\/seed-(-?\d+)\/(.+)\.json$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

export function isCuratedFixtureUrl(url) {
  try {
    const u = new URL(url, 'http://localhost');
    const m = PATH_RE.exec(u.pathname);
    if (!m) return false;
    // The custom-persona handler owns the `custom` prefix.
    return m[1] !== 'custom';
  } catch {
    return false;
  }
}

// Returns true iff the request URL carries pagination query params. The SW
// uses this to decide whether to intercept (rewrite + slice) or fall through
// (let the network serve the on-disk static file unchanged).
export function isPaginatedRequest(url) {
  try {
    const u = new URL(url, 'http://localhost');
    return u.searchParams.has('offset') || u.searchParams.has('limit');
  } catch {
    return false;
  }
}

// Pure HTTP handler. Takes the original request URL and a `fetchJson(url)`
// callback (so the SW can route the underlying static fetch through the
// network without re-triggering its own intercept). Returns a structured
// response — same shape as handleCustomFixtureRequest.
export async function handleCuratedFixtureRequest(rawUrl, { fetchJson } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl, 'http://localhost');
  } catch {
    return error(400, 'invalid URL');
  }
  if (!PATH_RE.test(parsed.pathname)) {
    return error(404, 'not a curated-persona fixture path');
  }

  const pagination = parsePaginationParams(parsed.searchParams);
  if (!pagination.requested) {
    return error(400, 'curated pagination only engages with ?offset= or ?limit=');
  }

  // Fetch the underlying static file (no query string).
  const staticUrl = `${parsed.origin}${parsed.pathname}`;
  let envelope;
  try {
    envelope = await fetchJson(staticUrl);
  } catch (err) {
    return error(502, `upstream fetch failed: ${err?.message ?? err}`);
  }

  const paged = paginateEnvelope(envelope, {
    offset: pagination.offset,
    limit: pagination.limit,
    requested: true,
    requestUrl: parsed.toString(),
  });

  return {
    status: 200,
    headers: { ...CORS_HEADERS },
    body: JSON.stringify(paged),
  };
}

function error(status, message) {
  return {
    status,
    headers: { ...CORS_HEADERS },
    body: JSON.stringify({ error: message }),
  };
}
