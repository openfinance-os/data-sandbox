#!/usr/bin/env node
// E-05 — release version bump. The root package.json is the single version
// source for all three distribution packages:
//   - packages/sandbox-fixtures/package.json is GENERATED from it
//     (tools/build-fixture-package.mjs),
//   - packages/sandbox-fixtures-py/pyproject.toml is STAMPED from it
//     (tools/build-fixture-package-py.mjs),
//   - packages/sandbox-mcp/package.json is hand-maintained but gated equal
//     by tests/package-version-sync.test.mjs.
// This script bumps the root version and rebuilds the fixture packages so
// all stamped copies agree, then prints the tag/publish next steps. The
// publish workflows' verify-tag gates refuse any tag that doesn't match the
// root version, so running this (and committing) is a release prerequisite.
//
// Usage: node tools/release-bump.mjs <version>
//   e.g. node tools/release-bump.mjs 0.3.0

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const version = process.argv[2];
if (!version) {
  console.error('usage: node tools/release-bump.mjs <version>   e.g. 0.3.0');
  process.exit(1);
}
// npm-acceptable semver: MAJOR.MINOR.PATCH with optional -prerelease/+build.
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!SEMVER_RE.test(version)) {
  console.error(`not a valid semver version: "${version}" (expected e.g. 0.3.0 or 1.0.0-rc.1)`);
  process.exit(1);
}

// 1. Root package.json — the single source of truth.
const rootPkgPath = path.join(repoRoot, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
const previous = rootPkg.version;
rootPkg.version = version;
fs.writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
console.log(`root package.json: ${previous} → ${version}`);

// 2. sandbox-mcp package.json is hand-maintained — bump it in lockstep so
// tests/package-version-sync.test.mjs stays green.
const mcpPkgPath = path.join(repoRoot, 'packages/sandbox-mcp/package.json');
// Single read (no exists-then-read race) — a missing workspace is fine, any
// other read/parse error should surface.
let mcpRaw = null;
try {
  mcpRaw = fs.readFileSync(mcpPkgPath, 'utf8');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
if (mcpRaw !== null) {
  const mcpPkg = JSON.parse(mcpRaw);
  const mcpPrevious = mcpPkg.version;
  mcpPkg.version = version;
  fs.writeFileSync(mcpPkgPath, `${JSON.stringify(mcpPkg, null, 2)}\n`);
  console.log(`packages/sandbox-mcp/package.json: ${mcpPrevious} → ${version}`);
}

// 3. Rebuild the fixture packages so the generated npm package.json and the
// stamped pyproject.toml pick up the new version. build:fixtures:pkgs needs
// the parsed spec on disk — build it first if absent.
if (!fs.existsSync(path.join(repoRoot, 'dist/SPEC.json'))) {
  console.log('dist/SPEC.json missing — running build:spec first…');
  execSync('npm run build:spec', { cwd: repoRoot, stdio: 'inherit' });
}
execSync('npm run build:fixtures:pkgs', { cwd: repoRoot, stdio: 'inherit' });

console.log(`
✔ version ${version} stamped across root, sandbox-mcp, sandbox-fixtures (generated) and pyproject.toml.

Next steps:
  1. npx vitest run tests/package-version-sync.test.mjs   # confirm the sync gate
  2. Review + commit the version changes (package.json files, pyproject.toml).
  3. Tag and push to publish:
       git tag fixtures-v${version} && git push origin fixtures-v${version}   # npm + PyPI fixtures
       git tag mcp-v${version} && git push origin mcp-v${version}             # MCP npm + ghcr image
     (the publish workflows verify tag ↔ root version and run full CI first)
`);
