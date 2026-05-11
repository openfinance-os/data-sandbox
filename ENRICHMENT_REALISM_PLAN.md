# Enrichment-realism plan

A staged plan to make the sandbox's transaction stream realistic enough
to serve as a credible test feed for a transaction-enrichment engine
(merchant categorisation, name cleaning, logo lookup, location
extraction, MCC correction).

## Context

The current dataset is **conditionally fit** for narrative-cleaning and
MCC-inference tests, but five gaps limit it as a general enrichment
fixture:

1. Only 4 MCC categories (groceries / dining / fuel / utilities), 19 merchants total
2. Narratives are realistically uppercase + truncated, but lack
   aggregator prefixes, terminal IDs, FX clutter, DBA drift, Arabic descriptors
3. MCC ground truth is binary-perfect — no misrouting to correct
4. No logo or brand-reference dataset
5. `MerchantDetails` shipped on the same record as the dirty narrative
   (workable, but a downstream consumer must remember to strip it)

Goal: close those gaps in a way that **preserves every load-bearing
invariant** in `CLAUDE.md` — spec-driven fields, deterministic
generation, no real customer data, no LFI-attributed operational
claims, mandatory-fields-never-redacted, v2.1 schema validity.

## Approach

Extend the existing `src/generator/realism.js` module and the
`synthetic-identity-pool/merchants/` pool set. **No new top-level
fields on `AETransaction`** — anything that doesn't fit v2.1 ships as
either `SupplementaryData` (where the spec allows it) or as a sidecar
reference dataset under `synthetic-identity-pool/`.

Phasing matches PRD style — each phase is independently shippable, lints
+ tests stay green at every phase boundary.

---

## Phase R1 — Broaden the merchant universe (highest impact)

