#!/usr/bin/env node
// EXP-20 — build the @openfinance-os/sandbox-fixtures distribution package.
// Emits per-(persona, lfi, endpoint) v2.1-shaped JSON envelopes + manifest +
// the parsed SPEC + persona manifests + a tiny ESM/CJS loader, into
// packages/sandbox-fixtures/. Runs after `npm run build:spec`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../src/generator/index.js';
import { buildRoleBundle, normalizeFootprint } from '../src/generator/multi-lfi.js';
import { envelopesFromBundle } from '../src/ui/export.js';
import { loadPersonasByDomain, loadAllPools, repoRoot } from './load-fixtures.mjs';
import {
  readPackageVersion,
  readNowAnchor,
  readSpecSha,
  readSpecVersions,
  safeEndpointName as safeName,
} from './build-shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PKG_VERSION = readPackageVersion() || '0.0.0';
const OUT = path.join(repoRoot, 'packages/sandbox-fixtures');
const NOW_ANCHOR = readNowAnchor();
const SHA = readSpecSha();
// Banking and insurance specs are pinned independently — banking on
// `v2.1-errata2`, insurance on `v2.1-errata1`. Each envelope is stamped
// with the version that matches its domain.
const SPEC_VERSIONS = readSpecVersions();

// Fail the build BEFORE writing a malformed envelope, rather than deferring
// the only structural check to rendered-fixture-spec-validation.test.mjs
// (which the publish workflow could skip). Mirrors the v2.1-shape contract
// asserted by tests/fixture-package.test.mjs: every emitted envelope must
// carry Data, Links.Self, Meta, and a SYNTHETIC watermark.
function assertEnvelope(env, endpoint, personaId) {
  const ctx = `${personaId} ${endpoint}`;
  if (!env || typeof env !== 'object') throw new Error(`emit ${ctx}: envelope is not an object`);
  if (env.Data === undefined) throw new Error(`emit ${ctx}: missing Data`);
  if (!env.Links || env.Links.Self === undefined)
    throw new Error(`emit ${ctx}: missing Links.Self`);
  if (env.Meta === undefined) throw new Error(`emit ${ctx}: missing Meta`);
  if (typeof env._watermark !== 'string' || !env._watermark.includes('SYNTHETIC')) {
    throw new Error(`emit ${ctx}: missing/invalid _watermark`);
  }
}

if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'bundles'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'personas'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'enrichment'), { recursive: true });

// Banking + insurance: both domains are now bundled. Fixture file layout
// stays `bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json` because persona
// ids are globally unique across domains; the manifest records the persona's
// `domain` so MCP / TPP consumers can filter (or fan out) per domain.
const bankingPersonas = loadPersonasByDomain('banking');
const insurancePersonas = loadPersonasByDomain('insurance');
const atmPersonas = loadPersonasByDomain('atm');
const pools = loadAllPools();
const now = new Date(NOW_ANCHOR);

const manifest = {
  package: '@openfinance-os/sandbox-fixtures',
  version: PKG_VERSION,
  // Banking is the primary domain of the npm/PyPI bundle — keep the
  // back-compat string field on the banking spec. `specVersions` carries
  // the per-domain breakdown for consumers that need it.
  specVersion: SPEC_VERSIONS.banking,
  specVersions: SPEC_VERSIONS,
  specSha: SHA,
  generatedAt: new Date().toISOString(),
  nowAnchor: NOW_ANCHOR,
  domains: ['banking', 'insurance', 'atm'],
  fixtures: {},
  // Phase D Slice 5: secondary/tertiary role bundles emitted alongside
  // the primary fixture per persona × LFI. Same envelope shape (v2.1
  // spec-validated) at a role-keyed stage path. Cross-bundle IBAN
  // identity holds: `roleFixtures[…].accountIds[0]`'s IBAN (in the
  // role bundle's /accounts envelope) byte-matches the
  // `self-to-<role>` beneficiary's CreditorAccount.Identification in
  // the primary bundle.
  roleFixtures: {},
  personas: {},
};

let fileCount = 0;
let totalBytes = 0;

