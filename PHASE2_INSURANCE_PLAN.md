# Phase 2 — Adding Insurance Data Sharing as a Second Domain

> Companion to `IMPLEMENTATION_PLAN.md` (v1 / v1.5 scope). This document covers Phase 2
> only — the Open Insurance domain extension targeted Q3 2026 (PRD §11), tied to the UAE
> Open Finance Insurance Suite GA in Q2 2026. Phase 2.2 (Open Wealth) is sketched as a
> proof of the abstraction; it gets its own plan once Phase 2.1 ships.

## Context

The OF Data Sandbox is v1 Bank Data Sharing only (PRD §11, NG-3, D-01). Phase 2 (Q3 2026, tied to UAE Insurance Suite GA Q2 2026) extends it with Open Insurance and later Open Wealth. Today the architecture is single-domain: spec parser hardcodes a 12-endpoint `IN_SCOPE_PATHS`, the bundle generator hardcodes 12 banking generators, the LFI redaction map is a hand-curated banking field allowlist, the persona schema has no `domain` field, and the UI has no domain selector. PRD has one unresolved open question, **OQ-EXP-16**, on whether to ingest Insurance's 833 KB v2.1 spec single-file or split-file.

The goal of this plan: a load-bearing refactor that makes "add a domain" a config + new generator files job, with zero edits to the redaction filter — provable when Phase 2.2 lands Open Wealth as the third domain.

The plan deliberately defers any code changes that depend on the Insurance YAML's actual contents. Step 1 is to vendor the spec and let `parse-spec.mjs` introspect it, not to enumerate endpoints from memory.

## Resolution: OQ-EXP-16 → split-file, lazy-loaded per domain

One upstream YAML per domain, one SHA pin per domain, one parsed JSON per domain, lazy-loaded. Banking parsed `dist/SPEC.json` is 326 KB raw / 33 KB gzipped today; Insurance YAML is 833 KB raw, extrapolating to ~85 KB gzipped parsed JSON. Eagerly bundling both alone consumes ~120 KB of EXP-24's 250 KB budget. Lazy-load fixes that and matches D-01's "single pinned SHA" framing cleanly per domain.

A small (~1 KB) eagerly-loaded `dist/domains.json` manifest lists available domains, pin SHAs, default endpoints, and per-domain parsed-JSON URLs. Active-domain SPEC fetched on-demand at boot and on switch.

## Persona schema: separate Insurance personas, narrative-only cross-link

Add a top-level `domain: banking | insurance` discriminator. Banking persona files keep their current shape (move under `personas/banking/`). Insurance personas live under `personas/insurance/` with their own schema (`policies`, `claims`, `premiums`, `insured_items`, `dependents` — exact shape derived from the vendored Insurance spec, not pre-authored). An optional `links.persona_id` cross-ref lets an Insurance persona narratively reference a banking twin without the generator ever reading across files.

Two narrow schemas beat one over-broad union — banking sub-sections like `spend_profile` / `distress_signals` have no Insurance analogue.

## Directory layout

```
spec/
  banking/    SPEC_PIN.sha, SPEC_PIN.retrieved, uae-account-information-openapi.yaml, lfi-bands.yaml
  insurance/  SPEC_PIN.sha, SPEC_PIN.retrieved, uae-insurance-openapi.yaml,         lfi-bands.yaml
personas/
  _schema.banking.yaml      (rename of current _schema.yaml)
  _schema.insurance.yaml    (new)
  banking/    *.yaml        (existing 10 move here unchanged)
  insurance/  *.yaml        (Phase 2.1 — five files)
src/generator/
  index.js                  thin dispatcher on persona.domain
  shared/                   envelope.js, watermark.js, retrieved-timestamp.js (extracted)
  banking/                  existing 10 generate*.js move here verbatim
  insurance/                policies.js, claims.js, premiums.js, parties.js, ... (Phase 2.0 MVP = 3 files)
dist/
  domains.json              eager
  SPEC.banking.json         lazy
  SPEC.insurance.json       lazy
packages/sandbox-fixtures/
  bundles/<domain>/<persona>/<lfi>/seed-<n>/<file>.json
```

One fixtures package, with a new `domain` axis. Loader API stays backward-compatible (`domain` defaults to `'banking'`).

## Critical files to modify

