#!/usr/bin/env node
// Build the release-candidate preview corpora (PRD D-01 amendment,
// 28 November 2026) from the stable fixture package.
//
// For every baseline in tools/domains.config.mjs#PREVIEWS, each stable
// fixture of a previewed domain (primary and role bundles, every listed LFI
// and seed) is re-shaped with src/core/preview.js and written to
//   packages/sandbox-fixtures/preview/<baseline>/bundles/<same relative path>
// alongside a manifest.json and index.json. tools/stage-site.mjs publishes
// the tree at /fixtures/preview/<baseline>/. The output is gitignored and
// stays out of the npm package; v2.1 remains the default everywhere.
//
// Requires `npm run build:spec` and tools/build-fixture-package.mjs first.

import fs from 'node:fs';
import path from 'node:path';
import { DOMAINS, PREVIEWS } from './domains.config.mjs';
import { repoRoot } from './load-fixtures.mjs';
import {
  toPreviewEnvelope,
  templateFor,
  newlyMandatoryPaths,
  restoreMandatory,
} from '../src/core/preview.js';
import {
  insuranceLine,
  previewQuoteFields,
  previewPolicyAdditions,
} from '../src/generator/insurance/preview-v22.js';

const PKG = path.join(repoRoot, 'packages/sandbox-fixtures');
const manifestPath = path.join(PKG, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('[preview] fixture package not built. Run `npm run build:fixtures` first.');
  process.exit(1);
}
const stable = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(repoRoot, 'spec/provenance.json'), 'utf8'))
  .preview?.corpus;

const domainOf = (endpoint) =>
  endpoint === '/atms'
    ? 'atm'
    : endpoint.includes('-insurance-') || endpoint.startsWith('/insurance-consents')
      ? 'insurance'
      : 'banking';

const readData = (rel) => JSON.parse(fs.readFileSync(path.join(PKG, rel), 'utf8')).Data;

/**
 * Facts the candidate newly requires for one insurance envelope, from the
 * insurance generator's preview module. Quotes read their line's first
 * policy from the same fixture.
 */
function insuranceAdditions(endpoint, env, entry) {
  const line = insuranceLine(endpoint);
  if (!line) return [];
  if (/-insurance-quotes\//.test(endpoint)) {
    const policyRel = entry.endpoints[`/${line}-insurance-policies/{InsurancePolicyId}`];
    if (!policyRel) throw new Error(`[preview] ${endpoint}: no ${line} policy in fixture`);
    return [{ at: ['Data'], values: previewQuoteFields(line, readData(policyRel)) }];
  }
  if (/-insurance-policies\/[^/]+$/.test(endpoint)) return previewPolicyAdditions(line, env.Data);
  return [];
}

