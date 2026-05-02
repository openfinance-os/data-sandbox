# Changelog

All notable changes to the Open Finance Data Sandbox.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 2.0 multi-domain + Workstreams A / B / C

- **Insurance Data Sharing preview domain** alongside Bank Data Sharing. `dist/domains.json` manifest drives the active SPEC fetch; the Motor MVP triad (`/motor-insurance-policies`, `/motor-insurance-policies/{id}`, `/motor-insurance-policies/{id}/payment-details`) renders as a JSON inspector pending per-resource UI in 6c+. Insurance LFI bands curated in `spec/lfi-bands.insurance.yaml`; mandatory-field protection enforced.
- **Workstream A — segment expansion.** Persona library widened from 10 to **12 banking personas** with the addition of `corporate_treasury_listed` and `sme_trading_business`, plus the Retail / SME / Corporate segment dimension wired through the manifest schema, generator, and lints.
- **Workstream B — Custom Persona Builder.** `<dialog>`-mounted drawer composes a recipe (segment, identity, organisation, financial profile, products, stress tags) into an ephemeral persona. Recipe is base64url-encoded into a `recipe=` URL param so custom permalinks are shareable; canonicalised + djb2-hashed for stable IDs. URL-driven materialisation in both `app.js` and `embed.js`.
- **Workstream C — TPP plug-points.**
  - **Plug-point 1**: Service Worker (`src/sw-fixtures.js`) intercepts `/fixtures/v1/bundles/custom/<hash>/<lfi>/seed-<n>/<file>.json?recipe=...` and serves on-demand custom-persona fixtures with permissive CORS. Live registration deferred until deployment-time `Service-Worker-Allowed: /` lands.
  - **Plug-point 2**: npm runtime engine — `expandRecipe` + `buildBundle` + `getPools` exposed from `@openfinance-os/sandbox-fixtures` so a Node consumer can synthesise custom personas without a Service Worker.
  - **Plug-point 3**: Static-fixture zip download — STORE-only ZIP writer (`src/persona-builder/zip-writer.js`) packs the (1 persona × 3 LFI × all endpoints) matrix into a `/fixtures/v1/bundles/<persona>/...`-shaped tree the TPP can host on their own static origin.

### Fixed

- **Persona spend volumes were inert.** Personas declared `groceries_aed_per_month_band` / `fuel_aed_per_month_band` (AED bands) but the generator was reading `*_per_month_count_band` (counts), so every persona except `senior_retiree` defaulted to `[4,9]` groceries / `[2,5]` fuel txs/month. Generator now derives a count from the AED band when no explicit count band is declared, dividing mid-band by the merchant pool's mean typical-tx amount; realised monthly grocery AED now lands inside each persona's declared band.
- **Embed mode was banking-only.** `src/embed.js` hard-coded `dist/SPEC.json` and didn't filter the persona pool by domain; an insurance permalink would have rendered an insurance bundle against the banking spec. Embed now resolves domain through `dist/domains.json` and renders a JSON-inspector preview for non-banking domains.
- **Coverage and field-card lookups missed `Transaction.TransactionReference`** (added to `PROBE_BAND` / `collectProbes` / `FIELD_BANDS`) and the per-endpoint coverage probe missed `Transaction.ValueDateTime` (added to `collectProbesForEndpoint('/transactions')`); the YAML `spec/lfi-bands.banking.yaml` was already correct.
- **`whyEmpty` median copy.** Was "Generator's RNG rolled unfavourably for this row" — but the LFI redactor caches keep/drop per `(path, band)` per bundle, so an absent field is uniformly absent across every row of one `(persona, lfi, seed)`. Reworded to "The simulated LFI didn't populate this field for this bundle (re-roll seed to resample)".

### Distribution

- **`@openfinance-os/sandbox-fixtures`** — fixture corpus widened to **12 banking personas × 3 LFI profiles** = **36 keys** in `manifest.json`, **912 envelope files** (per-account endpoints multiply by account count). Spec pin unchanged at `bc1cd97`.

## [1.1.0] — 2026-04-29

### Added — EXP-20 fixture package distribution

The Phase 1.5 EXP-20 deliverable: the synthetic dataset is now distributable as a versioned package other tools can pin in their own CI.

