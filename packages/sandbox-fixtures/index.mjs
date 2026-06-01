// @openfinance-os/sandbox-fixtures — ESM loader.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { paginateEnvelope } from './lib/shared/pagination.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));

const SPEC_FILE_BY_DOMAIN = {
  banking: 'spec.json',
  insurance: 'spec.insurance.json',
  atm: 'spec.atm.json',
};

export function listPersonas(opts = {}) {
  const ids = Object.keys(manifest.personas);
  if (!opts.domain) return ids;
  // Phase 2.2 — multi-domain personas (domains:[banking, insurance])
  // appear in BOTH banking and insurance filters.
  return ids.filter((id) => {
    const info = manifest.personas[id];
    if (!info) return false;
    const ds = Array.isArray(info.domains) ? info.domains : [info.domain ?? 'banking'];
    return ds.includes(opts.domain);
  });
}
export function getPersonaInfo(personaId) {
  return manifest.personas[personaId] ?? null;
}
export function listEndpoints(personaId, lfi = 'median') {
  const info = manifest.personas[personaId];
  if (!info) throw new Error(`unknown persona: ${personaId}`);
  const fixtureKey = `${personaId}|${lfi}|${info.default_seed}`;
  const fx = manifest.fixtures[fixtureKey];
  if (!fx) throw new Error(`unknown fixture key: ${fixtureKey}`);
  return Object.keys(fx.endpoints);
}
// Pagination — Open Finance v2.1 Links/Meta envelope. `loadFixturePage`
// is the package-level entry point for TPPs that want to simulate paging
// through a listing endpoint (transactions, standing orders, etc.) the
// way they would against a real LFI. Internally it loads the full fixture
// envelope and slices its Data array — the same engine the Service Worker
// uses for the staged `/fixtures/v1/bundles/.../*.json?offset=&limit=` URL.
//
// `requestUrl` is optional; supply it to make Links.{Self,First,Next,Last}
// point at the URL the consumer would hit. When omitted, the helper synth-
// esises a sandbox:// URL so the Links structure stays well-formed.
export function loadFixturePage(opts) {
  const { offset = 0, limit = 25, requestUrl, ...loadOpts } = opts || {};
  const envelope = loadFixture(loadOpts);
  return paginateEnvelope(envelope, {
    offset,
    limit,
    requested: true,
    requestUrl: requestUrl ?? sandboxUrl(loadOpts),
  });
}

function sandboxUrl({ persona, lfi = 'median', seed, endpoint }) {
  const info = manifest.personas[persona];
  const useSeed = seed ?? info?.default_seed ?? 0;
  const safe = String(endpoint || '').replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '');
  return `sandbox:/fixtures/v1/bundles/${persona}/${lfi}/seed-${useSeed}/${safe}.json`;
}

export function loadFixture({ persona, lfi = 'median', seed, endpoint, lfi_role }) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(`unknown persona: ${persona}`);
  const useSeed = seed ?? info.default_seed;
  if (lfi_role && lfi_role !== 'primary') {
    const rkey = `${persona}|${lfi_role}|${lfi}|${useSeed}`;
    const rfx = (manifest.roleFixtures ?? {})[rkey];
    if (!rfx) throw new Error(`no role-bundle fixture for ${rkey}`);
    const rel = rfx.endpoints[endpoint];
    if (!rel) throw new Error(`no fixture for endpoint ${endpoint} in ${rkey}`);
    return JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
  }
  const key = `${persona}|${lfi}|${useSeed}`;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error(`no fixture for ${key}`);
  const rel = fx.endpoints[endpoint];
  if (!rel) throw new Error(`no fixture for endpoint ${endpoint} in ${key}`);
  return JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
}
export function listRoleBundles(personaId) {
  // Derive the emitted role-slot keys from the role-fixture manifest rather
  // than a hard-coded list, so Phase 2.2 N-slot personas (arbitrary slot keys
  // like 'salary' / 'mortgage-lender') are discoverable, not just the legacy
  // secondary/tertiary triad. Keys are `${persona}|${slot}|${lfi}|${seed}`.
  const out = [];
  const rf = manifest.roleFixtures ?? {};
  if (!manifest.personas[personaId]) return out;
  const prefix = `${personaId}|`;
  for (const key of Object.keys(rf)) {
    if (!key.startsWith(prefix)) continue;
    const slot = key.slice(prefix.length).split('|')[0];
    if (!out.includes(slot)) out.push(slot);
  }
  return out;
}
export function loadJourney({ persona, lfi = 'median', seed, lfi_role } = {}) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(`unknown persona: ${persona}`);
  const useSeed = seed ?? info.default_seed;
  if (lfi_role && lfi_role !== 'primary') {
    const rkey = `${persona}|${lfi_role}|${lfi}|${useSeed}`;
    const rfx = (manifest.roleFixtures ?? {})[rkey];
    if (!rfx) throw new Error(`no role-bundle journey for ${rkey}`);
    const endpoints = {};
    for (const [endpoint, rel] of Object.entries(rfx.endpoints)) {
      endpoints[endpoint] = JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
    }
    return {
      persona, lfi, lfi_role,
      seed: useSeed,
      domain: info.domain ?? 'banking',
      accountIds: rfx.accountIds ?? [],
      policyIds: [],
      quoteId: null,
      customerId: endpoints['/parties']?.Data?.Party?.PartyId ?? null,
      specVersion: manifest.specVersion,
      specSha: manifest.specSha,
      version: manifest.version,
      endpoints,
    };
  }
  const key = `${persona}|${lfi}|${useSeed}`;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error(`no fixture for ${key}`);
  const endpoints = {};
  for (const [endpoint, rel] of Object.entries(fx.endpoints)) {
    endpoints[endpoint] = JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
  }
  return {
    persona,
    lfi,
    lfi_role: 'primary',
    seed: useSeed,
    domain: info.domain ?? 'banking',
    accountIds: fx.accountIds ?? [],
    policyIds: fx.policyIds ?? [],
    quoteId: fx.quoteId ?? null,
    customerId: endpoints['/parties']?.Data?.Party?.PartyId ?? null,
    specVersion: manifest.specVersion,
    specSha: manifest.specSha,
    version: manifest.version,
    endpoints,
  };
}
export function loadSpec(opts = {}) {
  const domain = opts.domain ?? 'banking';
  const file = SPEC_FILE_BY_DOMAIN[domain];
  if (!file) throw new Error(`unknown domain: ${domain}`);
  return JSON.parse(readFileSync(path.join(here, file), 'utf8'));
}
export function loadPersonaManifest(personaId) {
  return JSON.parse(readFileSync(path.join(here, 'personas', `${personaId}.json`), 'utf8'));
}

