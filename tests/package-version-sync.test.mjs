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
});
