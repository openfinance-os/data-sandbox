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
  const role = opts.lfi_role;
  if (role && role !== 'primary') {
    const rkey = persona + '|' + role + '|' + lfi + '|' + useSeed;
    const rfx = (manifest.roleFixtures || {})[rkey];
    if (!rfx) throw new Error('no role-bundle fixture for ' + rkey);
    const rel = rfx.endpoints[opts.endpoint];
    if (!rel) throw new Error('no fixture for endpoint ' + opts.endpoint + ' in ' + rkey);
    return JSON.parse(fs.readFileSync(path.join(here, rel), 'utf8'));
  }
  const key = persona + '|' + lfi + '|' + useSeed;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error('no fixture for ' + key);
  const rel = fx.endpoints[opts.endpoint];
  if (!rel) throw new Error('no fixture for endpoint ' + opts.endpoint + ' in ' + key);
  return JSON.parse(fs.readFileSync(path.join(here, rel), 'utf8'));
}
function listRoleBundles(personaId) {
  const out = [];
  const rf = manifest.roleFixtures || {};
  const info = manifest.personas[personaId];
  if (!info) return out;
  const slots = ['secondary', 'tertiary'];
  const lfis = ['rich', 'median', 'sparse'];
  for (let i = 0; i < slots.length; i++) {
    for (let j = 0; j < lfis.length; j++) {
      if (rf[personaId + '|' + slots[i] + '|' + lfis[j] + '|' + info.default_seed]) {
        if (out.indexOf(slots[i]) < 0) out.push(slots[i]);
      }
    }
  }
  return out;
}
function loadJourney(opts) {
  opts = opts || {};
  const persona = opts.persona;
  const lfi = opts.lfi || 'median';
  const info = manifest.personas[persona];
  if (!info) throw new Error('unknown persona: ' + persona);
  const useSeed = opts.seed != null ? opts.seed : info.default_seed;
  const role = opts.lfi_role;
  if (role && role !== 'primary') {
    const rkey = persona + '|' + role + '|' + lfi + '|' + useSeed;
    const rfx = (manifest.roleFixtures || {})[rkey];
    if (!rfx) throw new Error('no role-bundle journey for ' + rkey);
    const endpoints = {};
    const epEntries = Object.entries(rfx.endpoints);
    for (let i = 0; i < epEntries.length; i++) {
      const ep = epEntries[i][0];
      const rel = epEntries[i][1];
      endpoints[ep] = JSON.parse(fs.readFileSync(path.join(here, rel), 'utf8'));
    }
    const parties = endpoints['/parties'];
    return {
      persona: persona,
      lfi: lfi,
      lfi_role: role,
      seed: useSeed,
      domain: info.domain || 'banking',
      accountIds: rfx.accountIds || [],
      policyIds: [],
      quoteId: null,
      customerId: (parties && parties.Data && parties.Data.Party && parties.Data.Party.PartyId) || null,
      specVersion: manifest.specVersion,
      specSha: manifest.specSha,
      version: manifest.version,
      endpoints: endpoints,
    };
  }
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
    lfi_role: 'primary',
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
// Phase R1.5 — per-(persona, seed) enrichment sidecar. See index.mjs
// for the longer comment; LFI-independent payload keyed by TransactionId.
function loadEnrichment(opts) {
  opts = opts || {};
  const persona = opts.persona;
  const info = manifest.personas[persona];
  if (!info) throw new Error('unknown persona: ' + persona);
  const useSeed = opts.seed != null ? opts.seed : info.default_seed;
  const rel = info.enrichmentFile;
  if (!rel) throw new Error('no enrichment sidecar published for ' + persona);
  const data = JSON.parse(fs.readFileSync(path.join(here, rel), 'utf8'));
  if (data.seed !== useSeed) {
    throw new Error('enrichment sidecar seed mismatch: file has ' + data.seed + ', requested ' + useSeed);
  }
  return data;
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
  listRoleBundles,
  loadJourney, loadSpec, loadPersonaManifest, loadEnrichment, getPools, getEngine,
};
