// v2.2-rc2 preview corpus (PRD D-01 amendment, 28 November 2026).
//
// The preview carries the stable scenarios re-shaped to the release
// candidate's wire contract. These tests hold it to the same bar as the
// stable corpus: strict validation against its own pinned YAML, mandatory
// fields never missing, determinism, and v2.1 left untouched as the default.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildBundle } from '../src/generator/index.js';
import { envelopesFromBundle } from '../src/core/envelopes.js';
import {
  toPreviewEnvelope,
  templateFor,
  decimalString,
  restoreMandatory,
} from '../src/core/preview.js';
import {
  previewQuoteFields,
  previewPolicyAdditions,
} from '../src/generator/insurance/preview-v22.js';
import { loadPersonasByDomain, loadAllPools, repoRoot } from '../tools/load-fixtures.mjs';
import { createValidators, stripAnnotations } from '../tools/schema-validator.mjs';
import { PREVIEWS } from '../tools/domains.config.mjs';

const preview = PREVIEWS.find((p) => p.id === 'banking' && p.baseline === 'v2.2-rc2');
const yamlText = fs.readFileSync(path.join(repoRoot, preview.specPath), 'utf8');
const validators = createValidators(yamlText);
const stableValidators = createValidators(
  fs.readFileSync(path.join(repoRoot, 'spec/uae-account-information-openapi.yaml'), 'utf8'),
);
const previewSpec = JSON.parse(fs.readFileSync(path.join(repoRoot, preview.outPath), 'utf8'));
const stableSpec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/SPEC.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(repoRoot, 'spec/provenance.json'), 'utf8'));
const corpusProvenance = provenance.preview.corpus.domains.banking;
const pools = loadAllPools();
const personas = loadPersonasByDomain('banking');
const isBanking = (e) => e.startsWith('/accounts') || e === '/parties';

// Fields the release candidate makes mandatory that v2.1 left optional. The
// list is derived from the two parsed specs, never written by hand.
const newlyMandatory = Object.fromEntries(
  preview.inScopePaths.map((ep) => {
    const before = new Map(stableSpec.endpoints[ep].fields.map((f) => [f.path, f.status]));
    return [
      ep,
      previewSpec.endpoints[ep].fields
        .filter((f) => f.status === 'mandatory' && before.get(f.path) === 'optional')
        .map((f) => f.path),
    ];
  }),
);
// Release-candidate wording: whitespace-only values and non-informative
// placeholders do not satisfy a required narrative.
const PLACEHOLDER = /^\s*(n\/?a|-+|unknown|none|null|tbc|\.)?\s*$/i;

function valuesAt(node, parts) {
  if (parts.length === 0) return [node];
  if (node == null || typeof node !== 'object') return [];
  const [head, ...rest] = parts;
  if (head.endsWith('[]')) {
    const arr = node[head.slice(0, -2)];
    return Array.isArray(arr) ? arr.flatMap((item) => valuesAt(item, rest)) : [];
  }
  return head in node ? valuesAt(node[head], rest) : [];
}

describe('v2.2-rc2 preview: provenance', () => {
  it('vendors the exact pinned release-candidate file', () => {
    const sha = crypto.createHash('sha256').update(yamlText).digest('hex');
    expect(sha).toBe(corpusProvenance.sha256);
    expect(corpusProvenance.vendoredAt).toBe(preview.specPath);
    expect(corpusProvenance.path).toBe(preview.upstreamPath);
    expect(fs.readFileSync(path.join(repoRoot, preview.pinPath), 'utf8').trim()).toBe(
      corpusProvenance.commit,
    );
    expect(previewSpec.specVersion).toBe('v2.2-rc2');
    expect(previewSpec.status).toBe('preview');
  });

  it('keeps v2.1 as the stable default', () => {
    expect(provenance.baseline).toBe('v2.1');
    expect(provenance.preview.adopted).toBe(false);
    expect(stableSpec.specVersion).toMatch(/^v2\.1/);
    const domains = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist/domains.json'), 'utf8'));
    expect(domains.domains.map((d) => d.specVersion).every((v) => v.startsWith('v2.1'))).toBe(true);
  });

  it('derives the required narrative from the release candidate itself', () => {
    expect(newlyMandatory['/accounts/{AccountId}/transactions'].length).toBeGreaterThan(0);
  });
});

