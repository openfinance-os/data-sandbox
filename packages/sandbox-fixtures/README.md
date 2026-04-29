# @openfinance-os/sandbox-fixtures

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the
[Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox).

10 personas × 3 LFI profiles × 12 endpoints = **360 fixtures**, plus the
parsed v2.1 OpenAPI spec and the persona manifests.

## Install

```
npm install @openfinance-os/sandbox-fixtures
```

## Use

```js
import { loadFixture, listPersonas, listEndpoints, loadSpec } from '@openfinance-os/sandbox-fixtures';

const sara = loadFixture({
  persona: 'salaried_expat_mid',
  lfi: 'median',
  endpoint: '/accounts/{AccountId}/transactions',
});
// → v2.1-shaped envelope: { Data: { AccountId, Transaction: [...] }, Links, Meta, _watermark, ... }

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

- `bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json` — 360 fixtures (10 × 3 × 12). Each is a v2.1-correct `{ Data, Links, Meta }` envelope plus watermark fields (`_persona`, `_lfi`, `_seed`, `_specSha`).
- `personas/<persona>.json` — persona manifest (demographics, fixed commitments, stress coverage, narrative).
- `spec.json` — the parsed UAE Open Finance v2.1 OpenAPI spec, keyed by endpoint with field metadata.
- `manifest.json` — top-level index keyed by `<persona>|<lfi>|<seed>`.

## Determinism

Every fixture is a pure function of `(persona_id, lfi_profile, seed, build-time now-anchor)`. Same package version → byte-identical fixtures. Pin the package, pin your tests.

## Spec version

UAE Open Finance Standards `v2.1`, vendored from `Nebras-Open-Finance/api-specs:ozone` at the SHA recorded in `manifest.json.specSha`.

## Licensing

- **Loader code** (`index.mjs`, `index.cjs`, `index.d.ts`): MIT
- **Synthetic data** (`bundles/*`, `personas/*`): CC0 — public domain

## Reporting issues

[github.com/openfinance-os/data-sandbox/issues](https://github.com/openfinance-os/data-sandbox/issues) — every fixture's source is the live sandbox at https://openfinance-os.github.io/data-sandbox/.
