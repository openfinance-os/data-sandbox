#!/usr/bin/env node
// CI gate — fails loudly if the vendored OpenAPI YAML's structure changes
// shape unexpectedly between pinned-SHA bumps (R-EXP-08). Catches things like
// a removed endpoint, a renamed schema-ref pattern, or a fundamental change
// in how `responses` is encoded.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SPEC_PATH = path.join(repoRoot, 'spec/uae-account-information-openapi.yaml');

const REQUIRED_PATHS = [
  '/accounts',
  '/accounts/{AccountId}',
  '/accounts/{AccountId}/balances',
  '/accounts/{AccountId}/transactions',
  '/accounts/{AccountId}/standing-orders',
  '/accounts/{AccountId}/direct-debits',
  '/accounts/{AccountId}/beneficiaries',
  '/accounts/{AccountId}/scheduled-payments',
  '/accounts/{AccountId}/product',
  '/accounts/{AccountId}/parties',
  '/parties',
  '/accounts/{AccountId}/statements',
];

function fail(msg) {
  console.error('verify-spec-shape FAILED:', msg);
  process.exit(1);
}

const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));

if (!spec.openapi) fail('missing top-level `openapi` version');
if (!spec.info?.version) fail('missing info.version');
if (!spec.paths || typeof spec.paths !== 'object') fail('missing or invalid `paths`');
if (!spec.components?.schemas) fail('missing components.schemas');

for (const p of REQUIRED_PATHS) {
  const item = spec.paths[p];
  if (!item) fail(`missing required path: ${p}`);
  if (!item.get) fail(`required path missing GET: ${p}`);
  const r = item.get.responses?.['200'];
  if (!r) fail(`required path missing 200 response: ${p}`);
  // Either an inline schema or a $ref-to-response is acceptable.
  if (!r.$ref && !r.content?.['application/json']?.schema) {
    fail(`required path missing JSON schema for 200: ${p}`);
  }
}

console.log(`verify-spec-shape OK — openapi=${spec.openapi}, version=${spec.info.version}, paths=${Object.keys(spec.paths).length}`);