async function emitPersona(personaId, persona, domain) {
  const seed = persona.default_seed ?? 1;
  // Phase 2.2 — multi-domain personas declare `domains: [banking, insurance]`;
  // single-domain personas keep `domain: <string>`. Surface both shapes in
  // the manifest so npm / PyPI / MCP consumers can filter on either.
  const personaDomainList =
    Array.isArray(persona.domains) && persona.domains.length > 0
      ? persona.domains
      : [persona.domain ?? domain];
  const personaDomainLabel = personaDomainList.length > 1 ? 'multi' : personaDomainList[0];
  manifest.personas[personaId] = {
    name: persona.name,
    archetype: persona.archetype,
    default_seed: seed,
    domain: personaDomainLabel,
    domains: personaDomainList,
    stress_coverage: persona.stress_coverage ?? [],
    // D-14: surface a compact view of the persona's plausible multi-LFI
    // footprint so MCP / npm / PyPI consumers can discover the multi-bank
    // reality without re-reading the persona manifest. Each role keeps
    // the anonymous Rich/Median/Sparse populate-rate label and the
    // candidate-bank list (NG5/D-14 allow-site).
    multi_lfi_footprint: persona.multi_lfi_footprint ?? null,
    // Phase 2.2 — same shape, for insurance carriers.
    multi_insurer_footprint: persona.multi_insurer_footprint ?? null,
  };
  fs.writeFileSync(
    path.join(OUT, 'personas', `${personaId}.json`),
    JSON.stringify(persona, null, 2),
  );

  for (const lfi of ['rich', 'median', 'sparse']) {
    const ctx = {
      personaId,
      lfi,
      seed,
      // `specVersion` is kept on the banking value for back-compat with
      // consumers that read a single string; `specVersions` is the
      // per-domain object that wrapEnvelope / wrapInsurance pick from.
      specVersion: SPEC_VERSIONS.banking,
      specVersions: SPEC_VERSIONS,
      specSha: SHA,
      retrievedAt: NOW_ANCHOR,
    };
    const bundle = buildBundle({ persona, lfi, seed, pools, now });
    const envelopes = envelopesFromBundle(bundle, ctx);
    const dir = path.join(OUT, 'bundles', personaId, lfi, `seed-${seed}`);
    fs.mkdirSync(dir, { recursive: true });

    // Phase R1.5 — emit the per-(persona, seed) enrichment sidecar on the
    // first LFI pass only. The sidecar is computed pre-LFI inside the
    // generator so it's byte-identical under rich/median/sparse — writing
    // once is correct. URL: /enrichment/<persona>/seed-<n>.json.
    //
    // Manifest carries `enrichmentFiles` as a seed-keyed map (not a
    // single `enrichmentFile`) so a future persona declaring
    // `additional_seeds` doesn't have its earlier-seed paths
    // overwritten by the last iteration. loadEnrichment() resolves the
    // path by seed lookup.
    if (lfi === 'rich' && bundle._enrichment) {
      const enrichDir = path.join(OUT, 'enrichment', personaId);
      fs.mkdirSync(enrichDir, { recursive: true });
      const enrichFp = path.join(enrichDir, `seed-${seed}.json`);
      const enrichText = JSON.stringify(
        {
          schema: 'openfinance-os/data-sandbox/enrichment/v1',
          personaId,
          seed,
          generatedAt: new Date(NOW_ANCHOR).toISOString(),
          records: bundle._enrichment,
        },
        null,
        2,
      );
      fs.writeFileSync(enrichFp, enrichText);
      const relEnrich = path.relative(OUT, enrichFp).split(path.sep).join('/');
      const prevEntry = manifest.personas[personaId] ?? {};
      const prevFiles = prevEntry.enrichmentFiles ?? {};
      manifest.personas[personaId] = {
        ...prevEntry,
        enrichmentFiles: { ...prevFiles, [String(seed)]: relEnrich },
        enrichmentRecordCount: Object.keys(bundle._enrichment).length,
      };
      fileCount += 1;
      totalBytes += enrichText.length;
    }

    const endpointFiles = {};
    for (const [endpoint, env] of Object.entries(envelopes)) {
      assertEnvelope(env, endpoint, personaId);
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
    // pass it explicitly. Insurance bundles already emit both templated
    // and resolved keys directly from envelopesFromBundle.
    const aliasEndpoints = { ...endpointFiles };
    const accountIds = bundle.accounts?.map((a) => a.AccountId) ?? [];
    const firstAccountId = accountIds[0];
    if (firstAccountId) {
      for (const [endpoint, rel] of Object.entries(endpointFiles)) {
        const alias = endpoint.replace(`/accounts/${firstAccountId}`, '/accounts/{AccountId}');
        if (alias !== endpoint && !aliasEndpoints[alias]) {
          aliasEndpoints[alias] = rel;
        }
      }
    }
    const motorPolicyIds = bundle.motorPolicies?.map((p) => p.InsurancePolicyId) ?? [];
    const homePolicyIds = bundle.homePolicies?.map((p) => p.InsurancePolicyId) ?? [];
    const healthPolicyIds = bundle.healthPolicies?.map((p) => p.InsurancePolicyId) ?? [];
    const lifePolicyIds = bundle.lifePolicies?.map((p) => p.InsurancePolicyId) ?? [];
    const travelPolicyIds = bundle.travelPolicies?.map((p) => p.InsurancePolicyId) ?? [];
    const rentersPolicyIds = bundle.rentersPolicies?.map((p) => p.InsurancePolicyId) ?? [];
    const employmentPolicyIds = bundle.employmentPolicies?.map((p) => p.InsurancePolicyId) ?? [];
    const policyIds = [
      ...motorPolicyIds,
      ...homePolicyIds,
      ...healthPolicyIds,
      ...lifePolicyIds,
      ...travelPolicyIds,
      ...rentersPolicyIds,
      ...employmentPolicyIds,
    ];
    const motorQuoteId = bundle.motorQuote?.QuoteId ?? null;
    const homeQuoteId = bundle.homeQuote?.QuoteId ?? null;
    const healthQuoteId = bundle.healthQuote?.QuoteId ?? null;
    const lifeQuoteId = bundle.lifeQuote?.QuoteId ?? null;
    const travelQuoteId = bundle.travelQuote?.QuoteId ?? null;
    const rentersQuoteId = bundle.rentersQuote?.QuoteId ?? null;
    const employmentQuoteId = bundle.employmentQuote?.QuoteId ?? null;
    const quoteId =
      motorQuoteId ??
      homeQuoteId ??
      healthQuoteId ??
      lifeQuoteId ??
      travelQuoteId ??
      rentersQuoteId ??
      employmentQuoteId;
    const consentIds = bundle.consents?.map((c) => c.ConsentId) ?? [];
    // For multi-domain personas the bundle carries a `domains` array;
    // single-domain bundles use the `domain` field set by the generator
    // dispatcher. Store both for downstream consumers (MCP / npm) so
    // they can filter on `domain` (back-compat) or `domains` (Phase 2.2+).
    const bundleDomains = Array.isArray(bundle.domains)
      ? bundle.domains
      : [bundle.domain ?? domain];
    manifest.fixtures[`${personaId}|${lfi}|${seed}`] = {
      personaId,
      lfi,
      seed,
      domain: bundleDomains[0],
      domains: bundleDomains,
      line: bundle.line ?? null,
      accountIds,
      policyIds,
      quoteId,
      motorQuoteId,
      homeQuoteId,
      healthQuoteId,
      lifeQuoteId,
      travelQuoteId,
      rentersQuoteId,
      employmentQuoteId,
      consentIds,
      endpoints: aliasEndpoints,
    };

    // Phase D Slice 5: emit secondary/tertiary role bundles for any
    // banking persona declaring multi_lfi_footprint. Each role bundle
    // is a minimal v2.1 envelope set (single account at the role's
    // bank, balances, parties) staged at
    //   `bundles/<persona>/<role>/<lfi>/seed-<n>/...`
    // The primary bundle stays at the historical path (D-11 forward-
    // compat). Insurance personas don't carry a footprint.
    if (domain === 'banking' && persona.multi_lfi_footprint) {
      // Phase 2.2: iterate the normalised slots[] (skipping slots[0],
      // the primary). For legacy {primary, secondary, tertiary}
      // footprints the slot keys remain 'secondary' / 'tertiary' so
      // existing manifest entries + URLs stay byte-identical.
      const normFp = normalizeFootprint(persona.multi_lfi_footprint);
      const roleSlots = normFp ? normFp.slots.slice(1) : [];
      for (const slot of roleSlots) {
        const slotKey = slot.key;
        const roleBundle = await buildRoleBundle({ persona, slot: slotKey, lfi, seed, pools, now });
        if (!roleBundle) continue;
        const roleEnvelopes = envelopesFromBundle(roleBundle, ctx);
        const roleDir = path.join(OUT, 'bundles', personaId, slotKey, lfi, `seed-${seed}`);
        fs.mkdirSync(roleDir, { recursive: true });
        const roleFiles = {};
        for (const [endpoint, env] of Object.entries(roleEnvelopes)) {
          assertEnvelope(env, endpoint, `${personaId}|${slotKey}`);
          const fname = `${safeName(endpoint)}.json`;
          const fp = path.join(roleDir, fname);
          const text = JSON.stringify(env, null, 2);
          fs.writeFileSync(fp, text);
          roleFiles[endpoint] = path.relative(OUT, fp).split(path.sep).join('/');
          fileCount += 1;
          totalBytes += text.length;
        }
        const roleAccountIds = roleBundle.accounts?.map((a) => a.AccountId) ?? [];
        const aliasRoleEndpoints = { ...roleFiles };
        const firstRoleAccountId = roleAccountIds[0];
        if (firstRoleAccountId) {
          for (const [endpoint, rel] of Object.entries(roleFiles)) {
            const alias = endpoint.replace(
              `/accounts/${firstRoleAccountId}`,
              '/accounts/{AccountId}',
            );
            if (alias !== endpoint && !aliasRoleEndpoints[alias]) {
              aliasRoleEndpoints[alias] = rel;
            }
          }
        }
        manifest.roleFixtures[`${personaId}|${slotKey}|${lfi}|${seed}`] = {
          personaId,
          slot: slotKey,
          role: slot.role,
          lfi,
          seed,
          domain,
          accountIds: roleAccountIds,
          endpoints: aliasRoleEndpoints,
        };
      }
    }
  }
}

// Phase 2.2: multi-domain personas appear in BOTH bankingPersonas and
// insurancePersonas (loadPersonasByDomain matches against the persona's
// declared domain set). Emit them ONCE — buildBundle returns a composite
// bundle with both banking + insurance fields, and envelopesFromBundle
// produces both endpoint families. The banking iteration runs first so
// the role-bundle emitter inside emitPersona triggers for multi-domain
// personas with multi_lfi_footprint.
const emitted = new Set();
for (const [personaId, persona] of Object.entries(bankingPersonas)) {
  await emitPersona(personaId, persona, 'banking');
  emitted.add(personaId);
}
for (const [personaId, persona] of Object.entries(insurancePersonas)) {
  if (emitted.has(personaId)) continue; // multi-domain already emitted
  await emitPersona(personaId, persona, 'insurance');
}
// Phase 2.3 — ATM Locator. Persona-agnostic infrastructure data: the
// `atm_directory` sentinel persona is the (persona, lfi, seed) anchor
// for the v2.1 `GET /atms` endpoint. Same fixture-tree layout as
// banking / insurance so existing TPP consumers (URL fetchers, npm
// loader, MCP) pick it up without code changes.
for (const [personaId, persona] of Object.entries(atmPersonas)) {
  if (emitted.has(personaId)) continue;
  await emitPersona(personaId, persona, 'atm');
}

// Write banking + insurance SPEC.json into the package so consumers can
// introspect status badges without a second download. Banking remains at the
// historical filename (spec.json) for backward compatibility; insurance gets
// its own.
fs.copyFileSync(path.join(repoRoot, 'dist/SPEC.json'), path.join(OUT, 'spec.json'));
fs.copyFileSync(
  path.join(repoRoot, 'dist/SPEC.insurance.json'),
  path.join(OUT, 'spec.insurance.json'),
);
fs.copyFileSync(path.join(repoRoot, 'dist/SPEC.atm.json'), path.join(OUT, 'spec.atm.json'));

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
// `src/ui/export.js` defines envelopesFromBundle, which lib/persona-builder/
// fixture-handler.js + export-zip.js + the new MCP build_persona path all
// import as `../ui/export.js`. Without this copy the published package's
// custom-persona handlers fail to resolve their import.
copyDirRecursive(path.join(repoRoot, 'src/ui'), path.join(LIB_DIR, 'ui'));
fs.copyFileSync(path.join(repoRoot, 'src/prng.js'), path.join(LIB_DIR, 'prng.js'));

// Serialise the indexed pools so consumers can call getPools() without
// re-walking the YAML tree. Stable order preserved by the indexer.
fs.writeFileSync(path.join(OUT, 'pools.json'), JSON.stringify(pools));

// package.json — declares the npm package.
const pkgJson = {
  name: '@openfinance-os/sandbox-fixtures',
  version: PKG_VERSION,
  description:
    'Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the Open Finance Data Sandbox. 39 personas (21 banking + 9 insurance + 8 multi-domain + 1 ATM directory) × 3 LFI profiles × every in-scope endpoint. CC0 data, MIT loader code.',
  keywords: [
    'open-finance',
    'uae',
    'synthetic-data',
    'fixtures',
    'v2.1',
    'tpp',
    'commons',
    'insurance',
  ],
  homepage: 'https://github.com/openfinance-os/data-sandbox',
  repository: {
    type: 'git',
    url: 'https://github.com/openfinance-os/data-sandbox.git',
    directory: 'packages/sandbox-fixtures',
  },
  license: 'MIT',
  type: 'module',
  main: './index.cjs',
  module: './index.mjs',
  exports: {
    '.': { import: './index.mjs', require: './index.cjs', default: './index.mjs' },
    './manifest.json': './manifest.json',
    './spec.json': './spec.json',
    './spec.insurance.json': './spec.insurance.json',
    './spec.atm.json': './spec.atm.json',
    './pools.json': './pools.json',
    './bundles/*': './bundles/*',
    './personas/*': './personas/*',
    './lib/*': './lib/*',
  },
  files: [
    'index.mjs',
    'index.cjs',
    'index.d.ts',
    'manifest.json',
    'spec.json',
    'spec.insurance.json',
    'spec.atm.json',
    'pools.json',
    'bundles/',
    'personas/',
    'enrichment/',
    'brands/',
    'brand-registry.json',
    'lib/',
    'README.md',
  ],
  publishConfig: { access: 'public' },
};
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkgJson, null, 2));

