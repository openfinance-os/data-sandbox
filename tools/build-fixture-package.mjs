#!/usr/bin/env node
// EXP-20 — build the @openfinance-os/sandbox-fixtures distribution package.
// Emits per-(persona, lfi, endpoint) v2.1-shaped JSON envelopes + manifest +
// the parsed SPEC + persona manifests + a tiny ESM/CJS loader, into
// packages/sandbox-fixtures/. Runs after `npm run build:spec`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../src/generator/index.js';
import { envelopesFromBundle } from '../src/ui/export.js';
import { loadPersonasByDomain, loadAllPools } from './load-fixtures.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PKG_VERSION = readSandboxVersion() || '0.0.0';
const OUT = path.join(repoRoot, 'packages/sandbox-fixtures');
const NOW_ANCHOR = readNowAnchor();
const SHA = readSha();

function readSandboxVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return pkg.version;
  } catch { return null; }
}

function readNowAnchor() {
  const f = path.join(repoRoot, 'spec/SPEC_PIN.retrieved');
  if (!fs.existsSync(f)) return new Date(Date.UTC(2026, 3, 1)).toISOString();
  const ts = fs.readFileSync(f, 'utf8').trim();
  const d = new Date(ts);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function readSha() {
  const f = path.join(repoRoot, 'spec/SPEC_PIN.sha');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : 'unknown';
}

function safeName(s) {
  return s.replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '');
}

if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'bundles'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'personas'), { recursive: true });

// Banking only — insurance fixtures land with the insurance generator
// (slice 6b-ii); they get their own bundles/<domain>/<persona>/... layout.
const personas = loadPersonasByDomain('banking');
const pools = loadAllPools();
const now = new Date(NOW_ANCHOR);

const manifest = {
  package: '@openfinance-os/sandbox-fixtures',
  version: PKG_VERSION,
  specVersion: 'v2.1',
  specSha: SHA,
  generatedAt: new Date().toISOString(),
  nowAnchor: NOW_ANCHOR,
  fixtures: {},
  personas: {},
};

let fileCount = 0;
let totalBytes = 0;

for (const [personaId, persona] of Object.entries(personas)) {
  const seed = persona.default_seed ?? 1;
  manifest.personas[personaId] = {
    name: persona.name,
    archetype: persona.archetype,
    default_seed: seed,
    stress_coverage: persona.stress_coverage ?? [],
  };
  fs.writeFileSync(
    path.join(OUT, 'personas', `${personaId}.json`),
    JSON.stringify(persona, null, 2)
  );

  for (const lfi of ['rich', 'median', 'sparse']) {
    const ctx = {
      personaId, lfi, seed,
      specVersion: 'v2.1', specSha: SHA,
      retrievedAt: NOW_ANCHOR,
    };
    const bundle = buildBundle({ persona, lfi, seed, pools, now });
    const envelopes = envelopesFromBundle(bundle, ctx);
    const dir = path.join(OUT, 'bundles', personaId, lfi, `seed-${seed}`);
    fs.mkdirSync(dir, { recursive: true });

    const endpointFiles = {};
    for (const [endpoint, env] of Object.entries(envelopes)) {
      const fname = `${safeName(endpoint)}.json`;
      const fp = path.join(dir, fname);
      const text = JSON.stringify(env, null, 2);
      fs.writeFileSync(fp, text);
      endpointFiles[endpoint] = path.relative(OUT, fp).split(path.sep).join('/');
      fileCount += 1;
      totalBytes += text.length;
    }

    // Add templated-path aliases pointing at the *first* account's resolved
    // fixture, so callers using the v2.1 spec path (e.g.
    // '/accounts/{AccountId}/transactions') get a sensible default without
    // having to know the synthetic AccountId. Bundle-level endpoints
    // (/accounts, /parties) keep their plain key. Templated entries also
    // record the resolved account ids so callers who DO know the id can
    // pass it explicitly.
    const aliasEndpoints = { ...endpointFiles };
    const firstAccountId = bundle.accounts[0]?.AccountId;
    if (firstAccountId) {
      for (const [endpoint, rel] of Object.entries(endpointFiles)) {
        const alias = endpoint.replace(`/accounts/${firstAccountId}`, '/accounts/{AccountId}');
        if (alias !== endpoint && !aliasEndpoints[alias]) {
          aliasEndpoints[alias] = rel;
        }
      }
    }
    manifest.fixtures[`${personaId}|${lfi}|${seed}`] = {
      personaId, lfi, seed,
      accountIds: bundle.accounts.map((a) => a.AccountId),
      endpoints: aliasEndpoints,
    };
  }
}

