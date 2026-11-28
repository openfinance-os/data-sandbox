#!/usr/bin/env node
// Build the release-candidate preview corpora (PRD D-01 amendment,
// 28 November 2026) from the stable fixture package.
//
// For every preview in tools/domains.config.mjs#PREVIEWS, each stable fixture
// of that domain (primary and role bundles, every listed LFI and seed) is
// re-shaped with src/core/preview.js and written to
//   packages/sandbox-fixtures/preview/<baseline>/bundles/<same relative path>
// alongside a manifest.json and index.json. tools/stage-site.mjs publishes
// the tree at /fixtures/preview/<baseline>/. The output is gitignored and
// stays out of the npm package; v2.1 remains the default everywhere.
//
// Requires `npm run build:spec` and tools/build-fixture-package.mjs first.

import fs from 'node:fs';
import path from 'node:path';
import { PREVIEWS } from './domains.config.mjs';
import { repoRoot } from './load-fixtures.mjs';
import { toPreviewEnvelope } from '../src/core/preview.js';

const PKG = path.join(repoRoot, 'packages/sandbox-fixtures');
const manifestPath = path.join(PKG, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('[preview] fixture package not built. Run `npm run build:fixtures` first.');
  process.exit(1);
}
const stable = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(repoRoot, 'spec/provenance.json'), 'utf8'))
  .preview?.corpus;

const DOMAIN_OF = (endpoint) =>
  endpoint === '/atms'
    ? 'atm'
    : endpoint.includes('-insurance-') || endpoint.startsWith('/insurance-consents')
      ? 'insurance'
      : 'banking';

for (const preview of PREVIEWS) {
  const domainProvenance = provenance?.domains?.[preview.id];
  if (!domainProvenance || domainProvenance.version !== preview.baseline)
    throw new Error(
      `[preview] spec/provenance.json has no ${preview.baseline} ${preview.id} entry`,
    );
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, preview.outPath), 'utf8'));
  if (spec.specVersion !== preview.baseline)
    throw new Error(`[preview] ${preview.outPath} declares ${spec.specVersion}`);

  const outRoot = path.join(PKG, 'preview', preview.baseline);
  fs.rmSync(outRoot, { recursive: true, force: true });

  const out = {
    schema: 'openfinance-os/data-sandbox/fixtures/preview',
    status: 'preview',
    baseline: preview.baseline,
    stableBaseline: stable.specVersions?.[preview.id] ?? null,
    domain: preview.id,
    corpusVersion: stable.corpusVersion,
    version: stable.version,
    specProvenance: { [preview.id]: domainProvenance },
    notice:
      'Release-candidate preview. The stable baseline is v2.1; release candidates must not be the basis of a production implementation.',
    pathContract: `/fixtures/preview/${preview.baseline}/bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json`,
    wireChanges: {},
    fixtures: {},
    roleFixtures: {},
  };

  const written = new Map();
  let files = 0;
  const convert = (rel, endpoint) => {
    if (written.has(rel)) return written.get(rel);
    const env = JSON.parse(fs.readFileSync(path.join(PKG, rel), 'utf8'));
    const { envelope, changedPaths } = toPreviewEnvelope(env, endpoint, spec, domainProvenance);
    const dst = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, JSON.stringify(envelope, null, 2));
    for (const p of changedPaths) out.wireChanges[p] = 'number → decimal string';
    written.set(rel, rel);
    files++;
    return rel;
  };

  for (const [group, target] of [
    ['fixtures', out.fixtures],
    ['roleFixtures', out.roleFixtures],
  ]) {
    for (const [key, entry] of Object.entries(stable[group] ?? {})) {
      const endpoints = {};
      for (const [endpoint, rel] of Object.entries(entry.endpoints)) {
        if (DOMAIN_OF(endpoint) !== preview.id) continue;
        // Templated aliases share a file with a resolved endpoint; convert
        // under the resolved key so the template lookup sees a concrete path.
        const resolved =
          Object.entries(entry.endpoints).find(([e, r]) => r === rel && !e.includes('{'))?.[0] ??
          endpoint;
        endpoints[endpoint] = convert(rel, resolved);
      }
      if (Object.keys(endpoints).length === 0) continue;
      target[key] = {
        personaId: entry.personaId,
        role: entry.role ?? 'primary',
        lfi: entry.lfi,
        seed: entry.seed,
        accountIds: entry.accountIds ?? [],
        endpoints,
      };
    }
  }

  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(out, null, 2));
  const personas = [...new Set(Object.values(out.fixtures).map((f) => f.personaId))].sort();
  fs.writeFileSync(
    path.join(outRoot, 'index.json'),
    JSON.stringify(
      {
        schema: out.schema,
        status: out.status,
        baseline: out.baseline,
        stableBaseline: out.stableBaseline,
        domain: out.domain,
        notice: out.notice,
        pathContract: out.pathContract,
        specPin: domainProvenance.commit,
        wireChanges: out.wireChanges,
        personas,
        lfis: ['rich', 'median', 'sparse'],
      },
      null,
      2,
    ),
  );
  console.log(
    `[preview] ${preview.id} ${preview.baseline}: ${files} envelopes, ${personas.length} personas → ${path.relative(repoRoot, outRoot)}`,
  );
}
