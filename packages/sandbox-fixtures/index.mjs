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
export function loadSpec() {
  return JSON.parse(readFileSync(path.join(here, 'spec.json'), 'utf8'));
}
export function loadPersonaManifest(personaId) {
  return JSON.parse(readFileSync(path.join(here, 'personas', `${personaId}.json`), 'utf8'));
}
export { manifest };
