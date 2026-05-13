// @openfinance-os/sandbox-fixtures — ESM loader.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));

const SPEC_FILE_BY_DOMAIN = {
  banking: 'spec.json',
  insurance: 'spec.insurance.json',
};

export function listPersonas(opts = {}) {
  const ids = Object.keys(manifest.personas);
  if (!opts.domain) return ids;
  return ids.filter((id) => manifest.personas[id]?.domain === opts.domain);
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
  const out = [];
  const rf = manifest.roleFixtures ?? {};
  const info = manifest.personas[personaId];
  if (!info) return out;
  for (const slot of ['secondary', 'tertiary']) {
    for (const lfi of ['rich', 'median', 'sparse']) {
      if (rf[`${personaId}|${slot}|${lfi}|${info.default_seed}`]) {
        if (!out.includes(slot)) out.push(slot);
      }
    }
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
export function loadEnrichment({ persona, seed } = {}) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(`unknown persona: ${persona}`);
  const useSeed = seed ?? info.default_seed;
  const rel = info.enrichmentFile;
  if (!rel) throw new Error(`no enrichment sidecar published for ${persona}`);
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

export { manifest };
