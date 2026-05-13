#!/usr/bin/env node
// Phase R4 — brand registry builder.
//
// Walks every merchant pool under synthetic-identity-pool/merchants/
// and produces:
//   - packages/sandbox-fixtures/brand-registry.json — one entry per
//     merchant, keyed by `logoSlug` (the slugified canonical name).
//   - packages/sandbox-fixtures/brands/<slug>.svg — algorithmically-
//     generated placeholder mark (initials in a coloured circle,
//     OF-OS visual style). Deterministic on slug, so the same
//     merchant always renders the same logo across builds.
//
// Both artefacts are TPP-facing — copied into _site/fixtures/v1/ by
// stage-site so the staged origin serves /fixtures/v1/brand-registry.json
// and /fixtures/v1/brands/<slug>.svg directly. The fixture package's
// `loadBrandRegistry()` export reads the same JSON locally.
//
// Coverage invariant (enforced by lint-brand-registry-coverage):
// every merchant in any pool must have a registry entry, and every
// registry entry must point back to a pool merchant. The lint stays
// green as long as this builder runs before the package is published.

import fs from 'node:fs';
import path from 'node:path';
import { loadAllPools, repoRoot } from './load-fixtures.mjs';

const OUT = path.join(repoRoot, 'packages/sandbox-fixtures');
const REGISTRY_PATH = path.join(OUT, 'brand-registry.json');
const BRANDS_DIR = path.join(OUT, 'brands');

fs.mkdirSync(BRANDS_DIR, { recursive: true });

const pools = loadAllPools();
const familyGroups = pools.familyGroupsById ?? {};

// slug → registry record. Deduped — the same merchant can never appear
// across two pools today (canonical name is unique), but the dedup is
// here so that's enforceable rather than implicit.
const registry = {};
let svgCount = 0;

for (const pool of Object.values(pools.merchantsByCategory)) {
  for (const m of pool.merchants ?? []) {
    if (!m?.name) continue;
    const slug = slugify(m.name);
    if (!slug) continue;
    if (registry[slug]) {
      // Defensive — fail loudly. A name collision would silently make
      // two merchants share a logo / registry entry.
      throw new Error(`brand-registry: duplicate slug "${slug}" — merchant "${m.name}" collides with prior entry`);
    }
    const color = hashColor(slug);
    const initials = initialsFor(m.name);
    registry[slug] = {
      merchantName: m.name,
      logoUrl: `/fixtures/v1/brands/${slug}.svg`,
      primaryColor: color,
      // Synthetic website slug — keeps the registry shape consistent
      // with a production logo provider (Brandfetch / Clearbit-style)
      // without claiming any real domain.
      website: `https://${slug}.example`,
      parentGroup: m.parent_group ?? null,
      parentGroupAcronym: m.parent_group ? (familyGroups[m.parent_group]?.acronym ?? null) : null,
      displayVariants: Array.isArray(m.display_variants) ? m.display_variants : [],
      displayVariantsAr: Array.isArray(m.display_variants_ar) ? m.display_variants_ar : [],
      mcc: pool.mcc ?? null,
      initials,
    };
    fs.writeFileSync(path.join(BRANDS_DIR, `${slug}.svg`), buildSvg(initials, color));
    svgCount += 1;
  }
}

const out = {
  schema: 'openfinance-os/data-sandbox/brand-registry/v1',
  generatedAt: new Date().toISOString(),
  merchantCount: Object.keys(registry).length,
  records: registry,
};
fs.writeFileSync(REGISTRY_PATH, JSON.stringify(out, null, 2));

console.log(
  `brand-registry built → ${path.relative(repoRoot, REGISTRY_PATH)}\n` +
  `  ${Object.keys(registry).length} merchants · ${svgCount} placeholder SVGs (OF-OS style)`
);

// ─── helpers ────────────────────────────────────────────────────────

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function initialsFor(name) {
  const words = String(name)
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Deterministic 32-bit hash → hue, with fixed saturation + lightness.
// Same algorithm as the FNV-1a variant used elsewhere in the codebase;
// inlined here to avoid pulling shared/prng.js into a build script.
function hashColor(slug) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = ((h >>> 0) % 360);
  // S 55% / L 45% — readable on a light statement-table background,
  // visually distinct between adjacent merchants. Avoids the muted
  // pastels and the screaming primaries.
  return hslToHex(hue, 55, 45);
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 100 - l) / 10000;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = (l / 100) - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    const x = Math.round(v * 255);
    return x.toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function buildSvg(initials, color) {
  // 64×64, centred initials. White text on the brand colour. Pure
  // string-template — no external SVG lib needed. <title> + role
  // attributes carry the merchant initials for assistive tech.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${initials} logo placeholder">
  <title>${initials}</title>
  <circle cx="32" cy="32" r="30" fill="${color}"/>
  <text x="32" y="32" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${initials}</text>
</svg>
`;
}