// Loader — ESM
const indexMjs = `// @openfinance-os/sandbox-fixtures — ESM loader.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { paginateEnvelope } from './lib/shared/pagination.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));

const SPEC_FILE_BY_DOMAIN = {
  banking: 'spec.json',
  insurance: 'spec.insurance.json',
  atm: 'spec.atm.json',
};

export function listPersonas(opts = {}) {
  const ids = Object.keys(manifest.personas);
  if (!opts.domain) return ids;
  // Phase 2.2 — multi-domain personas (domains:[banking, insurance])
  // appear in BOTH banking and insurance filters.
  return ids.filter((id) => {
    const info = manifest.personas[id];
    if (!info) return false;
    const ds = Array.isArray(info.domains) ? info.domains : [info.domain ?? 'banking'];
    return ds.includes(opts.domain);
  });
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
// Pagination — Open Finance v2.1 Links/Meta envelope. \`loadFixturePage\`
// is the package-level entry point for TPPs that want to simulate paging
// through a listing endpoint (transactions, standing orders, etc.) the
// way they would against a real LFI. Internally it loads the full fixture
// envelope and slices its Data array — the same engine the Service Worker
// uses for the staged \`/fixtures/v1/bundles/.../*.json?offset=&limit=\` URL.
//
// \`requestUrl\` is optional; supply it to make Links.{Self,First,Next,Last}
// point at the URL the consumer would hit. When omitted, the helper synth-
// esises a sandbox:// URL so the Links structure stays well-formed.
export function loadFixturePage(opts) {
  const { offset = 0, limit = 25, requestUrl, ...loadOpts } = opts || {};
  const envelope = loadFixture(loadOpts);
  return paginateEnvelope(envelope, {
    offset,
    limit,
    requested: true,
    requestUrl: requestUrl ?? sandboxUrl(loadOpts),
  });
}

function sandboxUrl({ persona, lfi = 'median', seed, endpoint }) {
  const info = manifest.personas[persona];
  const useSeed = seed ?? info?.default_seed ?? 0;
  const safe = String(endpoint || '').replace(/^\\//, '').replace(/\\//g, '__').replace(/[{}]/g, '');
  return \`sandbox:/fixtures/v1/bundles/\${persona}/\${lfi}/seed-\${useSeed}/\${safe}.json\`;
}

export function loadFixture({ persona, lfi = 'median', seed, endpoint, lfi_role }) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(\`unknown persona: \${persona}\`);
  const useSeed = seed ?? info.default_seed;
  if (lfi_role && lfi_role !== 'primary') {
    const rkey = \`\${persona}|\${lfi_role}|\${lfi}|\${useSeed}\`;
    const rfx = (manifest.roleFixtures ?? {})[rkey];
    if (!rfx) throw new Error(\`no role-bundle fixture for \${rkey}\`);
    const rel = rfx.endpoints[endpoint];
    if (!rel) throw new Error(\`no fixture for endpoint \${endpoint} in \${rkey}\`);
    return JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
  }
  const key = \`\${persona}|\${lfi}|\${useSeed}\`;
  const fx = manifest.fixtures[key];
  if (!fx) throw new Error(\`no fixture for \${key}\`);
  const rel = fx.endpoints[endpoint];
  if (!rel) throw new Error(\`no fixture for endpoint \${endpoint} in \${key}\`);
  return JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
}
export function listRoleBundles(personaId) {
  // Derive the emitted role-slot keys from the role-fixture manifest rather
  // than a hard-coded list, so Phase 2.2 N-slot personas (arbitrary slot keys
  // like 'salary' / 'mortgage-lender') are discoverable, not just the legacy
  // secondary/tertiary triad. Keys are \`\${persona}|\${slot}|\${lfi}|\${seed}\`.
  const out = [];
  const rf = manifest.roleFixtures ?? {};
  if (!manifest.personas[personaId]) return out;
  const prefix = \`\${personaId}|\`;
  for (const key of Object.keys(rf)) {
    if (!key.startsWith(prefix)) continue;
    const slot = key.slice(prefix.length).split('|')[0];
    if (!out.includes(slot)) out.push(slot);
  }
  return out;
}
export function loadJourney({ persona, lfi = 'median', seed, lfi_role } = {}) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(\`unknown persona: \${persona}\`);
  const useSeed = seed ?? info.default_seed;
  if (lfi_role && lfi_role !== 'primary') {
    const rkey = \`\${persona}|\${lfi_role}|\${lfi}|\${useSeed}\`;
    const rfx = (manifest.roleFixtures ?? {})[rkey];
    if (!rfx) throw new Error(\`no role-bundle journey for \${rkey}\`);
    const endpoints = {};
    for (const [endpoint, rel] of Object.entries(rfx.endpoints)) {
      endpoints[endpoint] = JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
    }
    return {
      persona, lfi, lfi_role,
      seed: useSeed,
      domain: info.domain ?? 'banking',
      accountIds: rfx.accountIds ?? [],
      policyIds: [],
      quoteId: null,
      customerId: endpoints['/parties']?.Data?.Party?.PartyId ?? null,
      specVersion: manifest.specVersion,
      specSha: manifest.specSha,
      version: manifest.version,
      endpoints,
    };
  }
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
    lfi_role: 'primary',
    seed: useSeed,
    domain: info.domain ?? 'banking',
    accountIds: fx.accountIds ?? [],
    policyIds: fx.policyIds ?? [],
    quoteId: fx.quoteId ?? null,
    customerId: endpoints['/parties']?.Data?.Party?.PartyId ?? null,
    specVersion: manifest.specVersion,
    specSha: manifest.specSha,
    version: manifest.version,
    endpoints,
  };
}
export function loadSpec(opts = {}) {
  const domain = opts.domain ?? 'banking';
  const file = SPEC_FILE_BY_DOMAIN[domain];
  if (!file) throw new Error(\`unknown domain: \${domain}\`);
  return JSON.parse(readFileSync(path.join(here, file), 'utf8'));
}
export function loadPersonaManifest(personaId) {
  return JSON.parse(readFileSync(path.join(here, 'personas', \`\${personaId}.json\`), 'utf8'));
}

// Phase R1.5 — per-(persona, seed) enrichment sidecar. The bundle itself
// stays as the v2.1 envelope a real UAE core would serve over Open
// Finance (the "raw" view); the enrichment sidecar is what a TPP's
// enrichment engine produces after cleaning. Same shape pattern as a
// production logo / categorisation provider (Brandfetch, Tink, Plaid,
// SaltEdge): join by TransactionId.
//
// LFI-independent — computed before applyLfiProfile() so the sidecar
// stays complete even under Sparse (which redacts MerchantDetails out
// of the bundle's wire payload).
// Phase R4 — brand registry. Slug-keyed map of merchant → logo URL,
// primary colour, website, parent-group, display variants. The
// enrichment sidecar's logoSlug field is the join key. Same shape
// pattern as a production logo provider (Brandfetch / Clearbit). The
// registry file is generated by tools/build-brand-registry.mjs from
// the merchant pools — see lint-brand-registry-coverage for the
// 1:1 invariant. Throws if the registry hasn't been built (run
// 'npm run build:fixtures' to regenerate).
let _brandRegistryCache = null;
export function loadBrandRegistry() {
  if (_brandRegistryCache) return _brandRegistryCache;
  const fp = path.join(here, 'brand-registry.json');
  _brandRegistryCache = JSON.parse(readFileSync(fp, 'utf8'));
  return _brandRegistryCache;
}

export function loadEnrichment({ persona, seed } = {}) {
  const info = manifest.personas[persona];
  if (!info) throw new Error(\`unknown persona: \${persona}\`);
  const useSeed = seed ?? info.default_seed;
  // Seed-keyed map (set since R3 fix); legacy single-string
  // 'enrichmentFile' kept as a fallback for the transitional window
  // where a previously-built manifest is still around.
  const rel = info.enrichmentFiles?.[String(useSeed)] ?? info.enrichmentFile;
  if (!rel) throw new Error(\`no enrichment sidecar published for \${persona} seed=\${useSeed}\`);
  const data = JSON.parse(readFileSync(path.join(here, rel), 'utf8'));
  if (data.seed !== useSeed) {
    throw new Error(\`enrichment sidecar seed mismatch: file has \${data.seed}, requested \${useSeed}\`);
  }
  return data;
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
// envelopesFromBundle wraps an in-memory generator bundle into v2.1-shaped
// JSON envelopes (Data / Links / Meta + watermark fields) keyed by endpoint.
// Counterpart to buildBundle for any consumer that doesn't read the static
// fixture files — e.g. the MCP build_persona path.
export { envelopesFromBundle } from './lib/ui/export.js';

// Pagination helpers — pure functions that operate on already-loaded
// envelopes. Useful for TPPs that prefer to load the full envelope once
// and slice client-side (e.g. when prototyping a paging UI).
export { paginateEnvelope };
export {
  parsePaginationParams,
  isPaginatableEnvelope,
  findListKey,
  PAGINATION_DEFAULTS,
} from './lib/shared/pagination.js';

export { manifest };
`;
fs.writeFileSync(path.join(OUT, 'index.mjs'), indexMjs);

