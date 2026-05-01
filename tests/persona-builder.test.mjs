// Custom Persona Builder unit tests — Workstream B.
// Covers: recipe encode/decode round-trip, expander → schema-valid persona,
// expander throws on unknown pool refs, expander+buildBundle is deterministic
// for the same (recipe, lfi, seed), generated bundle validates against the
// pinned v2.1-errata1 spec for sampled recipes across all three segments.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildBundle } from '../src/generator/index.js';
import {
  RECIPE_DEFAULTS,
  encodeRecipe,
  decodeRecipe,
  canonicalise,
  recipeHash,
  validateRecipe,
} from '../src/persona-builder/recipe.js';
import { expandRecipe } from '../src/persona-builder/expand.js';
import { loadAllPools, repoRoot } from '../tools/load-fixtures.mjs';

const SPEC_PATH = path.join(repoRoot, 'spec/uae-account-information-openapi.yaml');

const SAMPLE_RECIPES = [
  // Retail — minimal default
  { segment: 'Retail' },
  // Retail — affluent expat with credit card + mortgage
  {
    segment: 'Retail',
    name_pool: 'expat_indian',
    age_band: '39-50',
    income_band: 'affluent',
    products: ['CurrentAccount', 'CreditCard', 'Mortgage'],
    card_limit: 'high',
    spend_intensity: 'high',
    fx_activity: true,
  },
  // SME — Aurora-style trading business
  {
    segment: 'SME',
    name_pool: 'expat_arab',
    age_band: '39-50',
    income_band: 'mid',
    flag_payroll: false,
    products: ['CurrentAccount', 'Savings'],
    cash_flow_intensity: 'med',
    fx_activity: true,
    legal_name_pool: 'sme_mainland',
    signatory_pool: 'expat_arab',
    signatory_account_role: 'Principal',
    signatory_party_type: 'Sole',
  },
  // Corporate — large-cap
  {
    segment: 'Corporate',
    name_pool: 'emirati',
    age_band: '51-65',
    income_band: 'hnw',
    flag_payroll: false,
    products: ['CurrentAccount', 'Savings', 'Finance'],
    cash_flow_intensity: 'high',
    fx_activity: true,
    legal_name_pool: 'corporate_listed',
    signatory_pool: 'emirati',
    signatory_account_role: 'SeniorManagingOfficial',
    signatory_party_type: 'Joint',
  },
];

describe('recipe codec — Workstream B', () => {
  it('canonicalise strips defaults and sorts keys', () => {
    const c = canonicalise({ segment: 'Retail', name_pool: 'expat_indian' });
    // Both equal defaults → empty canonical form.
    expect(c).toEqual({});
  });

  it('canonicalise preserves non-default values', () => {
    const c = canonicalise({ segment: 'SME', cash_flow_intensity: 'high' });
    expect(c.segment).toBe('SME');
    expect(c.cash_flow_intensity).toBe('high');
    expect(c.name_pool).toBeUndefined();
  });

  it('encodeRecipe / decodeRecipe round-trip preserves dimensions', () => {
    for (const r of SAMPLE_RECIPES) {
      const encoded = encodeRecipe(r);
      const decoded = decodeRecipe(encoded);
      // Re-encoding the decoded recipe yields the same string (idempotent).
      expect(encodeRecipe(decoded)).toBe(encoded);
      // Dimension values survive the round-trip.
      for (const [k, v] of Object.entries(r)) {
        expect(decoded[k]).toEqual(v);
      }
    }
  });

  it('decodeRecipe is tolerant of malformed input', () => {
    expect(decodeRecipe('')).toEqual({ ...RECIPE_DEFAULTS });
    expect(decodeRecipe('not-base64-!!!')).toEqual({ ...RECIPE_DEFAULTS });
    expect(decodeRecipe(encodeRecipe('not an object'))).toEqual({ ...RECIPE_DEFAULTS });
  });

  it('recipeHash is stable and distinguishes recipes', () => {
    const h1 = recipeHash({ segment: 'Retail' });
    const h2 = recipeHash({ segment: 'SME' });
    const h1again = recipeHash({ segment: 'Retail', name_pool: 'expat_indian' }); // default
    expect(h1).not.toBe(h2);
    expect(h1).toBe(h1again);
    expect(h1).toMatch(/^[0-9a-z]+$/);
  });
});

