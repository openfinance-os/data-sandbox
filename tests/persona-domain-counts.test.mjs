// Regression guard for APP_IMPROVEMENT_PLAN.md §1 A-1: every consumer that
// filters personas by domain must be multi-domain aware. The original bug
// filtered on the singular `domain` key, which Phase 2.2 multi-domain
// personas don't carry — silently hiding all 8 of them (including the
// flagship retail_multi_banker) from the explorer's banking AND insurance
// tabs.
//
// The counts asserted here are derived from the persona manifests, not
// hard-coded expectations about the library size — adding a persona moves
// both sides of the assertion together.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadAllPersonas, loadPersonasByDomain } from '../tools/load-fixtures.mjs';
import { normalizeDomains, personaInDomain, domainLabel } from '../src/shared/domains.js';

const DATA = JSON.parse(readFileSync(new URL('../dist/data.json', import.meta.url), 'utf8'));

describe('persona domain normalisation (A-1)', () => {
  it('dist/data.json per-domain persona counts match the YAML manifests', async () => {
    const manifests = await loadAllPersonas();
    for (const domain of ['banking', 'insurance', 'atm']) {
      const expected = Object.keys(await loadPersonasByDomain(domain)).length;
      const rendered = Object.values(DATA.personas).filter((p) =>
        personaInDomain(p, domain),
      ).length;
      expect(rendered, `personaInDomain must surface every ${domain} persona`).toBe(expected);
    }
    // Multi-domain personas appear under BOTH tabs, so the per-domain sums
    // exceed the library size by exactly the multi-domain count.
    const multi = Object.values(manifests).filter((p) => normalizeDomains(p).length > 1).length;
    expect(multi).toBeGreaterThan(0);
  });

  it('multi-domain personas in dist/data.json carry domains[] and are banking-visible', () => {
    const multis = Object.entries(DATA.personas).filter(
      ([, p]) => Array.isArray(p.domains) && p.domains.length > 1,
    );
    expect(multis.length).toBeGreaterThan(0);
    for (const [id, p] of multis) {
      expect(personaInDomain(p, 'banking'), `${id} must be visible on the banking tab`).toBe(true);
      expect(domainLabel(p), `${id} must label as multi`).toBe('multi');
    }
    // The flagship persona is the regression canary.
    expect(multis.map(([id]) => id)).toContain('retail_multi_banker');
  });

  it('normalizeDomains handles every shape a persona record can arrive in', () => {
    expect(normalizeDomains({ domain: 'insurance' })).toEqual(['insurance']);
    expect(normalizeDomains({ domains: ['banking', 'insurance'] })).toEqual([
      'banking',
      'insurance',
    ]);
    // Fixture-manifest shape: label 'multi' alongside the array.
    expect(normalizeDomains({ domain: 'multi', domains: ['banking', 'insurance'] })).toEqual([
      'banking',
      'insurance',
    ]);
    // Defensive default matches the pre-Phase-2 convention.
    expect(normalizeDomains({})).toEqual(['banking']);
    expect(domainLabel({ domain: 'atm' })).toBe('atm');
  });
});
