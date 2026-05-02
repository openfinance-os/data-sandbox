# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

Phase 1 has shipped and Phase 1.5 is largely in. The repo contains source, tests, build tooling, two distribution packages (npm + PyPI), a worked TPP integration example, and a stage-to-`_site/` pipeline. The PRD remains the source of truth for new features and decisions — **do not invent behaviour that contradicts it.**

Key documents in the repo:
- `PRD_OF_Data_Explorer.md` (v0.9, draft) — the product spec.
- `IMPLEMENTATION_PLAN.md` — current execution plan.
- `PHASE2_INSURANCE_PLAN.md` — Phase 2 insurance-domain plan (motor MVP partially landed).
- `CHANGELOG.md` — running log of shipped slices.
- `PRD_OF_Data_Explorer_Review.md` — historical (Tier-1 items folded into v0.5–v0.8; remainder closed in v0.9).
- `PRD_OF_Data_Explorer_Spec_Validation.md` — applies to the prototype HTML, not the PRD.
- `PRD_OF_Data_Explorer_Deployment.md` — superseded (hosting locked to OF-OS Commons per D-05).
- `of-sandbox-prototype.html` — original single-file prototype; basis for the v1 build.

## What the product is

An interactive, **client-side static** sandbox that lets a TPP-perspective user load synthetic UAE customer personas and explore every UAE Open Finance Bank Data Sharing payload they would receive — with mandatory/optional/conditional field treatment derived live from the published OpenAPI spec. Hosted as a contribution to OpenFinance-OS Commons. Bank Data Sharing only in v1; Open Wealth/Insurance/Service Initiation are v2+.

## Architecture (PRD §6, as built)

- **Frontend**: vanilla HTML/CSS/JS, no build chain. Sources under `src/`. Entry: `src/index.html` + `src/app.js`. The `/integrate` page (`src/integrate.html` + `src/integrate.js`) documents the four TPP plug-points.
- **Synthetic generator**: runs entirely in the browser (and in Node for tests). Deterministic seeded PRNG (mulberry32) at `src/prng.js`. Entry: `buildBundle()` at `src/generator/index.js:86`, dispatching to `src/generator/banking/` or `src/generator/insurance/`. `(persona_id, lfi_profile, seed)` → bundle is a pure function.
- **Spec source**: vendored at `spec/uae-account-information-openapi.yaml` from `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/`, **pinned by commit SHA**. Insurance baseline at `spec/uae-insurance-openapi.yaml`. The pinned SHA is exposed in `dist/SPEC.json#pinSha`, the UI top bar, `/about`, and the fixture-package manifest.
- **Build-time tooling** (`tools/`): `parse-spec.mjs` walks the vendored YAML and emits `dist/SPEC.json` (banking) + `dist/SPEC.insurance.json`; `build-data.mjs` builds `dist/data.json` (personas + pools); `build-fixture-package.mjs` + `build-fixture-package-py.mjs` generate the npm and PyPI packages; `stage-site.mjs` assembles `_site/` for static deployment. Six lints (`lint-no-handauthored-fields`, `lint-no-institution-leak`, `lint-pii-leak`, `lint-no-glyph-only`, `lint-persona-spec-conformance`, `lint-stress-coverage-uniqueness`) enforce the load-bearing invariants.
- **No backend, no database, no auth.** Static deployment to OF-OS Commons. Anonymous PostHog analytics only.
- **Persona definitions**: YAML manifests under `personas/`, one per persona. Loader: `tools/load-fixtures.mjs` (`loadPersona`, `loadAllPersonas`, `loadPersonasByDomain`). Each manifest declares a `stress_coverage` field per EXP-25.
- **Synthetic identity pool**: `synthetic-identity-pool/` — names/IBANs/phones/DOBs drawn from here only (EXP-07, enforced by `lint-pii-leak`).
- **Custom-persona builder**: `src/persona-builder/` — recipe codec (`recipe.js`: `encodeRecipe`/`decodeRecipe`/`recipeHash`/`validateRecipe`), expansion engine, and Service-Worker fixture handler (`fixture-handler.js`). The SW (`src/sw-fixtures.js`) intercepts `/fixtures/v1/bundles/custom/<recipeHash>/<lfi>/seed-<n>/<file>.json?recipe=<base64url>` and returns generated v2.1 envelopes with CORS.