// Loader — CommonJS wrapper.
const indexCjs = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const here = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const SPEC_FILE_BY_DOMAIN = { banking: 'spec.json', insurance: 'spec.insurance.json', atm: 'spec.atm.json' };
function listPersonas(opts) {
  const ids = Object.keys(manifest.personas);
  if (!opts || !opts.domain) return ids;
  // Phase 2.2 — multi-domain personas appear in BOTH banking and insurance filters.
  return ids.filter(function (id) {
    const info = manifest.personas[id];
    if (!info) return false;
    const ds = Array.isArray(info.domains) ? info.domains : [info.domain || 'banking'];
    return ds.indexOf(opts.domain) !== -1;
  });
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
  // Derive emitted role-slot keys from the manifest (supports Phase 2.2
  // N-slot personas, not just the legacy secondary/tertiary triad).
  const out = [];
  const rf = manifest.roleFixtures || {};
  if (!manifest.personas[personaId]) return out;
  const prefix = personaId + '|';
  const keys = Object.keys(rf);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(prefix) !== 0) continue;
    const slot = keys[i].slice(prefix.length).split('|')[0];
    if (out.indexOf(slot) < 0) out.push(slot);
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
// Phase R4 — slug-keyed brand registry. See index.mjs for the long comment.
let _brandRegistryCache = null;
function loadBrandRegistry() {
  if (_brandRegistryCache) return _brandRegistryCache;
  _brandRegistryCache = JSON.parse(fs.readFileSync(path.join(here, 'brand-registry.json'), 'utf8'));
  return _brandRegistryCache;
}