// Write SPEC.json into the package so consumers can introspect status badges
// without a second download.
fs.copyFileSync(path.join(repoRoot, 'dist/SPEC.json'), path.join(OUT, 'spec.json'));

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Workstream C plug-point 2 — vendor the runtime engine (generator + persona-
// builder + prng + pool indexer) into the package so TPPs can run a custom
// persona inside their own app without any network call. We copy the source
// modules verbatim and serialise the indexed pools to a JSON the loader
// hydrates lazily.
const LIB_DIR = path.join(OUT, 'lib');
fs.mkdirSync(LIB_DIR, { recursive: true });
function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const sFull = path.join(src, ent.name);
    const dFull = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDirRecursive(sFull, dFull);
    else if (ent.isFile() && /\.(mjs|js)$/.test(ent.name)) fs.copyFileSync(sFull, dFull);
  }
}
copyDirRecursive(path.join(repoRoot, 'src/generator'), path.join(LIB_DIR, 'generator'));
copyDirRecursive(path.join(repoRoot, 'src/persona-builder'), path.join(LIB_DIR, 'persona-builder'));
copyDirRecursive(path.join(repoRoot, 'src/shared'), path.join(LIB_DIR, 'shared'));
fs.copyFileSync(path.join(repoRoot, 'src/prng.js'), path.join(LIB_DIR, 'prng.js'));

// Serialise the indexed pools so consumers can call getPools() without
// re-walking the YAML tree. Stable order preserved by the indexer.
fs.writeFileSync(path.join(OUT, 'pools.json'), JSON.stringify(pools));

// package.json — declares the npm package.
const pkgJson = {
  name: '@openfinance-os/sandbox-fixtures',
  version: PKG_VERSION,
  description: 'Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the Open Finance Data Sandbox. 10 personas × 3 LFI profiles × 12 endpoints = 360 envelopes. CC0 data, MIT loader code.',
  keywords: ['open-finance', 'uae', 'synthetic-data', 'fixtures', 'v2.1', 'tpp', 'commons'],
  homepage: 'https://github.com/openfinance-os/data-sandbox',
  repository: { type: 'git', url: 'https://github.com/openfinance-os/data-sandbox.git', directory: 'packages/sandbox-fixtures' },
  license: 'MIT',
  type: 'module',
  main: './index.cjs',
  module: './index.mjs',
  exports: {
    '.': { import: './index.mjs', require: './index.cjs', default: './index.mjs' },
    './manifest.json': './manifest.json',
    './spec.json': './spec.json',
    './pools.json': './pools.json',
    './bundles/*': './bundles/*',
    './personas/*': './personas/*',
    './lib/*': './lib/*',
  },
  files: ['index.mjs', 'index.cjs', 'index.d.ts', 'manifest.json', 'spec.json', 'pools.json', 'bundles/', 'personas/', 'lib/', 'README.md'],
  publishConfig: { access: 'public' },
};
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkgJson, null, 2));

// Loader — ESM
const indexMjs = `// @openfinance-os/sandbox-fixtures — ESM loader.
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
  if (!info) throw new Error(\`unknown persona: \${personaId}\`);
  const fixtureKey = \`\${personaId}|\${lfi}|\${info.default_seed}\`;
  const fx = manifest.fixtures[fixtureKey];
  if (!fx) throw new Error(\`unknown fixture key: \${fixtureKey}\`);
  return Object.keys(fx.endpoints);
}
export function loadFixture({ persona, lfi = 'median', seed, endpoint }) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(\`unknown persona: \${persona}\`);
  const useSeed = seed ?? info.default_seed;
  const key = \`\${persona}|\${lfi}|\${useSeed}\`;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error(\`no fixture for \${key}\`);
  const rel = fx.endpoints[endpoint];
  if (!rel) throw new Error(\`no fixture for endpoint \${endpoint} in \${key}\`);
  return JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
}
export function loadJourney({ persona, lfi = 'median', seed } = {}) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(\`unknown persona: \${persona}\`);
  const useSeed = seed ?? info.default_seed;
  const key = \`\${persona}|\${lfi}|\${useSeed}\`;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error(\`no fixture for \${key}\`);
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
  return JSON.parse(readFileSync(path.join(here, 'personas', \`\${personaId}.json\`), 'utf8'));
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
`;
fs.writeFileSync(path.join(OUT, 'index.mjs'), indexMjs);

