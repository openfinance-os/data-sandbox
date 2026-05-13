// Unit tests for the pagination helper and the curated / custom fixture
// handlers' pagination behaviour. Exercises the pure functions in-process
// — no Service Worker runtime needed.

import { describe, it, expect } from 'vitest';
import {
  paginateEnvelope,
  parsePaginationParams,
  isPaginatableEnvelope,
  findListKey,
  PAGINATION_DEFAULTS,
} from '../src/shared/pagination.js';
import {
  isCuratedFixtureUrl,
  isPaginatedRequest,
  handleCuratedFixtureRequest,
} from '../src/persona-builder/curated-fixture-handler.js';
import {
  isCustomFixtureUrl,
  handleCustomFixtureRequest,
} from '../src/persona-builder/fixture-handler.js';
import { encodeRecipe, recipeHash } from '../src/persona-builder/recipe.js';
import { loadAllPools } from '../tools/load-fixtures.mjs';

const txEnvelope = (count, accountId = 'acct-01') => ({
  Data: {
    AccountId: accountId,
    Transaction: Array.from({ length: count }, (_, i) => ({
      TransactionId: `tx-${String(i).padStart(4, '0')}`,
      BookingDateTime: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    })),
  },
  Links: { Self: 'https://x.test/transactions' },
  Meta: { TotalPages: 1 },
  _watermark: 'SYNTHETIC',
  _persona: 'demo',
});

describe('parsePaginationParams', () => {
  it('returns requested=false when neither offset nor limit is supplied', () => {
    const p = parsePaginationParams(new URL('https://x.test/q').searchParams);
    expect(p.requested).toBe(false);
    expect(p.offset).toBe(0);
    expect(p.limit).toBe(Infinity);
  });

  it('engages when offset OR limit is set', () => {
    expect(parsePaginationParams(new URL('https://x.test/q?offset=10').searchParams).requested).toBe(true);
    expect(parsePaginationParams(new URL('https://x.test/q?limit=5').searchParams).requested).toBe(true);
  });

  it('clamps limit to [1, maxLimit] and defaults offset to 0', () => {
    const p1 = parsePaginationParams(new URL('https://x.test/q?limit=99999').searchParams);
    expect(p1.limit).toBe(PAGINATION_DEFAULTS.maxLimit);
    const p2 = parsePaginationParams(new URL('https://x.test/q?limit=0').searchParams);
    expect(p2.limit).toBe(1);
    const p3 = parsePaginationParams(new URL('https://x.test/q?offset=-5&limit=10').searchParams);
    expect(p3.offset).toBe(0);
    expect(p3.limit).toBe(10);
  });

  it('falls back to defaultLimit when only offset is provided', () => {
    const p = parsePaginationParams(new URL('https://x.test/q?offset=50').searchParams);
    expect(p.requested).toBe(true);
    expect(p.limit).toBe(PAGINATION_DEFAULTS.defaultLimit);
  });
});

describe('findListKey / isPaginatableEnvelope', () => {
  it('detects the listable array under Data', () => {
    expect(findListKey(txEnvelope(3))).toBe('Transaction');
    expect(isPaginatableEnvelope(txEnvelope(3))).toBe(true);
  });

  it('returns null when Data is a single record', () => {
    const env = { Data: { Party: { PartyId: 'p1' } }, Links: {}, Meta: {} };
    expect(findListKey(env)).toBe(null);
    expect(isPaginatableEnvelope(env)).toBe(false);
  });

  it('handles /insurance-consents where Data is the array directly', () => {
    const env = { Data: [{ ConsentId: 'c1' }, { ConsentId: 'c2' }], Links: {}, Meta: {} };
    expect(findListKey(env)).toBe('__root__');
  });
});

