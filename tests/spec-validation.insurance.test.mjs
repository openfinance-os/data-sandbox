// EXP-10 acceptance for the Insurance domain — Phase 2.0 Motor MVP.
// Runs the motor persona × 3 LFI profiles × 3 motor endpoints through AJV
// against the parsed v2.1-errata1 insurance schemas. Mirrors the banking
// spec-validation test, scoped to the 3 motor endpoints in
// tools/domains.config.mjs.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildBundle } from '../src/generator/index.js';
import { loadPersonasByDomain, loadAllPools, repoRoot } from '../tools/load-fixtures.mjs';

const SPEC_PATH = path.join(repoRoot, 'spec/uae-insurance-openapi.yaml');
const PARSED_PATH = path.join(repoRoot, 'dist/SPEC.insurance.json');

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
      if (node.nullable === true && typeof node.type === 'string') {
        node.type = [node.type, 'null'];
      }
      delete node.nullable;
      if (node.exclusiveMinimum === true && typeof node.minimum === 'number') {
        node.exclusiveMinimum = node.minimum;
        delete node.minimum;
      }
      if (node.exclusiveMaximum === true && typeof node.maximum === 'number') {
        node.exclusiveMaximum = node.maximum;
        delete node.maximum;
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

const baseLinks = (endpointSuffix) => ({
  Self: `https://example.test/open-finance/insurance/v2.1/${endpointSuffix}`,
});
const baseMeta = () => ({ TotalPages: 1 });

const PROFILES = ['rich', 'median', 'sparse'];

describe('insurance spec validation — Motor MVP (3 endpoints × persona × LFI)', () => {
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
  const parsed = JSON.parse(fs.readFileSync(PARSED_PATH, 'utf8'));
  const personas = loadPersonasByDomain('insurance');
  const pools = loadAllPools();
  const validators = Object.fromEntries(
    Object.entries(parsed.endpoints).map(([p, e]) => [p, compileSchema(spec, e.schemaRef)])
  );

  function envelopeFor(endpoint, bundle) {
    switch (endpoint) {
      case '/motor-insurance-policies':
        return {
          Data: { Policies: bundle.motorPolicySummaries },
          Links: baseLinks('motor-insurance-policies'),
          Meta: baseMeta(),
        };
      case '/motor-insurance-policies/{InsurancePolicyId}': {
        const policy = bundle.motorPolicies[0];
        return {
          Data: policy,
          Links: baseLinks(`motor-insurance-policies/${policy.InsurancePolicyId}`),
          Meta: baseMeta(),
        };
      }
      case '/motor-insurance-policies/{InsurancePolicyId}/payment-details': {
        const policy = bundle.motorPolicies[0];
        return {
          Data: bundle.paymentDetails,
          Links: baseLinks(`motor-insurance-policies/${policy.InsurancePolicyId}/payment-details`),
          Meta: baseMeta(),
        };
      }
      default:
        return null;
    }
  }

  const endpoints = Object.keys(parsed.endpoints);
  const personaIds = Object.keys(personas);

  describe.each(personaIds)('persona=%s', (pid) => {
    const persona = personas[pid];
    describe.each(PROFILES)('LFI=%s', (lfi) => {
      const bundle = buildBundle({ persona, lfi, seed: 4729, pools });
      it.each(endpoints)('endpoint %s validates against v2.1-errata1 schema', (endpoint) => {
        const validate = validators[endpoint];
        const env = envelopeFor(endpoint, bundle);
        const ok = validate(env);
        if (!ok) {
          console.error(
            `${pid} ${lfi} ${endpoint} errors:`,
            JSON.stringify(validate.errors?.slice(0, 5), null, 2)
          );
        }
        expect(ok, `${pid} ${lfi} ${endpoint}`).toBe(true);
      });
    });
  });
});
