#!/usr/bin/env node
// Build-time data emitter — turns the YAML personas + identity pools into a
// single JSON file the browser fetches at runtime. Avoids needing a YAML
// parser in the browser bundle (keeping the "no build chain" frontend
// honest under the EXP-24 page-weight budget).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { POOL_FILE_LIST } from '../src/shared/pools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const OUT = path.join(repoRoot, 'dist/data.json');

function loadYaml(rel) {
  return yaml.load(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

function listPersonaFiles() {
  return fs
    .readdirSync(path.join(repoRoot, 'personas'))
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'));
}

const personas = {};
for (const f of listPersonaFiles()) {
  const m = loadYaml(`personas/${f}`);
  personas[m.persona_id] = m;
}

const pools = {};
for (const [key, rel] of POOL_FILE_LIST) {
  pools[key] = loadYaml(`synthetic-identity-pool/${rel}`);
}

// Build the namesByPoolId index just like indexPoolsByPoolId() does in Node.
const namesByPoolId = {};
for (const [k, v] of Object.entries(pools)) {
  if (k.startsWith('names') && v && v.pool_id) namesByPoolId[v.pool_id] = v;
}

const buildInfo = {
  // EXP-05 anchor — used by the browser as the deterministic `now` so that
  // visitors hitting the same URL see the same bundle regardless of when.
  // We pin to first-of-month of the SPEC retrieval to match DEFAULT_NOW in
  // src/generator/index.js (Phase 0 keeps these aligned by reading the same
  // value off SPEC_PIN.retrieved when present).
  nowIso: deriveNow(),
};

function deriveNow() {
  const retrievedFile = path.join(repoRoot, 'spec/SPEC_PIN.retrieved');
  if (!fs.existsSync(retrievedFile)) return new Date(Date.UTC(2026, 3, 1)).toISOString();
  const ts = fs.readFileSync(retrievedFile, 'utf8').trim();
  const d = new Date(ts);
  // First of the same UTC month.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

const out = {
  personas,
  pools: { ...pools, namesByPoolId },
  buildInfo,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(
  `built ${Object.keys(personas).length} personas, ${Object.keys(pools).length} pools → ${path.relative(repoRoot, OUT)} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB)`
);