- **`@openfinance-os/sandbox-fixtures`** (npm) — 720 v2.1-shaped JSON envelopes covering 10 personas × 3 LFI profiles × all per-account endpoints. Ships with the parsed `spec.json`, the persona manifests, a single `manifest.json` index keyed by `<persona>|<lfi>|<seed>`, and a tiny ESM/CJS/TS loader exposing `loadFixture / listPersonas / listEndpoints / loadSpec / loadPersonaManifest`. Templated paths like `/accounts/{AccountId}/transactions` resolve to the persona's first account by default.
- **`openfinance-os-sandbox-fixtures`** (PyPI) — Python wrapper with the same API (snake_case). `pip install openfinance-os-sandbox-fixtures` then `from openfinance_os_sandbox_fixtures import load_fixture`. Same data, same `_specSha`, same determinism guarantees.
- **`tools/build-fixture-package.mjs`** + **`tools/build-fixture-package-py.mjs`** generate both packages from a single `npm run build:fixtures` invocation.
- **`.github/workflows/publish-fixtures.yml`** publishes both packages on `fixtures-v*` tag push (npm via `NPM_TOKEN` secret, PyPI via Trusted Publisher OIDC).
- **`tests/fixture-package.test.mjs`** — 7 round-trip tests including v2.1 schema validation against the published envelope. Hamid's anchor JTBD-13.1 ("multi-persona deterministic test corpus my SDK's CI can validate against, packaged as @openfinance-os/... fixtures I can pin").

Total: 420 unit tests (was 413). Bundle weight unchanged (the fixture package lives outside the deployed sandbox).

## [1.0.0] — 2026-04-29

First Commons-publishable release. All 27 EXP-NN requirements from PRD v0.9 implemented; both EXP-16 (Compare-LFIs) and EXP-18 (Underwriting Scenario panel) — originally scheduled for Phase 1.5 — landed in this initial release as well.

### Specification & data

- **Vendored UAE Open Finance v2.1 Account Information OpenAPI** at upstream commit `bc1cd97`. Spec parser (`tools/parse-spec.mjs`) emits a flat `dist/SPEC.json` keyed by endpoint, with field metadata (name, type, format, enum, status) for **826 fields across 12 endpoints, 340 of them mandatory**. Hand-authored field-status tables forbidden; CI-enforced lint.
- **10 synthetic UAE personas** spanning 14 stress-coverage terms in the controlled vocabulary: Salaried Expat Mid · Salaried Emirati Affluent · Gig Variable Income · Senior Retiree · Recent Graduate Thin-File · Mortgage DBR Heavy · SME Cash-Heavy · NSF Distressed · HNW Multi-Currency · Joint Account Family.
- **All 12 v2.1 Account Information endpoints** generated and validated against the v2.1 schema. The full persona × LFI × endpoint matrix (360 combinations) passes.
- **Three LFI populate-rate profiles** — Rich (every populate-band field populated) · Median (Universal=1.0, Common=0.7, Variable=0.4, Rare=0.1) · Sparse (Universal-only).
- **Old-core-banking realism in transaction shapes** — UPPERCASE truncated narratives (`SAL/PAYROLL/HELIXDATA`, `DD/UTILITIES/3959`), channel-specific reference numbers (`IPP9444186899`, `BRN149202505058032`, `UTIL2025051124`), POS amounts with fils precision, ValueDateTime drift T+1 to T+3 for FX / cross-bank, `Status=Pending` for last 24-48h, NSF events emit paired Rejected debit + Booked bounce-fee, weekday-bias on retail transaction dates.
- **Determinism guaranteed.** `(persona_id, lfi_profile, seed, build-time-now-anchor)` → byte-identical bundle, verified by replay test.

### UI

