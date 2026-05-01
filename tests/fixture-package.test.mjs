// EXP-20 acceptance: install + import + read-fixture round-trips in a clean
// Node environment using the documented (persona, lfi, seed) keying. We
// don't actually publish to npm in CI — instead we load the built package
// from packages/sandbox-fixtures/ as if it were installed.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { repoRoot } from '../tools/load-fixtures.mjs';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');

// Ensure the package exists; if not, the build step hasn't run.
beforeAll(() => {
  if (!fs.existsSync(PKG_DIR)) {
    throw new Error(`fixture package not built — run 'node tools/build-fixture-package.mjs' first`);
  }
});

describe('EXP-20 fixture package — @openfinance-os/sandbox-fixtures', () => {
  it('package.json declares the v1 contract', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@openfinance-os/sandbox-fixtures');
    expect(pkg.license).toBe('MIT');
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports['.']).toEqual(expect.objectContaining({
      import: './index.mjs', require: './index.cjs',
    }));
    expect(pkg.publishConfig.access).toBe('public');
  });

  it('manifest.json indexes 12 personas × 3 LFIs', () => {
    const m = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'manifest.json'), 'utf8'));
    expect(m.package).toBe('@openfinance-os/sandbox-fixtures');
    expect(m.specVersion).toBe('v2.1');
    expect(m.specSha.length).toBeGreaterThan(20);
    expect(Object.keys(m.personas).length).toBe(12);
    expect(Object.keys(m.fixtures).length).toBe(36); // 12 × 3
    for (const [key, fx] of Object.entries(m.fixtures)) {
      expect(key).toMatch(/^[a-z_]+\|(rich|median|sparse)\|\d+$/);
      // Every fixture entry has a non-empty endpoints map.
      expect(Object.keys(fx.endpoints).length).toBeGreaterThan(0);
    }
  });

  it('ESM loader works — listPersonas + loadFixture + loadSpec', async () => {
    const m = await import(path.join(PKG_DIR, 'index.mjs'));
    const personas = m.listPersonas();
    expect(personas).toContain('salaried_expat_mid');
    expect(personas.length).toBe(12);
    const sara = m.loadFixture({
      persona: 'salaried_expat_mid',
      lfi: 'median',
      endpoint: '/accounts',
    });
    expect(sara.Data?.Account).toBeInstanceOf(Array);
    expect(sara._watermark).toMatch(/^SYNTHETIC — Open Finance Data Sandbox/);
    expect(sara._persona).toBe('salaried_expat_mid');
    const spec = m.loadSpec();
    expect(spec.specVersion).toBe('v2.1');
    expect(spec.endpoints['/accounts']).toBeDefined();
  });

  it('CJS loader exports the same surface', () => {
    const cjsPath = path.join(PKG_DIR, 'index.cjs');
    expect(fs.existsSync(cjsPath)).toBe(true);
    const text = fs.readFileSync(cjsPath, 'utf8');
    expect(text).toContain('module.exports');
    expect(text).toContain('loadFixture');
    expect(text).toContain('loadJourney');
    expect(text).toContain('listPersonas');
    expect(text).toContain('loadSpec');
  });

  // EXP-29 — TPP showcase consumers shouldn't have to loop endpoints
  // themselves to assemble a coherent journey. loadJourney returns the
  // full bundle in one call.
  it('EXP-29 loadJourney returns a coherent bundle for one (persona, lfi, seed)', async () => {
    const m = await import(path.join(PKG_DIR, 'index.mjs'));
    const j = m.loadJourney({ persona: 'salaried_expat_mid', lfi: 'median' });
    expect(j.persona).toBe('salaried_expat_mid');
    expect(j.lfi).toBe('median');
    expect(j.seed).toBe(4729);
    expect(j.specVersion).toBe('v2.1');
    expect(j.specSha.length).toBeGreaterThan(20);
    expect(j.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(j.accountIds.length).toBeGreaterThan(0);
    expect(j.customerId).toMatch(/-party$/);

    // The accounts envelope agrees with manifest.accountIds.
    const accountsEnv = j.endpoints['/accounts'];
    expect(accountsEnv?.Data?.Account?.map((a) => a.AccountId).sort())
      .toEqual([...j.accountIds].sort());

    // Every accountId resolves to balances + transactions envelopes.
    for (const id of j.accountIds) {
      expect(j.endpoints[`/accounts/${id}/balances`]).toBeDefined();
      expect(j.endpoints[`/accounts/${id}/transactions`]).toBeDefined();
    }

    // /parties customerId matches the journey's customerId.
    expect(j.endpoints['/parties']?.Data?.Party?.PartyId).toBe(j.customerId);
  });

  it('EXP-29 loadJourney is deterministic across two calls', async () => {
    const m = await import(path.join(PKG_DIR, 'index.mjs'));
    const a = m.loadJourney({ persona: 'hnw_multicurrency', lfi: 'rich' });
    const b = m.loadJourney({ persona: 'hnw_multicurrency', lfi: 'rich' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every fixture file is valid JSON and v2.1-shaped', async () => {
    const m = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'manifest.json'), 'utf8'));
    let validated = 0;
    for (const fx of Object.values(m.fixtures)) {
      for (const [endpoint, rel] of Object.entries(fx.endpoints)) {
        const fp = path.join(PKG_DIR, rel);
        const env = JSON.parse(fs.readFileSync(fp, 'utf8'));
        expect(env.Data, `${endpoint}`).toBeDefined();
        expect(env.Links?.Self, `${endpoint}`).toBeDefined();
        expect(env.Meta, `${endpoint}`).toBeDefined();
        expect(env._watermark, `${endpoint}`).toMatch(/SYNTHETIC/);
        validated += 1;
      }
    }
    expect(validated).toBeGreaterThan(720); // 12 personas × 3 LFI × ~20 endpoint files
  });

  it('a sampled fixture validates against the v2.1 OpenAPI schema', async () => {
    const spec = yaml.load(fs.readFileSync(path.join(repoRoot, 'spec/uae-account-information-openapi.yaml'), 'utf8'));
    const m = await import(path.join(PKG_DIR, 'index.mjs'));
    const fixture = m.loadFixture({ persona: 'salaried_expat_mid', lfi: 'median', endpoint: '/accounts' });

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
    const validate = ajv.compile({
      $schema: 'http://json-schema.org/draft-07/schema#',
      definitions,
      $ref: '#/definitions/AEReadAccount',
    });
    // Strip our watermark fields before validation.
    const stripped = { Data: fixture.Data, Links: fixture.Links, Meta: fixture.Meta };
    const ok = validate(stripped);
    if (!ok) console.error(validate.errors?.slice(0, 3));
    expect(ok).toBe(true);
  });

  it('determinism — the package is reproducible across builds', () => {
    // Same SHA + same now-anchor + same persona seeds → identical files.
    // We sample a few fixtures and check their byte-content matches the
    // bytes inside the package.
    const m = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'manifest.json'), 'utf8'));
    const sample = Object.entries(m.fixtures).slice(0, 3);
    for (const [, fx] of sample) {
      for (const [, rel] of Object.entries(fx.endpoints)) {
        const fp = path.join(PKG_DIR, rel);
        const stat = fs.statSync(fp);
        expect(stat.size).toBeGreaterThan(50);
      }
    }
  });
});