function loadEnrichment(opts) {
  opts = opts || {};
  const persona = opts.persona;
  const info = manifest.personas[persona];
  if (!info) throw new Error('unknown persona: ' + persona);
  const useSeed = opts.seed != null ? opts.seed : info.default_seed;
  const rel = (info.enrichmentFiles && info.enrichmentFiles[String(useSeed)]) || info.enrichmentFile;
  if (!rel) throw new Error('no enrichment sidecar published for ' + persona + ' seed=' + useSeed);
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
async function loadFixturePage(opts) {
  const o = opts || {};
  const offset = o.offset != null ? o.offset : 0;
  const limit = o.limit != null ? o.limit : 25;
  const requestUrl = o.requestUrl;
  const loadOpts = { persona: o.persona, lfi: o.lfi, seed: o.seed, endpoint: o.endpoint, lfi_role: o.lfi_role };
  const envelope = loadFixture(loadOpts);
  const { paginateEnvelope } = await import('./lib/shared/pagination.js');
  return paginateEnvelope(envelope, {
    offset, limit, requested: true,
    requestUrl: requestUrl || sandboxUrl(loadOpts),
  });
}

function sandboxUrl(opts) {
  const persona = opts.persona;
  const lfi = opts.lfi || 'median';
  const info = manifest.personas[persona];
  const seed = opts.seed != null ? opts.seed : (info && info.default_seed) || 0;
  const safe = String(opts.endpoint || '').replace(/^\\//, '').replace(/\\//g, '__').replace(/[{}]/g, '');
  return 'sandbox:/fixtures/v1/bundles/' + persona + '/' + lfi + '/seed-' + seed + '/' + safe + '.json';
}

async function getPagination() {
  return import('./lib/shared/pagination.js');
}

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
  listRoleBundles, loadFixturePage,
  loadJourney, loadSpec, loadPersonaManifest, loadEnrichment, loadBrandRegistry,
  getPools, getEngine, getPagination,
};
`;
fs.writeFileSync(path.join(OUT, 'index.cjs'), indexCjs);

// Tiny TS types for editor support.
const indexDts = `export type Domain = 'banking' | 'insurance' | 'atm';
export interface PersonaInfo {
  name: string;
  archetype: string;
  default_seed: number;
  domain: Domain;
  stress_coverage: string[];
}
export interface FixtureEntry {
  personaId: string;
  lfi: string;
  seed: number;
  domain: Domain;
  accountIds: string[];
  policyIds: string[];
  quoteId: string | null;
  endpoints: Record<string, string>;
}
export interface Manifest {
  package: string;
  version: string;
  specVersion: string;
  specSha: string;
  generatedAt: string;
  nowAnchor: string;
  domains: Domain[];
  fixtures: Record<string, FixtureEntry>;
  personas: Record<string, PersonaInfo>;
}
export interface Journey {
  persona: string;
  lfi: 'rich' | 'median' | 'sparse';
  seed: number;
  domain: Domain;
  accountIds: string[];
  policyIds: string[];
  quoteId: string | null;
  customerId: string | null;
  specVersion: string;
  specSha: string;
  version: string;
  endpoints: Record<string, unknown>;
}
export const manifest: Manifest;
export function listPersonas(opts?: { domain?: Domain }): string[];
export function getPersonaInfo(personaId: string): PersonaInfo | null;
export function listEndpoints(personaId: string, lfi?: 'rich' | 'median' | 'sparse'): string[];
export function loadFixture(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
  endpoint: string;
  /** D-14 / Phase D Slice 5: a non-primary role-slot key to read the
   * persona's multi-LFI footprint role bundle instead of the primary
   * fixture. Legacy personas use 'secondary' / 'tertiary'; Phase 2.2
   * N-slot personas use arbitrary keys (e.g. 'salary', 'mortgage-lender')
   * — see listRoleBundles for the emitted set. Omit (or pass 'primary')
   * for the historical primary path. */
  lfi_role?: string;
}): unknown;
/** Returns the role-slot keys that have an emitted role bundle for this
 * persona. Legacy personas return a subset of ['secondary','tertiary'];
 * Phase 2.2 N-slot personas return their declared slot keys. */