## Repo layout

- `src/` — frontend sources (vanilla JS) + Service Worker.
- `spec/` — vendored OpenAPI YAMLs (banking v2.1, insurance) + `lfi-bands.banking.yaml`.
- `tools/` — spec parser, data builder, fixture-package builders, site stager, lints.
- `personas/` — YAML persona manifests (12 banking + 1 insurance = 13 total).
- `synthetic-identity-pool/` — name/IBAN/phone/DOB pools.
- `tests/` — Vitest suites (spec validation, replay, LFI bands, fixture-package, integrate-staging, journey-coherence, etc.) + Playwright e2e under `tests/e2e/`.
- `packages/sandbox-fixtures/` — `@openfinance-os/sandbox-fixtures` (npm). Exports: `loadFixture`, `loadJourney`, `buildBundle`, `expandRecipe`, `encodeRecipe`, `recipeHash`, `validateRecipe`, `listPersonas`, `listEndpoints`, `loadSpec`, `getPools`, `manifest`.
- `packages/sandbox-fixtures-py/` — PyPI mirror (same fixture data, Python loader).
- `examples/tpp-budgeting-demo/` — worked TPP integration (HTML + `app.js` + Postman collection).
- `dist/` — build outputs (`SPEC.json`, `SPEC.insurance.json`, `data.json`, `domains.json`); gitignored.
- `_site/` — staged static site for deployment, including `_site/fixtures/v1/{bundles,personas,manifest.json,index.json,spec.json}` and `_site/_headers` (CORS + cache); gitignored.

## Commands

- `npm run ci` — verify spec shape → parse spec → all lints → vitest. Runs without needing a built site.
- `npm run build:spec` — parse vendored YAMLs to `dist/SPEC*.json`.
- `npm run build:fixtures` — build the npm + PyPI fixture packages (unblocks the EXP-20 / EXP-32 test suites).
- `npm run build:site` — full pipeline: build:spec → build:data → fixture packages → stage `_site/` (unblocks the EXP-28..31 staging-contract tests).
- `npm test` — vitest. After `build:site`, all suites unblock (729 tests, 0 skipped); without it, three suites skip with messages pointing at the right command.
- `npm run test:e2e` — Playwright smoke + a11y.
- `npm run test:perf` — Lighthouse CI (EXP-24 budget).
- `npm run serve` — quick `python3 -m http.server` on `src/` for local dev.

## TPP plug-points (EXP-20 / EXP-27 / EXP-28..32)

Documented end-to-end in `src/integrate.html`; verified in the test harness. Four ways a TPP gets persona data, all returning the same v2.1 envelope shape (`Data` / `Links` / `Meta`):

1. **Static fixtures** — `…/fixtures/v1/bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json`. Built by `stage-site.mjs`. `_site/_headers` declares `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=600` on `/fixtures/v1/*`.
2. **Service Worker dynamic** for custom personas (recipe-driven) — `src/sw-fixtures.js` + `src/persona-builder/fixture-handler.js`. Returns 409 on recipe-hash tamper.
3. **Embed iframe** (chrome-less) — `src/embed.html` + `src/embed.js`, EXP-27.
4. **npm / PyPI package** — `packages/sandbox-fixtures{,-py}/`, EXP-20.

The worked TPP example at `examples/tpp-budgeting-demo/app.js` is the canonical fetch chain (`/parties` + `/accounts` parallel, then per-account fan-out).

## Load-bearing invariants — DO NOT violate

These come from the PRD's NG (non-goals) and EXP requirements. Violating any of them is a P0 bug, not a stylistic choice.

