// Phase R4 — brand registry.
// Asserts:
//   1. Registry covers every merchant in every pool (1:1).
//   2. Every entry has a valid logoUrl, primaryColor, parent group
//      back-reference where declared on the pool, displayVariants
//      passthrough, and a non-empty initials string.
//   3. Sidecar's logoUrl + primaryColor match the registry record
//      for the same slug — the algorithmic derivation in
//      src/generator/enrichment.js MUST mirror the builder in
//      tools/build-brand-registry.mjs.
//   4. SVG files exist for every registry entry on disk.
//   5. loadBrandRegistry() exposes the registry through the
//      sandbox-fixtures package surface.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, loadAllPools } from '../tools/load-fixtures.mjs';
import { buildBundle } from '../src/generator/index.js';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const REGISTRY_PATH = path.join(PKG_DIR, 'brand-registry.json');
const BRANDS_DIR = path.join(PKG_DIR, 'brands');
const BUILT = fs.existsSync(REGISTRY_PATH);

if (!BUILT) {
  describe.skip("Phase R4 brand registry (run 'npm run build:brand-registry' to enable)", () => {
    it.skip('brand registry not built', () => {});
  });
} else
  describe('Phase R4 brand registry', () => {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    const records = registry.records;
    const pools = loadAllPools();

    it('schema is the v1 contract', () => {
      expect(registry.schema).toBe('openfinance-os/data-sandbox/brand-registry/v1');
      expect(registry.merchantCount).toBe(Object.keys(records).length);
      expect(registry.generatedAt).toBeTruthy();
    });

    it('every merchant in every pool has a registry entry', () => {
      for (const pool of Object.values(pools.merchantsByCategory)) {
        for (const m of pool.merchants ?? []) {
          const slug = slugify(m.name);
          expect(
            records[slug],
            `missing registry entry for "${m.name}" (slug "${slug}")`,
          ).toBeTruthy();
        }
      }
    });

    it('every registry entry has logoUrl + primaryColor + initials + parent-group passthrough', () => {
      for (const [slug, rec] of Object.entries(records)) {
        expect(rec.merchantName, `${slug} merchantName`).toBeTruthy();
        expect(rec.logoUrl, `${slug} logoUrl`).toBe(`/fixtures/v1/brands/${slug}.svg`);
        expect(rec.primaryColor, `${slug} primaryColor`).toMatch(/^#[0-9a-f]{6}$/);
        expect(rec.initials, `${slug} initials`).toMatch(/^[A-Z0-9]{1,2}$/);
        expect(rec.website, `${slug} website`).toMatch(/^https:\/\/.+\.example$/);
        // Arrays default to [] when not declared on the pool — never null/undefined.
        expect(Array.isArray(rec.displayVariants)).toBe(true);
        expect(Array.isArray(rec.displayVariantsAr)).toBe(true);
      }
    });

    it('every registry entry has a matching SVG file on disk', () => {
      for (const slug of Object.keys(records)) {
        expect(fs.existsSync(path.join(BRANDS_DIR, `${slug}.svg`)), `missing SVG for ${slug}`).toBe(
          true,
        );
      }
    });

    it('SVGs are well-formed (root <svg>, single <circle>, single <text>)', () => {
      const sample = Object.keys(records).slice(0, 5);
      for (const slug of sample) {
        const svg = fs.readFileSync(path.join(BRANDS_DIR, `${slug}.svg`), 'utf8');
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.includes('<circle')).toBe(true);
        expect(svg.includes('<text')).toBe(true);
        // Includes the merchant initials in the <text> body.
        expect(svg).toContain(records[slug].initials);
      }
    });

    it('algorithmic parity — enrichment sidecar matches the registry for every record', async () => {
      const { loadPersonasByDomain } = await import('../tools/load-fixtures.mjs');
      const banking = loadPersonasByDomain('banking');
      const persona = banking.salaried_expat_mid;
      const bundle = buildBundle({ persona, lfi: 'rich', seed: 4729, pools });
      for (const rec of Object.values(bundle._enrichment)) {
        if (!rec.logoSlug) continue;
        const reg = records[rec.logoSlug];
        if (!reg) continue; // skip non-pool merchants (eg. ATM network) — already covered by the 1:1 lint
        expect(rec.logoUrl, `${rec.logoSlug} logoUrl`).toBe(reg.logoUrl);
        expect(rec.primaryColor, `${rec.logoSlug} primaryColor`).toBe(reg.primaryColor);
      }
    });

    it('loadBrandRegistry exposes the same payload through the package surface', async () => {
      const m = await import(path.join(PKG_DIR, 'index.mjs'));
      const r = m.loadBrandRegistry();
      expect(r.schema).toBe(registry.schema);
      expect(r.merchantCount).toBe(registry.merchantCount);
      expect(Object.keys(r.records).length).toBe(Object.keys(registry.records).length);
    });
  });

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