export function listRoleBundles(personaId: string): string[];

// Pagination — Open Finance v2.1 Links/Meta envelope. \`loadFixturePage\`
// loads the full fixture for the requested endpoint and returns a paginated
// view: the array under \`Data\` is sliced to \`[offset, offset+limit)\`, and
// Links.{Self,First,Last} + (when applicable) Links.{Next,Prev} +
// Meta.TotalPages are populated. A \`_pagination\` sidecar object exposes
// the resolved offset/limit/total-records/page-number to client code.
export interface PaginationOptions {
  offset?: number;
  limit?: number;
  /** Override the URL emitted in Links.*. Defaults to a synthetic
   *  sandbox:/fixtures/v1/... URL matching the persona/lfi/seed/endpoint. */
  requestUrl?: string;
}
export interface PaginatedMeta {
  TotalPages: number;
  [k: string]: unknown;
}
export interface PaginatedLinks {
  Self: string;
  First: string;
  Last: string;
  Next?: string;
  Prev?: string;
}
export interface PaginationSidecar {
  offset: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  pageNumber: number;
  hasNext: boolean;
  hasPrevious: boolean;
}
export interface PaginatedEnvelope {
  Data: unknown;
  Links: PaginatedLinks;
  Meta: PaginatedMeta;
  _pagination: PaginationSidecar;
  [k: string]: unknown;
}
export function loadFixturePage(
  opts: {
    persona: string;
    endpoint: string;
    lfi?: 'rich' | 'median' | 'sparse';
    seed?: number;
    lfi_role?: string;
  } & PaginationOptions
): PaginatedEnvelope;