- **Three-pane layout** — persona library · navigator + payload · field detail. Viewport-locked; only inner panes scroll.
- **Spec-driven status badges** — solid green pill (Mandatory), dashed pill (Optional), outline pill (Conditional), with M/O/C labels for accessibility. Top-edge stripe per column header carries the status colour at a glance.
- **Field card with all 9 elements per EXP-14** — name, path, status, type, format, enum, example value from the persona, real-LFIs guidance, and a deep link to the upstream Nebras GitHub at the pinned SHA. PII flagged inline. "Why is this empty?" tooltips on absent cells explain the reason (LFI band, conditional rule, persona attribute).
- **Coverage meter** at bundle level + per-endpoint sub-meter inline in the navigator with amber→green gradient by populate rate.
- **Transactions filter & sort** — full-text search, TransactionType / SubTransactionType / Debit-Credit / date-range / amount-band / MCC; sortable columns; sticky leftmost column on /transactions; row striping; NSF rows tinted red with a top-of-table distress callout.
- **Monthly summary** above /transactions — 12-row collapsible roll-up with credits / debits / net / NSF count.
- **Persona library** with narrative excerpts + clickable stress-coverage chips that filter the library.
- **Bidirectional links** — clicking a standing-order / direct-debit / beneficiary row jumps to /transactions filtered to the matching transactions, with a yellow banner offering Back.
- **Compare-LFIs view (EXP-16)** — side-by-side render of the same persona under two LFI profiles, with cell-level diff highlighting (green = present here only, red = missing, amber = changed). Column-union ensures dropped fields are visible on both sides.
- **Underwriting Scenario panel (EXP-18)** — virtual bundle-level entry rendering the four pinned signals: Implied monthly net income (primary Payroll → Fallback A same-day-of-month → Fallback B counterparty cluster → "—"), Total fixed commitments (frequency-normalised, multi-currency converted to AED at the pinned rate), Implied DBR, NSF / distress count. Low-volume guard suppresses DBR and surfaces a teaching-moment banner for the Senior persona.
- **Spec-wide find** (⌘K / Ctrl+K) across field names, paths, enums, and persona narratives.
- **Tour** (§5.4) — 5-step walkthrough of Sara's bundle, available on demand.
- **Date humanise toggle** in the transactions filter bar.
- **Tell-me-a-story design polish** — 120ms fade transition on persona/LFI change, clustered topbar (Scenario + Run-state), promoted coverage chip, viewport-locked layout (no page-level scrolling).

### Sharing & integration

- **Share via URL** — `?persona=&lfi=&seed=` reproduces the exact bundle on any machine, any cache, any day. URLs are stable across deployments.
- **Embed mode (EXP-27)** — chrome-less variant at `/src/embed.html?persona=&lfi=&endpoint=&seed=&height=` for iframe consumption (slide decks, blog posts, LMS modules). Attribution strip with "Open in sandbox →".
- **Export (EXP-19)** — JSON per endpoint (v2.1-shaped envelopes), CSV per resource, single tarball; every export carries the §6.5 watermark; in-browser tar build with no extra deps.
- **Report-an-issue (EXP-26)** — every field card carries a one-click pre-filled GitHub issue with field name + path + status + persona + LFI + seed + pinned SHA + 5-checkbox triage set.

### Posture & non-functional

- **WCAG 2.1 AA (EXP-23)** — axe-core CI gate, zero violations. Status badges convey meaning by both colour and shape and label. Keyboard reachable. `prefers-reduced-motion` honoured.
- **Performance budget (EXP-24)** — Lighthouse-CI mobile profile gate. Bundle weight test enforces ≤ 250 KB gzipped (currently ~67 KB).
- **Anonymous analytics surface (EXP-21)** — PostHog event allowlist; no PII; no fingerprinting; no cross-site identifiers. CI scan in place; project key wiring deferred to v1.0.x.
- **No-PII export & identity posture (EXP-22)** — no cookies; no localStorage / sessionStorage writes outside the URL-encoded `(persona, lfi, seed)` tuple; no rogue network calls. CI-asserted.
- **Spec-driven invariant lints** — no-handauthored-fields (EXP-01), no-institution-leak (NG5), pii-leak (EXP-07/22a, 665 strings checked across 10 personas), no-glyph-only (EXP-23g).

### Distribution

- **GitHub Pages** at https://openfinance-os.github.io/data-sandbox/ — auto-deploy on push to `main`.
- **Cloudflare Pages** at https://data-sandbox-1cq.pages.dev/ — same `npm run build:site` → `_site/` pipeline.
- **MIT** licence on code; **CC0** on synthetic data.

### Tests

- **413 Vitest unit tests** — replay determinism, spec validation across 10 × 3 × 12 = 360 combinations, LFI profile mechanics, underwriting calculator, exports, identity posture, persona manifest schema, URL roundtrip, monthly summary aggregation.
- **15 Playwright e2e tests** — including axe-core a11y, Compare-LFIs diff classification, EXP-18 panel rendering + Senior low-volume guard, ⌘K find box, transactions filter, embed page, identity posture, About page metadata, tour walkthrough, field-card 9 elements, stress-chip filter.
- **4 invariant lints** + **Lighthouse-CI** + **bundle-weight gate**.

### Stewardship

24-month minimum maintenance window from launch. Quarterly populate-rate band recalibration. Spec-pin updates within 30 days of upstream `v2.x` releases. 14-day issue triage SLA. Persona library reviewed quarterly. Public 90-day EOL clause.

[1.1.0]: https://github.com/openfinance-os/data-sandbox/releases/tag/v1.1.0
[1.0.0]: https://github.com/openfinance-os/data-sandbox/releases/tag/v1.0.0
