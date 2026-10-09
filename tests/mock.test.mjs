import { describe, it, expect, afterAll } from 'vitest';
import { createMockServer } from '../tools/mock-server.mjs';
import { encodeRecipe, RECIPE_DEFAULTS } from '../src/persona-builder/recipe.js';
import { loadFixture } from '@openfinance-os/sandbox-fixtures';
const server = createMockServer();
afterAll(() => new Promise((r) => server.close(r)));
describe('external HTTP harness', () => {
  it('serves curated/custom/role JSON and complete pagination; returns useful errors', async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const accounts = await fetch(`${base}/scenarios/salaried_expat_mid/accounts?seed=4729`).then(
      (r) => r.json(),
    );
    expect(accounts._scenario.referenceDate).toBe('2026-05-01T00:00:00.000Z');
    const id = accounts.Data.Account[0].AccountId;
    const route = `${base}/scenarios/salaried_expat_mid/accounts/${id}/transactions?limit=37`;
    let cursor,
      ids = [],
      count;
    do {
      const res = await fetch(route + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
      expect(res.headers.get('content-type')).toContain('application/json');
      const page = await res.json();
      ids.push(...page.Data.Transaction.map((t) => t.TransactionId));
      cursor = page._filter.nextCursor;
      count = page._filter.matched;
    } while (cursor);
    expect(ids.length).toBe(count);
    expect(new Set(ids).size).toBe(count);
    const empty = await fetch(route + '&case=empty').then((r) => r.json());
    expect(empty.Data.Transaction).toEqual([]);
    for (const [scenario, status] of [
      ['revoked', 403],
      ['expired', 403],
      ['missing-permission', 403],
      ['rate-limit', 429],
      ['temporary-failure', 503],
    ]) {
      const res = await fetch(route + `&case=${scenario}`);
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body._harness.authority).toBe('API Hub');
      expect(body.Data).toBeUndefined();
    }
    const missing = await fetch(`${base}/scenarios/salaried_expat_mid/nonexistent`);
    expect(missing.status).toBe(404);
    const role = await fetch(
      `${base}/scenarios/sme_rak_trading_emirati/accounts?role=secondary`,
    ).then((r) => r.json());
    const { _harness, ...canonicalRole } = role;
    expect(_harness.simulated).toBe(true);
    expect(canonicalRole).toEqual(
      loadFixture({
        persona: 'sme_rak_trading_emirati',
        lfi_role: 'secondary',
        endpoint: '/accounts',
      }),
    );
    const custom = await fetch(
      `${base}/scenarios/custom/accounts?recipe=${encodeRecipe(RECIPE_DEFAULTS)}&seed=9`,
    ).then((r) => r.json());
    expect(custom._scenario.personaId).toMatch(/^custom_/);
    expect(custom._scenario.recipeHash).toBeTruthy();
    expect(custom._scenario.seed).toBe(9);
    const short = await fetch(route + '&case=short-history&summary=true').then((r) => r.json());
    expect(short._summary.count).toBeLessThan(count);
    const optional = await fetch(
      `${base}/scenarios/salaried_expat_mid/accounts?case=optional-absence`,
    ).then((r) => r.json());
    expect(optional._scenario.lfi).toBe('sparse');
  });
});