- `tools/parse-spec.mjs` — extract `parseDomain({ domainId, specPath, pinPath, retrievedPath, inScopePaths, outPath, upstreamRepo, upstreamPath })`. The `IN_SCOPE_PATHS` at lines 24–37 moves into a new `tools/domains.config.mjs`. `walkSchema()` (line 60) and `extractEndpointFields()` are reused as-is — already domain-agnostic. Each emitted field record gains `{ domain, band }`; band defaults to `'Unknown'` and is overridden by `spec/<domain>/lfi-bands.yaml` (the only hand-authored input — extend `tools/lint-no-handauthored-fields.mjs` to whitelist exactly that filename per domain).
- `src/generator/index.js` — `buildBundle()` becomes `if (persona.domain === 'banking') return buildBankingBundle(...)`-style dispatch. Shared scaffolding (envelope, EXP-19 watermark, `now` anchor) moves to `src/generator/shared/envelope.js`.
- `src/generator/lfi-profile.js` — delete the hardcoded `OPTIONAL_FIELD_BANDS` (lines 20–34). New signature: `applyLfiProfile({ bundle, personaId, lfi, seed, bandsForDomain })`. Walk the bundle generically: leaf-field path looked up in `bandsForDomain`, decision via existing `shouldKeep()`, mandatory paths skipped categorically (preserving EXP-04). After this change, adding a domain requires no edits here. The file's own line 18 comment ("Phase 1 will move this into the spec parser so band lookups are spec-driven") confirms this was always the trajectory.
- `src/prng.js` — unchanged. `mulberry32`, `seedFromTuple`, `makePrng` are domain-agnostic. Reuse as-is.
- `src/app.js` — replace the hardcoded `ENDPOINTS` array (lines 36–51) with `ENDPOINTS_BY_DOMAIN`, populated from `dist/domains.json`. Add a domain selector control above the persona list. On switch: lazy-fetch `dist/SPEC.<domain>.json`, reset `state.spec`, repopulate persona library with that domain's personas, set default endpoint.
- `src/url.js` — extend with a `domain` query param (less invasive than a path-prefix change; backward-compatible for existing `/p/<personaId>` permalinks). `encodePermalink`, `encodeEmbed`, and `encodeFixtureUrl` all accept and emit `domain`. `decodeFromUrl` reads it; if absent and a known persona ID resolves to a single domain, infer it. EXP-17 reproducibility preserved — the seeded tuple is unchanged, `domain` is just routing.
- `tools/build-fixture-package.mjs` — fixture path becomes `bundles/<domain>/<persona>/<lfi>/seed-<n>/<file>.json`. Manifest grows a `domains[]` field.
- `tests/replay.test.mjs`, `tests/spec-validation.test.mjs`, `tests/lfi-profile.test.mjs`, `tests/persona-manifest.test.mjs` — wrap each suite in `describe.each(getDomains())` (reads `dist/domains.json`). Adding a domain becomes a config addition, not a new test file.
- `tests/fixture-package-completeness.test.mjs` (new) — assert every `(domain, persona, lfi, endpoint, seed)` tuple resolves to exactly one fixture file. Cardinality guard once domains multiply.

## Insurance endpoint scoping — discover, don't guess

1. Vendor `uae-insurance-openapi.yaml` into `spec/insurance/` and pin its SHA. Verify the upstream path (inferred `Nebras-Open-Finance/api-specs:dist/standards/v2.1/uae-insurance-openapi.yaml`) via the `open-finance-uae` skill before committing.
2. Run `parse-spec.mjs --domain insurance --inscope=[]` (introspection mode) to list every `paths.*.get` the spec exposes. That listing is the authoritative endpoint catalog.
3. Tier:
   - **Phase 2.0 MVP** (behind `?domain=insurance` flag, internal only): 3 endpoints — the Insurance equivalents of banking's `/accounts` + `/accounts/{id}` + `/transactions`. Demonstrates the abstraction end-to-end.
   - **Phase 2.1**: full Insurance GET coverage + 5 personas + Appendix-F vocabulary signoff + public selector enabled.

Acceptance: every in-scope endpoint produces output that passes `tests/spec-validation.test.mjs` parameterized by domain.

## Stress-coverage vocabulary (Appendix F extension)

Banking vocabulary moves into `docs/stress-coverage-vocabulary.banking.yaml` (PRD Appendix F verbatim). New `docs/stress-coverage-vocabulary.insurance.yaml` — twelve illustrative draft candidates, pending Phase 2 SME signoff:

