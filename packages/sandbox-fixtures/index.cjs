'use strict';
const fs = require('node:fs');
const path = require('node:path');
const here = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
function listPersonas() { return Object.keys(manifest.personas); }
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
    accountIds: fx.accountIds || [],
    customerId: (parties && parties.Data && parties.Data.Party && parties.Data.Party.PartyId) || null,
    specVersion: manifest.specVersion,
    specSha: manifest.specSha,
    version: manifest.version,
    endpoints: endpoints,
  };
}
function loadSpec() { return JSON.parse(fs.readFileSync(path.join(here, 'spec.json'), 'utf8')); }
function loadPersonaManifest(personaId) {
  return JSON.parse(fs.readFileSync(path.join(here, 'personas', personaId + '.json'), 'utf8'));
}
module.exports = { manifest, listPersonas, getPersonaInfo, listEndpoints, loadFixture, loadJourney, loadSpec, loadPersonaManifest };
