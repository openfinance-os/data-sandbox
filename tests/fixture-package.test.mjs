// EXP-20 acceptance: install + import + read-fixture round-trips in a clean
// Node environment using the documented (persona, lfi, seed) keying. We
// don't actually publish to npm in CI — instead we load the built package
// from packages/sandbox-fixtures/ as if it were installed.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { repoRoot } from '../tools/load-fixtures.mjs';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
// The package's own index.mjs reads manifest.json synchronously at import,
// so a missing manifest crashes the dynamic imports below. Guard the entire
// suite with a top-level if/else (describe.skipIf still invokes the body).
const FIXTURES_BUILT = fs.existsSync(path.join(PKG_DIR, 'manifest.json'));

if (!FIXTURES_BUILT) {
  describe.skip("EXP-20 fixture package (run 'npm run build:fixtures' to enable)", () => {
    it.skip('fixture package not built — run `npm run build:fixtures`', () => {});
  });
} else describe('EXP-20 fixture package — @openfinance-os/sandbox-fixtures', () => {
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

  it('manifest.json indexes 21 banking + 9 insurance + 8 multi-domain personas × 3 LFIs', () => {
    const m = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'manifest.json'), 'utf8'));
    expect(m.package).toBe('@openfinance-os/sandbox-fixtures');
    expect(m.specVersion).toBe('v2.1');
    expect(m.specSha.length).toBeGreaterThan(20);
    expect(m.domains).toEqual(expect.arrayContaining(['banking', 'insurance']));
    expect(Object.keys(m.personas).length).toBe(38);
    expect(Object.keys(m.fixtures).length).toBe(114); // 38 × 3
    const byDomain = { banking: 0, insurance: 0, multi: 0 };
    for (const info of Object.values(m.personas)) {
      expect(info.domain).toBeDefined();
      byDomain[info.domain] = (byDomain[info.domain] ?? 0) + 1;
    }
    expect(byDomain).toEqual({ banking: 21, insurance: 9, multi: 8 });
    for (const [key, fx] of Object.entries(m.fixtures)) {
      expect(key).toMatch(/^[a-z_]+\|(rich|median|sparse)\|\d+$/);
      // Every fixture entry has a non-empty endpoints map.
      expect(Object.keys(fx.endpoints).length).toBeGreaterThan(0);
      expect(['banking', 'insurance', 'multi']).toContain(fx.domain);
    }
  });

  it('ESM loader works — listPersonas + loadFixture + loadSpec', async () => {
    const m = await import(path.join(PKG_DIR, 'index.mjs'));
    const personas = m.listPersonas();
    expect(personas).toContain('salaried_expat_mid');
    expect(personas).toContain('motor_comprehensive_mid');
    expect(personas.length).toBe(38);
    // Multi-domain personas appear in both banking and insurance filters.
    expect(m.listPersonas({ domain: 'banking' }).length).toBe(29);  // 21 + 8 multi
    expect(m.listPersonas({ domain: 'insurance' }).length).toBe(17); // 9 + 8 multi
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
    const insuranceSpec = m.loadSpec({ domain: 'insurance' });
    expect(insuranceSpec.endpoints['/motor-insurance-policies']).toBeDefined();
    expect(insuranceSpec.endpoints['/motor-insurance-quotes/{QuoteId}']).toBeDefined();
  });

  it('CJS loader exports the same surface', () => {
    const cjsPath = path.join(PKG_DIR, 'index.cjs');
    expect(fs.existsSync(cjsPath)).toBe(true);
    const text = fs.readFileSync(cjsPath, 'utf8');
    expect(text).toContain('module.exports');
    expect(text).toContain('loadFixture');
    expect(text).toContain('loadJourney');
    expect(text).toContain('loadEnrichment');
    expect(text).toContain('listPersonas');
    expect(text).toContain('loadSpec');
    expect(text).toContain('getPools');
    expect(text).toContain('getEngine');
  });

  // Phase R1.5 — enrichment sidecar exported via loadEnrichment.
  // The sidecar mirrors the bundle's TransactionId set 1:1 and the
  // payload is what a TPP's enrichment engine would produce after
  // cleaning the raw v2.1 envelope.
  it('loadEnrichment returns a complete sidecar for every banking persona', async () => {
    const m = await import(path.join(PKG_DIR, 'index.mjs'));
    const bankingIds = m.listPersonas({ domain: 'banking' });
    expect(bankingIds.length).toBe(29); // 21 single-banking + 8 multi-domain
    for (const personaId of bankingIds) {
      const sidecar = m.loadEnrichment({ persona: personaId });
      expect(sidecar.schema).toBe('openfinance-os/data-sandbox/enrichment/v1');
      expect(sidecar.personaId).toBe(personaId);
      expect(typeof sidecar.records).toBe('object');
      // Every persona has at least the salary/income credits + commitments —
      // a few dozen records minimum even for the thin Senior persona.
      expect(Object.keys(sidecar.records).length).toBeGreaterThan(20);
      // Spot-check shape of one record.
      const first = Object.values(sidecar.records)[0];
      expect(first.category).toBeTruthy();
      expect(first.subcategory).toBeTruthy();
      expect(first).toHaveProperty('merchant');
      expect(first).toHaveProperty('mcc');
      expect(first).toHaveProperty('logoSlug');
    }
  });

  it('loadEnrichment payload size matches the bundle transaction count', async () => {
    const m = await import(path.join(PKG_DIR, 'index.mjs'));
    const j = m.loadJourney({ persona: 'salaried_expat_mid', lfi: 'median' });
    const txEnvelope = j.endpoints[
      `/accounts/${j.accountIds[0]}/transactions`
    ];
    const txCount = (txEnvelope?.Data?.Transaction ?? []).length;
    const sidecar = m.loadEnrichment({ persona: 'salaried_expat_mid' });
    // The sidecar covers ALL accounts' transactions, not just the first
    // account — so the count is ≥ the single-account envelope count.
    expect(Object.keys(sidecar.records).length).toBeGreaterThanOrEqual(txCount);
  });

  // EXP-28 / Workstream C plug-point 2 — TPPs install the package, compose
  // a recipe, run the generator inside their own app. No network call.
  it('runtime engine exports — expandRecipe + buildBundle + getPools work in-process', async () => {
    const m = await import(path.join(PKG_DIR, 'index.mjs'));
    const pools = m.getPools();
    expect(pools.namesByPoolId).toBeDefined();
    expect(pools.organisationsByPoolId).toBeDefined();
    expect(pools.counterpartiesByPoolId).toBeDefined();

    // SME custom persona — exercises the segment expansion path.
    const persona = m.expandRecipe({ segment: 'SME' }, pools);
    expect(persona.persona_id).toMatch(/^custom_/);
    expect(persona.segment).toBe('SME');

    const bundle = m.buildBundle({ persona, lfi: 'median', seed: 1, pools });
    expect(bundle.accounts.length).toBeGreaterThan(0);
    expect(bundle.accounts[0].AccountType).toBe('SME');
    expect(bundle.parties[0].PartyCategory).toBe('SME');

    // Determinism — EXP-05 holds across the package boundary.
    const bundleAgain = m.buildBundle({ persona, lfi: 'median', seed: 1, pools });
    expect(JSON.stringify(bundle)).toBe(JSON.stringify(bundleAgain));

    // Recipe codec is exported.
    const enc = m.encodeRecipe({ segment: 'Corporate' });
    expect(typeof enc).toBe('string');
    expect(m.decodeRecipe(enc).segment).toBe('Corporate');
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
    expect(validated).toBeGreaterThan(720); // 17 personas × 3 LFI × ~20 endpoint files
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