describe('paginateEnvelope', () => {
  const REQ_URL = 'https://x.test/fixtures/v1/bundles/p/median/seed-1/accounts__acct-01__transactions.json';

  it('returns a shallow copy with refreshed Self when not requested', () => {
    const env = txEnvelope(60);
    const out = paginateEnvelope(env, {
      offset: 0, limit: Infinity, requested: false, requestUrl: REQ_URL,
    });
    expect(out.Data.Transaction).toHaveLength(60);
    expect(out.Links.Self).toBe(REQ_URL);
    expect(out.Meta.TotalPages).toBe(1);
    expect(out._pagination).toBeUndefined();
  });

  it('slices Data and emits First/Last/Next when on the first page', () => {
    const env = txEnvelope(60);
    const out = paginateEnvelope(env, { offset: 0, limit: 25, requested: true, requestUrl: REQ_URL });
    expect(out.Data.Transaction).toHaveLength(25);
    expect(out.Data.Transaction[0].TransactionId).toBe('tx-0000');
    expect(out.Meta.TotalPages).toBe(3);
    expect(out.Links.Self).toContain('offset=0&limit=25');
    expect(out.Links.First).toContain('offset=0&limit=25');
    expect(out.Links.Last).toContain('offset=50&limit=25');
    expect(out.Links.Next).toContain('offset=25&limit=25');
    expect(out.Links.Prev).toBeUndefined();
    expect(out._pagination).toEqual({
      offset: 0, limit: 25, totalRecords: 60, totalPages: 3,
      pageNumber: 1, hasNext: true, hasPrevious: false,
    });
  });

  it('emits Prev (no Next) on the last page', () => {
    const env = txEnvelope(60);
    const out = paginateEnvelope(env, { offset: 50, limit: 25, requested: true, requestUrl: REQ_URL });
    expect(out.Data.Transaction).toHaveLength(10);
    expect(out.Links.Next).toBeUndefined();
    expect(out.Links.Prev).toContain('offset=25&limit=25');
    expect(out._pagination.hasNext).toBe(false);
    expect(out._pagination.hasPrevious).toBe(true);
  });

  it('preserves Data sibling fields like AccountId across slicing', () => {
    const env = txEnvelope(10, 'acct-XYZ');
    const out = paginateEnvelope(env, { offset: 0, limit: 5, requested: true, requestUrl: REQ_URL });
    expect(out.Data.AccountId).toBe('acct-XYZ');
    expect(out.Data.Transaction).toHaveLength(5);
  });

  it('strips an existing ?offset=/?limit= before re-emitting Links', () => {
    const url = `${REQ_URL}?offset=999&limit=42`;
    const env = txEnvelope(30);
    const out = paginateEnvelope(env, { offset: 0, limit: 10, requested: true, requestUrl: url });
    expect(out.Links.Self.match(/offset=/g)).toHaveLength(1);
    expect(out.Links.Self).toContain('offset=0&limit=10');
  });

  it('handles empty arrays without dividing by zero', () => {
    const env = txEnvelope(0);
    const out = paginateEnvelope(env, { offset: 0, limit: 25, requested: true, requestUrl: REQ_URL });
    expect(out.Data.Transaction).toHaveLength(0);
    expect(out.Meta.TotalPages).toBe(1);
    expect(out.Links.Next).toBeUndefined();
  });

  it('paginates a root-array envelope (e.g. /insurance-consents)', () => {
    const env = {
      Data: Array.from({ length: 5 }, (_, i) => ({ ConsentId: `c${i}` })),
      Links: { Self: 'https://x.test/insurance-consents' },
      Meta: { TotalPages: 1 },
    };
    const out = paginateEnvelope(env, { offset: 2, limit: 2, requested: true, requestUrl: 'https://x.test/insurance-consents' });
    expect(Array.isArray(out.Data)).toBe(true);
    expect(out.Data).toHaveLength(2);
    expect(out.Data[0].ConsentId).toBe('c2');
  });
});