describe('v2.2-rc2 preview: adapter', () => {
  it('formats decimals without exponents or trailing zeros', () => {
    expect(decimalString(3.6725)).toBe('3.6725');
    expect(decimalString(4)).toBe('4');
    expect(decimalString(0.0000001)).toBe('0.0000001');
  });

  it('resolves emitted endpoints to spec templates', () => {
    const paths = previewSpec.inScopePaths;
    expect(templateFor('/accounts', paths)).toBe('/accounts');
    expect(templateFor('/accounts/acct-01/transactions', paths)).toBe(
      '/accounts/{AccountId}/transactions',
    );
    expect(templateFor('/accounts/acct-01', paths)).toBe('/accounts/{AccountId}');
    expect(templateFor('/nope', paths)).toBe(null);
  });

  it('does not mutate its input and is deterministic', () => {
    const [personaId, persona] = Object.entries(personas)[0];
    const seed = persona.default_seed;
    const envs = envelopesFromBundle(buildBundle({ persona, lfi: 'rich', seed, pools }), {
      personaId,
      lfi: 'rich',
      seed,
    });
    for (const [endpoint, env] of Object.entries(envs)) {
      if (!isBanking(endpoint)) continue;
      const before = JSON.stringify(env);
      const a = toPreviewEnvelope(env, endpoint, previewSpec, {
        stableSpec,
        provenance: corpusProvenance,
      });
      const b = toPreviewEnvelope(env, endpoint, previewSpec, {
        stableSpec,
        provenance: corpusProvenance,
      });
      expect(JSON.stringify(env)).toBe(before);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.envelope._watermark).toBe(env._watermark);
      expect(a.envelope._specVersion).toBe('v2.2-rc2');
      expect(a.envelope._baselineStatus).toBe('preview');
    }
  });
});

describe('v2.2-rc2 preview: every persona × LFI validates strictly', () => {
  for (const [personaId, persona] of Object.entries(personas)) {
    for (const lfi of ['rich', 'median', 'sparse']) {
      it(`${personaId} ${lfi}`, () => {
        const seed = persona.default_seed;
        const envs = envelopesFromBundle(buildBundle({ persona, lfi, seed, pools }), {
          personaId,
          lfi,
          seed,
        });
        for (const [endpoint, env] of Object.entries(envs)) {
          if (!isBanking(endpoint)) continue;
          const { envelope } = toPreviewEnvelope(env, endpoint, previewSpec, {
            stableSpec,
            provenance: corpusProvenance,
          });
          const validate = validators.forEndpoint(endpoint);
          const payload = stripAnnotations(envelope);
          expect(validate(payload), JSON.stringify({ endpoint, errors: validate.errors })).toBe(
            true,
          );
          // Fields the candidate newly requires are present and informative,
          // even under Sparse (mandatory fields are never redacted).
          const template = templateFor(endpoint, previewSpec.inScopePaths);
          for (const fieldPath of newlyMandatory[template]) {
            const parts = fieldPath.split('.');
            const parent = valuesAt(payload, parts.slice(0, -1));
            const leaf = parts[parts.length - 1];
            for (const node of parent) {
              if (node == null || typeof node !== 'object') continue;
              expect(node[leaf], `${endpoint} ${fieldPath}`).toBeDefined();
              if (typeof node[leaf] === 'string')
                expect(PLACEHOLDER.test(node[leaf]), `${endpoint} ${fieldPath}`).toBe(false);
            }
          }
          // The stable envelope still validates against v2.1.
          expect(stableValidators.forEndpoint(endpoint)(stripAnnotations(env))).toBe(true);
        }
      });
    }
  }
});

