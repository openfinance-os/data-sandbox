# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

Phases 1 through 2.3 have shipped. The repo contains source, tests, build tooling, three distribution packages (npm + PyPI + MCP server), two worked TPP integration examples, and a stage-to-`_site/` pipeline. The PRD remains the source of truth for new features and decisions — **do not invent behaviour that contradicts it.**

Key documents in the repo:
- `PRD_OF_Data_Explorer.md` (v0.9, draft) — the product spec.
- `IMPLEMENTATION_PLAN.md` — current execution plan.
- `PHASE2_INSURANCE_PLAN.md` — Phase 2 insurance-domain plan (motor MVP partially landed).
- `CHANGELOG.md` — running log of shipped slices.
- `PRD_OF_Data_Explorer_Review.md` — historical (Tier-1 items folded into v0.5–v0.8; remainder closed in v0.9).
- `PRD_OF_Data_Explorer_Spec_Validation.md` — applies to the prototype HTML, not the PRD.
- `PRD_OF_Data_Explorer_Deployment.md` — superseded (hosting locked to OF-OS Commons per D-05).
- `archive/of-sandbox-prototype.html` — original single-file prototype; basis for the v1 build. Kept for historical reference only (see `archive/README.md`).

## What the product is

An interactive, **client-side static** sandbox that lets a TPP-perspective user load synthetic UAE customer personas and explore every UAE Open Finance payload they would receive — with mandatory/optional/conditional field treatment derived live from the published OpenAPI spec. Hosted as a contribution to OpenFinance-OS Commons. v1 was Bank Data Sharing only; Insurance (all 7 lines) and the ATM Locator have since shipped as domains. Open Wealth / Service Initiation remain future.

## Architecture (PRD §6, as built)

