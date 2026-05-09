// EXP-10 acceptance for the Insurance domain — Phase 2.0 (Motor) + 2.1 (+Home).
// Runs each insurance persona × 3 LFI profiles × the 4 endpoints in the
// persona's line through AJV against the parsed v2.1-errata1 insurance
// schemas. The persona's `line` discriminator (motor|home) selects which
// endpoint subset applies; bundles for the other line are absent in that
// persona's bundle so we skip the inapplicable endpoints.

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
  // The UAE Insurance v2.1 spec uses an OpenAPI-style `format: decimal` on
  // percentage / VAT-percentage schemas. ajv-formats doesn't ship it; register
  // a permissive checker so AJV doesn't log "unknown format" warnings on every
  // compile. Range / precision is already enforced by the schema's `pattern`.
  ajv.addFormat('decimal', { type: 'string', validate: () => true });

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

describe('insurance spec validation — endpoints × persona × LFI', () => {
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
  const parsed = JSON.parse(fs.readFileSync(PARSED_PATH, 'utf8'));
  const personas = loadPersonasByDomain('insurance');
  const pools = loadAllPools();
  const validators = Object.fromEntries(
    Object.entries(parsed.endpoints).map(([p, e]) => [p, compileSchema(spec, e.schemaRef)])
  );

  // Per-line endpoint sets — each persona only emits envelopes for its line.
  const ENDPOINTS_BY_LINE = {
    motor: [
      '/motor-insurance-policies',
      '/motor-insurance-policies/{InsurancePolicyId}',
      '/motor-insurance-policies/{InsurancePolicyId}/payment-details',
      '/motor-insurance-quotes/{QuoteId}',
    ],
    home: [
      '/home-insurance-policies',
      '/home-insurance-policies/{InsurancePolicyId}',
      '/home-insurance-policies/{InsurancePolicyId}/payment-details',
      '/home-insurance-quotes/{QuoteId}',
    ],
    health: [
      '/health-insurance-policies',
      '/health-insurance-policies/{InsurancePolicyId}',
      '/health-insurance-policies/{InsurancePolicyId}/payment-details',
      '/health-insurance-quotes/{QuoteId}',
    ],
  };

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
      case '/motor-insurance-quotes/{QuoteId}': {
        const quote = bundle.motorQuote;
        return {
          Data: quote,
          Links: baseLinks(`motor-insurance-quotes/${quote.QuoteId}`),
          Meta: baseMeta(),
        };
      }
      case '/home-insurance-policies':
        return {
          Data: { Policies: bundle.homePolicySummaries },
          Links: baseLinks('home-insurance-policies'),
          Meta: baseMeta(),
        };
      case '/home-insurance-policies/{InsurancePolicyId}': {
        const policy = bundle.homePolicies[0];
        return {
          Data: policy,
          Links: baseLinks(`home-insurance-policies/${policy.InsurancePolicyId}`),
          Meta: baseMeta(),
        };
      }
      case '/home-insurance-policies/{InsurancePolicyId}/payment-details': {
        const policy = bundle.homePolicies[0];
        return {
          Data: bundle.paymentDetails,
          Links: baseLinks(`home-insurance-policies/${policy.InsurancePolicyId}/payment-details`),
          Meta: baseMeta(),
        };
      }
      case '/home-insurance-quotes/{QuoteId}': {
        const quote = bundle.homeQuote;
        return {
          Data: quote,
          Links: baseLinks(`home-insurance-quotes/${quote.QuoteId}`),
          Meta: baseMeta(),
        };
      }
      case '/health-insurance-policies':
        return {
          Data: { Policies: bundle.healthPolicySummaries },
          Links: baseLinks('health-insurance-policies'),
          Meta: baseMeta(),
        };
      case '/health-insurance-policies/{InsurancePolicyId}': {
        const policy = bundle.healthPolicies[0];
        return {
          Data: policy,
          Links: baseLinks(`health-insurance-policies/${policy.InsurancePolicyId}`),
          Meta: baseMeta(),
        };
      }
      case '/health-insurance-policies/{InsurancePolicyId}/payment-details': {
        const policy = bundle.healthPolicies[0];
        return {
          Data: bundle.paymentDetails,
          Links: baseLinks(`health-insurance-policies/${policy.InsurancePolicyId}/payment-details`),
          Meta: baseMeta(),
        };
      }
      case '/health-insurance-quotes/{QuoteId}': {
        const quote = bundle.healthQuote;
        return {
          Data: quote,
          Links: baseLinks(`health-insurance-quotes/${quote.QuoteId}`),
          Meta: baseMeta(),
        };
      }
      default:
        return null;
    }
  }

  const personaIds = Object.keys(personas);

  describe.each(personaIds)('persona=%s', (pid) => {
    const persona = personas[pid];
    const line = persona.line ?? 'motor';
    const endpoints = ENDPOINTS_BY_LINE[line];
    describe.each(PROFILES)('LFI=%s', (lfi) => {
      const bundle = buildBundle({ persona, lfi, seed: persona.default_seed, pools });
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