describe('curated-fixture-handler URL detection', () => {
  it('matches curated bundle paths', () => {
    expect(isCuratedFixtureUrl(
      'https://x.test/fixtures/v1/bundles/salaried_expat_mid/median/seed-4729/accounts.json'
    )).toBe(true);
  });

  it('excludes the custom-persona subtree', () => {
    expect(isCuratedFixtureUrl(
      'https://x.test/fixtures/v1/bundles/custom/abc/median/seed-1/accounts.json'
    )).toBe(false);
  });

  it('isPaginatedRequest only returns true with offset/limit', () => {
    expect(isPaginatedRequest('https://x.test/fixtures/v1/bundles/p/median/seed-1/x.json')).toBe(false);
    expect(isPaginatedRequest('https://x.test/fixtures/v1/bundles/p/median/seed-1/x.json?limit=10')).toBe(true);
    expect(isPaginatedRequest('https://x.test/fixtures/v1/bundles/p/median/seed-1/x.json?offset=5')).toBe(true);
  });
});

describe('handleCuratedFixtureRequest', () => {
  it('rejects requests that omit offset/limit (those fall through to the network in the SW)', async () => {
    const url = 'https://x.test/fixtures/v1/bundles/p/median/seed-1/accounts.json';
    const fetchJson = async () => txEnvelope(10);
    const res = await handleCuratedFixtureRequest(url, { fetchJson });
    expect(res.status).toBe(400);
  });

  it('fetches the static file once and slices the Data array', async () => {
    const url = 'https://x.test/fixtures/v1/bundles/p/median/seed-1/accounts__acct-01__transactions.json?offset=0&limit=10';
    let fetched = null;
    const fetchJson = async (u) => {
      fetched = u;
      return txEnvelope(100, 'acct-01');
    };
    const res = await handleCuratedFixtureRequest(url, { fetchJson });
    expect(res.status).toBe(200);
    // SW must fetch the bare static URL (no query) to bypass its own intercept.
    expect(fetched).toBe('https://x.test/fixtures/v1/bundles/p/median/seed-1/accounts__acct-01__transactions.json');
    const env = JSON.parse(res.body);
    expect(env.Data.Transaction).toHaveLength(10);
    expect(env.Meta.TotalPages).toBe(10);
    expect(env.Links.Next).toContain('offset=10&limit=10');
    expect(env._pagination.totalRecords).toBe(100);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('reports upstream failures as 502', async () => {
    const url = 'https://x.test/fixtures/v1/bundles/p/median/seed-1/x.json?limit=5';
    const fetchJson = async () => { throw new Error('boom'); };
    const res = await handleCuratedFixtureRequest(url, { fetchJson });
    expect(res.status).toBe(502);
  });
});

describe('handleCustomFixtureRequest — pagination', () => {
  const pools = loadAllPools();
  const recipe = { segment: 'SME', spend_intensity: 'high' };
  const encoded = encodeRecipe(recipe);
  const hash = recipeHash(recipe);

  it('returns the full envelope when no pagination params are supplied', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/${hash}/median/seed-7/accounts__AccountId__transactions.json?recipe=${encoded}`;
    const res = handleCustomFixtureRequest(url, { pools });
    expect(res.status).toBe(200);
    const env = JSON.parse(res.body);
    expect(env.Meta.TotalPages).toBe(1);
    expect(env._pagination).toBeUndefined();
  });

  it('slices the Data array and emits Links.Next when ?limit= is present', () => {
    const url = `https://x.test/fixtures/v1/bundles/custom/${hash}/median/seed-7/accounts__AccountId__transactions.json?recipe=${encoded}&limit=5&offset=0`;
    const res = handleCustomFixtureRequest(url, { pools });
    expect(res.status).toBe(200);
    const env = JSON.parse(res.body);
    expect(env.Data.Transaction.length).toBeLessThanOrEqual(5);
    expect(env._pagination.limit).toBe(5);
    if (env._pagination.totalRecords > 5) {
      expect(env.Links.Next).toMatch(/offset=5/);
    }
  });
});