const baselines = [...new Set(PREVIEWS.map((p) => p.baseline))];
for (const baseline of baselines) {
  const previews = PREVIEWS.filter((p) => p.baseline === baseline);
  const outRoot = path.join(PKG, 'preview', baseline);
  fs.rmSync(outRoot, { recursive: true, force: true });

  const specs = {};
  const stableSpecs = {};
  const specProvenance = {};
  for (const preview of previews) {
    const domainProvenance = provenance?.domains?.[preview.id];
    if (!domainProvenance || domainProvenance.version !== baseline)
      throw new Error(`[preview] spec/provenance.json has no ${baseline} ${preview.id} entry`);
    const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, preview.outPath), 'utf8'));
    if (spec.specVersion !== baseline)
      throw new Error(`[preview] ${preview.outPath} declares ${spec.specVersion}`);
    specs[preview.id] = spec;
    const stableOut = DOMAINS.find((d) => d.id === preview.id).outPath;
    stableSpecs[preview.id] = JSON.parse(fs.readFileSync(path.join(repoRoot, stableOut), 'utf8'));
    specProvenance[preview.id] = domainProvenance;
  }
  const domains = Object.keys(specs);

  const out = {
    schema: 'openfinance-os/data-sandbox/fixtures/preview',
    status: 'preview',
    baseline,
    stableBaselines: Object.fromEntries(domains.map((d) => [d, stable.specVersions?.[d] ?? null])),
    domains,
    corpusVersion: stable.corpusVersion,
    version: stable.version,
    specProvenance,
    notice:
      'Release-candidate preview. The stable baseline is v2.1; release candidates must not be the basis of a production implementation.',
    pathContract: `/fixtures/preview/${baseline}/bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json`,
    wireChanges: Object.fromEntries(domains.map((d) => [d, {}])),
    fixtures: {},
    roleFixtures: {},
  };

  const written = new Set();
  const restoredPaths = new Set();
  const counts = Object.fromEntries(domains.map((d) => [d, 0]));
  const convert = (rel, endpoint, entry) => {
    if (written.has(rel)) return rel;
    const domain = domainOf(endpoint);
    const env = JSON.parse(fs.readFileSync(path.join(PKG, rel), 'utf8'));
    const additions = domain === 'insurance' ? insuranceAdditions(endpoint, env, entry) : [];
    const result = toPreviewEnvelope(env, endpoint, specs[domain], {
      stableSpec: stableSpecs[domain],
      provenance: specProvenance[domain],
      additions,
    });
    // Restore fields the candidate makes mandatory that this LFI profile
    // redacted, from the same scenario's Rich twin.
    if (entry.lfi !== 'rich') {
      const richRel = rel.replace(`/${entry.lfi}/seed-`, '/rich/seed-');
      const template = templateFor(endpoint, specs[domain].inScopePaths);
      const paths = newlyMandatoryPaths(
        specs[domain].endpoints[template],
        stableSpecs[domain].endpoints[template],
      );
      if (paths.length && richRel !== rel && fs.existsSync(path.join(PKG, richRel))) {
        const rich = toPreviewEnvelope(
          JSON.parse(fs.readFileSync(path.join(PKG, richRel), 'utf8')),
          endpoint,
          specs[domain],
          { stableSpec: stableSpecs[domain] },
        ).envelope;
        for (const p of restoreMandatory(result.envelope, rich, paths))
          restoredPaths.add(`${domain}:${p.replace(/\.\d+\./g, '[].')}`);
      }
    }
    const dst = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, JSON.stringify(result.envelope, null, 2));
    const changes = out.wireChanges[domain];
    for (const p of result.changedPaths) changes[p] = 'number → decimal string';
    for (const p of result.removedPaths) changes[p] = 'removed';
    for (const p of result.addedPaths) changes[p] = 'added';
    written.add(rel);
    counts[domain]++;
    return rel;
  };

  for (const [group, target] of [
    ['fixtures', out.fixtures],
    ['roleFixtures', out.roleFixtures],
  ]) {
    for (const [key, entry] of Object.entries(stable[group] ?? {})) {
      const endpoints = {};
      for (const [endpoint, rel] of Object.entries(entry.endpoints)) {
        if (!specs[domainOf(endpoint)]) continue;
        // Templated aliases share a file with a resolved endpoint; convert
        // under the resolved key so the template lookup sees a concrete path.
        const resolved =
          Object.entries(entry.endpoints).find(([e, r]) => r === rel && !e.includes('{'))?.[0] ??
          endpoint;
        endpoints[endpoint] = convert(rel, resolved, entry);
      }
      if (Object.keys(endpoints).length === 0) continue;
      target[key] = {
        personaId: entry.personaId,
        role: entry.role ?? 'primary',
        lfi: entry.lfi,
        seed: entry.seed,
        domains: [...new Set(Object.keys(endpoints).map(domainOf))].sort(),
        accountIds: entry.accountIds ?? [],
        policyIds: entry.policyIds ?? [],
        endpoints,
      };
    }
  }

  for (const key of restoredPaths) {
    const [domain, p] = key.split(':');
    out.wireChanges[domain][p] ??= 'now mandatory; kept under every LFI profile';
  }
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(out, null, 2));
  const personasBy = (domain) =>
    [
      ...new Set(
        Object.values(out.fixtures)
          .filter((f) => f.domains.includes(domain))
          .map((f) => f.personaId),
      ),
    ].sort();
  fs.writeFileSync(
    path.join(outRoot, 'index.json'),
    JSON.stringify(
      {
        schema: out.schema,
        status: out.status,
        baseline,
        stableBaselines: out.stableBaselines,
        domains,
        notice: out.notice,
        pathContract: out.pathContract,
        specPin: specProvenance[domains[0]].commit,
        specs: Object.fromEntries(
          domains.map((d) => [d, d === 'banking' ? 'spec.json' : `spec.${d}.json`]),
        ),
        wireChanges: out.wireChanges,
        personas: Object.fromEntries(domains.map((d) => [d, personasBy(d)])),
        lfis: ['rich', 'median', 'sparse'],
      },
      null,
      2,
    ),
  );
  for (const d of domains)
    console.log(
      `[preview] ${d} ${baseline}: ${counts[d]} envelopes, ${personasBy(d).length} personas`,
    );
  console.log(`[preview] → ${path.relative(repoRoot, outRoot)}`);
}