1. **Spec-driven field metadata, never hand-authored** (EXP-01). Status badges (mandatory/optional/conditional), enums, types, formats all flow from the parsed OpenAPI YAML. A linter rule forbids hand-authored field tables in the codebase. If you find yourself typing a field name as a literal in a status table, stop — extend the spec parser instead.
2. **No real customer data, ever** (NG4, EXP-07). No anonymised data, no aggregated stats, no derivations from any institution's customer base. Personas are fictional and built from publicly observable UAE-market patterns only.
3. **No institution-specific operational detail, ever** (NG5). LFI profiles are anonymous (`Rich`/`Median`/`Sparse`) — never named. Populate-rate guidance is published as ecosystem-wide assumption bands, never attributed to a specific bank. A "no-institution-leak" lint runs on persona manifests.
4. **Deterministic generation** (EXP-05). `(persona, lfi_profile, seed)` always yields the exact same bundle. URLs are shareable and stable across deployments. CI replay test runs every build.
5. **Mandatory fields are never redacted by LFI profile** (EXP-04 / §8.3). Redaction filter only touches optional/conditional fields. If the Sparse profile ever drops a mandatory field, the bundle is spec-invalid — bug.
6. **Every generated payload validates against the v2.1 OpenAPI schema** (EXP-10 acceptance). Snapshot test runs across the full persona × LFI × endpoint matrix.
7. **Standards baseline is v2.1 only** (D-01). No v2.0↔v2.1 toggle, no delta view (D-09). Single pinned SHA.
8. **No separate contributor branding** (NG6). The artefact takes OF-OS Commons visual identity. No logos, no upsells, no contributor chrome.
9. **Watermark every export** (§6.5, EXP-19). Every CSV/JSON/tarball carries `SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:{id} lfi:{profile} seed:{seed} retrieved:{timestamp}`.

## EXP-IDs — the requirement vocabulary

The PRD assigns every requirement an `EXP-NN` ID (PRD §4). When discussing or implementing features, reference these IDs — downstream stories, designs, and tests will too. Highlights:

- **EXP-01 / EXP-13 / EXP-14**: spec-driven field status badges and field cards (the load-bearing UX).
- **EXP-04 / §8.3**: LFI profile mechanics (Rich/Median/Sparse) as post-generation field-redaction.
- **EXP-17**: persona+LFI+seed in URL → reproducible bundle.
- **EXP-18**: Underwriting Scenario Panel (v1.5) with pinned, illustrative formulas — the formulas are spelled out under §4.4 and must not drift. Includes a low-volume guard (Senior persona is the test case).
- **EXP-23 / EXP-24**: WCAG 2.1 AA + perf budget (< 250 KB gzipped, Lighthouse ≥ 90 on mobile, < 200 ms persona gen).
- **EXP-25**: every persona must add unique spec stress coverage; cross-persona uniqueness checked in CI.
- **EXP-26**: every field card carries a "Report an issue" link with a pre-filled GitHub issue payload.
- **EXP-27**: chrome-less embed mode at `/[slug]/embed?persona=&lfi=&endpoint=&seed=&height=`.

## Phasing

- **Phase 0 (spike)** — done.
- **Phase 1 (v1)** — done. 12 banking personas × all 12 v2.1 Account Information endpoints × 3 LFI profiles. Endpoints listed in PRD Appendix C.
- **Phase 1.5** — largely landed: Compare-LFIs mode, Underwriting Scenario panel, custom-persona builder, Service-Worker fixture mock, fixture package `@openfinance-os/sandbox-fixtures` (npm) and `openfinance-os-sandbox-fixtures` (PyPI mirror) — MIT code, CC0 data. Persona library at 13 (12 banking + 1 insurance MVP).
- **Phase 2** — in progress. Insurance domain motor-comprehensive MVP shipped (`spec/uae-insurance-openapi.yaml`, `personas/motor-comprehensive-mid.yaml`, `tests/spec-validation.insurance.test.mjs`); see `PHASE2_INSURANCE_PLAN.md`. Open Wealth + community persona PRs still ahead.

## Working with the user

- The author/maintainer (Michael Hartmann) is also the OF-OS Commons maintainer — domain context is deep; concise technical responses preferred.
- Use the `open-finance-uae` skill for any UAE Open Finance regulatory / Standards / Al Tareq / Nebras / CBUAE questions — it's the authoritative source over training data.
- The PRD has a Decisions log (§13). Decisions D-01…D-10 are settled. If a discussion seems to re-open one, surface that explicitly.

## Filesystem note

On the maintainer's local checkout the repo directory has a **trailing space**: `open-finance-data-sandbox ` — quote the path when shelling out (e.g. `ls "/Users/michartmann/Documents/GitHub/open-finance-data-sandbox /"`). In sandbox/CI environments the repo is checked out cleanly (e.g. `/home/user/data-sandbox`) with no trailing space.