describe('expandRecipe — Workstream B', () => {
  const pools = loadAllPools();

  it.each(SAMPLE_RECIPES)('produces a schema-shaped persona for $segment', (r) => {
    const persona = expandRecipe(r, pools);
    expect(persona.persona_id).toMatch(/^custom_/);
    expect(persona.domain).toBe('banking');
    expect(persona.segment).toBe(r.segment ?? 'Retail');
    expect(persona.demographics.nationality_pool).toBeTypeOf('string');
    expect(Array.isArray(persona.accounts)).toBe(true);
    expect(persona.accounts.length).toBeGreaterThan(0);
    if ((r.segment ?? 'Retail') !== 'Retail') {
      expect(persona.organisation.legal_name_pool).toBeTypeOf('string');
      expect(Array.isArray(persona.organisation.signatories)).toBe(true);
      expect(persona.organisation.signatories.length).toBeGreaterThan(0);
      expect(persona.cash_flow.customer_inflows.counterparty_pool).toBeTypeOf('string');
    }
  });

  it('throws on unknown pool refs', () => {
    expect(() =>
      expandRecipe({ segment: 'Retail', name_pool: 'pool_does_not_exist' }, pools)
    ).toThrow(/unknown/);
    expect(() =>
      expandRecipe(
        { segment: 'SME', legal_name_pool: 'no_such_org_pool' },
        pools
      )
    ).toThrow(/unknown/);
  });

  it('validateRecipe agrees with the expander on valid input', () => {
    for (const r of SAMPLE_RECIPES) {
      expect(validateRecipe(r, pools).ok).toBe(true);
    }
  });
});

describe('expander + buildBundle determinism — EXP-05 for custom personas', () => {
  const pools = loadAllPools();

  it.each(SAMPLE_RECIPES)('byte-identical bundle across two calls — $segment', (r) => {
    const persona = expandRecipe(r, pools);
    const a = buildBundle({ persona, lfi: 'median', seed: 4729, pools });
    const b = buildBundle({ persona, lfi: 'median', seed: 4729, pools });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different recipes yield different persona_ids and different bundles', () => {
    const a = expandRecipe({ segment: 'Retail' }, pools);
    const b = expandRecipe({ segment: 'SME' }, pools);
    expect(a.persona_id).not.toBe(b.persona_id);
    const bundleA = buildBundle({ persona: a, lfi: 'median', seed: 4729, pools });
    const bundleB = buildBundle({ persona: b, lfi: 'median', seed: 4729, pools });
    expect(bundleA.accounts[0].AccountType).toBe('Retail');
    expect(bundleB.accounts[0].AccountType).toBe('SME');
  });
});

describe('custom-persona spec validation — sampled recipe grid', () => {
  const pools = loadAllPools();
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));

  function compileFor(refPath) {
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

  function strip(rec) {
    const out = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k.startsWith('_')) continue;
      out[k] = v;
    }
    return out;
  }

  // Validate just the /accounts and /accounts/{AccountId}/parties endpoints
  // — these are the ones segment expansion most directly affects (AccountType
  // and PartyCategory). The full spec-validation grid for curated personas
  // already exercises every endpoint shape.
  const accountsValidator = compileFor('#/components/schemas/AEReadAccount');
  const partiesValidator = compileFor('#/components/schemas/AEReadParty2');

  it.each(SAMPLE_RECIPES)('custom persona for $segment validates /accounts + /parties', (r) => {
    const persona = expandRecipe(r, pools);
    const bundle = buildBundle({ persona, lfi: 'rich', seed: 4729, pools });
    const accountsEnv = {
      Data: { Account: bundle.accounts.map(strip) },
      Links: { Self: 'https://example.test/accounts' },
      Meta: { TotalPages: 1 },
    };
    expect(accountsValidator(accountsEnv), JSON.stringify(accountsValidator.errors)).toBe(true);

    for (const acc of bundle.accounts) {
      const partiesEnv = {
        Data: {
          AccountId: acc.AccountId,
          Party: bundle.parties.filter((p) => p._accountId === acc.AccountId).map(strip),
        },
        Links: { Self: `https://example.test/accounts/${acc.AccountId}/parties` },
        Meta: { TotalPages: 1 },
      };
      expect(partiesValidator(partiesEnv), JSON.stringify(partiesValidator.errors)).toBe(true);
    }
  });
});
