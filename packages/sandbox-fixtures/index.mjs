// @openfinance-os/sandbox-fixtures — ESM loader.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));

export function listPersonas() {
  return Object.keys(manifest.personas);
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
export function loadFixture({ persona, lfi = 'median', seed, endpoint }) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(`unknown persona: ${persona}`);
  const useSeed = seed ?? info.default_seed;
  const key = `${persona}|${lfi}|${useSeed}`;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error(`no fixture for ${key}`);
  const rel = fx.endpoints[endpoint];
  if (!rel) throw new Error(`no fixture for endpoint ${endpoint} in ${key}`);
  return JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
}
export function loadJourney({ persona, lfi = 'median', seed } = {}) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(`unknown persona: ${persona}`);
  const useSeed = seed ?? info.default_seed;
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
    seed: useSeed,
    accountIds: fx.accountIds ?? [],
    customerId: endpoints['/parties']?.Data?.Party?.PartyId ?? null,
    specVersion: manifest.specVersion,
    specSha: manifest.specSha,
    version: manifest.version,
    endpoints,
  };
}
export function loadSpec() {
  return JSON.parse(readFileSync(path.join(here, 'spec.json'), 'utf8'));
}
export function loadPersonaManifest(personaId) {
  return JSON.parse(readFileSync(path.join(here, 'personas', `${personaId}.json`), 'utf8'));
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

export { manifest };
