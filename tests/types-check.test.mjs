// E-01 — TypeScript consumer gate for @openfinance-os/sandbox-fixtures.
//
// Before this gate existed the published package had no `types` field and no
// `types` condition in its exports map, so every TS consumer under
// moduleResolution node16/bundler got TS7016 and the 250-line .d.ts was dead
// weight. This suite builds a hermetic smoke-consumer project in a temp dir
// (node_modules symlink → the built package, so the real exports map is
// exercised) and runs `tsc --noEmit` under node16 resolution.
//
// Skip-gating follows tests/fixture-package.test.mjs (FIXTURES_BUILT), plus
// a clean skip when no TypeScript compiler is reachable — `typescript` is
// not currently a root devDependency (noted in APP_IMPROVEMENT_PLAN E-01);
// CI images and `npx tsc` normally provide it.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../tools/load-fixtures.mjs';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const FIXTURES_BUILT =
  fs.existsSync(path.join(PKG_DIR, 'manifest.json')) &&
  fs.existsSync(path.join(PKG_DIR, 'package.json')) &&
  fs.existsSync(path.join(PKG_DIR, 'index.d.ts'));

// Find a usable tsc: local install first (npx --no-install), then a global.
function findTsc() {
  for (const candidate of [
    ['npx', ['--no-install', 'tsc']],
    ['tsc', []],
  ]) {
    const [cmd, prefix] = candidate;
    const probe = spawnSync(cmd, [...prefix, '--version'], { encoding: 'utf8' });
    if (probe.status === 0 && /Version \d/.test(probe.stdout ?? '')) {
      return { cmd, prefix };
    }
  }
  return null;
}
const TSC = FIXTURES_BUILT ? findTsc() : null;

// The smoke consumer — exercises the documented surface AND the .d.ts fixes
// (Domain/DomainLabel with 'multi', PersonaInfo.domains + footprints,
// Journey.lfi_role, pagination types, recipe codec, CJS async accessors).
const SMOKE_TS = `
import {
  manifest,
  listPersonas,
  getPersonaInfo,
  listEndpoints,
  listRoleBundles,
  loadFixture,
  loadFixturePage,
  loadJourney,
  loadSpec,
  loadPersonaManifest,
  loadEnrichment,
  loadBrandRegistry,
  getPools,
  buildBundle,
  expandRecipe,
  encodeRecipe,
  decodeRecipe,
  recipeHash,
  validateRecipe,
  envelopesFromBundle,
  paginateEnvelope,
  parsePaginationParams,
  isPaginatableEnvelope,
  findListKey,
  PAGINATION_DEFAULTS,
  RECIPE_DEFAULTS,
  getEngine,
  getPagination,
} from '@openfinance-os/sandbox-fixtures';
import type {
  Domain,
  DomainLabel,
  LfiProfile,
  Manifest,
  PersonaInfo,
  FixtureEntry,
  RoleFixtureEntry,
  Journey,
  MultiLfiFootprint,
  SlotsMultiLfiFootprint,
  LegacyMultiLfiFootprint,
  MultiInsurerFootprint,
  FootprintSlot,
  PaginatedEnvelope,
  EnrichmentSidecar,
  BrandRegistry,
  CustomRecipe,
  Engine,
} from '@openfinance-os/sandbox-fixtures';

// --- manifest + persona metadata ------------------------------------------
const m: Manifest = manifest;
const versions: Record<string, string> | undefined = m.specVersions;
const roleFixtures: Record<string, RoleFixtureEntry> | undefined = m.roleFixtures;

const all: string[] = listPersonas();
const banking: string[] = listPersonas({ domain: 'banking' });
const atm: string[] = listPersonas({ domain: 'atm' });

const info: PersonaInfo | null = getPersonaInfo(all[0] ?? '');
if (info) {
  // DomainLabel must admit 'multi'; Domain must not.
  const label: DomainLabel = info.domain;
  const multiLabel: DomainLabel = 'multi';
  const declared: Domain[] | undefined = info.domains;
  // Footprints — both the legacy triad AND the Phase 2.2 slots[] shape.
  const fp: MultiLfiFootprint | null | undefined = info.multi_lfi_footprint;
  if (fp && 'slots' in fp) {
    const slots: FootprintSlot[] = (fp as SlotsMultiLfiFootprint).slots;
    const candidates: string[] | undefined = slots[0]?.plausible_lfi_candidates;
  } else if (fp) {
    const legacy: LegacyMultiLfiFootprint = fp;
    const role: string | undefined = legacy.primary?.role;
  }
  const ifp: MultiInsurerFootprint | null | undefined = info.multi_insurer_footprint;
  const insurers: string[] | undefined = ifp?.slots[0]?.plausible_insurer_candidates;
}

const legacyShape: MultiLfiFootprint = {
  primary: { role: 'operating' },
  secondary: { role: 'acquiring' },
};
const slotShape: MultiLfiFootprint = {
  slots: [{ key: 'salary', role: 'salary_primary', plausible_lfi_candidates: ['x'] }],
};

// --- fixtures + journeys ---------------------------------------------------
const endpoints: string[] = listEndpoints(all[0] ?? '', 'median');
const slots: string[] = listRoleBundles(all[0] ?? '');
const env: unknown = loadFixture({ persona: all[0] ?? '', endpoint: '/accounts', lfi_role: 'secondary' });
const journey: Journey = loadJourney({ persona: all[0] ?? '', lfi: 'rich', lfi_role: 'secondary' });
const role: string = journey.lfi_role;
const journeyDomain: DomainLabel = journey.domain;
const lfi: LfiProfile = journey.lfi;

// --- pagination ------------------------------------------------------------
const page: PaginatedEnvelope = loadFixturePage({
  persona: all[0] ?? '',
  endpoint: '/accounts',
  offset: 0,
  limit: 25,
});
const hasNext: boolean = page._pagination.hasNext;
const defaults: { readonly defaultLimit: number; readonly maxLimit: number } = PAGINATION_DEFAULTS;
// URLSearchParams comes from @types/node / lib.dom in a real consumer; the
// smoke project deliberately runs with neither, so extract the parameter
// type from the signature instead of naming the global.
declare const searchParams: Parameters<typeof parsePaginationParams>[0];
const parsed = parsePaginationParams(searchParams);
const paginatable: boolean = isPaginatableEnvelope(env);
const listKey: string | null = findListKey(env);
const repaged: unknown = paginateEnvelope(env, { offset: 0, limit: 10, requested: true });

// --- specs / enrichment / brands ------------------------------------------
const bankingSpec: unknown = loadSpec();
const atmSpec: unknown = loadSpec({ domain: 'atm' });
const personaManifest: unknown = loadPersonaManifest(all[0] ?? '');
const sidecar: EnrichmentSidecar = loadEnrichment({ persona: all[0] ?? '' });
const recordCount: number = Object.keys(sidecar.records).length;
const registry: BrandRegistry = loadBrandRegistry();

// --- runtime engine + recipe codec ----------------------------------------
const pools = getPools();
const recipe: CustomRecipe = { segment: 'Retail', spend_intensity: 'med' };
const encoded: string = encodeRecipe(recipe);
const decoded: CustomRecipe = decodeRecipe(encoded);
const hash: string = recipeHash(recipe);
const validation = validateRecipe(recipe, pools);
if (!validation.ok) {
  const errors: string[] = validation.errors;
}
const expanded: unknown = expandRecipe(RECIPE_DEFAULTS, pools);
const bundle: unknown = buildBundle({ persona: expanded, lfi: 'median', seed: 1, pools });
const envs: Record<string, unknown> = envelopesFromBundle(bundle, {
  personaId: 'custom',
  lfi: 'median',
  seed: 1,
  retrievedAt: new Date().toISOString(),
});

// --- CJS-only async accessors (declared + documented in the .d.ts) --------
async function cjsSurface(): Promise<void> {
  const engine: Engine = await getEngine();
  const b: unknown = engine.buildBundle({ persona: expanded, lfi: 'sparse', seed: 2, pools });
  const pagination = await getPagination();
  const lim: number = pagination.PAGINATION_DEFAULTS.defaultLimit;
}

export {};
`;

