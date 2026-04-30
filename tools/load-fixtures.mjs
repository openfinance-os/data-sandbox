// Test-side helper: loads persona manifests and identity pools from disk
// dynamically (so adding a new pool file or persona doesn't require edits
// here or in src/shared/pools.js).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { indexPools } from '../src/shared/pools.js';

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

export function listPersonaFiles() {
  return fs
    .readdirSync(path.join(repoRoot, 'personas'))
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'));
}

export function loadAllPersonas() {
  const out = {};
  for (const f of listPersonaFiles()) {
    const m = loadYaml(`personas/${f}`);
    out[m.persona_id] = m;
  }
  return out;
}

// Convenience filter — most banking-pipeline test sites want to skip
// non-banking personas until the domain dispatcher lands in slice 6b-ii.
export function loadPersonasByDomain(domain) {
  const out = {};
  for (const [id, m] of Object.entries(loadAllPersonas())) {
    if (m.domain === domain) out[id] = m;
  }
  return out;
}

function* walkPoolFiles() {
  const root = path.join(repoRoot, 'synthetic-identity-pool');
  for (const sub of fs.readdirSync(root, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const subPath = path.join(root, sub.name);
    for (const f of fs.readdirSync(subPath)) {
      if (f.endsWith('.yaml')) yield path.join(sub.name, f);
    }
  }
}

export function loadAllPools() {
  const raw = [];
  for (const rel of walkPoolFiles()) {
    raw.push(loadYaml(`synthetic-identity-pool/${rel}`));
  }
  return indexPools(raw);
}

export function loadSpec() {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/SPEC.json'), 'utf8'));
}