// Phase R1.5 — per-(persona, seed) enrichment sidecar. The bundle itself
// stays as the v2.1 envelope a real UAE core would serve over Open
// Finance (the "raw" view); the enrichment sidecar is what a TPP's
// enrichment engine produces after cleaning. Same shape pattern as a
// production logo / categorisation provider (Brandfetch, Tink, Plaid,
// SaltEdge): join by TransactionId.
//
// LFI-independent — computed before applyLfiProfile() so the sidecar
// stays complete even under Sparse (which redacts MerchantDetails out
// of the bundle's wire payload).
// Phase R4 — brand registry. Slug-keyed map of merchant → logo URL,
// primary colour, website, parent-group, display variants. The
// enrichment sidecar's logoSlug field is the join key. Same shape
// pattern as a production logo provider (Brandfetch / Clearbit). The
// registry file is generated by tools/build-brand-registry.mjs from
// the merchant pools — see lint-brand-registry-coverage for the
// 1:1 invariant. Throws if the registry hasn't been built (run
// 'npm run build:fixtures' to regenerate).
let _brandRegistryCache = null;
export function loadBrandRegistry() {
  if (_brandRegistryCache) return _brandRegistryCache;
  const fp = path.join(here, 'brand-registry.json');
  _brandRegistryCache = JSON.parse(readFileSync(fp, 'utf8'));
  return _brandRegistryCache;
}

export function loadEnrichment({ persona, seed } = {}) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(`unknown persona: ${persona}`);
  const useSeed = seed ?? info.default_seed;
  // Seed-keyed map (set since R3 fix); legacy single-string
  // 'enrichmentFile' kept as a fallback for the transitional window
  // where a previously-built manifest is still around.
  const rel = info.enrichmentFiles?.[String(useSeed)] ?? info.enrichmentFile;
  if (!rel) throw new Error(`no enrichment sidecar published for ${persona} seed=${useSeed}`);
  const data = JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
  if (data.seed !== useSeed) {
    throw new Error(`enrichment sidecar seed mismatch: file has ${data.seed}, requested ${useSeed}`);
  }
  return data;
}

// Workstream C plug-point 2 — runtime generator for custom personas. TPPs
// installing this package can compose a recipe and run buildBundle inside
// their own app, getting the same v2.1-shaped envelopes as the static
// fixtures. Cross-origin friendly (no network call).
let _poolsCache = null;
export function getPools() {
  if (_poolsCache) return _poolsCache;
  _poolsCache = JSON.parse(readFileSync(path.join(here, 'pools.json'), 'utf8'));
  return _poolsCache;
}
export { buildBundle } from './lib/generator/index.js';
export { expandRecipe } from './lib/persona-builder/expand.js';
export {
  RECIPE_DEFAULTS,
  encodeRecipe,
  decodeRecipe,
  recipeHash,
  validateRecipe,
} from './lib/persona-builder/recipe.js';
// envelopesFromBundle wraps an in-memory generator bundle into v2.1-shaped
// JSON envelopes (Data / Links / Meta + watermark fields) keyed by endpoint.
// Counterpart to buildBundle for any consumer that doesn't read the static
// fixture files — e.g. the MCP build_persona path.
export { envelopesFromBundle } from './lib/ui/export.js';

// Pagination helpers — pure functions that operate on already-loaded
// envelopes. Useful for TPPs that prefer to load the full envelope once
// and slice client-side (e.g. when prototyping a paging UI).
export { paginateEnvelope };
export {
  parsePaginationParams,
  isPaginatableEnvelope,
  findListKey,
  PAGINATION_DEFAULTS,
} from './lib/shared/pagination.js';

export { manifest };
