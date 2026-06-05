#!/usr/bin/env node
// Build-time data emitter — turns the YAML personas + identity pools into a
// single JSON file the browser fetches at runtime. Avoids needing a YAML
// parser in the browser bundle.

import fs from 'node:fs';
import path from 'node:path';
import { loadAllPersonas, loadAllPools, repoRoot } from './load-fixtures.mjs';

const OUT = `${repoRoot}/dist/data.json`;
const I18N_OUT = `${repoRoot}/dist/data.i18n.json`;

// All domains. The UI filters by state.domain at runtime (slice 8 onward).
// Each persona record carries its own `domain` field (banking | insurance).
const personas = loadAllPersonas();
const pools = loadAllPools();

// D-10 — split opt-in locale content (Arabic display names + narratives) out
// of data.json. data.json is preloaded on the critical path (index.html) and
// drives first paint, so the default English experience must not carry the
// Arabic payload. The overlay below is fetched + merged on demand only when the
// UI resolves to a non-default locale (src/app.js → ensureLocaleData). The
// fields stay in the YAML manifests (and thus the fixture packages) untouched —
// this only reshapes the browser data file.
const LOCALE_FIELDS = ['name_ar', 'narrative_ar'];
const localeData = { ar: {} };
for (const [personaId, persona] of Object.entries(personas)) {
  const fields = {};
  for (const key of LOCALE_FIELDS) {
    if (persona[key] != null) {
      fields[key] = persona[key];
      delete persona[key];
    }
  }
  if (Object.keys(fields).length) localeData.ar[personaId] = fields;
}

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
fs.writeFileSync(I18N_OUT, JSON.stringify(localeData));
const poolCount =
  Object.keys(pools.namesByPoolId).length +
  Object.keys(pools.employersByPoolId).length +
  Object.keys(pools.merchantsByCategory).length +
  Object.keys(pools.counterpartyBanksByCategory).length +
  Object.keys(pools.ibansByCategory).length +
  Object.keys(pools.organisationsByPoolId ?? {}).length +
  Object.keys(pools.counterpartiesByPoolId ?? {}).length;
const localeCount = Object.keys(localeData.ar).length;
console.log(
  `built ${Object.keys(personas).length} personas, ${poolCount} pools → ${path.relative(repoRoot, OUT)} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB)`,
);
console.log(
  `split ${localeCount} personas' ar content → ${path.relative(repoRoot, I18N_OUT)} (${(JSON.stringify(localeData).length / 1024).toFixed(1)} KB, lazy-loaded)`,
);