if (!FIXTURES_BUILT) {
  describe.skip("E-01 types check (run 'npm run build:fixtures' to enable)", () => {
    it.skip('fixture package not built — run `npm run build:fixtures`', () => {});
  });
} else if (!TSC) {
  describe.skip('E-01 types check (no TypeScript compiler found — add `typescript` to devDependencies)', () => {
    it.skip('tsc unavailable — install typescript to enable this gate', () => {});
  });
} else {
  describe('E-01 TypeScript consumer gate — @openfinance-os/sandbox-fixtures', () => {
    it('package.json exposes types field + a leading types condition', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
      expect(pkg.types).toBe('./index.d.ts');
      const rootEntry = pkg.exports['.'];
      expect(rootEntry.types).toBe('./index.d.ts');
      // The `types` condition must come FIRST — conditions are matched in
      // object order, and a types condition after import/require is ignored.
      expect(Object.keys(rootEntry)[0]).toBe('types');
      // Shipped-but-previously-unexported subpaths.
      for (const sub of [
        './package.json',
        './brand-registry.json',
        './enrichment/*',
        './brands/*',
        './pools.json',
      ]) {
        expect(pkg.exports[sub], `missing exports entry ${sub}`).toBeDefined();
      }
    });

    it('tsc --noEmit passes on a node16 smoke consumer of the main exports', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-fixtures-types-'));
      try {
        // Hermetic consumer: resolve the package through a real node_modules
        // symlink so the exports map + types condition are what tsc sees.
        const scopeDir = path.join(tmp, 'node_modules', '@openfinance-os');
        fs.mkdirSync(scopeDir, { recursive: true });
        fs.symlinkSync(PKG_DIR, path.join(scopeDir, 'sandbox-fixtures'), 'junction');
        fs.writeFileSync(
          path.join(tmp, 'package.json'),
          JSON.stringify({ name: 'types-smoke-consumer', private: true, type: 'module' }, null, 2),
        );
        fs.writeFileSync(path.join(tmp, 'smoke.ts'), SMOKE_TS);
        fs.writeFileSync(
          path.join(tmp, 'tsconfig.json'),
          JSON.stringify(
            {
              extends: path.join(repoRoot, 'tsconfig.types-check.json'),
              files: ['smoke.ts'],
            },
            null,
            2,
          ),
        );
        const res = spawnSync(TSC.cmd, [...TSC.prefix, '--noEmit', '-p', tmp], {
          encoding: 'utf8',
          cwd: repoRoot,
          timeout: 120_000,
        });
        const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim();
        expect(res.status, `tsc --noEmit failed:\n${output}`).toBe(0);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }, 120_000);
  });
}
