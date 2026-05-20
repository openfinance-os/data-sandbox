# @openfinance-os/sandbox-fixtures

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the
[Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox).

38 personas (21 banking + 9 insurance + 8 multi-domain) × 3 LFI profiles ×
every v2.1 endpoint per persona's accounts/policies = **~2,000 fixtures**,
plus the parsed v2.1 OpenAPI specs (banking + insurance) and the persona
manifests. Multi-domain personas are surfaced by both
`loadPersonasByDomain('banking')` and `loadPersonasByDomain('insurance')`,
matching the way the sandbox UI renders them in both tabs.

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

- `bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json` — ~2,000 fixtures across two domains. Banking: 18 personas × 3 LFIs × every Account-Information endpoint per persona's accounts. Insurance: 9 personas (motor, home, health, life, travel, renters, employment) × 3 LFIs × the per-line endpoint set. Each is a v2.1-correct `{ Data, Links, Meta }` envelope plus watermark fields (`_persona`, `_lfi`, `_seed`, `_specSha`).
- `personas/<persona>.json` — persona manifest (demographics, fixed commitments, stress coverage, narrative).
- `spec.json` — the parsed UAE Open Finance v2.1 Account-Information spec, keyed by endpoint with field metadata. The insurance spec is sibling-loadable via `loadSpec({ domain: 'insurance' })`.
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