// Loader — CommonJS wrapper.
const indexCjs = `'use strict';
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
  return { buildBundle: gen.buildBundle, expandRecipe: exp.expandRecipe,
    RECIPE_DEFAULTS: rec.RECIPE_DEFAULTS, encodeRecipe: rec.encodeRecipe,
    decodeRecipe: rec.decodeRecipe, recipeHash: rec.recipeHash, validateRecipe: rec.validateRecipe };
}
module.exports = {
  manifest, listPersonas, getPersonaInfo, listEndpoints, loadFixture,
  loadJourney, loadSpec, loadPersonaManifest, getPools, getEngine,
};
`;
fs.writeFileSync(path.join(OUT, 'index.cjs'), indexCjs);

// Tiny TS types for editor support.
const indexDts = `export interface PersonaInfo {
  name: string;
  archetype: string;
  default_seed: number;
  stress_coverage: string[];
}
export interface Manifest {
  package: string;
  version: string;
  specVersion: string;
  specSha: string;
  generatedAt: string;
  nowAnchor: string;
  fixtures: Record<string, { personaId: string; lfi: string; seed: number; accountIds: string[]; endpoints: Record<string, string> }>;
  personas: Record<string, PersonaInfo>;
}
export interface Journey {
  persona: string;
  lfi: 'rich' | 'median' | 'sparse';
  seed: number;
  accountIds: string[];
  customerId: string | null;
  specVersion: string;
  specSha: string;
  version: string;
  endpoints: Record<string, unknown>;
}
export const manifest: Manifest;
export function listPersonas(): string[];
export function getPersonaInfo(personaId: string): PersonaInfo | null;
export function listEndpoints(personaId: string, lfi?: 'rich' | 'median' | 'sparse'): string[];
export function loadFixture(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
  endpoint: string;
}): unknown;
export function loadJourney(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
}): Journey;
export function loadSpec(): unknown;
export function loadPersonaManifest(personaId: string): unknown;

// Workstream C plug-point 2 — runtime engine for custom personas.
export interface IndexedPools {
  namesByPoolId: Record<string, unknown>;
  employersByPoolId: Record<string, unknown>;
  merchantsByCategory: Record<string, unknown>;
  counterpartyBanksByCategory: Record<string, unknown>;
  ibansByCategory: Record<string, unknown>;
  organisationsByPoolId: Record<string, unknown>;
  counterpartiesByPoolId: Record<string, unknown>;
}
export interface CustomRecipe {
  segment?: 'Retail' | 'SME' | 'Corporate';
  name_pool?: string;
  age_band?: string;
  emirate?: string;
  income_band?: string;
  flag_payroll?: boolean;
  employer_pool?: string;
  products?: string[];
  card_limit?: 'low' | 'mid' | 'high';
  spend_intensity?: 'low' | 'med' | 'high';
  fx_activity?: boolean;
  cash_deposit?: boolean;
  distress?: 'none' | 'occasional' | 'frequent';
  legal_name_pool?: string;
  signatory_pool?: string;
  signatory_account_role?: string;
  signatory_party_type?: 'Sole' | 'Joint' | 'Delegate';
  cash_flow_intensity?: 'low' | 'med' | 'high';
  customer_inflow_pool?: string;
  supplier_outflow_pool?: string;
  invoice_cadence?: 'weekly' | 'biweekly' | 'monthly' | 'irregular';
  stress_tags?: string[];
}
export const RECIPE_DEFAULTS: Required<CustomRecipe>;
export function encodeRecipe(recipe: CustomRecipe): string;
export function decodeRecipe(encoded: string): CustomRecipe;
export function recipeHash(recipe: CustomRecipe): string;
export function validateRecipe(recipe: CustomRecipe, pools: IndexedPools): { ok: true } | { ok: false; errors: string[] };
export function getPools(): IndexedPools;
export function expandRecipe(recipe: CustomRecipe, pools: IndexedPools): unknown;
export function buildBundle(opts: { persona: unknown; lfi: 'rich' | 'median' | 'sparse'; seed: number; pools: IndexedPools; now?: Date }): unknown;
`;
fs.writeFileSync(path.join(OUT, 'index.d.ts'), indexDts);