Bring MCC coverage from 4 categories to ~15. Keep merchants fictional
but UAE-plausible (per existing convention; NG4/NG5 unaffected since
merchants aren't institutions).

New pools to add under `synthetic-identity-pool/merchants/`, each as a
YAML file shaped like `groceries.yaml`:

| New pool             | MCC      | Examples (fictional, UAE-plausible)              |
|----------------------|----------|---------------------------------------------------|
| `ride_hailing.yaml`  | 4121     | DesertRide, OasisGo, MarinaCab                    |
| `ecommerce.yaml`     | 5399 / 5961 | DuneDirect, GulfShop, SandboxBazaar           |
| `entertainment.yaml` | 7832 / 7922 | MirageCinemas, OasisArena, DesertSkyEvents    |
| `healthcare.yaml`    | 8011 / 5912 | CrescentClinic, PalmPharmacy, OasisLab         |
| `travel_air.yaml`    | 4511     | GulfWingAir, EmiratesSky (fictional), DesertJet   |
| `travel_hotel.yaml`  | 7011     | OasisStay, CrescentHotels, MarinaResorts          |
| `transport.yaml`     | 4111 / 4112 | MetroCard top-up, NolBalance, Salik            |
| `government.yaml`    | 9311 / 9399 | RTA, DubaiNow, FAHR, MOI fees                  |
| `telecom.yaml`       | 4814     | Beacon Mobile (existing) + 2 more                 |
| `education.yaml`     | 8220 / 8299 | OasisAcademy, GulfTutors                       |
| `subscriptions.yaml` | 5815 / 4899 | DesertStream, OasisMusic, SandboxNews          |
| `atm_withdrawal.yaml`| 6011     | (no merchant; pool of ATM-location codes)         |

Each pool entry carries: `name`, `mcc`, `display_variants[]` (DBA
drift, abbreviated forms, ALL-CAPS truncations), `terminal_prefixes[]`,
`typical_amount_band` (so PRNG draws plausible values), `weight` (draw
frequency).

Plus a per-persona **spend-profile registry** so the generator picks
categories appropriate to the persona: a Senior persona spends on
healthcare + utilities, an SME spends on suppliers + fuel, an expat
family spends on grocery + ride-hailing + travel.

Files to add:
- `synthetic-identity-pool/merchants/{ride_hailing,ecommerce,entertainment,healthcare,travel_air,travel_hotel,transport,government,telecom,education,subscriptions,atm_withdrawal}.yaml`
- `src/generator/banking/spend-profiles.js` — persona → category-weight map
- Extend `src/generator/transactions.js` to dispatch through the spend profile

---

## Phase R2 — Dirty up the narratives

Extend `src/generator/realism.js` with a richer narrative grammar.
Keep `bankishNarrative()` as the base; layer optional dirtying.

New helpers in `realism.js`:

- **`aggregatorPrefix(channel, rng)`** — prepends realistic
  payment-rail noise: `TST*`, `SQ *`, `PYPL*`, `STRP*`, `APL*`,
  `GPAY*`, `NOON*`, `CRT*` based on channel weights.
- **`merchantNumberSuffix(rng)`** — appends a 4-7 digit terminal /
  merchant ID (e.g. `... 84421`, `... 30188`).
- **`emirateCode(rng)`** — picks from `DXB|AUH|SHJ|AJM|RAK|UAQ|FUJ`
  weighted by population. Already partially used; codify it.
- **`dbaDrift(canonicalName, rng, drift = 0.3)`** — with probability
  `drift`, returns an alternate display form drawn from
  `display_variants[]` for that merchant; otherwise the canonical
  abbreviation. Lets the same merchant appear as both `MARKETMARK` and
  `MMARK HYPRMKT` across transactions.
- **`fxClutter(narrative, ccy, rng)`** — for cross-currency
  transactions, append `<CCY> <amt>` and an originating-country code
  (`STARBUCKS LDN GBP 4.20`).
- **`arabicDescriptor(merchant, rng, prob = 0.1)`** — with low
  probability, emit the narrative in Arabic-Latin transliterated form
  (e.g. `MAHATTA WAQOOD` for fuel station). Requires a parallel
  `display_variants_ar` column on merchant pools.

All five compose: `dbaDrift → aggregatorPrefix → bankishNarrative →
merchantNumberSuffix → emirateCode`. Each is opt-in and probability-
gated, so the existing replay tests (deterministic snapshots) only
break where we explicitly enable the new layers.

Hard constraint: every output must still fit `TransactionInformation`'s
v2.1 length bound. Wrap the final assembly in the existing 22-char
truncation, OR check the spec's actual `maxLength` and lift the cap if
it's higher than 22.

Files to modify:
- `src/generator/realism.js` — new helpers
- `src/generator/transactions.js` — opt into new helpers per channel
- `synthetic-identity-pool/merchants/*.yaml` — add `display_variants`,
  `display_variants_ar`, `terminal_prefixes`

---

## Phase R3 — Controlled MCC noise (tests engine's MCC-correction)

Today every emitted MCC is "correct". Real card networks misroute
constantly. Add a configurable noise layer.

In `src/generator/transactions.js`:

- Add a `mccNoiseRate` param (default `0.05` = 5% of card txns get a
  wrong-but-plausible MCC, drawn from a confusion table).
- Build a `mcc-confusion.yaml` under
  `synthetic-identity-pool/merchants/` mapping `correctMcc → [{wrong,
  weight, reason}]`. Examples:
  - `5541 → 5411 (petrol convenience store rings as grocery)`
  - `5812 → 5814 (cafe rings as fast-food)`
  - `5912 → 5411 (pharmacy in supermarket)`
- Tag noisy transactions with an internal `_mccNoiseApplied: true`
  field, **stripped on export** (per the existing `_*` convention in
  `src/ui/export.js:16-23`). Ground truth still ships clean in
  `MerchantDetails.MerchantCategoryCode`; the noise is in the dirty
  narrative's category cues only.

This way the enrichment engine's MCC-correction logic can be scored
end-to-end: did it spot the misrouted ones?

Files to add/modify:
- `synthetic-identity-pool/merchants/mcc-confusion.yaml`
- `src/generator/transactions.js` — apply noise post-draw, pre-narrative

---

## Phase R4 — Logo / brand reference sidecar

v2.1 doesn't define a logo field — don't shoehorn one into
`MerchantDetails`. Instead ship a separate, opt-in reference dataset.

New artefact: `synthetic-identity-pool/merchants/_brand-registry.json`
(generated, gitignored; built by a new `tools/build-brand-registry.mjs`).
Shape:

```json
{
  "Marketmark Hypermarket": {
    "merchantId": "M-MARKETMARK",
    "logoUrl": "/fixtures/v1/brands/marketmark.svg",
    "primaryColor": "#1f7a44",
    "website": "https://marketmark.example",
    "displayVariants": ["MARKETMARK", "MMARK HYPR", "MARKETMRK HYP"]
  }
}
```

Distribute under:
- `_site/fixtures/v1/brands/<slug>.svg` — placeholder SVG per merchant
  (geometric mark, OF-OS visual style — no real brand logos)
- `_site/fixtures/v1/brand-registry.json` — the lookup table
- Re-export from `@openfinance-os/sandbox-fixtures` as
  `loadBrandRegistry()`

Critical: the registry is a **separate enrichment-target dataset**, not
part of the v2.1 envelope. An enrichment engine resolves
`MerchantName` → registry → `logoUrl`. Same shape a TPP would use
against a production logo provider (Brandfetch, Clearbit-style).

Files to add:
- `tools/build-brand-registry.mjs`
- `tools/stage-site.mjs` — extend to copy the registry + brand SVGs
- `packages/sandbox-fixtures/index.js` — export `loadBrandRegistry`
- New lint: `lint-brand-registry-coverage` — every merchant in every
  pool must have a registry entry, every registry entry must reference
  a merchant in some pool

---

## Phase R5 — Edge cases that wreck naïve enrichers

A short list of high-value edge cases worth seeding:

- **Refund linking** — emit refund/reversal transactions whose
  narrative shares the original merchant cue but uses a `RFD/` or
  `REV/` prefix. Enrichment should pair them.
- **Recurring subscriptions** — same merchant + same amount + monthly
  cadence. Enrichment should classify as recurring vs one-off. Already
  half-modelled by standing orders; extend to card-recurring (Netflix-
  style) where the standing-order endpoint wouldn't show it.
- **Tip-bearing dining** — split base + tip in the narrative
  (`POS/CEDARPLATE+T 18%`) — enrichment should recover base amount.
- **Multi-currency same merchant** — same coffee chain in DXB (AED) +
  LDN (GBP), enrichment should cluster as one merchant.
- **ATM withdrawals at on-us vs off-us terminals** — different fee
  semantics, same MCC.
- **Failed/declined retries** — same merchant within minutes,
  same/similar amount, only one settles. Enrichment must dedupe.

Most of these are small additions to `src/generator/transactions.js`
gated by per-persona `enable_<edge>` flags so opt-in test suites can
exercise them without bloating every bundle.

---

## Phase R6 — Persona-level realism

Beyond per-transaction realism, the **shape** of a persona's spend
matters for category-mix tests. Add to each persona manifest under
`personas/`:

- `spend_profile_id` — references one of the new spend profiles
- `seasonal_overrides` — e.g. travel persona spikes in Eid + summer
- `lifecycle_events` — one-off salary bonus, school-fee blocks,
  vehicle-registration spikes (RTA category)

These already partially exist via `lifestyle_modifiers` in some
personas — codify the convention and extend.

Files to modify:
- `personas/*.yaml` — add new optional keys
- `tools/load-fixtures.mjs` — surface the new keys
- `src/generator/transactions.js` — consume them

---

## Order of operations (recommended)

1. **R1** first — biggest impact, no risk to existing tests, isolated
   to new files + a dispatcher hook
2. **R2** next — narrative dirtying. Will require regenerating
   snapshot tests and re-running the spec-conformance lint. Likely
   1-2 days of test churn.
3. **R3** in parallel with R2 — orthogonal change, low test impact
4. **R4** next — sidecar dataset, doesn't touch the v2.1 envelope at all
5. **R5** opt-in, can ship anytime
6. **R6** last — persona manifests are easy to revise, do once the new
   merchant pools are stable

Each phase ships with: new pool YAMLs / module changes, updated
snapshot tests, an entry in `CHANGELOG.md`, and a lint extension where
applicable.

---

## Critical files

- `src/generator/transactions.js` (617 lines) — primary modification site
- `src/generator/realism.js` (165 lines) — extend with new dirtying helpers; **reuse**, don't duplicate
- `src/ui/export.js:16-23` — `strip()` convention for internal `_*`
  fields; new internal flags must follow it
- `synthetic-identity-pool/merchants/*.yaml` — new pools + extended
  schema for existing pools
- `personas/*.yaml` — spend-profile attachments (R6)
- `tools/build-brand-registry.mjs` (new) + `tools/stage-site.mjs`
  (extend)
- `packages/sandbox-fixtures/index.js` — export `loadBrandRegistry`
- `tests/generator/transactions.test.js` (and snapshots) — will need
  refresh after R2/R3
- New lints: `lint-brand-registry-coverage`,
  `lint-merchant-pool-schema`

## Invariants this plan preserves

- **Spec-driven fields (EXP-01)** — no hand-authored field tables; all
  new merchant data flows through pools + parser
- **Deterministic generation (EXP-05)** — every new helper takes the
  PRNG instance; same `(persona, lfi, seed)` still yields byte-identical
  output for any given realism configuration
- **Mandatory fields never redacted (EXP-04)** — narrative dirtying
  affects only optional/conditional content of `TransactionInformation`
- **v2.1 schema validity (EXP-10)** — no new top-level fields on
  `AETransaction`; logo data ships sidecar; length bounds respected
- **No real customer data (NG4)** — all merchants remain fictional
- **No institution-specific operational detail (NG5)** — merchants
  aren't institutions; LFI profiles untouched
- **Watermark every export (EXP-19)** — sidecar registry inherits the
  same watermark stamping

## Verification

For each phase:

- `npm run ci` stays green (spec parse + 6 lints + ~1668 vitest tests)
- `npm run build:site` succeeds; staged `_site/fixtures/v1/` carries
  the new pools and (R4) the brand registry
- New diversity check: across 100 sampled persona×lfi×seed bundles,
  count distinct merchants, distinct MCCs, distinct narrative templates;
  assert minimums (e.g. ≥ 12 MCCs, ≥ 80 merchants, ≥ 30 narrative shapes)
- End-to-end smoke: run the future enrichment-engine harness against
  the data; confusion matrix for MCC accuracy should be non-trivially
  populated (proves R3's noise is reaching the input side); name-recovery
  similarity histogram should show a long tail (proves R2's DBA drift
  is producing real ambiguity)
- Sample 5 transactions per phase via the MCP server (`set_session` +
  `get_transactions`) and eyeball that the `TransactionInformation`
  strings actually look like things you've seen on a real bank statement

## Out of scope

- Anything that changes the v2.1 envelope shape — strictly additive
  via `SupplementaryData` or sidecar
- Real merchant brands / logos — fictional only, per existing convention
- Detection-evasion realism (timing patterns engineered to defeat fraud
  models) — wrong tool, wrong dataset
- Insurance domain — same realism principles would apply but a separate
  plan; this doc is banking-only

## Open questions for the maintainer

Before starting any phase, confirm:

1. Phase R1 scope — happy with the 12 new pools listed, or trim/extend?
2. Phase R4 — sidecar dataset feels right for logos vs. `SupplementaryData`
   on the envelope?
3. Phase R3 — 5% MCC noise rate the right default, or higher to make
   the testing signal stronger?
4. Acceptable scope of test-snapshot churn from R2 (likely 100s of
   updated snapshot files)?
