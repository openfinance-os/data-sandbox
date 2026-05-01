// EXP-28..EXP-31 staging contract — verifies the build:site pipeline lays
// out _site/ in the shape the integration guide and the worked example
// promise to TPP integrators. If this test fails after a stage-site.mjs
// change, the integration guide URLs / example fetches will 404 in prod.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../tools/load-fixtures.mjs';

const SITE = path.join(repoRoot, '_site');

function need(rel) {
  const p = path.join(SITE, rel);
  return { p, exists: fs.existsSync(p) };
}

beforeAll(() => {
  if (!fs.existsSync(path.join(SITE, 'src/index.html'))) {
    throw new Error("_site not staged — run 'npm run build:site' first");
  }
});

describe('EXP-28..EXP-31 staging contract', () => {
  it('integration guide files are staged (EXP-31)', () => {
    expect(need('src/integrate.html').exists, 'integrate.html').toBe(true);
    expect(need('src/integrate.js').exists, 'integrate.js').toBe(true);
    const html = fs.readFileSync(need('src/integrate.html').p, 'utf8');
    // Top-bar nav linkage from the sandbox.
    const indexHtml = fs.readFileSync(need('src/index.html').p, 'utf8');
    expect(indexHtml).toContain('href="integrate.html"');
    // Disclaimer is in the page.
    expect(html).toMatch(/Not endorsed by[\s\S]*Nebras/);
    // All four plug points are documented.
    expect(html).toMatch(/Path 1.*iframe/);
    expect(html).toMatch(/Path 2.*npm/);
    expect(html).toMatch(/Path 3.*PyPI/);
    expect(html).toMatch(/Path 4.*raw/);
  });

  it('worked example is staged at /examples/tpp-budgeting-demo/', () => {
    expect(need('examples/tpp-budgeting-demo/index.html').exists).toBe(true);
    expect(need('examples/tpp-budgeting-demo/app.js').exists).toBe(true);
    expect(need('examples/tpp-budgeting-demo/README.md').exists).toBe(true);
    expect(need('examples/tpp-budgeting-demo/postman.json').exists).toBe(true);
  });

  it('raw HTTPS fixture URLs are staged at /fixtures/v1/ (EXP-28)', () => {
    expect(need('fixtures/v1/manifest.json').exists).toBe(true);
    expect(need('fixtures/v1/spec.json').exists).toBe(true);
    expect(need('fixtures/v1/index.json').exists).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(need('fixtures/v1/manifest.json').p, 'utf8'));
    expect(manifest.specVersion).toBe('v2.1');
    expect(Object.keys(manifest.personas).length).toBe(12);
    expect(Object.keys(manifest.fixtures).length).toBe(36);

    const index = JSON.parse(fs.readFileSync(need('fixtures/v1/index.json').p, 'utf8'));
    expect(index.lfiProfiles).toEqual(['rich', 'median', 'sparse']);
    expect(index.endpoints).toContain('/accounts');
    expect(index.endpoints).toContain('/parties');
    expect(index.endpoints.some((e) => e.includes('{AccountId}'))).toBe(true);
    expect(index.pin).toBe('manifest.json.version');
    expect(index.pathContract).toMatch(/\/fixtures\/v1\/bundles/);
  });

  it('the example\'s sample fetch chain resolves end-to-end against staged fixtures', () => {
    const persona = 'salaried_expat_mid';
    const lfi = 'median';
    const manifest = JSON.parse(fs.readFileSync(need('fixtures/v1/manifest.json').p, 'utf8'));
    const seed = manifest.personas[persona].default_seed;
    const base = `fixtures/v1/bundles/${persona}/${lfi}/seed-${seed}`;

    // /parties + /accounts (the demo's first parallel pair).
    const parties = JSON.parse(fs.readFileSync(need(`${base}/parties.json`).p, 'utf8'));
    expect(parties.Data?.Party?.PartyId).toBeTruthy();

    const accounts = JSON.parse(fs.readFileSync(need(`${base}/accounts.json`).p, 'utf8'));
    const ids = (accounts.Data?.Account ?? []).map((a) => a.AccountId);
    expect(ids.length).toBeGreaterThan(0);

    // Per-account chain (the demo's second parallel pair, per AccountId).
    for (const id of ids) {
      for (const suffix of ['balances', 'transactions', 'standing-orders']) {
        const file = need(`${base}/accounts__${id}__${suffix}.json`);
        expect(file.exists, `${base}/accounts__${id}__${suffix}.json`).toBe(true);
        const env = JSON.parse(fs.readFileSync(file.p, 'utf8'));
        expect(env.Data?.AccountId).toBe(id);
      }
    }
  });

  it('CORS + cache headers cover /fixtures/v1/* (EXP-28)', () => {
    const headers = fs.readFileSync(need('_headers').p, 'utf8');
    expect(headers).toMatch(/\/fixtures\/v1\/\*/);
    expect(headers).toMatch(/Access-Control-Allow-Origin: \*/);
    expect(headers).toMatch(/Cache-Control: public/);
  });

  it('TPP demo panel snippet patterns are exercised by url.js (EXP-30)', async () => {
    const url = await import('../src/url.js');
    const fixtureUrl = url.encodeFixtureUrl({
      origin: 'https://openfinance-os.org',
      personaId: 'salaried_expat_mid',
      lfi: 'median',
      seed: 4729,
      endpoint: '/accounts/{AccountId}/transactions',
    });
    // The same URL the panel offers in the curl row, modulo the origin.
    expect(fixtureUrl).toBe('https://openfinance-os.org/fixtures/v1/bundles/salaried_expat_mid/median/seed-4729/accounts__AccountId__transactions.json');
  });
});