// README.
const readme = `# @openfinance-os/sandbox-fixtures

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the
[Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox).

10 personas × 3 LFI profiles × 12 endpoints = **360 fixtures**, plus the
parsed v2.1 OpenAPI spec and the persona manifests.

## Install

\`\`\`
npm install @openfinance-os/sandbox-fixtures
\`\`\`

## Use

\`\`\`js
import { loadFixture, loadJourney, listPersonas, listEndpoints, loadSpec } from '@openfinance-os/sandbox-fixtures';

const sara = loadFixture({
  persona: 'salaried_expat_mid',
  lfi: 'median',
  endpoint: '/accounts/{AccountId}/transactions',
});
// → v2.1-shaped envelope: { Data: { AccountId, Transaction: [...] }, Links, Meta, _watermark, ... }

const journey = loadJourney({ persona: 'salaried_expat_mid', lfi: 'median' });
// → { persona, lfi, seed, accountIds, customerId, specVersion, specSha, version,
//     endpoints: { '/accounts': envelope, '/parties': envelope,
//       '/accounts/{AccountId}/balances': envelope, ... all endpoints, all coherent } }
// AccountIds, CustomerId line up across every endpoint — drop-in replacement for
// the data your TPP demo currently fetches from the Nebras-operated regulatory
// sandbox, which ships intentionally thin mock data.

listPersonas();
// → ['salaried_expat_mid', 'salaried_emirati_affluent', ...]

listEndpoints('hnw_multicurrency');
// → ['/accounts', '/accounts/{AccountId}', '/accounts/{AccountId}/balances', ...]

loadSpec();
// → parsed SPEC object — every field's status, type, format, enum, conditional rules
\`\`\`

CommonJS works too:

\`\`\`js
const { loadFixture } = require('@openfinance-os/sandbox-fixtures');
\`\`\`

## What's in the box

- \`bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json\` — 360 fixtures (10 × 3 × 12). Each is a v2.1-correct \`{ Data, Links, Meta }\` envelope plus watermark fields (\`_persona\`, \`_lfi\`, \`_seed\`, \`_specSha\`).
- \`personas/<persona>.json\` — persona manifest (demographics, fixed commitments, stress coverage, narrative).
- \`spec.json\` — the parsed UAE Open Finance v2.1 OpenAPI spec, keyed by endpoint with field metadata.
- \`manifest.json\` — top-level index keyed by \`<persona>|<lfi>|<seed>\`.

## Determinism

Every fixture is a pure function of \`(persona_id, lfi_profile, seed, build-time now-anchor)\`. Same package version → byte-identical fixtures. Pin the package, pin your tests.

## Spec version

UAE Open Finance Standards \`v2.1\`, vendored from \`Nebras-Open-Finance/api-specs:ozone\` at the SHA recorded in \`manifest.json.specSha\`.

## Licensing

- **Loader code** (\`index.mjs\`, \`index.cjs\`, \`index.d.ts\`): MIT
- **Synthetic data** (\`bundles/*\`, \`personas/*\`): CC0 — public domain

## Reporting issues

[github.com/openfinance-os/data-sandbox/issues](https://github.com/openfinance-os/data-sandbox/issues) — every fixture's source is the live sandbox at https://openfinance-os.github.io/data-sandbox/.
`;
fs.writeFileSync(path.join(OUT, 'README.md'), readme);

console.log(
  `built fixture package → ${path.relative(repoRoot, OUT)}/`
  + `\n  ${fileCount} fixture files (${(totalBytes / 1024).toFixed(1)} KB raw)`
  + `\n  ${Object.keys(manifest.personas).length} personas · ${Object.keys(manifest.fixtures).length} (persona × lfi) keys`
  + `\n  spec ${manifest.specVersion} @ ${manifest.specSha.slice(0, 7)}`
);
