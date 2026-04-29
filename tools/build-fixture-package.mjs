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
import { loadAllPersonas, loadAllPools } from './load-fixtures.mjs';

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

const personas = loadAllPersonas();
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
    './bundles/*': './bundles/*',
    './personas/*': './personas/*',
  },
  files: ['index.mjs', 'index.cjs', 'manifest.json', 'spec.json', 'bundles/', 'personas/', 'README.md'],
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
module.exports = { manifest, listPersonas, getPersonaInfo, listEndpoints, loadFixture, loadJourney, loadSpec, loadPersonaManifest };
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