- **Frontend**: vanilla HTML/CSS/JS, no build chain. Sources under `src/`. Entry: `src/index.html` + `src/app.js` (the explorer). The `/integrate` page (`src/integrate.html` + `src/integrate.js`) documents the five TPP plug-points. The `/connect` page (`src/connect.html` + `src/connect.js` — the repo's largest frontend file) is a consumer-direct consent-journey walkthrough modelled on the Plaid + ChatGPT pattern (pick profile → pick bank → share → back in chat); the actual OAuth simulation lives in `packages/sandbox-mcp/` behind `--simulate-oauth`. Arabic / RTL i18n shipped (D-10): URL-driven locale, chrome translation via `src/shared/i18n.js`, per-persona `name_ar` / `narrative_ar`, lazy-loaded `dist/data.i18n.json`.
- **Synthetic generator**: runs entirely in the browser (and in Node for tests). Deterministic seeded PRNG (mulberry32) at `src/prng.js`. Entry: `buildBundle()` in `src/generator/index.js`, dispatching to `src/generator/banking/`, `src/generator/insurance/`, or `src/generator/atm/` (multi-domain personas run several pipelines and merge). `(persona_id, lfi_profile, seed)` → bundle is a pure function.
- **Spec source**: vendored at `spec/uae-account-information-openapi.yaml` from `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1-errata2/`, **pinned by commit SHA**. Insurance baseline at `spec/uae-insurance-openapi.yaml` (still `v2.1-errata1` — errata2 doesn't republish insurance); ATM Locator at `spec/uae-atm-openapi.yaml`. The pinned SHA is exposed in `dist/SPEC.json#pinSha`, the UI top bar, `/about`, and the fixture-package manifest.
- **Build-time tooling** (`tools/`): `parse-spec.mjs` walks the vendored YAMLs and emits `dist/SPEC.json` (banking) + `dist/SPEC.insurance.json` + `dist/SPEC.atm.json`; `build-data.mjs` builds `dist/data.json` (personas + pools) + `dist/data.i18n.json`; `build-fixture-package.mjs` + `build-fixture-package-py.mjs` generate the npm and PyPI packages (root `package.json` is the single version source — the npm package.json is generated from it, pyproject.toml is stamped at build time, `tests/package-version-sync.test.mjs` gates all three); `stage-site.mjs` assembles `_site/` for static deployment. Seven lints (`lint-no-handauthored-fields`, `lint-no-institution-leak`, `lint-pii-leak`, `lint-no-glyph-only`, `lint-persona-spec-conformance`, `lint-stress-coverage-uniqueness`, `lint-brand-registry-coverage`) enforce the load-bearing invariants; `tests/lfi-bands-mandatory-overlap.test.mjs` structurally enforces invariant 5 against the parsed spec.
- **No backend, no database, no auth.** Static deployment to OF-OS Commons. Anonymous PostHog analytics only.
- **Persona definitions**: YAML manifests under `personas/`, one per persona. Loader: `tools/load-fixtures.mjs` (`loadPersona`, `loadAllPersonas`, `loadPersonasByDomain`). Each manifest declares a `stress_coverage` field per EXP-25.
- **Synthetic identity pool**: `synthetic-identity-pool/` — names/IBANs/phones/DOBs drawn from here only (EXP-07, enforced by `lint-pii-leak`).
- **Custom-persona builder**: `src/persona-builder/` — recipe codec (`recipe.js`: `encodeRecipe`/`decodeRecipe`/`recipeHash`/`validateRecipe`), expansion engine, and Service-Worker fixture handler (`fixture-handler.js`). The SW (`src/sw-fixtures.js`) intercepts `/fixtures/v1/bundles/custom/<recipeHash>/<lfi>/seed-<n>/<file>.json?recipe=<base64url>` and returns generated v2.1 envelopes with CORS.

## Repo layout

- `src/` — frontend sources (vanilla JS) + Service Worker.
- `spec/` — vendored OpenAPI YAMLs (banking v2.1-errata2, insurance v2.1-errata1, ATM Locator) + `lfi-bands.{banking,insurance,atm}.yaml`.
- `tools/` — spec parser, data builder, fixture-package builders, site stager, lints.
- `personas/` — YAML persona manifests (21 banking-only + 9 insurance-only + 8 multi-domain = 38 customer personas, plus the `atm-directory` infrastructure persona = 39 manifests; the banking domain renders 29 personas and the insurance domain renders 17, with the 8 multi-domain personas counted under both).
- `synthetic-identity-pool/` — name/IBAN/phone/DOB pools.
- `tests/` — Vitest suites (spec validation, replay, LFI bands, fixture-package, integrate-staging, journey-coherence, etc.) + Playwright e2e under `tests/e2e/`.
- `packages/sandbox-fixtures/` — `@openfinance-os/sandbox-fixtures` (npm). Exports: `loadFixture`, `loadJourney`, `buildBundle`, `expandRecipe`, `encodeRecipe`, `recipeHash`, `validateRecipe`, `listPersonas`, `listEndpoints`, `loadSpec`, `getPools`, `manifest`.
- `packages/sandbox-fixtures-py/` — PyPI mirror (same fixture data, Python loader).
- `packages/sandbox-mcp/` — `@openfinance-os/sandbox-mcp`, MCP server wrapping the fixture package (stdio + Streamable HTTP transports; deployed at `https://data-sandbox.fly.dev/mcp`).
- `examples/tpp-budgeting-demo/` — worked TPP integration (HTML + `app.js` + Postman collection).
- `examples/accounting-multi-bank-demo/` — multi-LFI role-bundle reconciliation demo (cross-LFI ledger by IBAN identity).
- `dist/` — build outputs (`SPEC.json`, `SPEC.insurance.json`, `SPEC.atm.json`, `data.json`, `data.i18n.json`, `avatars.json`, `domains.json`); gitignored.
- `_site/` — staged static site for deployment, including `_site/fixtures/v1/{bundles,personas,manifest.json,index.json,spec.json}` and `_site/_headers` (CORS + cache); gitignored.

## Commands

- `npm run ci` — verify spec shape → builds (spec, data, avatars, fixture packages) → all lints → vitest → MCP workspace tests. Runs without needing a staged site.
- `npm run build:spec` — parse vendored YAMLs to `dist/SPEC*.json`.
- `npm run build:fixtures` — build the npm + PyPI fixture packages (unblocks the EXP-20 / EXP-32 test suites).
- `npm run build:site` — full pipeline: build:spec → build:data → avatars → fixture packages → brand registry → stage `_site/` (unblocks the EXP-28..31 staging-contract tests).
- `npm test` — vitest. After the fixture packages are built, all suites unblock (~3.4k tests, 0 skipped); without them, the gated suites skip with messages pointing at the right command.
- `npm run test:mcp` — the `@openfinance-os/sandbox-mcp` workspace suite (also part of `npm run ci`).
- `npm run test:e2e` — Playwright smoke + a11y + visual + RTL.
- `npm run test:perf` — Lighthouse CI (EXP-24 budget).
- `npm run serve` — quick `python3 -m http.server` on `src/` for local dev.

## TPP plug-points (EXP-20 / EXP-27 / EXP-28..32)

Documented end-to-end in `src/integrate.html`; verified in the test harness. Five ways a TPP gets persona data, all returning the same v2.1 envelope shape (`Data` / `Links` / `Meta`):

1. **Static fixtures** — `…/fixtures/v1/bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json`. Built by `stage-site.mjs`. `_site/_headers` declares `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=600` on `/fixtures/v1/*`. Note: GitHub Pages (the current deploy target) ignores `_headers` directives, but it serves `Access-Control-Allow-Origin: *` by default, so EXP-28 still holds. The cache directives are no-ops on GH Pages — they take effect only on Netlify / Cloudflare Pages. See `tools/stage-site.mjs:96` for the full nuance.
2. **Service Worker dynamic** for custom personas (recipe-driven) — `src/sw-fixtures.js` + `src/persona-builder/fixture-handler.js`. Returns 409 on recipe-hash tamper.
3. **Embed iframe** (chrome-less) — `src/embed.html` + `src/embed.js`, EXP-27.
4. **npm / PyPI package** — `packages/sandbox-fixtures{,-py}/`, EXP-20.
5. **MCP server** — `packages/sandbox-mcp/` (stdio for Claude Desktop / Claude Code, Streamable HTTP for hosted clients; D-13 deployment on Fly).

The worked TPP example at `examples/tpp-budgeting-demo/app.js` is the canonical fetch chain (`/parties` + `/accounts` parallel, then per-account fan-out); `examples/accounting-multi-bank-demo/app.js` is the canonical multi-LFI role-bundle reconciliation.

## Load-bearing invariants — DO NOT violate

These come from the PRD's NG (non-goals) and EXP requirements. Violating any of them is a P0 bug, not a stylistic choice.

1. **Spec-driven field metadata, never hand-authored** (EXP-01). Status badges (mandatory/optional/conditional), enums, types, formats all flow from the parsed OpenAPI YAML. A linter rule forbids hand-authored field tables in the codebase. If you find yourself typing a field name as a literal in a status table, stop — extend the spec parser instead.
2. **No real customer data, ever** (NG4, EXP-07). No anonymised data, no aggregated stats, no derivations from any institution's customer base. Personas are fictional and built from publicly observable UAE-market patterns only.
3. **No institution-specific operational detail, ever** (NG5, refined by D-14, extended to insurers in Phase 2.2). LFI profiles are anonymous (`Rich`/`Median`/`Sparse`) — never named. Populate-rate guidance is published as ecosystem-wide assumption bands, never attributed to a specific bank or insurer. **Real UAE bank AND insurer names are allowed only at the four sites where no operational claim binds to them**: (a) the dedicated counterparty-bank pools (`synthetic-identity-pool/counterparty-banks/`); (b) the dedicated counterparty-insurer pools (`synthetic-identity-pool/counterparty-insurers/`, Phase 2.2); (c) the optional `multi_lfi_footprint.{primary|secondary|tertiary}.plausible_lfi_candidates` (legacy) / `multi_lfi_footprint.slots[].plausible_lfi_candidates` (Phase 2.2 N-slot) arrays in persona manifests; (d) the Phase 2.2 `multi_insurer_footprint.slots[].plausible_insurer_candidates` array. All four are candidate sets with no populate-rate binding. Names remain forbidden anywhere a populate-rate, product mix, categorisation rule, or other operational claim is bound — including the `lfi_profile` field, the bundle-emitting LFI identity, and any UI label that implies operational attribution. The `lint-no-institution-leak` lint encodes this allowed/forbidden split for both banks and insurers.
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
- **Phase 1.5** — landed: Compare-LFIs mode, Underwriting Scenario panel, custom-persona builder, Service-Worker fixture mock, fixture package `@openfinance-os/sandbox-fixtures` (npm) and `openfinance-os-sandbox-fixtures` (PyPI mirror) — MIT code, CC0 data.
- **Phase 2.0** — done. Insurance domain motor-MVP (4 endpoints, 3 motor personas; see `PHASE2_INSURANCE_PLAN.md`). Phase 2.x SME expansion (D-14): real-UAE counterparty-bank pool, 6 new SME personas (F&B multi-outlet, e-commerce marketplace, free-zone SaaS, construction sub-contractor, healthcare clinic, RAK Emirati trading) each carrying a `multi_lfi_footprint`; mod-97-valid IBANs; full Phase D role-bundle generation (primary + secondary + tertiary URLs under `bundles/<persona>/{secondary,tertiary}/<lfi>/seed-<n>/`); cross-LFI mirror-ledger transactions; footprint-aware SO routing; MCP server (`packages/sandbox-mcp/`) deployed to Fly.
- **Phase 2.1** — done. Insurance flipped from `preview` → `ga`; full read-only coverage of all 7 lines (motor + home + health + life + travel + renters + employment) plus Insurance Consents = 30 endpoints. Six new insurance personas: `home-mortgage-villa`, `health-family-comprehensive`, `life-mortgage-protection`, `travel-annual-multitrip-expat`, `renters-apartment-tenant`, `employment-iloe-private`. Library at 27 at the time of release (18 banking + 9 insurance). Per-line generator modules under `src/generator/insurance/<line>.js` with a registry-driven dispatcher.
- **Phase 2.2** — landed. N-slot `multi_lfi_footprint.slots[]` (replaces the fixed primary/secondary/tertiary triad; back-compat adapter `normalizeFootprint()` walks both shapes). Multi-product per LFI via `accounts[].at_slot` tagging; role bundles emit all matching products with the slot's bank override and per-product mod-97 IBAN derivation. Multi-domain personas via `domains: [banking, insurance]` — `buildMultiDomainBundle` runs both pipelines on the same `(persona, lfi, seed)`, merges results, and `envelopesFromBundle` emits both endpoint families at the same persona path. `multi_insurer_footprint.slots[]` mirrors the banking pattern for insurance carriers; new `synthetic-identity-pool/counterparty-insurers/uae-real.yaml` pool + `lint-no-institution-leak` extension cover real insurer names. New flagship persona `retail-multi-banker` exercises all of the above (4 banking LFIs × multiple products + 3 insurance carriers). After the v1.5-trio restoration (`domestic-worker`, `pep-flagged`, `returning-expat`) and the multi-domain upgrade of seven previously banking-only personas (`emirati-takaful-multi`, `gcc-commuter-multi`, `healthcare-multi`, `hnw-intl-multi`, `recent-expat-multi`, `retired-multi`, `tech-pro-multi`) the library is at **38 total** — 21 banking-only + 9 insurance-only + 8 multi-domain. The banking tab in the gallery surfaces 29 personas (21 + 8 multi-domain) and the insurance tab surfaces 17 (9 + 8 multi-domain); `loadPersonasByDomain` honours both the legacy singular `domain:` field and the plural `domains: [...]` array so multi-domain personas appear under both filters.
- **Phase 2.3** — done. ATM Locator domain GA: `spec/uae-atm-openapi.yaml` + `lfi-bands.atm.yaml`, generator under `src/generator/atm/`, the `atm-directory` infrastructure persona, and ATM picker UI (`src/ui/atm.js`). Also in this window: the `/connect` consumer consent-journey walkthrough (Plaid + ChatGPT shape) with opt-in OAuth simulation in the MCP server, `examples/accounting-multi-bank-demo/`, and Arabic / RTL i18n (D-10) — chrome translation, `name_ar` / `narrative_ar` across all personas, Arabic-Indic numeral toggle, lazy `dist/data.i18n.json` off the critical path.
- **Phase 2.x (open)** — Open Wealth, deeper i18n (field-card explanations, tour, find-box strings are still English-only), PostHog go-live (D-08). The analytics layer is wired — `src/analytics.js` exposes an allowlisted `track()` (EXP-21 event/property allowlist, EXP-22 no-persistent-identifier SDK init), guarded by `tests/analytics-allowlist.test.mjs`; it stays inert until a PostHog project key is configured, so no events are emitted yet.

## Working with the user

- The author/maintainer (Michael Hartmann) is also the OF-OS Commons maintainer — domain context is deep; concise technical responses preferred.
- Use the `open-finance-uae` skill for any UAE Open Finance regulatory / Standards / Al Tareq / Nebras / CBUAE questions — it's the authoritative source over training data.
- The PRD has a Decisions log (§13). Decisions D-01…D-10 are settled. If a discussion seems to re-open one, surface that explicitly.

## Filesystem note

On the maintainer's local checkout the repo directory has a **trailing space**: `open-finance-data-sandbox ` — quote the path when shelling out (e.g. `ls "/Users/michartmann/Documents/GitHub/open-finance-data-sandbox /"`). In sandbox/CI environments the repo is checked out cleanly (e.g. `/home/user/data-sandbox`) with no trailing space.
