import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildBundle } from '../src/generator/index.js';
import { envelopesFromBundle } from '../src/ui/export.js';
import { loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';
import { createValidators, stripAnnotations } from '../tools/schema-validator.mjs';

const validators = createValidators(
  fs.readFileSync('spec/uae-account-information-openapi.yaml', 'utf8'),
);
const pools = loadAllPools();
describe('banking envelopes: strict normalized schema', () => {
  for (const [personaId, persona] of Object.entries(loadPersonasByDomain('banking'))) {
    for (const lfi of ['rich', 'median', 'sparse']) {
      it(`${personaId} ${lfi}`, () => {
        const seed = persona.default_seed;
        const bundle = buildBundle({ persona, lfi, seed, pools });
        const envelopes = envelopesFromBundle(bundle, { personaId, lfi, seed });
        for (const [endpoint, env] of Object.entries(envelopes)) {
          if (!endpoint.startsWith('/accounts') && endpoint !== '/parties') continue;
          const validate = validators.forEndpoint(endpoint);
          expect(
            validate(stripAnnotations(env)),
            JSON.stringify({ endpoint, errors: validate.errors }),
          ).toBe(true);
        }
      });
    }
  }
});
