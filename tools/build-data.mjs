#!/usr/bin/env node
// Build-time data emitter — turns the YAML personas + identity pools into a
// single JSON file the browser fetches at runtime. Avoids needing a YAML
// parser in the browser bundle.

import fs from 'node:fs';
import path from 'node:path';
import { loadAllPersonas, loadAllPools, repoRoot } from './load-fixtures.mjs';

const OUT = `${repoRoot}/dist/data.json`;

// All domains. The UI filters by state.domain at runtime (slice 8 onward).
// Each persona record carries its own `domain` field (banking | insurance).
const personas = loadAllPersonas();
const pools = loadAllPools();

const buildInfo = { nowIso: deriveNow() };

function deriveNow() {
  const f = `${repoRoot}/spec/SPEC_PIN.retrieved`;
  if (!fs.existsSync(f)) return new Date(Date.UTC(2026, 3, 1)).toISOString();
  const ts = fs.readFileSync(f, 'utf8').trim();
  const d = new Date(ts);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

const out = { personas, pools, buildInfo };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(
  `built ${Object.keys(personas).length} personas, ${Object.keys(pools.namesByPoolId).length + Object.keys(pools.employersByPoolId).length + Object.keys(pools.merchantsByCategory).length + Object.keys(pools.counterpartyBanksByCategory).length + Object.keys(pools.ibansByCategory).length} pools → ${path.relative(repoRoot, OUT)} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB)`
);