`lapsed_policy`, `multi_vehicle_household`, `high_claim_frequency`, `pep_policyholder`, `sharia_takaful_product`, `expat_temporary_coverage`, `non_renewal_pending`, `no_claims_discount_max`, `comprehensive_to_third_party_downgrade`, `coinsured_dependents`, `excess_excluded_peril_dispute`, `motor_total_loss_recent`.

`tests/persona-manifest.test.mjs` extends to load the per-domain vocab file and enforce `stress_coverage` membership.

## Phasing

- **Phase 2.0 (Q3 2026 start)** — foundational refactors: spec parser parameterized, `lfi-profile.js` spec-driven, directory split, persona schema split, UI domain selector behind flag, 3-endpoint Insurance MVP, parameterized tests. **Banking byte-identical to Phase 1 fixtures** — regression-protected by `tests/replay.test.mjs`.
- **Phase 2.1 (Q3 2026 mid)** — full Insurance endpoint coverage, 5 Insurance personas, Appendix-F vocabulary signed off, public domain selector. Lighthouse re-run with both SPEC JSONs lazy-loadable.
- **Phase 2.2 (Q4 2026)** — Open Wealth as third domain. Test of the abstraction: < 1 day of generator code per new endpoint, zero edits to `lfi-profile.js`.

## Resolutions to prior open questions

- **(a) v2.1 Insurance spec at GA → preview-flagged.** Each entry in `dist/domains.json` gets `status: 'ga' | 'preview'`. If Insurance Suite GA slips, Phase 2.0 internal work proceeds against a pre-GA SHA marked `preview`; the public UI domain selector hides `preview` domains unless `?preview=1` is set. D-01's "single pinned SHA per domain" stays intact post-GA — we just don't ship a public selector pointing at a moving target. Cost: one field in `domains.json`, one gate in `src/app.js`.
- **(b) Upstream SHA cadence → weekly upstream-watch CI.** A GitHub Action fetches the latest upstream SHA weekly, runs `parse-spec.mjs` against it, and opens a PR only if the emitted `dist/SPEC.<domain>.json` diff is non-trivial (field added/removed, status changed, enum changed). Wording-only changes in `description:` are ignored. Each PR is the bump policy — a human reviews. Banking has been stable enough in v1 that this rarely fires; Insurance post-GA is the real test. Action lives at `.github/workflows/upstream-spec-watch.yml`.
- **(c) Party-model overlap → separate generators, shared identity helper.** Do not share a `parties.js`. Share `src/generator/shared/identity.js` (name / DOB / nationality sampling from the synthetic-identity-pool — already centralized) and keep `src/generator/banking/parties.js` and `src/generator/insurance/parties.js` separate. Their role enums and field shapes differ (policyholder has `dependents[]`; account-holder doesn't). Sharing the pool is the real win; sharing the schema wrapper over-couples two specs that move on independent SHAs. Reconfirm against the actual Insurance party schema once the YAML is vendored.
- **(d) Cross-domain persona links → keep the field, don't surface it in UI.** `links.persona_id` stays as an authoring convenience (an Insurance persona can document "narratively inspired by `salaried_emirati_affluent`" for stress-coverage parity). The UI never renders it. Surfacing "this persona's banking twin" implies cross-domain identity stitching, which a TPP can't legally do without consents in both domains — NG5-adjacent and the wrong signal to send from a sandbox. Documentation-only field; extend `tools/lint-no-handauthored-fields.mjs` (or a sibling lint) to assert no `src/` file references `links.persona_id`.

## Verification

- `npm run build:spec` produces both per-domain JSONs + `domains.json`. Verify on-boot gzipped bundle (HTML + JS + CSS + `domains.json` + active SPEC) stays < 250 KB. Domain switch triggers a single async fetch ≤ 100 KB gzipped.
- `npm test` runs the parameterized matrix `domain × persona × lfi × seed × endpoint` for replay, schema validation, LFI invariants, persona-manifest conformance.
- Manual smoke: cold-load a Phase 1 banking permalink in Phase 2 build, assert byte-identical render (regression). Switch to Insurance via the new selector — URL updates with `?domain=insurance`, payload renders, watermark intact.
- Lighthouse mobile run after switching domains in the same session — must hold ≥ 90 (EXP-24).
- Replay test: load the same Insurance permalink across two cold builds, assert byte-identical bundle (EXP-05).
- `tools/lint-no-handauthored-fields.mjs` and `tools/lint-no-institution-leak.mjs` pass on the expanded tree without modification beyond the `lfi-bands.yaml` whitelist.
