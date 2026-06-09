// Invariant 5 hardening — EXP-04 / §8.3: "mandatory fields are never
// redacted by LFI profile."
//
// The redaction bodies in src/generator/*/lfi-profile.js only touch paths
// listed in their OPTIONAL_FIELD_BANDS tables, so the invariant holds *by
// omission*: nothing structurally stops a future band entry from naming a
// spec-mandatory path, which Sparse/Median would then silently strip,
// producing spec-invalid bundles. This suite closes that gap by
// intersecting every band-table path with the field statuses parsed from
// the vendored OpenAPI YAML (dist/SPEC*.json `endpoints[].fields[]`) — the
// check stays spec-driven per EXP-01, no hand-authored field lists.
//
// Rules enforced per domain:
//   1. Every band path must resolve to at least one spec field (a path
//      that matches nothing is a typo or a spec-drift casualty).
//   2. A band path matching a spec-MANDATORY field is only legal when its
//      band is 'Universal' — Universal always keeps (shouldKeep() is true
//      under Rich, Median p=1.0, and Sparse), so no redaction can occur.
//      Example: Atm.SupportedCurrencies is spec-mandatory but listed at
//      Universal for populate-rate badge display; that is safe. The same
//      path at Common/Variable/Rare/Unknown would be a P0 and fails here.
//
// Path mapping: band paths are resource-anchored (Account.Nickname,
// Product.Policy.CareNetwork, Atm.Services); spec paths are envelope-
// anchored with array markers (Data.Account[].Nickname). We normalise the
// spec path by stripping `[]` and match the band path as a dot-segment
// suffix. The ATM band table prefixes a synthetic `Atm.` resource segment
// (its spec payload is an anonymous `Data[]` array), so its leading
// segment is dropped before matching.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const DOMAINS = [
  { name: 'banking', spec: 'dist/SPEC.json', stripLeadingSegment: false },
  { name: 'insurance', spec: 'dist/SPEC.insurance.json', stripLeadingSegment: false },
  // ATM band paths carry a synthetic `Atm.` resource prefix — the spec's
  // payload root is the anonymous Data[] array, so there is no matching
  // resource segment to anchor on.
  { name: 'atm', spec: 'dist/SPEC.atm.json', stripLeadingSegment: true },
];

function loadSpec(rel) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

// normalised spec path -> Set of statuses seen across all endpoints.
// Stripping `[]` can collapse an array field and its item schema onto the
// same key (Data[].SupportedCurrencies + Data[].SupportedCurrencies[]) —
// we keep the union of statuses, so 'mandatory' is never masked.
function statusIndex(spec) {
  const idx = new Map();
  for (const ep of Object.values(spec.endpoints)) {
    for (const field of ep.fields) {
      const norm = field.path.replace(/\[\]/g, '');
      if (!idx.has(norm)) idx.set(norm, new Set());
      idx.get(norm).add(field.status);
    }
  }
  return idx;
}

for (const domain of DOMAINS) {
  describe(`LFI bands × spec mandatory overlap — ${domain.name}`, () => {
    const spec = loadSpec(domain.spec);
    const idx = statusIndex(spec);
    const bandOverrides = spec.bandOverrides;

    it('has band overrides to check', () => {
      expect(bandOverrides).toBeTruthy();
      expect(Object.keys(bandOverrides).length).toBeGreaterThan(0);
    });

    for (const [bandPath, band] of Object.entries(spec.bandOverrides ?? {})) {
      const matchPath = domain.stripLeadingSegment
        ? bandPath.split('.').slice(1).join('.')
        : bandPath;

      it(`${bandPath} (${band}) resolves to a spec field and never redacts a mandatory one`, () => {
        const matches = [...idx.keys()].filter(
          (n) => n === matchPath || n.endsWith(`.${matchPath}`),
        );
        expect(matches.length, `band path ${bandPath} matches no spec field`).toBeGreaterThan(0);

        const statuses = new Set(matches.flatMap((m) => [...idx.get(m)]));
        if (statuses.has('mandatory')) {
          expect(
            band,
            `band path ${bandPath} matches a spec-MANDATORY field; only the always-keep ` +
              `'Universal' band is allowed there (EXP-04 / invariant 5)`,
          ).toBe('Universal');
        }
      });
    }
  });
}