/** Pure pagination over an already-loaded envelope. */
export function paginateEnvelope(
  envelope: unknown,
  opts: { offset: number; limit: number; requested: boolean; requestUrl?: string }
): unknown;
export function parsePaginationParams(
  searchParams: URLSearchParams,
  opts?: { defaultLimit?: number; maxLimit?: number }
): { offset: number; limit: number; requested: boolean };
export function isPaginatableEnvelope(envelope: unknown): boolean;
export function findListKey(envelope: unknown): string | null;
export const PAGINATION_DEFAULTS: { readonly defaultLimit: number; readonly maxLimit: number };

export function loadJourney(opts: {
  persona: string;
  lfi?: 'rich' | 'median' | 'sparse';
  seed?: number;
  /** D-14 / Slice 8: load the persona's role-keyed bundle instead of the
   * primary. Only valid for personas with multi_lfi_footprint declaring
   * the slot AND a role bundle emitted (see listRoleBundles). Legacy
   * 'secondary'/'tertiary' or a Phase 2.2 N-slot key. */
  lfi_role?: string;
}): Journey;
export function loadSpec(opts?: { domain?: Domain }): unknown;
export function loadPersonaManifest(personaId: string): unknown;

// Phase R1.5 — per-(persona, seed) enrichment sidecar. The bundle stays as
// the v2.1 envelope a real UAE core would serve over Open Finance (the
// "raw" view); the enrichment payload is what a TPP's enrichment engine
// would produce after cleaning. Join by TransactionId.
export interface EnrichmentRecord {
  merchant: string | null;
  /** Corrected ISO 18245 MCC (the trustworthy taxonomy key). Sidecar
   *  carries this even when the wire-level MCC is misrouted. */
  mcc: string | null;
  category: string;
  subcategory: string;
  logoSlug: string | null;
  /** Phase R4 — direct logo URL matching the brand-registry path. The
   *  sidecar emits this deterministically from the slug so a TPP can
   *  render the logo straight off the enrichment record without a
   *  registry lookup. Same value the brand-registry entry carries. */
  logoUrl: string | null;
  /** Phase R4 — deterministic FNV-1a → HSL → hex brand colour. Matches
   *  the colour painted on the merchant's placeholder SVG (algorithmic
   *  parity is test-enforced). */
  primaryColor: string | null;
  /** Phase R2 — synthetic UAE family-conglomerate parent group id. */
  parentGroup: string | null;
  /** Phase R2 — short acronym used as a narrative prefix on the raw side. */
  parentGroupAcronym: string | null;
  /** Phase R3 — the wrong-but-plausible MCC the card scheme emitted on
   *  the wire, populated only when misrouting occurred. */
  mccRaw: string | null;
  /** Phase R3 — true when the wire MCC was misrouted. */
  mccMisrouted: boolean;
  /** Phase R3 — human-readable reason from the confusion table. */
  mccMisroutingReason: string | null;
}
export interface EnrichmentSidecar {
  schema: string;
  personaId: string;
  seed: number;
  generatedAt: string;
  records: Record<string, EnrichmentRecord>;
}
export function loadEnrichment(opts: { persona: string; seed?: number }): EnrichmentSidecar;

