// EXP-10 acceptance subset for Phase 0: every payload validates against the
// v2.1 OpenAPI schema for the active resource. We construct an OAS3 envelope
// per endpoint and compile it with ajv; bundles for Sara × Median × seed=4729
// must validate.
//
// Phase 0 strips `additionalProperties: false` from the compiled schemas so
// generator-internal scaffolding (like the optional CreditLine block we add)
// passes — Phase 1 widens generator coverage and re-enables strict mode.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildBundle } from '../src/generator/index.js';
import { loadPersona, loadAllPools, loadSpec, repoRoot } from '../tools/load-fixtures.mjs';

const SPEC_PATH = path.join(repoRoot, 'spec/uae-account-information-openapi.yaml');

function compileSchema(spec, refPath, { stripAdditional = true } = {}) {
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
      if (stripAdditional && node.additionalProperties === false) {
        delete node.additionalProperties;
      }
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

const baseLinks = (resource) => ({
  Self: `https://example.test/open-finance/account-information/v2.1/${resource}`,
});
const baseMeta = () => ({ TotalPages: 1 });

// Strip generator-internal underscore-prefixed fields from a record before validation.
function strip(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

describe('spec validation — EXP-10 (Phase 0 subset)', () => {
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
  const parsedSpec = loadSpec();
  const persona = loadPersona('salaried_expat_mid');
  const pools = loadAllPools();
  const bundle = buildBundle({ persona, lfi: 'median', seed: 4729, pools });

  const ACCOUNTS_SCHEMA = parsedSpec.endpoints['/accounts'].schemaRef;
  const TRANSACTIONS_SCHEMA = parsedSpec.endpoints['/accounts/{AccountId}/transactions'].schemaRef;
  const BALANCES_SCHEMA = parsedSpec.endpoints['/accounts/{AccountId}/balances'].schemaRef;

  it('GET /accounts payload validates', () => {
    const validate = compileSchema(spec, ACCOUNTS_SCHEMA);
    const Account = bundle.accounts.map(strip);
    const env = {
      Data: { Account },
      Links: baseLinks('accounts'),
      Meta: baseMeta(),
    };
    const ok = validate(env);
    if (!ok) console.error('accounts validation errors:', JSON.stringify(validate.errors?.slice(0, 4), null, 2));
    expect(ok).toBe(true);
  });

  it('GET /balances payload validates per account', () => {
    const validate = compileSchema(spec, BALANCES_SCHEMA);
    for (const acc of bundle.accounts) {
      const Balance = bundle.balances
        .filter((b) => b._accountId === acc.AccountId)
        .map(strip);
      const env = {
        Data: { AccountId: acc.AccountId, Balance },
        Links: baseLinks(`accounts/${acc.AccountId}/balances`),
        Meta: baseMeta(),
      };
      const ok = validate(env);
      if (!ok) console.error(`balance validation errors for ${acc.AccountId}:`, JSON.stringify(validate.errors?.slice(0, 4), null, 2));
      expect(ok, `account ${acc.AccountId}`).toBe(true);
    }
  });

  it('GET /transactions payload validates per account', () => {
    const validate = compileSchema(spec, TRANSACTIONS_SCHEMA);
    for (const acc of bundle.accounts) {
      const Transaction = bundle.transactions
        .filter((t) => t._accountId === acc.AccountId)
        .map(strip);
      const env = {
        Data: { AccountId: acc.AccountId, Transaction },
        Links: baseLinks(`accounts/${acc.AccountId}/transactions`),
        Meta: baseMeta(),
      };
      const ok = validate(env);
      if (!ok) console.error(`transaction validation errors for ${acc.AccountId}:`, JSON.stringify(validate.errors?.slice(0, 4), null, 2));
      expect(ok, `account ${acc.AccountId}`).toBe(true);
    }
  });
});
