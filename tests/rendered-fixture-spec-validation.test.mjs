import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createValidators, stripAnnotations } from '../tools/schema-validator.mjs';

const root = 'packages/sandbox-fixtures';
// A missing build is a failure, including on CI.
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
const schemas = Object.fromEntries(
  ['banking', 'insurance', 'atm'].map((domain) => [
    domain,
    createValidators(
      fs.readFileSync(
        `spec/uae-${domain === 'banking' ? 'account-information' : domain}-openapi.yaml`,
        'utf8',
      ),
      { normalization: domain === 'insurance' },
    ),
  ]),
);
const literalInsurance = createValidators(
  fs.readFileSync('spec/uae-insurance-openapi.yaml', 'utf8'),
);
const fixtures = new Map();
for (const entry of [
  ...Object.values(manifest.fixtures),
  ...Object.values(manifest.roleFixtures ?? {}),
]) {
  for (const [endpoint, rel] of Object.entries(entry.endpoints)) {
    if (endpoint.includes('{')) continue;
    const domain =
      endpoint === '/atms'
        ? 'atm'
        : endpoint.includes('-insurance-') || endpoint.startsWith('/insurance-consents')
          ? 'insurance'
          : 'banking';
    fixtures.set(rel, { endpoint, domain });
  }
}
describe('strict rendered corpus', () => {
  for (const domain of ['banking', 'insurance', 'atm'])
    it(`${domain}: every emitted response`, () => {
      let count = 0;
      for (const [rel, entry] of fixtures) {
        if (entry.domain !== domain) continue;
        const payload = stripAnnotations(JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')));
        const validate = schemas[domain].forEndpoint(entry.endpoint);
        expect(
          validate(payload),
          JSON.stringify({ rel, errors: validate.errors?.slice(0, 4) }),
        ).toBe(true);
        // Explicitly distinguish the diagnosed literal upstream rejection.
        if (entry.endpoint.includes('-insurance-quotes/'))
          expect(literalInsurance.forEndpoint(entry.endpoint)(payload)).toBe(false);
        count++;
      }
      expect(count).toBeGreaterThan(0);
    });
  it('rejects unknown fields in envelopes, quote branches and Meta', () => {
    for (const [rel, entry] of fixtures) {
      if (
        !['/atms', '/accounts'].includes(entry.endpoint) &&
        !entry.endpoint.includes('-insurance-quotes/')
      )
        continue;
      const payload = stripAnnotations(JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')));
      const validate = schemas[entry.domain].forEndpoint(entry.endpoint);
      expect(validate({ ...payload, Invented: true })).toBe(false);
      if (entry.endpoint.includes('-insurance-quotes/')) {
        expect(validate({ ...payload, Meta: { TotalPages: 1 } })).toBe(false);
        expect(validate({ ...payload, Data: { ...payload.Data, Invented: true } })).toBe(false);
        expect(validate({ ...payload, Data: { ...payload.Data, QuoteStatus: 'MadeUp' } })).toBe(
          false,
        );
      }
    }
  });
  it('refuses missing mapping and unreviewed normalization', () => {
    expect(() => schemas.banking.forEndpoint('/made-up')).toThrow();
    expect(() =>
      createValidators(fs.readFileSync('spec/uae-insurance-openapi.yaml', 'utf8') + '\n', {
        normalization: true,
      }),
    ).toThrow('Unreviewed');
  });
});
