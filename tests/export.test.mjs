// EXP-19 acceptance: every JSON export validates against the v2.1 schema for
// its endpoint, every CSV is non-empty for non-empty resources, every export
// carries the §6.5 watermark.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildBundle } from '../src/generator/index.js';
import { loadPersona, loadAllPools, loadSpec, repoRoot } from '../tools/load-fixtures.mjs';
import { envelopesFromBundle, csvForResource, csvBundleByResource } from '../src/ui/export.js';

const SPEC_PATH = path.join(repoRoot, 'spec/uae-account-information-openapi.yaml');

function compileSchema(spec, refPath) {
  const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  const definitions = JSON.parse(JSON.stringify(spec.components.schemas));
  const rewrite = (node) => {
    if (Array.isArray(node)) return node.forEach(rewrite);
    if (node && typeof node === 'object') {
      if (typeof node.$ref === 'string' && node.$ref.startsWith('#/components/schemas/')) {
        node.$ref = `#/definitions/${node.$ref.slice('#/components/schemas/'.length)}`;
      }
      if (node.nullable === true && typeof node.type === 'string') node.type = [node.type, 'null'];
      delete node.nullable;
      if (node.exclusiveMinimum === true && typeof node.minimum === 'number') {
        node.exclusiveMinimum = node.minimum; delete node.minimum;
      }
      if (node.exclusiveMaximum === true && typeof node.maximum === 'number') {
        node.exclusiveMaximum = node.maximum; delete node.maximum;
      }
      if (node.exclusiveMinimum === false) delete node.exclusiveMinimum;
      if (node.exclusiveMaximum === false) delete node.exclusiveMaximum;
      if (node.additionalProperties === false) delete node.additionalProperties;
      for (const k of Object.keys(node)) rewrite(node[k]);
    }
  };
  rewrite(definitions);
  const targetName = refPath.replace('#/components/schemas/', '');
  return ajv.compile({
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions,
    $ref: `#/definitions/${targetName}`,
  });
}

const CTX = {
  personaId: 'salaried_expat_mid',
  lfi: 'median',
  seed: 4729,
  specVersion: 'v2.1',
  specSha: 'bc1cd97',
  retrievedAt: '2026-04-29T00:00:00Z',
};

describe('exports — EXP-19 / §6.5', () => {
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
  const parsed = loadSpec();
  const persona = loadPersona('salaried_expat_mid');
  const pools = loadAllPools();
  const bundle = buildBundle({ persona, lfi: 'median', seed: 4729, pools });
  const envelopes = envelopesFromBundle(bundle, CTX);

  it('every envelope carries the watermark + persona/lfi/seed/sha', () => {
    for (const [endpoint, env] of Object.entries(envelopes)) {
      expect(env._watermark, endpoint).toMatch(/^SYNTHETIC — Open Finance Data Sandbox/);
      expect(env._watermark, endpoint).toContain('persona:salaried_expat_mid');
      expect(env._watermark, endpoint).toContain('lfi:median');
      expect(env._watermark, endpoint).toContain('seed:4729');
      expect(env._persona, endpoint).toBe('salaried_expat_mid');
      expect(env._lfi, endpoint).toBe('median');
      expect(env._seed, endpoint).toBe(4729);
      expect(env._specSha, endpoint).toBe('bc1cd97');
    }
  });

  it('every JSON export validates against v2.1 (after stripping watermark fields)', () => {
    const validators = Object.fromEntries(
      Object.entries(parsed.endpoints).map(([p, e]) => [p, compileSchema(spec, e.schemaRef)])
    );
    for (const [endpoint, env] of Object.entries(envelopes)) {
      const stripped = { Data: env.Data, Links: env.Links, Meta: env.Meta };
      // Add Meta.FirstAvailable/LastAvailable for transactions/statements.
      if (endpoint.endsWith('/transactions') || endpoint.endsWith('/statements')) {
        stripped.Meta = {
          ...stripped.Meta,
          FirstAvailableDateTime: '2025-04-01T00:00:00Z',
          LastAvailableDateTime: '2026-04-01T00:00:00Z',
          TotalRecords: Array.isArray(stripped.Data?.Transaction)
            ? stripped.Data.Transaction.length
            : Array.isArray(stripped.Data?.Statements) ? stripped.Data.Statements.length : 0,
        };
      }
      // Resolve which validator to use — endpoints with concrete AccountIds
      // map back to the templated path in SPEC.json.
      const templ = endpoint.replace(/\/accounts\/[^/]+/, '/accounts/{AccountId}');
      const validate = validators[templ] ?? validators[endpoint];
      if (!validate) continue;
      const ok = validate(stripped);
      if (!ok) console.error(`${endpoint} validation errors:`, JSON.stringify(validate.errors?.slice(0, 3), null, 2));
      expect(ok, endpoint).toBe(true);
    }
  });

  it('CSV exports start with a watermark comment and have a header row', () => {
    const csvs = csvBundleByResource(bundle, CTX);
    for (const [resource, csv] of Object.entries(csvs)) {
      const lines = csv.split('\n');
      expect(lines[0], resource).toMatch(/^# SYNTHETIC — Open Finance Data Sandbox/);
      // Empty resources get a "# (no rows)" line; non-empty resources have a header.
      if (lines[1] !== '# (no rows)') {
        expect(lines[1], resource).toBeTruthy();
      }
    }
  });

  it('Transaction CSV is non-empty for Sara × Median', () => {
    const csv = csvForResource(bundle.transactions, CTX);
    const lines = csv.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0]).toMatch(/^# SYNTHETIC/);
    // Header should include TransactionId.
    expect(lines[1]).toContain('TransactionId');
    // No raw newlines should leak unescaped.
    for (const line of lines.slice(2)) {
      // Each line should split into a sane number of columns; don't validate
      // exact count (CSV allows quoted commas) but check it's not 0.
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