const PREVIEW_ROOT = path.join(repoRoot, 'packages/sandbox-fixtures/preview', preview.baseline);
describe('v2.2-rc2 preview: built corpus', () => {
  // A missing build is a failure, as for the stable rendered corpus.
  const manifest = JSON.parse(fs.readFileSync(path.join(PREVIEW_ROOT, 'manifest.json'), 'utf8'));
  const stable = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packages/sandbox-fixtures/manifest.json'), 'utf8'),
  );

  it('covers every stable banking fixture, primary and role', () => {
    const index = JSON.parse(fs.readFileSync(path.join(PREVIEW_ROOT, 'index.json'), 'utf8'));
    for (const group of ['fixtures', 'roleFixtures']) {
      const expected = Object.entries(stable[group])
        .filter(([, e]) => Object.keys(e.endpoints).some(isBanking))
        .map(([k]) => k)
        .sort();
      const withBanking = Object.entries(manifest[group])
        .filter(([, e]) => Object.keys(e.endpoints).some(isBanking))
        .map(([k]) => k)
        .sort();
      expect(withBanking).toEqual(expected);
    }
    expect(manifest.status).toBe('preview');
    expect(manifest.baseline).toBe('v2.2-rc2');
    expect(manifest.specProvenance.banking.commit).toBe(corpusProvenance.commit);
    expect(index.wireChanges.banking).toEqual({
      'Data.Transaction[].CurrencyExchange.ExchangeRate': 'number → decimal string',
    });
  });

  it('every emitted preview response validates and carries the watermark', () => {
    let count = 0;
    const seen = new Set();
    for (const group of ['fixtures', 'roleFixtures'])
      for (const entry of Object.values(manifest[group]))
        for (const [endpoint, rel] of Object.entries(entry.endpoints)) {
          if (!isBanking(endpoint) || endpoint.includes('{') || seen.has(rel)) continue;
          seen.add(rel);
          const env = JSON.parse(fs.readFileSync(path.join(PREVIEW_ROOT, rel), 'utf8'));
          expect(env._watermark).toContain('SYNTHETIC');
          expect(env._specVersion).toBe('v2.2-rc2');
          const validate = validators.forEndpoint(endpoint);
          expect(validate(stripAnnotations(env)), rel).toBe(true);
          count++;
        }
    expect(count).toBeGreaterThan(1000);
  });

  it('changes only what the release candidate re-types', () => {
    const index = JSON.parse(fs.readFileSync(path.join(PREVIEW_ROOT, 'index.json'), 'utf8'));
    for (const fieldPath of Object.keys(index.wireChanges.banking)) {
      const [ep] = Object.entries(previewSpec.endpoints).find(([, e]) =>
        e.fields.some((f) => f.path === fieldPath),
      );
      const now = previewSpec.endpoints[ep].fields.find((f) => f.path === fieldPath);
      const was = stableSpec.endpoints[ep].fields.find((f) => f.path === fieldPath);
      expect(now.type).toBe('string');
      expect(was.type).not.toBe('string');
    }
  });
});

// ── Insurance ──────────────────────────────────────────────────────────────
const insurancePreview = PREVIEWS.find((p) => p.id === 'insurance' && p.baseline === 'v2.2-rc2');
const insuranceYaml = fs.readFileSync(path.join(repoRoot, insurancePreview.specPath), 'utf8');
const insuranceValidators = createValidators(insuranceYaml, { normalization: true });
const insuranceLiteral = createValidators(insuranceYaml);
const insuranceSpec = JSON.parse(
  fs.readFileSync(path.join(repoRoot, insurancePreview.outPath), 'utf8'),
);
const insuranceStableSpec = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'dist/SPEC.insurance.json'), 'utf8'),
);
const isInsurance = (e) => e.includes('-insurance-') || e.startsWith('/insurance-consents');

describe('v2.2-rc2 preview: insurance generator facts', () => {
  const policy = (extra) => ({ Product: { Policy: { PolicyStartDate: '2026-01-31', ...extra } } });

  it('maps each line to a CoverType the candidate declares', () => {
    const enumOf = (line) =>
      insuranceSpec.endpoints[`/${line}-insurance-quotes/{QuoteId}`].fields.find(
        (f) => f.path === 'Data.CoverType',
      ).enum;
    const cases = {
      motor: policy({ TypeOfPolicy: 'ThirdPartyLiability' }),
      health: policy({ TypeOfPolicy: 'HealthInsuranceIndividual' }),
      life: policy({ CoverType: 'Joint' }),
      employment: policy({ SchemeCategory: 'CategoryA' }),
      travel: policy({ MultiTrip: false }),
      home: policy(),
      renters: policy(),
    };
    for (const [line, data] of Object.entries(cases)) {
      const fields = previewQuoteFields(line, data);
      expect(enumOf(line), line).toContain(fields.CoverType);
      expect(fields.PolicyStartDate).toBe('2026-01-31');
      expect(fields.PolicyEndDate).toBe('2027-01-31');
    }
    expect(previewQuoteFields('home', policy({ PolicyEndDate: '2026-12-31' })).PolicyEndDate).toBe(
      '2026-12-31',
    );
    expect(() => previewQuoteFields('motor', {})).toThrow();
  });

  it('derives motor registration and insured-address coordinates', () => {
    const motor = (year) => ({
      Product: { Policy: { PolicyStartDate: '2026-01-31' }, VehicleDetails: { ModelYear: year } },
    });
    expect(previewPolicyAdditions('motor', motor('2026'))[0].values.RegistrationType).toBe('New');
    expect(previewPolicyAdditions('motor', motor('2021'))[0].values.RegistrationType).toBe(
      'RenewalOfExistingVehicle',
    );
    const home = {
      Product: { PropertyDetails: { InsuredPropertyAddress: { AddressLine: ['B 1', 'Dubai'] } } },
    };
    const [{ values }] = previewPolicyAdditions('home', home);
    expect(values).toEqual({ Latitude: '25.20', Longitude: '55.27' });
    expect(previewPolicyAdditions('travel', home)).toEqual([]);
  });

  it('restores newly mandatory fields a profile redacted, from the Rich twin', () => {
    const sparse = { Data: { A: [{ B: 1 }, { B: 2 }] } };
    const rich = {
      Data: {
        A: [
          { B: 1, C: 'x' },
          { B: 2, C: 'y' },
        ],
      },
    };
    expect(restoreMandatory(sparse, rich, ['Data.A[].C'])).toEqual(['Data.A[].C']);
    expect(sparse.Data.A.map((a) => a.C)).toEqual(['x', 'y']);
  });

  it('refuses an addition the candidate does not declare', () => {
    const env = { Data: {}, Links: {}, Meta: {} };
    expect(() =>
      toPreviewEnvelope(env, '/motor-insurance-quotes/q1', insuranceSpec, {
        stableSpec: insuranceStableSpec,
        additions: [{ at: ['Data'], values: { NotAField: 1 } }],
      }),
    ).toThrow(/not declared/);
  });
});

