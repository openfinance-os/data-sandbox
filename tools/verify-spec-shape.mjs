#!/usr/bin/env node
// CI gate — fails loudly if a vendored OpenAPI YAML's structure changes
// shape unexpectedly between pinned-SHA bumps (R-EXP-08). Catches things like
// a removed endpoint, a renamed schema-ref pattern, or a fundamental change
// in how `responses` is encoded.
//
// T-05b: domain-generic. Driven entirely off the DOMAINS registry in
// tools/domains.config.mjs — each domain's `inScopePaths` IS the
// required-path list, and its `specPath` names the vendored YAML. Adding a
// domain (Open Wealth, Service Initiation) extends this gate with zero code
// changes here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { DOMAINS } from './domains.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function fail(domainId, msg) {
  console.error(`verify-spec-shape FAILED [${domainId}]:`, msg);
  process.exit(1);
}

const summaries = [];

for (const domain of DOMAINS) {
  const specPath = path.join(repoRoot, domain.specPath);
  if (!fs.existsSync(specPath)) fail(domain.id, `missing vendored spec: ${domain.specPath}`);
  const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));

  if (!spec.openapi) fail(domain.id, 'missing top-level `openapi` version');
  if (!spec.info?.version) fail(domain.id, 'missing info.version');
  if (!spec.paths || typeof spec.paths !== 'object') fail(domain.id, 'missing or invalid `paths`');
  if (!spec.components?.schemas) fail(domain.id, 'missing components.schemas');
  if (!Array.isArray(domain.inScopePaths) || domain.inScopePaths.length === 0) {
    fail(domain.id, 'domains.config.mjs entry has no inScopePaths — nothing to gate');
  }

  for (const p of domain.inScopePaths) {
    const item = spec.paths[p];
    if (!item) fail(domain.id, `missing required path: ${p}`);
    if (!item.get) fail(domain.id, `required path missing GET: ${p}`);
    const r = item.get.responses?.['200'];
    if (!r) fail(domain.id, `required path missing 200 response: ${p}`);
    // Either an inline schema or a $ref-to-response is acceptable.
    if (!r.$ref && !r.content?.['application/json']?.schema) {
      fail(domain.id, `required path missing JSON schema for 200: ${p}`);
    }
  }

  summaries.push(
    `${domain.id}: openapi=${spec.openapi} version=${spec.info.version} ` +
      `paths=${Object.keys(spec.paths).length} inScope=${domain.inScopePaths.length}`,
  );
}

console.log(`verify-spec-shape OK — ${summaries.join(' | ')}`);
