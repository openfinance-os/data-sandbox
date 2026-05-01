// Anti-drift gate — Phase 2.0 slice 2.
// The runtime LFI redaction body in src/generator/lfi-profile.js encodes a
// path -> band map (via getOptionalFieldBands()). The spec parser loads the
// same map from spec/lfi-bands.banking.yaml and emits it in dist/SPEC.json
// bandOverrides. These two MUST agree, or status badges and redaction will
// diverge.
//
// Once the redaction body becomes generic (driven by the injected bands map
// directly), this test loses its raison d'être and can be retired in favor
// of structural tests against bandsForDomain consumption.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOptionalFieldBands as bankingBands } from '../src/generator/banking/lfi-profile.js';
import { getOptionalFieldBands as insuranceBands } from '../src/generator/insurance/lfi-profile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function bandsFromSpec(distPath) {
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, distPath), 'utf8'));
  expect(spec.bandOverrides).toBeTruthy();
  return spec.bandOverrides;
}

function bandsFromRuntime(getOptionalFieldBands) {
  return Object.fromEntries(
    getOptionalFieldBands().map(({ path: p, band }) => [p, band])
  );
}

describe('LFI bands — runtime vs SPEC.json', () => {
  it('banking SPEC.json bandOverrides matches banking getOptionalFieldBands()', () => {
    expect(bandsFromSpec('dist/SPEC.json')).toEqual(bandsFromRuntime(bankingBands));
  });

  it('insurance SPEC.json bandOverrides matches insurance getOptionalFieldBands()', () => {
    expect(bandsFromSpec('dist/SPEC.insurance.json')).toEqual(bandsFromRuntime(insuranceBands));
  });
});
