// Version-sync gate across the three distribution packages.
//
// The root package.json is the single source of truth:
//   - packages/sandbox-fixtures/package.json is *generated* from it
//     (PKG_VERSION in tools/build-fixture-package.mjs),
//   - packages/sandbox-fixtures-py/pyproject.toml is *stamped* from it
//     (tools/build-fixture-package-py.mjs),
//   - packages/sandbox-mcp/package.json is hand-maintained.
// A divergence means npm and PyPI consumers see different semver contracts
// for the same fixture data — this suite fails the build before that ships.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readJsonVersion(rel) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8')).version;
}

const rootVersion = readJsonVersion('package.json');

describe('distribution package version sync', () => {
  it('root package.json declares a version', () => {
    expect(rootVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('sandbox-mcp matches the root version', () => {
    expect(readJsonVersion('packages/sandbox-mcp/package.json')).toBe(rootVersion);
  });

  it('PyPI pyproject.toml matches the root version', () => {
    const toml = fs.readFileSync(
      path.join(repoRoot, 'packages/sandbox-fixtures-py/pyproject.toml'),
      'utf8',
    );
    const m = toml.match(/^version = "(.*)"$/m);
    expect(m, 'pyproject.toml has no version line').toBeTruthy();
    expect(m[1]).toBe(rootVersion);
  });

  // The npm fixture package's package.json only exists after
  // `npm run build:fixtures` — when present it must carry the root version.
  const fixturesPkg = path.join(repoRoot, 'packages/sandbox-fixtures/package.json');
  it.skipIf(!fs.existsSync(fixturesPkg))('built sandbox-fixtures matches the root version', () => {
    expect(readJsonVersion('packages/sandbox-fixtures/package.json')).toBe(rootVersion);
  });

  // E-04: recursive `data/**/*` package-data globs are silently dropped by
  // setuptools < 62.3 — the wheel then installs without its fixture tree and
  // every loader call FileNotFoundErrors. Guard the build-system floor.
  it('pyproject.toml requires setuptools >= 62.3 (recursive package-data floor)', () => {
    const toml = fs.readFileSync(
      path.join(repoRoot, 'packages/sandbox-fixtures-py/pyproject.toml'),
      'utf8',
    );
    const m = toml.match(/requires\s*=\s*\[\s*"setuptools>=([\d.]+)"\s*\]/);
    expect(m, 'pyproject.toml has no setuptools>=X build requirement').toBeTruthy();
    const [major, minor] = m[1].split('.').map(Number);
    expect(major * 1000 + (minor ?? 0)).toBeGreaterThanOrEqual(62 * 1000 + 3);
  });

  // E-04: the py.typed marker must exist and be included in package-data,
  // or type checkers ignore the package's inline annotations.
  it('pyproject.toml ships the py.typed marker in package-data', () => {
    const toml = fs.readFileSync(
      path.join(repoRoot, 'packages/sandbox-fixtures-py/pyproject.toml'),
      'utf8',
    );
    expect(toml).toMatch(/"py\.typed"/);
    expect(
      fs.existsSync(
        path.join(
          repoRoot,
          'packages/sandbox-fixtures-py/src/openfinance_os_sandbox_fixtures/py.typed',
        ),
      ),
    ).toBe(true);
  });

  // E-01: the generated npm package must expose its types both as the legacy
  // top-level field and as the FIRST condition of the root exports entry —
  // node16/bundler resolution ignores the top-level field when `exports`
  // exists, and conditions are matched in object order.
  it.skipIf(!fs.existsSync(fixturesPkg))('built sandbox-fixtures exposes TypeScript types', () => {
    const pkg = JSON.parse(fs.readFileSync(fixturesPkg, 'utf8'));
    expect(pkg.types).toBe('./index.d.ts');
    expect(pkg.exports['.'].types).toBe('./index.d.ts');
    expect(Object.keys(pkg.exports['.'])[0]).toBe('types');
  });
});