describe('v2.2-rc2 preview: insurance built corpus', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PREVIEW_ROOT, 'manifest.json'), 'utf8'));
  const stable = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packages/sandbox-fixtures/manifest.json'), 'utf8'),
  );

  it('covers every stable insurance fixture and pins its own provenance', () => {
    const insuranceProvenance = provenance.preview.corpus.domains.insurance;
    expect(crypto.createHash('sha256').update(insuranceYaml).digest('hex')).toBe(
      insuranceProvenance.sha256,
    );
    expect(manifest.domains).toEqual(['banking', 'insurance']);
    for (const group of ['fixtures', 'roleFixtures']) {
      const expected = Object.entries(stable[group])
        .filter(([, e]) => Object.keys(e.endpoints).some(isInsurance))
        .map(([k]) => k);
      for (const key of expected)
        expect(Object.keys(manifest[group][key].endpoints).some(isInsurance), key).toBe(true);
    }
  });

  it('every emitted insurance response validates against the reviewed rc2 composition', () => {
    let count = 0;
    let quotes = 0;
    const seen = new Set();
    for (const group of ['fixtures', 'roleFixtures'])
      for (const entry of Object.values(manifest[group]))
        for (const [endpoint, rel] of Object.entries(entry.endpoints)) {
          if (!isInsurance(endpoint) || endpoint.includes('{') || seen.has(rel)) continue;
          seen.add(rel);
          const env = JSON.parse(fs.readFileSync(path.join(PREVIEW_ROOT, rel), 'utf8'));
          expect(env._watermark).toContain('SYNTHETIC');
          expect(env._specVersion).toBe('v2.2-rc2');
          const payload = stripAnnotations(env);
          const validate = insuranceValidators.forEndpoint(endpoint);
          expect(
            validate(payload),
            JSON.stringify({ rel, errors: validate.errors?.slice(0, 3) }),
          ).toBe(true);
          // The composition defect is upstream: rc2 still rejects every quote literally.
          if (endpoint.includes('-insurance-quotes/')) {
            expect(insuranceLiteral.forEndpoint(endpoint)(payload)).toBe(false);
            quotes++;
          }
          count++;
        }
    expect(count).toBeGreaterThan(1000);
    expect(quotes).toBeGreaterThan(0);
  });

  it('only wire changes the two parsed specs explain', () => {
    const index = JSON.parse(fs.readFileSync(path.join(PREVIEW_ROOT, 'index.json'), 'utf8'));
    const anywhere = (spec, p) =>
      Object.values(spec.endpoints).some((e) => e.fields.some((f) => f.path === p));
    for (const [p, kind] of Object.entries(index.wireChanges.insurance)) {
      if (kind === 'removed') {
        expect(anywhere(insuranceStableSpec, p), p).toBe(true);
        expect(anywhere(insuranceSpec, p), p).toBe(false);
      } else {
        expect(anywhere(insuranceSpec, p), p).toBe(true);
      }
    }
  });
});