// Phase R4 — brand registry. Slug-keyed map (the logoSlug field on an
// EnrichmentRecord joins here). Same shape a Brandfetch / Clearbit
// integration would return. Logos are algorithmically-generated
// placeholders (initials in a coloured circle, OF-OS visual style) —
// no real brand marks are reproduced.
export interface BrandRegistryEntry {
  merchantName: string;
  logoUrl: string;
  primaryColor: string;
  website: string;
  parentGroup: string | null;
  parentGroupAcronym: string | null;
  displayVariants: string[];
  displayVariantsAr: string[];
  mcc: string | null;
  initials: string;
}
export interface BrandRegistry {
  schema: string;
  generatedAt: string;
  merchantCount: number;
  records: Record<string, BrandRegistryEntry>;
}
export function loadBrandRegistry(): BrandRegistry;

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
export function envelopesFromBundle(bundle: unknown, ctx: { personaId: string; lfi: 'rich' | 'median' | 'sparse'; seed: number; specVersion?: string; specSha?: string; retrievedAt: string }): Record<string, unknown>;
`;
fs.writeFileSync(path.join(OUT, 'index.d.ts'), indexDts);

// README.
const readme = `# @openfinance-os/sandbox-fixtures

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the
[Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox).

38 personas (21 banking + 9 insurance + 8 multi-domain) × 3 LFI profiles ×
every v2.1 endpoint per persona's accounts/policies = **~2,000 fixtures**,
plus the parsed v2.1 OpenAPI specs (banking + insurance) and the persona
manifests. Multi-domain personas are surfaced by both
\`loadPersonasByDomain('banking')\` and \`loadPersonasByDomain('insurance')\`,
matching the way the sandbox UI renders them in both tabs.

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

- \`bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json\` — ~2,000 fixtures across two domains. Banking: 18 personas × 3 LFIs × every Account-Information endpoint per persona's accounts. Insurance: 9 personas (motor, home, health, life, travel, renters, employment) × 3 LFIs × the per-line endpoint set. Each is a v2.1-correct \`{ Data, Links, Meta }\` envelope plus watermark fields (\`_persona\`, \`_lfi\`, \`_seed\`, \`_specSha\`).
- \`personas/<persona>.json\` — persona manifest (demographics, fixed commitments, stress coverage, narrative).
- \`spec.json\` — the parsed UAE Open Finance v2.1 Account-Information spec, keyed by endpoint with field metadata. The insurance spec is sibling-loadable via \`loadSpec({ domain: 'insurance' })\`.
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

const personasByDomain = {};
for (const info of Object.values(manifest.personas)) {
  const d = info.domain ?? 'banking';
  personasByDomain[d] = (personasByDomain[d] ?? 0) + 1;
}
const personaSummary = Object.entries(personasByDomain)
  .map(([d, n]) => `${n} ${d}`)
  .join(' + ');

console.log(
  `built fixture package → ${path.relative(repoRoot, OUT)}/` +
    `\n  ${fileCount} fixture files (${(totalBytes / 1024).toFixed(1)} KB raw)` +
    `\n  ${Object.keys(manifest.personas).length} personas (${personaSummary}) · ${Object.keys(manifest.fixtures).length} (persona × lfi) keys` +
    `\n  spec ${manifest.specVersion} @ ${manifest.specSha.slice(0, 7)}`,
);
