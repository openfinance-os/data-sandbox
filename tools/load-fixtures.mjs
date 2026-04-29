// Test-side helper: loads persona manifests and identity pools from disk.
// Used by Vitest tests; the browser uses fetched JSON instead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { POOL_FILE_LIST, indexPoolsByPoolId } from '../src/shared/pools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, '..');

export function loadYaml(relPath) {
  const abs = path.join(repoRoot, relPath);
  return yaml.load(fs.readFileSync(abs, 'utf8'));
}

export function loadPersona(personaId) {
  const slug = personaId.replace(/_/g, '-');
  return loadYaml(`personas/${slug}.yaml`);
}

export function loadAllPools() {
  const pools = {};
  for (const [key, rel] of POOL_FILE_LIST) {
    pools[key] = loadYaml(`synthetic-identity-pool/${rel}`);
  }
  return indexPoolsByPoolId(pools);
}

export function loadSpec() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/SPEC.json'), 'utf8'));
}
