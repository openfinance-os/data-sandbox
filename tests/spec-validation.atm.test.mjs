// EXP-10 acceptance for the ATM Locator domain — Phase 2.3 GA.
// Runs the ATM directory bundle (one persona × 3 LFI profiles × the
// single `GET /atms` endpoint) through AJV against the parsed v2.1
// ATM schemas. Mandatory fields stay populated across all profiles;
// optional fields are profile-dependent but the envelope MUST always
// validate against `AEReadAtms1`.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildBundle } from '../src/generator/index.js';
import { envelopesFromBundle } from '../src/ui/export.js';
import { loadPersonasByDomain, loadAllPools, repoRoot } from '../tools/load-fixtures.mjs';

const SPEC_PATH = path.join(repoRoot, 'spec/uae-atm-openapi.yaml');
const PARSED_PATH = path.join(repoRoot, 'dist/SPEC.atm.json');

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
      // Strip OAS additionalProperties:false so the sandbox's envelope
      // wrapping (Links/Meta + _watermark, _persona, _lfi, etc.) doesn't
      // trip strict-object validation — same convention as the banking
      // and insurance spec-validation suites.
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

const PROFILES = ['rich', 'median', 'sparse'];

describe('atm spec validation — /atms × persona × LFI', () => {
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
  const parsed = JSON.parse(fs.readFileSync(PARSED_PATH, 'utf8'));
  const personas = loadPersonasByDomain('atm');
  const pools = loadAllPools();
  const now = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));
  const validators = Object.fromEntries(
    Object.entries(parsed.endpoints).map(([p, e]) => [p, compileSchema(spec, e.schemaRef)]),
  );

  // Sanity — at least one ATM persona is loaded.
  it('atm domain has at least one persona', () => {
    expect(Object.keys(personas).length).toBeGreaterThan(0);
  });

  for (const [personaId, persona] of Object.entries(personas)) {
    for (const lfi of PROFILES) {
      it(`${personaId} × ${lfi} × /atms validates`, () => {
        const seed = persona.default_seed ?? 1;
        const bundle = buildBundle({ persona, lfi, seed, pools, now });
        const envelopes = envelopesFromBundle(bundle, {
          personaId,
          lfi,
          seed,
          specVersions: { atm: parsed.specVersion },
          specSha: parsed.pinSha,
          retrievedAt: parsed.retrievedAt,
        });
        const env = envelopes['/atms'];
        expect(env).toBeTruthy();
        // Strip sandbox-internal underscore-prefixed keys before AJV —
        // same convention as the banking / insurance suites. `Data`
        // + `Meta` are the only spec-required keys.
        const { Data, Meta } = env;
        const wireOnly = { Data, Meta };
        const ok = validators['/atms'](wireOnly);
        if (!ok) {
          throw new Error(
            `AJV failures for ${personaId} × ${lfi}: ` +
              JSON.stringify(validators['/atms'].errors, null, 2),
          );
        }

        // Mandatory fields under every ATM record stay populated
        // across every LFI profile.
        for (const atm of Data) {
          expect(atm.LFIId).toBeTruthy();
          expect(atm.LFIBrandId).toBeTruthy();
          expect(atm.ATMId).toBeTruthy();
          expect(Array.isArray(atm.SupportedCurrencies)).toBe(true);
          expect(atm.SupportedCurrencies.length).toBeGreaterThan(0);
          expect(atm.Location).toBeTruthy();
          expect(atm.Location.PostalAddress).toBeTruthy();
          expect(atm.Location.GeoLocation).toBeTruthy();
        }
      });
    }
  }
});

describe('atm LFI redaction — Rich > Median > Sparse on optional fields', () => {
  const personas = loadPersonasByDomain('atm');
  const pools = loadAllPools();
  const now = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

  it('Sparse strips optional bands (Branch / ATMFee / Notes / Links)', () => {
    const [personaId, persona] = Object.entries(personas)[0];
    const seed = persona.default_seed ?? 1;
    const sparseBundle = buildBundle({ persona, lfi: 'sparse', seed, pools, now });
    for (const atm of sparseBundle.atms) {
      expect(atm.Branch).toBeUndefined();
      expect(atm.ATMFee).toBeUndefined();
      expect(atm.Notes).toBeUndefined();
      expect(atm.Links).toBeUndefined();
      expect(atm.Accessibility).toBeUndefined();
    }
  });

  it('Rich keeps every optional band populated', () => {
    const [personaId, persona] = Object.entries(personas)[0];
    const seed = persona.default_seed ?? 1;
    const richBundle = buildBundle({ persona, lfi: 'rich', seed, pools, now });
    // Spot-check a few representative ATMs — each should have the
    // full optional set the generator emits.
    for (const atm of richBundle.atms.slice(0, 5)) {
      expect(atm.Branch).toBeDefined();
      expect(atm.ATMFee).toBeDefined();
      expect(atm.Notes).toBeDefined();
      expect(atm.Links).toBeDefined();
      expect(atm.Accessibility).toBeDefined();
    }
  });
});

describe('atm replay — deterministic per (persona, lfi, seed)', () => {
  const personas = loadPersonasByDomain('atm');
  const pools = loadAllPools();
  const now = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

  it('two builds of the same (persona, lfi, seed) produce byte-identical bundles', () => {
    const [personaId, persona] = Object.entries(personas)[0];
    const seed = persona.default_seed ?? 1;
    const a = buildBundle({ persona, lfi: 'median', seed, pools, now });
    const b = buildBundle({ persona, lfi: 'median', seed, pools, now });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
