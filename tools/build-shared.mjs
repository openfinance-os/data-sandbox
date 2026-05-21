// Build-time helpers shared between fixture-package builders and any other
// tool that needs the pinned spec version, the build-time `now` anchor, or
// the package version. Pure reads — no side effects.

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './load-fixtures.mjs';

/**
 * Top-level package version from /package.json. Used as the `version` field
 * in the emitted fixture-package manifest. Returns null on read failure so
 * callers can fall back to '0.0.0'.
 */
export function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return null;
  }
}

/**
 * Build-time `now` anchor. Reads `spec/SPEC_PIN.retrieved` (an ISO timestamp)
 * and floors to the first day of that month so deterministic transactions
 * align to month boundaries. Falls back to 2026-04-01 UTC.
 */
export function readNowAnchor() {
  const f = path.join(repoRoot, 'spec/SPEC_PIN.retrieved');
  if (!fs.existsSync(f)) return new Date(Date.UTC(2026, 3, 1)).toISOString();
  const ts = fs.readFileSync(f, 'utf8').trim();
  const d = new Date(ts);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * Pinned banking-spec SHA from `spec/SPEC_PIN.sha`. Returns 'unknown' on
 * read failure so consumers always have a stringable value.
 */
export function readSpecSha() {
  const f = path.join(repoRoot, 'spec/SPEC_PIN.sha');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : 'unknown';
}

/**
 * Parsed spec version per domain (from `info.version` in the source YAML).
 * Reads `dist/SPEC.json` (banking) and `dist/SPEC.insurance.json` (insurance);
 * both files are produced by `tools/parse-spec.mjs`, which must have run
 * before this is called. Returns 'unknown' for any missing file so callers
 * still get a stringable value.
 *
 * Banking and insurance are pinned independently — currently banking is on
 * `v2.1-errata2` while insurance is on `v2.1-errata1` (errata2 didn't
 * republish the insurance spec).
 */
export function readSpecVersions() {
  const banking = readVersionFromDist('dist/SPEC.json');
  const insurance = readVersionFromDist('dist/SPEC.insurance.json');
  const atm = readVersionFromDist('dist/SPEC.atm.json');
  return { banking, insurance, atm };
}

function readVersionFromDist(rel) {
  const f = path.join(repoRoot, rel);
  if (!fs.existsSync(f)) return 'unknown';
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')).specVersion ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Slugify an OpenAPI endpoint path into a filesystem-safe basename.
 * `/accounts/{AccountId}/balances` -> `accounts__AccountId__balances`.
 */
export function safeEndpointName(s) {
  return s.replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '');
}
