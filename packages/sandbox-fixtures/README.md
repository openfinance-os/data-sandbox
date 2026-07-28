# @openfinance-os/sandbox-fixtures

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the
[Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox).

39 personas (21 banking + 8 multi-domain + 9 insurance + 1 atm) × 3 LFI profiles ×
every v2.1 endpoint per persona's accounts/policies = **6,428 fixture files**,
plus the parsed v2.1 OpenAPI specs for all three domains (banking +
insurance + ATM Locator) and the persona manifests. Multi-domain personas
are surfaced by both `listPersonas({ domain: 'banking' })` (29 personas)
and `listPersonas({ domain: 'insurance' })` (17 personas), matching the
way the sandbox UI renders them in both tabs.

## Install

```
npm install @openfinance-os/sandbox-fixtures
```

## Use

```js
import { loadFixture, loadJourney, listPersonas, listEndpoints, loadSpec } from '@openfinance-os/sandbox-fixtures';

const sara = loadFixture({
  persona: 'salaried_expat_mid',
  lfi: 'median',
  endpoint: '/accounts/{AccountId}/transactions',
});
// → v2.1-shaped envelope: { Data: { AccountId, Transaction: [...] }, Links, Meta, _watermark, ... }

const journey = loadJourney({ persona: 'salaried_expat_mid', lfi: 'median' });
// → { persona, lfi, seed, accountIds, customerId, specVersion, specSha, version,
//     endpoints: { '/accounts': envelope, '/parties': envelope,
//       '/accounts/{AccountId}/balances': envelope, ... all endpoints, all coherent } }
// AccountIds, CustomerId line up across every endpoint — drop-in replacement for
// the data your TPP demo currently fetches from the Nebras-operated regulatory
// sandbox, which ships intentionally thin mock data.

listPersonas();
// → ['salaried_expat_mid', 'salaried_emirati_affluent', ...]

listEndpoints('hnw_multicurrency');
// → ['/accounts', '/accounts/{AccountId}', '/accounts/{AccountId}/balances', ...]

loadSpec();
// → parsed SPEC object — every field's status, type, format, enum, conditional rules
```

CommonJS works too:

```js
const { loadFixture } = require('@openfinance-os/sandbox-fixtures');
```

## What's in the box

- `bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json` — 6,428 fixture files across three domains (banking · insurance across all 7 lines — motor, home, health, life, travel, renters, employment · ATM Locator). Banking: 29 personas (incl. 8 multi-domain). Insurance: 17 personas (incl. the same 8 multi-domain). Each is a v2.1-correct `{ Data, Links, Meta }` envelope plus watermark fields (`_persona`, `_lfi`, `_seed`, `_specSha`).
- `personas/<persona>.json` — persona manifest (demographics, fixed commitments, stress coverage, narrative).
- `spec.json` / `spec.insurance.json` / `spec.atm.json` — the parsed UAE Open Finance v2.1 specs, keyed by endpoint with field metadata. Load via `loadSpec()` / `loadSpec({ domain: 'insurance' })` / `loadSpec({ domain: 'atm' })`.
- `enrichment/<persona>/seed-<n>.json` + `brand-registry.json` + `brands/*.svg` — enrichment sidecars and the slug-keyed brand registry (see below).
- `manifest.json` — top-level index keyed by `<persona>|<lfi>|<seed>`.
- `pools.json` + `lib/` — the vendored runtime engine for custom personas (see below).

All data files are also importable as subpaths, e.g.
`import manifest from '@openfinance-os/sandbox-fixtures/manifest.json' with { type: 'json' }`
— the exports map exposes `./manifest.json`, `./spec*.json`, `./pools.json`,
`./brand-registry.json`, `./bundles/*`, `./personas/*`, `./enrichment/*`,
`./brands/*`, `./lib/*`, and `./package.json`.

## Pagination helpers

`loadFixturePage({ persona, endpoint, lfi, seed, offset, limit })` returns one
page of a listing endpoint the way a real LFI would: the array under `Data`
is sliced, `Links.{Self,First,Next,Prev,Last}` and `Meta.TotalPages` are
populated, and a `_pagination` sidecar exposes the resolved page state.
Pure helpers are exported too: `paginateEnvelope`, `parsePaginationParams`,
`isPaginatableEnvelope`, `findListKey`, and `PAGINATION_DEFAULTS`
(default limit 25, max 500). Note: on the CommonJS entry `loadFixturePage`
is **async** (await it), and the pure helpers are reached via the
`getPagination()` accessor.

## Role bundles (multi-LFI footprints)

Personas declaring a `multi_lfi_footprint` ship extra role bundles — the
same customer seen from their secondary/tertiary (or Phase 2.2 N-slot)
banking relationships. `listRoleBundles(personaId)` returns the emitted
slot keys; pass `lfi_role` to `loadFixture` / `loadFixturePage` /
`loadJourney` to read them. Cross-bundle IBAN identity holds: the role
bundle's account IBAN byte-matches the corresponding self-beneficiary in
the primary bundle.

## Enrichment sidecar + brand registry

`loadEnrichment({ persona, seed })` returns the per-(persona, seed)
enrichment sidecar — cleaned merchant, corrected MCC, category taxonomy,
logo slug/URL, brand colour, parent-group, and MCC-misrouting metadata —
joined to the raw envelopes by `TransactionId`. `loadBrandRegistry()`
returns the slug-keyed brand registry (logo URL, primary colour, display
variants; the `logoSlug` on an enrichment record is the join key). Logos
are algorithmically-generated placeholders — no real brand marks.

## Custom personas (recipe codec + runtime engine)

The full generator ships in `lib/`: compose a recipe and run it in-process
for the same v2.1 envelopes as the static fixtures, no network needed.
ESM exports: `buildBundle`, `expandRecipe`, `encodeRecipe`, `decodeRecipe`,
`recipeHash`, `validateRecipe`, `RECIPE_DEFAULTS`, `envelopesFromBundle`,
and `getPools()` for the serialised synthetic-identity pools. On the
CommonJS entry these are reached via the async `getEngine()` accessor.

## Determinism

Every fixture is a pure function of `(persona_id, lfi_profile, seed, build-time now-anchor)`. Same package version → byte-identical fixtures. Pin the package, pin your tests.

## Spec version

UAE Open Finance Standards `v2.1`, vendored from `Nebras-Open-Finance/api-specs:ozone` at the SHA recorded in `manifest.json.specSha`.

## Licensing

- **Loader code** (`index.mjs`, `index.cjs`, `index.d.ts`): MIT
- **Synthetic data** (`bundles/*`, `personas/*`): CC0 — public domain

## Reporting issues

[github.com/openfinance-os/data-sandbox/issues](https://github.com/openfinance-os/data-sandbox/issues) — every fixture's source is the live sandbox at https://openfinance-os.github.io/data-sandbox/.
