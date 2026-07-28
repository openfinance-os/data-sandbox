// Fail-loud gate for the build-artefact skip convention (T-03,
// APP_IMPROVEMENT_PLAN.md §3).
//
// ~11 suites follow the pattern `if (!FIXTURES_BUILT) { describe.skip }` so
// a fresh clone can run `npm test` without building anything. Locally that
// is the right trade — but a skipped suite is a PASS, so in CI the same
// pattern means a broken or relocated build artefact silently disables a
// large share of the spec-conformance estate behind a green check.
//
// This suite flips the contract: when CI is set, the artefacts those suites
// gate on MUST exist. Locally it stays quiet (mirroring the skip pattern it
// polices).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN_CI = process.env.CI === 'true' || process.env.CI === '1';

// Artefact → the npm script that produces it. Every path here is one that a
// gated suite existence-checks before deciding to run.
const REQUIRED_IN_CI = [
  {
    rel: 'packages/sandbox-fixtures/manifest.json',
    build: 'npm run build:fixtures',
    gates: 'fixture-package, rendered-fixture-spec-validation, multi-lfi-*, counterparty-* suites',
  },
  {
    rel: 'dist/brand-registry.json',
    build: 'npm run build:fixtures',
    gates: 'brand-registry suite',
  },
  {
    rel: '_site/src/index.html',
    build: 'npm run build:site',
    gates: 'integrate-staging (EXP-28..31) suite',
  },
];

describe('no silent suite-skips in CI (T-03)', () => {
  it.skipIf(!IN_CI)('every artefact the gated suites depend on exists', () => {
    const missing = REQUIRED_IN_CI.filter((a) => !fs.existsSync(path.join(repoRoot, a.rel)));
    expect(
      missing.map((a) => `${a.rel} (build: ${a.build}; would silently skip: ${a.gates})`),
      'CI ran without build artefacts — the suites gated on them skipped as passes',
    ).toEqual([]);
  });

  it('the required-artefact list stays in sync with the skip-gated suites', () => {
    // Cheap structural check: every tests/*.mjs that existence-gates on a
    // path should gate on one of the artefacts listed above (or a child of
    // one). Catches a future suite gating on a NEW artefact this file
    // doesn't know about.
    const testDir = path.join(repoRoot, 'tests');
    const gatePattern = /existsSync\(([^)]*)\)/;
    const knownRoots = ['packages/sandbox-fixtures', 'dist/', '_site/'];
    const offenders = [];
    for (const f of fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs'))) {
      if (f === 'no-silent-skips.test.mjs') continue;
      const src = fs.readFileSync(path.join(testDir, f), 'utf8');
      if (!/describe\.skip|it\.skip/.test(src)) continue;
      if (!gatePattern.test(src)) continue;
      const coversKnownRoot = knownRoots.some((root) => src.includes(root));
      if (!coversKnownRoot) offenders.push(f);
    }
    expect(
      offenders,
      'these suites skip-gate on an artefact no CI existence-check covers — extend REQUIRED_IN_CI',
    ).toEqual([]);
  });
});
