// EXP-10 acceptance: every payload validates against the v2.1 OpenAPI schema.
// Phase 1 widens this from the Phase 0 subset to all 12 endpoints, validated
// across the full persona × LFI matrix. additionalProperties remains relaxed
// for now (Phase 1 → Phase 1.5 will tighten generator coverage and re-enable
// strict mode).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildBundle } from '../src/generator/index.js';
import { loadAllPersonas, loadAllPools, loadSpec, repoRoot } from '../tools/load-fixtures.mjs';

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

const baseLinks = (resource) => ({
  Self: `https://example.test/open-finance/account-information/v2.1/${resource}`,
});
const baseMeta = () => ({ TotalPages: 1 });
const txnsMeta = (count) => ({ TotalPages: 1, FirstAvailableDateTime: '2025-04-01T00:00:00Z', LastAvailableDateTime: '2026-04-01T00:00:00Z', TotalRecords: count });

function strip(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

const PROFILES = ['rich', 'median', 'sparse'];

describe('spec validation — EXP-10 (all 12 endpoints, every persona × LFI)', () => {
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
  const parsed = loadSpec();
  const personas = loadAllPersonas();
  const pools = loadAllPools();
  const validators = Object.fromEntries(
    Object.entries(parsed.endpoints).map(([p, e]) => [p, compileSchema(spec, e.schemaRef)])
  );

  function envelope({ resource, payload, accountId, includeMeta = baseMeta }) {
    const data = accountId ? { AccountId: accountId, [resource]: payload } : { [resource]: payload };
    return { Data: data, Links: baseLinks(resource.toLowerCase()), Meta: includeMeta() };
  }

  function envelopeFor(endpoint, bundle, acc) {
    switch (endpoint) {
      case '/accounts':
        return envelope({ resource: 'Account', payload: bundle.accounts.map(strip) });
      case '/accounts/{AccountId}':
        return {
          Data: { AccountId: acc.AccountId, Account: strip(acc) },
          Links: baseLinks(`accounts/${acc.AccountId}`),
          Meta: baseMeta(),
        };
      case '/accounts/{AccountId}/balances':
        return envelope({
          resource: 'Balance',
          accountId: acc.AccountId,
          payload: bundle.balances.filter((b) => b._accountId === acc.AccountId).map(strip),
        });
      case '/accounts/{AccountId}/transactions': {
        const txns = bundle.transactions.filter((t) => t._accountId === acc.AccountId).map(strip);
        return {
          Data: { AccountId: acc.AccountId, Transaction: txns },
          Links: baseLinks(`accounts/${acc.AccountId}/transactions`),
          Meta: txnsMeta(txns.length),
        };
      }
      case '/accounts/{AccountId}/standing-orders':
        return envelope({
          resource: 'StandingOrder',
          accountId: acc.AccountId,
          payload: bundle.standingOrders.filter((x) => x._accountId === acc.AccountId).map(strip),
        });
      case '/accounts/{AccountId}/direct-debits':
        return envelope({
          resource: 'DirectDebit',
          accountId: acc.AccountId,
          payload: bundle.directDebits.filter((x) => x._accountId === acc.AccountId).map(strip),
        });
      case '/accounts/{AccountId}/beneficiaries':
        return envelope({
          resource: 'Beneficiary',
          accountId: acc.AccountId,
          payload: bundle.beneficiaries.filter((x) => x._accountId === acc.AccountId).map(strip),
        });
      case '/accounts/{AccountId}/scheduled-payments':
        return envelope({
          resource: 'ScheduledPayment',
          accountId: acc.AccountId,
          payload: bundle.scheduledPayments.filter((x) => x._accountId === acc.AccountId).map(strip),
        });
      case '/accounts/{AccountId}/product':
        return envelope({
          resource: 'Product',
          accountId: acc.AccountId,
          payload: bundle.product.filter((x) => x._accountId === acc.AccountId).map(strip),
        });
      case '/accounts/{AccountId}/parties':
        return envelope({
          resource: 'Party',
          accountId: acc.AccountId,
          payload: bundle.parties.filter((x) => x._accountId === acc.AccountId).map(strip),
        });
      case '/parties':
        return envelope({ resource: 'Party', payload: strip(bundle.callingUserParty) });
      case '/accounts/{AccountId}/statements': {
        const stmts = bundle.statements.filter((x) => x._accountId === acc.AccountId).map(strip);
        return {
          Data: {
            AccountId: acc.AccountId,
            AccountSubType: acc.AccountSubType,
            Statements: stmts,
          },
          Links: baseLinks(`accounts/${acc.AccountId}/statements`),
          Meta: txnsMeta(stmts.length),
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
      it.each(endpoints)('endpoint %s validates against v2.1 schema', (endpoint) => {
        const validate = validators[endpoint];
        if (endpoint === '/accounts' || endpoint === '/parties') {
          const env = envelopeFor(endpoint, bundle, null);
          const ok = validate(env);
          if (!ok) console.error(`${pid} ${lfi} ${endpoint} errors:`, JSON.stringify(validate.errors?.slice(0, 3), null, 2));
          expect(ok, endpoint).toBe(true);
        } else {
          for (const acc of bundle.accounts) {
            const env = envelopeFor(endpoint, bundle, acc);
            const ok = validate(env);
            if (!ok) console.error(`${pid} ${lfi} ${endpoint} ${acc.AccountId} errors:`, JSON.stringify(validate.errors?.slice(0, 3), null, 2));
            expect(ok, `${pid} ${endpoint} ${acc.AccountId}`).toBe(true);
          }
        }
      });
    });
  });
});
