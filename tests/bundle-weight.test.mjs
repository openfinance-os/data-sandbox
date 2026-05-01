// EXP-24 acceptance partial: total page weight <= 250 KB gzipped on a cold
// load. We measure the sum of the bundle assets the browser actually fetches
// for the main page (HTML + CSS + every imported JS module + dist/SPEC.json
// + dist/data.json), gzipped.
//
// Lighthouse-CI in tests/e2e/lighthouse covers the runtime perf budget
// (Performance >= 90, TTI < 3s) — that needs a headless Chrome, so it lives
// in the e2e workflow rather than this Vitest run.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { repoRoot } from '../tools/load-fixtures.mjs';

const BUDGET_KB = 250;

const ASSETS = [
  'src/index.html',
  'src/styles.css',
  'src/app.js',
  'src/prng.js',
  'src/url.js',
  'src/shared/spec-helpers.js',
  'src/shared/watermark.js',
  'src/shared/pools.js',
  'src/generator/index.js',
  'src/generator/identity.js',
  'src/generator/accounts.js',
  'src/generator/balances.js',
  'src/generator/transactions.js',
  'src/generator/standing-orders.js',
  'src/generator/direct-debits.js',
  'src/generator/beneficiaries.js',
  'src/generator/scheduled-payments.js',
  'src/generator/parties.js',
  'src/generator/statements.js',
  'src/generator/product.js',
  'src/generator/banking/lfi-profile.js',
  'src/ui/export.js',
  'dist/SPEC.json',
  'dist/data.json',
];

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf).length;
}

describe('bundle-weight budget — EXP-24', () => {
  it(`total gzipped weight is under ${BUDGET_KB} KB`, () => {
    const sizes = ASSETS.map((rel) => {
      const abs = path.join(repoRoot, rel);
      const size = gzipSize(abs);
      return { rel, size };
    });
    const total = sizes.reduce((acc, x) => acc + x.size, 0);
    const totalKb = total / 1024;
    if (totalKb >= BUDGET_KB) {
      console.error('asset breakdown (gzipped):');
      for (const s of sizes.sort((a, b) => b.size - a.size).slice(0, 10)) {
        console.error(`  ${(s.size / 1024).toFixed(1)} KB  ${s.rel}`);
      }
    }
    expect(totalKb).toBeLessThan(BUDGET_KB);
  });
});
