'use strict';
const fs = require('node:fs');
const path = require('node:path');
const here = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const SPEC_FILE_BY_DOMAIN = { banking: 'spec.json', insurance: 'spec.insurance.json' };
function listPersonas(opts) {
  const ids = Object.keys(manifest.personas);
  if (!opts || !opts.domain) return ids;
  return ids.filter(function (id) { return manifest.personas[id] && manifest.personas[id].domain === opts.domain; });
}
function getPersonaInfo(personaId) { return manifest.personas[personaId] || null; }
function listEndpoints(personaId, lfi) {
  lfi = lfi || 'median';
  const info = manifest.personas[personaId];
  if (!info) throw new Error('unknown persona: ' + personaId);
  const fx = manifest.fixtures[personaId + '|' + lfi + '|' + info.default_seed];
  if (!fx) throw new Error('unknown fixture key');
  return Object.keys(fx.endpoints);
}
function loadFixture(opts) {
  const persona = opts.persona;
  const lfi = opts.lfi || 'median';
  const info = manifest.personas[persona];
  if (!info) throw new Error('unknown persona: ' + persona);
  const useSeed = opts.seed != null ? opts.seed : info.default_seed;
  const key = persona + '|' + lfi + '|' + useSeed;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error('no fixture for ' + key);
  const rel = fx.endpoints[opts.endpoint];
  if (!rel) throw new Error('no fixture for endpoint ' + opts.endpoint + ' in ' + key);
  return JSON.parse(fs.readFileSync(path.join(here, rel), 'utf8'));
}
function loadJourney(opts) {
  opts = opts || {};
  const persona = opts.persona;
  const lfi = opts.lfi || 'median';
  const info = manifest.personas[persona];
  if (!info) throw new Error('unknown persona: ' + persona);
  const useSeed = opts.seed != null ? opts.seed : info.default_seed;
  const key = persona + '|' + lfi + '|' + useSeed;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error('no fixture for ' + key);
  const endpoints = {};
  const epEntries = Object.entries(fx.endpoints);
  for (let i = 0; i < epEntries.length; i++) {
    const ep = epEntries[i][0];
    const rel = epEntries[i][1];
    endpoints[ep] = JSON.parse(fs.readFileSync(path.join(here, rel), 'utf8'));
  }
  const parties = endpoints['/parties'];
  return {
    persona: persona,
    lfi: lfi,
    seed: useSeed,
    domain: info.domain || 'banking',
    accountIds: fx.accountIds || [],
    policyIds: fx.policyIds || [],
    quoteId: fx.quoteId || null,
    customerId: (parties && parties.Data && parties.Data.Party && parties.Data.Party.PartyId) || null,
    specVersion: manifest.specVersion,
    specSha: manifest.specSha,
    version: manifest.version,
    endpoints: endpoints,
  };
}
function loadSpec(opts) {
  const domain = (opts && opts.domain) || 'banking';
  const file = SPEC_FILE_BY_DOMAIN[domain];
  if (!file) throw new Error('unknown domain: ' + domain);
  return JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
}
function loadPersonaManifest(personaId) {
  return JSON.parse(fs.readFileSync(path.join(here, 'personas', personaId + '.json'), 'utf8'));
}
let _poolsCache = null;
function getPools() {
  if (_poolsCache) return _poolsCache;
  _poolsCache = JSON.parse(fs.readFileSync(path.join(here, 'pools.json'), 'utf8'));
  return _poolsCache;
}
// CJS re-export of the runtime engine. Uses dynamic import so the CJS
// loader can pull in the ESM lib modules without requiring callers to
// install a transpiler.
async function getEngine() {
  const gen = await import('./lib/generator/index.js');
  const exp = await import('./lib/persona-builder/expand.js');
  const rec = await import('./lib/persona-builder/recipe.js');
  const ui = await import('./lib/ui/export.js');
  return { buildBundle: gen.buildBundle, expandRecipe: exp.expandRecipe,
    RECIPE_DEFAULTS: rec.RECIPE_DEFAULTS, encodeRecipe: rec.encodeRecipe,
    decodeRecipe: rec.decodeRecipe, recipeHash: rec.recipeHash, validateRecipe: rec.validateRecipe,
    envelopesFromBundle: ui.envelopesFromBundle };
}
module.exports = {
  manifest, listPersonas, getPersonaInfo, listEndpoints, loadFixture,
  loadJourney, loadSpec, loadPersonaManifest, getPools, getEngine,
};
