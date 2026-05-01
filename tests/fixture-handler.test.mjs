// Unit tests for the custom-persona fixture handler — Workstream C
// plug-point 1. Exercises the handler in-process so the Service Worker
// itself doesn't need a browser runtime to be tested.

import { describe, it, expect } from 'vitest';
import {
  isCustomFixtureUrl,
  handleCustomFixtureRequest,
} from '../src/persona-builder/fixture-handler.js';
import { encodeRecipe, recipeHash } from '../src/persona-builder/recipe.js';
import { loadAllPools } from '../tools/load-fixtures.mjs';

describe('isCustomFixtureUrl', () => {
  it('matches the documented URL shape', () => {
    expect(isCustomFixtureUrl(
      'https://x.test/fixtures/v1/bundles/custom/abc/median/seed-1/accounts.json'
    )).toBe(true);
    expect(isCustomFixtureUrl(
      'https://x.test/fixtures/v1/bundles/custom/abc/rich/seed-42/accounts__custom-abc-acct-01__transactions.json'
    )).toBe(true);
  });

  it('rejects curated-persona URLs and arbitrary paths', () => {
    expect(isCustomFixtureUrl(
      'https://x.test/fixtures/v1/bundles/salaried_expat_mid/median/seed-4729/accounts.json'
    )).toBe(false);
    expect(isCustomFixtureUrl('https://x.test/api/something')).toBe(false);
  });
});

describe('handleCustomFixtureRequest', () => {
  const pools = loadAllPools();
  const recipe = { segment: 'SME' };
  const encoded = encodeRecipe(recipe);
  const hash = recipeHash(recipe);

  it('serves the /accounts envelope for an SME recipe', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/${hash}/median/seed-1/accounts.json?recipe=${encoded}`;
    const res = handleCustomFixtureRequest(url, { pools });
    expect(res.status).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    const env = JSON.parse(res.body);
    expect(env.Data.Account).toBeInstanceOf(Array);
    expect(env.Data.Account.length).toBeGreaterThan(0);
    expect(env.Data.Account[0].AccountType).toBe('SME');
    expect(env.Links.Self).toBeTypeOf('string');
  });

  it('serves /parties (calling user) with PartyCategory matching segment', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/${hash}/rich/seed-1/parties.json?recipe=${encoded}`;
    const res = handleCustomFixtureRequest(url, { pools });
    expect(res.status).toBe(200);
    const env = JSON.parse(res.body);
    expect(env.Data.Party.PartyCategory).toBe('SME');
  });

  it('resolves the /accounts/{AccountId}/transactions template form to the first account', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/${hash}/median/seed-1/accounts__AccountId__transactions.json?recipe=${encoded}`;
    const res = handleCustomFixtureRequest(url, { pools });
    expect(res.status).toBe(200);
    const env = JSON.parse(res.body);
    expect(env.Data.AccountId).toBeTypeOf('string');
    expect(env.Data.Transaction).toBeInstanceOf(Array);
  });

  it('rejects requests missing the recipe query', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/${hash}/median/seed-1/accounts.json`;
    const res = handleCustomFixtureRequest(url, { pools });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/recipe/);
  });

  it('rejects requests where recipe hash mismatches the path', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/wronghash/median/seed-1/accounts.json?recipe=${encoded}`;
    const res = handleCustomFixtureRequest(url, { pools });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/hash mismatch/);
  });

  it('returns 404 for an unknown filename', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/${hash}/median/seed-1/not_a_real_endpoint.json?recipe=${encoded}`;
    const res = handleCustomFixtureRequest(url, { pools });
    expect(res.status).toBe(404);
  });

  it('determinism: same URL + now anchor yields byte-identical body', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/${hash}/median/seed-1/accounts.json?recipe=${encoded}`;
    const now = new Date(Date.UTC(2026, 3, 1));
    const a = handleCustomFixtureRequest(url, { pools, now });
    const b = handleCustomFixtureRequest(url, { pools, now });
    expect(a.body).toBe(b.body);
  });
});
