# Implementation Plan — Open Finance Data Sandbox

| Field | Value |
|---|---|
| **Document type** | Implementation plan companion to `PRD_OF_Data_Explorer.md` v0.9 |
| **Date** | 28 April 2026 |
| **Author** | Michael Hartmann |
| **Status** | Draft — for self-approval before Phase 0 spike kicks off |
| **Scope** | Phase 0 (spike) → Phase 1 (V1 Commons publication) → Phase 1.5. Phase 2 (community contribution + Open Wealth/Insurance) is intentionally out of scope here; it gets its own plan once v1.5 ships. |

This plan operationalises PRD v0.9. The PRD answers *what* and *why*; this document answers *how*, *in what order*, and *with what tooling*. Where the PRD and this plan disagree, the PRD wins and this plan is updated.

---

## 1. Stack choices

The PRD's load-bearing tech constraints (§6.2) are: vanilla HTML/CSS/JS, no build chain in v1, deterministic mulberry32 PRNG, vendored OpenAPI YAML pinned by SHA, build-time tooling parses YAML → JSON `SPEC` consumed by the frontend, no backend / no database / no auth.

Within those constraints:

| Layer | Choice | Why |
|---|---|---|
| **Language** | JavaScript (ES2022) — single-language project | Aligns with "no build chain" frontend; lets the YAML-parser tool share helpers with the runtime generator. |
| **Module system** | Native ES modules (`<script type="module">`) | Honours "no build chain". No bundler, no transpiler. Browser support is a non-issue for the target audience. |
| **Frontend runtime deps** | None at v1 | Vanilla JS is intentional. v1.5 may introduce a tiny build (esbuild) only if maintenance pain justifies it. |
| **Build-time tools** | Node 20+ with `js-yaml` and `ajv` | Tiny dep surface. `js-yaml` for YAML; `ajv` for OpenAPI schema validation in tests. Pin both with `package-lock.json`. |
| **Test runner** | Vitest | Ergonomic, fast, supports ES modules natively, plays nicely with snapshots. Alternative considered: Node native test runner — rejected for less ergonomic snapshots. |
| **a11y CI** | `@axe-core/playwright` | Headless Chromium runs the published HTML, axe-core reports violations. Single CI job. |
| **Performance CI** | `@lhci/cli` (Lighthouse CI) | Mobile profile, asserts Performance ≥ 90, page-weight ≤ 250 KB gzipped, time-to-interactive < 3 s. |
| **Linting** | `eslint` (recommended ruleset) + custom rules for spec-drift, PII-leak, no-institution-leak, no-glyph-only-semantics | All EXP-01 / EXP-07 / EXP-22 / EXP-23 / NG5 invariants enforced as lints, not as docstrings. |
| **CI** | GitHub Actions | Standard for OSS Commons; free for public repos. |
| **Repo host** | `github.com/openfinance-os/data-sandbox` (TBC — see Open Decisions §8) | Mirrors the `@openfinance-os/...` package namespace from D-06. |
| **Hosting** | OF-OS Commons publication workflow (D-05) | The Commons maintainer handles the actual upload; we hand off a static bundle. |
| **Analytics** | PostHog (D-08, EXP-21) | Cloud-hosted; project key needed (Open Decision §8.6). |

**Things we are explicitly NOT introducing in v1:**

- React, Svelte, Vue, or any reactive framework. Reconsidered at v1.5 only if maintenance pain demands it.
- TypeScript. Reconsidered at v1.5 only if generator complexity demands it. JSDoc type annotations + `@ts-check` give ~80% of the value for ~5% of the cost.
- Any bundler. ES modules + `<script type="module">`.
- A CSS preprocessor. Vanilla CSS with custom properties.
- A backend. Static files only.
- A database. Static files only.

---

## 2. Repository layout

The repo is currently PRD-only. Phase 0 introduces source code under this layout:

```
/                                          (repo root — currently PRD-only)
├── PRD_OF_Data_Explorer.md                (live, v0.9)
├── PRD_OF_Data_Explorer_Review.md         (historical)
├── PRD_OF_Data_Explorer_Spec_Validation.md (applies to prototype)
├── PRD_OF_Data_Explorer_Deployment.md     (superseded)
├── of-sandbox-prototype.html              (Phase 0 starting point)
├── IMPLEMENTATION_PLAN.md                 (this doc)
├── CLAUDE.md
├── README.md                              (Phase 1 — Commons-facing landing)
├── LICENSE                                (MIT — code; Phase 0)
├── LICENSE-DATA                           (CC0 — synthetic data; Phase 0)
├── CHANGELOG.md                           (Phase 1)
├── CONTRIBUTING.md                        (Phase 2 — gated by D-07)
├── package.json                           (Phase 0)
├── package-lock.json
├── .github/
│   └── workflows/
│       ├── ci.yml                         (test, lint, axe, lhci, replay)
│       └── deploy.yml                     (Phase 1 — to OF-OS Commons)
├── spec/
│   ├── uae-account-information-openapi.yaml   (vendored, pinned by SHA — see SPEC_PIN.txt)
│   └── SPEC_PIN.txt                       (the pinned commit SHA + retrieved date)
├── tools/
│   ├── parse-spec.mjs                     (YAML → dist/SPEC.json — EXP-01)
│   ├── verify-spec-shape.mjs              (CI gate — fails if upstream shape changes — R-EXP-08)
│   ├── lint-no-handauthored-fields.mjs    (EXP-01 invariant)
│   ├── lint-no-institution-leak.mjs       (NG5 invariant — scans /personas/ for bank names)
│   ├── lint-pii-leak.mjs                  (EXP-07 — scans for non-pool names/IBANs/etc.)
│   ├── lint-no-glyph-only.mjs             (EXP-23 (g))
│   ├── pin-spec-sha.mjs                   (developer helper — vendor a new pin)
│   └── build-fixture-package.mjs          (Phase 1.5 — emits @openfinance-os/sandbox-fixtures)
├── personas/
│   ├── _schema.yaml                       (manifest schema — validated in CI)
│   ├── salaried-expat-mid.yaml            (Phase 0 — Sara)
│   ├── salaried-emirati-affluent.yaml     (Phase 1)
│   ├── sme-cash-heavy.yaml                (Phase 1)
│   ├── gig-variable-income.yaml           (Phase 1)
│   ├── recent-graduate-thin-file.yaml     (Phase 1)
│   ├── hnw-multicurrency.yaml             (Phase 1)
│   ├── mortgage-dbr-heavy.yaml            (Phase 1)
│   ├── nsf-distressed.yaml                (Phase 1)
│   ├── joint-account-family.yaml          (Phase 1)
│   ├── senior-retiree.yaml                (Phase 1)
│   ├── domestic-worker.yaml               (Phase 1.5)
│   ├── pep-flagged.yaml                   (Phase 1.5)
│   └── returning-expat.yaml               (Phase 1.5)
├── synthetic-identity-pool/
│   ├── names/
│   │   ├── expat_indian.yaml
│   │   ├── expat_pakistani.yaml
│   │   ├── expat_filipino.yaml
│   │   ├── expat_arab.yaml
│   │   ├── emirati.yaml
│   │   └── ... (other expat communities — Phase 1)
│   ├── employers/
│   │   ├── tech_freezone.yaml             (Sara's pool)
│   │   ├── construction.yaml
│   │   ├── healthcare.yaml
│   │   ├── retail.yaml
│   │   ├── pension_gcc.yaml               (Senior persona)
│   │   └── platforms_gig.yaml             (Gig persona — Careem-like, Talabat-like)
│   ├── merchants/
│   │   ├── groceries.yaml
│   │   ├── fuel.yaml
│   │   ├── dining.yaml
│   │   ├── utilities.yaml
│   │   └── ...
│   ├── counterparty-banks/
│   │   ├── domestic.yaml                  (synthetic UAE bank names)
│   │   └── international.yaml             (for FX / remittance)
│   └── ibans/
│       └── synthetic.yaml                 (deterministic synthetic IBAN generator inputs)
├── src/
│   ├── index.html                         (the sandbox)
│   ├── embed.html                         (chrome-less variant — EXP-27)
│   ├── about.html                         (citation guidance, methodology, /changelog)
│   ├── styles.css                         (OF-OS Commons identity tokens)
│   ├── app.js                             (entry — wires up the 3-pane UI)
│   ├── prng.js                            (mulberry32 + seed mixer)
│   ├── url.js                             (encode/decode persona+lfi+seed — EXP-17 / §6.8)
│   ├── analytics.js                       (PostHog wiring — EXP-21)
│   ├── generator/
│   │   ├── index.js                       (orchestrator — manifest → bundle)
│   │   ├── accounts.js
│   │   ├── balances.js
│   │   ├── transactions.js                (the load-bearing one — narrative coherence)
│   │   ├── standing-orders.js
│   │   ├── direct-debits.js
│   │   ├── beneficiaries.js
│   │   ├── scheduled-payments.js
│   │   ├── product.js
│   │   ├── parties.js
│   │   ├── statements.js
│   │   ├── identity.js                    (draws from synthetic-identity-pool)
│   │   └── lfi-profile.js                 (Rich/Median/Sparse redaction — §8.3)
│   ├── ui/
│   │   ├── persona-library.js
│   │   ├── navigator.js
│   │   ├── field-card.js                  (EXP-14 — 9 elements)
│   │   ├── coverage-meter.js              (EXP-15 — bundle + per-endpoint)
│   │   ├── transactions-view.js           (EXP-11 — filter/search/sort)
│   │   ├── compare-lfis.js                (Phase 1.5 — EXP-16)
│   │   ├── underwriting-panel.js          (Phase 1.5 — EXP-18)
│   │   ├── tell-me-a-story.js             (§5.4)
│   │   ├── raw-json-toggle.js             (EXP-10)
│   │   ├── export.js                      (EXP-19 — JSON / CSV / tarball)
│   │   ├── report-issue.js                (EXP-26 — pre-filled GitHub issue)
│   │   └── topbar.js                      (EXP-09)
│   └── shared/
│       ├── spec-helpers.js                (status badge derivation, conditional rule eval)
│       └── watermark.js                   (§6.5)
├── dist/
│   └── SPEC.json                          (generated by tools/parse-spec.mjs — checked in for Phase 0)
└── tests/
    ├── replay.test.mjs                    (EXP-05 — byte-identical bundles)
    ├── spec-validation.test.mjs           (EXP-10 — every payload validates against v2.1 schema)
    ├── status-coverage.test.mjs           (EXP-13 — every field has a badge)
    ├── narrative-coherence.test.mjs       (EXP-06 — Payroll on payday, rent within 0–3d, etc.)
    ├── lfi-profile.test.mjs               (EXP-04 — Rich/Median/Sparse mandatory-equality + populate counts)
    ├── persona-stress.test.mjs            (EXP-25 — uniqueness on stress_coverage)
    ├── pii-leak.test.mjs                  (EXP-07 + EXP-22 (a))
    ├── watermark.test.mjs                 (EXP-19 + EXP-22 (b))
    ├── identity-posture.test.mjs          (EXP-22 (c) — no cookies / localStorage / non-URL identity)
    ├── analytics.test.mjs                 (EXP-21 — event allowlist + no PII)
    ├── pre-fill-payload.test.mjs          (EXP-26 — snapshot the GitHub issue body)
    ├── coverage-meter.test.mjs            (EXP-15 — bundle + per-endpoint values)
    ├── url-roundtrip.test.mjs             (§6.8 — encode/decode three URL shapes)
    ├── persona-manifest-schema.test.mjs   (validates each /personas/*.yaml against _schema.yaml)
    ├── synthetic-pool.test.mjs            (every name/IBAN/employer in generator output traces to /synthetic-identity-pool/)
    └── e2e/
        ├── a11y.spec.mjs                  (axe-core via Playwright — EXP-23)
        ├── keyboard-nav.spec.mjs          (full keyboard walkthrough)
        └── lighthouse.spec.mjs            (performance budget — EXP-24)
```

---

## 3. Phase 0 spike — Wk 1–2 (10 working days)

**Goal:** prove the spine — one persona end-to-end through three endpoints, badges driven from spec, deterministic, accessible. Internal preview only at `/commons/sandbox/preview/` (or equivalent unindexed path) with `<meta name="robots" content="noindex">`. Hardcoded LFI=Median.

**Exit criteria** (PRD §11): self-review confirms IA, field treatment, and feasibility for Phase 1 expansion.

| # | Task | Output | EXP / invariant gated |
|---|---|---|---|
| **0.1** | Initialise Node project: `package.json` (private until Phase 1), `package-lock.json`, `.gitignore`, MIT/CC0 LICENSEs, GitHub Actions skeleton, Vitest config, ESLint config. | Repo bootstrapped. | — |
| **0.2** | Vendor `uae-account-information-openapi.yaml` from `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/`. Record SHA + retrieved-date in `spec/SPEC_PIN.txt`. | `spec/uae-account-information-openapi.yaml` checked in. | EXP-01, §6.3 |
| **0.3** | Build `tools/parse-spec.mjs` — emits `dist/SPEC.json` keyed by endpoint + schema, with field metadata (name, type, format, enum, required, conditional rule). Hand-written `tools/verify-spec-shape.mjs` runs as a CI gate that fails if the parser encounters an unrecognised structure. | `dist/SPEC.json` (~50–200 KB depending on flattening). | EXP-01, R-EXP-08 |
| **0.4** | Hand-roll `src/prng.js` — mulberry32 + a `seedFromTuple(persona_id, lfi_profile, seed)` mixer. Unit-tested. | Deterministic PRNG primitive. | EXP-05 |
| **0.5** | Author `personas/_schema.yaml` (the manifest schema) and `personas/salaried-expat-mid.yaml` from PRD §8.2 (with the v0.9 employer-pool fix). Validation against schema enforced in CI. | Sara's manifest. | EXP-02, EXP-25 (`stress_coverage` field present) |
| **0.6** | Author Phase 0 slices of the synthetic identity pool: `names/expat_indian.yaml`, `employers/tech_freezone.yaml`, `merchants/{groceries,fuel,dining,utilities}.yaml`, `counterparty-banks/domestic.yaml`. Just enough to feed Sara. | Pool seeded. | EXP-07 |
| **0.7** | Build `src/generator/{accounts,balances,transactions}.js` end-to-end for Sara at LFI=Median. Transactions module produces the v2.1-correct shape: `Flags=[Payroll]` on payday, monthly rent direct debit posted day +2, MCC clusters (groceries, fuel, dining, utilities), no FX, no cash deposits. | Sara's bundle generates. | EXP-03, EXP-06 (subset) |
| **0.8** | Build `src/generator/lfi-profile.js` for the Median profile only (Phase 0 limits scope). Verify mandatory fields are never redacted. | Profile filter scaffolded. | EXP-04 (subset) |
| **0.9** | Strip residual brand chrome from `of-sandbox-prototype.html`; replace its hand-coded SPEC with `dist/SPEC.json`; fix all v2.1 enum values flagged in `PRD_OF_Data_Explorer_Spec_Validation.md`. Save as `src/index.html` + `src/styles.css` + `src/app.js`. | Prototype evolved into the spike UI. | NG6, Spec_Validation findings closed |
| **0.10** | Wire the field-status badges (EXP-13): solid pill for mandatory, dashed for optional, outline + rule chip for conditional. Status derived from `dist/SPEC.json` only — hand-authored field tables forbidden by `tools/lint-no-handauthored-fields.mjs`. | Badges render correctly. | EXP-01, EXP-13 |
| **0.11** | Field card (EXP-14) — Phase 0 minimum: name, type, format, enum, status badge, persona example value. Spec citation, conditional rule, and "what to expect from real LFIs" guidance deferred to Phase 1. | Field card opens on hover/focus. | EXP-14 (subset) |
| **0.12** | Coverage meter (EXP-15) — Phase 0 minimum: bundle-level only. Per-endpoint sub-meter deferred to Phase 1. | Top-bar meter renders. | EXP-15 (subset) |
| **0.13** | Snapshot test (`tests/spec-validation.test.mjs`) — Sara × Median × {accounts, balances, transactions} payloads validate against the v2.1 OpenAPI schema via `ajv`. | Spec compliance proven for the spike. | EXP-10 (subset) |
| **0.14** | Replay test (`tests/replay.test.mjs`) — generate Sara × Median × seed=1 twice in a clean Node process; assert byte-identical output. | Determinism proven. | EXP-05 |
| **0.15** | a11y check (`tests/e2e/a11y.spec.mjs`) — axe-core via Playwright on the spike build, zero violations. Keyboard-only walkthrough recorded as a video artefact in CI. | a11y baseline established. | EXP-23 (subset) |
| **0.16** | Self-review demo. Confirm IA, field treatment, feasibility for Phase 1. Document any pivots in CHANGELOG. | Phase 0 closes. | §11 Phase 0 exit |

**Phase 0 deliverable shape:** ~3–5k lines of JS, ~200–500 lines of YAML, one persona, three endpoints, deterministic, spec-validated, a11y-clean. Hosted internally only.

---

## 4. Phase 1 — V1 Commons publication — Wk 3–8 (30 working days)

**Goal:** ship at `openfinance-os.org/commons/[slug]` with 10 personas × 12 endpoints × 3 LFI profiles, all v1 EXPs (EXP-01..EXP-15, EXP-17, EXP-19, EXP-21, EXP-22, EXP-23, EXP-24, EXP-25, EXP-26, EXP-27).

**Exit criteria** (PRD §11): M1 hit (< 5 min time-to-first-insight) in usability testing with 5 users spanning Sara plus at least one of Hassan / Maryam / Reem / Hamid; listed in the OF-OS Commons feed.

The work decomposes into seven streams that run partly in parallel. The order within each stream is sequential; streams sync at three checkpoints (Wk 4 end, Wk 6 end, Wk 8 end).

### Stream A — Spec-driven generator completion

| # | Task | EXP |
|---|---|---|
| A.1 | Extend `tools/parse-spec.mjs` to handle the full v2.1 schema (every endpoint, every conditional rule, every enum). Add `tools/lint-no-handauthored-fields.mjs` to CI as a hard gate. | EXP-01 |
| A.2 | Build `src/generator/{standing-orders,direct-debits,beneficiaries,scheduled-payments,product,parties,statements}.js`. Each module matches v2.1 schema exactly; each is invariant-tested. | EXP-03 |
| A.3 | Complete `src/generator/lfi-profile.js` for all three profiles. Add `tests/lfi-profile.test.mjs` asserting (a) mandatory equality across profiles, (b) Sparse → only Universal optional fields populated, (c) Rich → every band populated, (d) Median populate counts within ±10% of expected over 1000-seed Monte Carlo. | EXP-04 |
| A.4 | Add narrative-coherence tests (`tests/narrative-coherence.test.mjs`): salary on payday with `Flags=Payroll`, rent within 0–3 days, MCC clusters, FX only on FX-active personas, cash deposits only on cash-heavy personas, standing-order amounts match transaction history. | EXP-06 |

### Stream B — Persona library expansion (10 v1 personas)

| # | Task |
|---|---|
| B.1 | Author manifests + per-persona generator rules + stress_coverage attestations for: Salaried Emirati Affluent, SME Cash-Heavy, Gig, Thin-File, HNW Multi-currency, Mortgage DBR Heavy, Distressed, Joint Account, Senior. |
| B.2 | Per persona: extend the synthetic identity pool with the relevant slices (e.g., HNW pulls Filipino + Arab names + multi-currency banks; Joint Account pulls a couple's name pair + custodian-for-minor party). |
| B.3 | Snapshot baseline every persona × LFI × endpoint combination — 10 × 3 × 12 = 360 baseline snapshots. |
| B.4 | EXP-25 uniqueness CI: `tests/persona-stress.test.mjs` asserts every manifest's `stress_coverage` adds at least one term not covered by personas already in the library, drawn from Appendix F's controlled vocabulary. |
| B.5 | NG5 lint: `tools/lint-no-institution-leak.mjs` scans `/personas/` for any token matching a known UAE bank name list (vendored from a public UAE bank registry). |

### Stream C — UI / UX completion

| # | Task | EXP |
|---|---|---|
| C.1 | Three-pane layout responsive at 320 / 768 / 1024 / 1440 px; field-detail slide-over on narrow viewports. | EXP-08 |
| C.2 | Top bar: persona, LFI profile, Standards version + SHA on hover, coverage meter at every viewport including 320 px. | EXP-09 |
| C.3 | Rendered ↔ Raw JSON toggle, state-preserved on switch back. | EXP-10 |
| C.4 | Transactions view: filter (date / type / sub-type / debit-credit / amount-band / MCC), full-text search on `TransactionInformation`, sort on every column, stable sort. | EXP-11 |
| C.5 | Standing Orders / Direct Debits / Beneficiaries / Scheduled Payments — bidirectional links to Transactions. | EXP-12 |
| C.6 | Field card complete (EXP-14): all 9 elements including spec-citation link to the upstream Nebras GitHub anchor at the pinned SHA, conditional rule, "what to expect from real LFIs" guidance string (Commons-curated, never institution-attributed). | EXP-14 |
| C.7 | Coverage meter both scopes (bundle + per-endpoint sub-meter in the navigator). | EXP-15 |
| C.8 | Tell-me-a-story walkthrough loads Salaried Expat × Median, steps through the §5.4 narrative, dismissible, doesn't fire on repeat visits. | §5.4, M1 driver |

### Stream D — Sharing, embedding, exporting

| # | Task | EXP |
|---|---|---|
| D.1 | URL state (`src/url.js`): encode persona + lfi + seed, decode on load, three URL shapes per §6.8. `tests/url-roundtrip.test.mjs` asserts every shape round-trips. Persona-default seed defined in each manifest. | EXP-17, §6.8 |
| D.2 | Export (EXP-19): JSON per endpoint, CSV per resource, tarball. Watermarking via `src/shared/watermark.js`. `tests/watermark.test.mjs` scans every export format. | EXP-19, §6.5 |
| D.3 | Embed mode (EXP-27): `embed.html` chrome-less variant; query params `persona`/`lfi`/`endpoint`/`seed`/`height`; oEmbed metadata published; tested in three hosts (basic HTML, Notion-style embed, an LMS module). | EXP-27 |
| D.4 | Report-an-issue (EXP-26): every field card carries the affordance; click opens GitHub issue URL with pre-filled body containing field name + schema, persona, LFI, seed, pinned SHA, checkbox set. Snapshot-tested. | EXP-26 |

### Stream E — Identity, analytics, posture

| # | Task | EXP |
|---|---|---|
| E.1 | PostHog wiring (`src/analytics.js`): allowlist of seven events from EXP-21; assert no event payload contains free-text input or persistent identifier. CI test instruments a headless run and inspects every event. | EXP-21 |
| E.2 | Identity-posture scan (`tests/identity-posture.test.mjs`): headless browser navigates the app, asserts no cookies set, no localStorage / sessionStorage writes outside an opaque session token, no server calls beyond the static asset fetch and PostHog. | EXP-22 (c) |
| E.3 | PII-leak scan (`tools/lint-pii-leak.mjs`): for every persona × LFI × endpoint, scan the bundle for any name/IBAN/phone/DOB/employer/merchant/counterparty-bank token not present in `/synthetic-identity-pool/`. | EXP-07, EXP-22 (a) |

### Stream F — a11y, performance, hardening

| # | Task | EXP |
|---|---|---|
| F.1 | axe-core CI passes with zero violations across `index.html`, `embed.html`, `about.html`. | EXP-23 |
| F.2 | Keyboard-only walkthrough recorded as a CI artefact for every release. | EXP-23 (a) |
| F.3 | VoiceOver + NVDA manual walkthrough — once per release; documented in `CHANGELOG.md`. | EXP-23 (e) |
| F.4 | `prefers-reduced-motion` honoured by the slide-over animation. | EXP-23 (f) |
| F.5 | `tools/lint-no-glyph-only.mjs` asserts no field-card guidance string consists only of a glyph or whose meaning collapses if the glyph is removed. | EXP-23 (g) |
| F.6 | Lighthouse-CI mobile profile: Performance ≥ 90, page weight ≤ 250 KB gzipped, time-to-interactive < 3 s on 4G/5 Mbps. CI fails the build on regression. | EXP-24 |
| F.7 | Synthetic-data generation < 200 ms on a mid-tier mobile device (real-device test pre-launch). | EXP-24 |

### Stream G — Commons publication and launch

| # | Task |
|---|---|
| G.1 | `/about` page: methodology, populate-rate-bands explainer, citation guidance, changelog summary, EOL/handoff clause from §16. |
| G.2 | Persistent footer: synthetic disclaimer, populate-rate-band disclaimer, Standards v2.1 + pinned SHA. |
| G.3 | Static cross-link from the *Credit Underwriting in the UAE* Commons article — coordinated with the article author per D-04. |
| G.4 | Commons-feed listing with preview card and tags (`bank-data-sharing`, `synthetic-data`, `developer-tool`, `credit-underwriting`). |
| G.5 | Pre-publication checklist (PRD §11) run end-to-end: spec validation re-run, disclaimer copy approved, cross-link in place, accessibility check, PostHog events verified anonymous. |
| G.6 | Phase 1 exit usability test: 5 users, M1 measured. Findings logged in `CHANGELOG.md`. At least one of Hassan / Maryam / Reem / Hamid included to validate non-anchor JTBDs and to deliver the R-EXP-04 closure signal. |
| G.7 | Publish to OF-OS Commons via the publication workflow (D-05). Tag `v1.0.0`. |

### Phase 1 sync points

- **Wk 4 end** — Stream A (generator) and Stream B (persona library) at ≥ 50% of v1 scope; Stream C field card complete; first end-to-end persona × LFI × endpoint snapshot suite passing in CI.
- **Wk 6 end** — feature freeze. All v1 EXPs implemented in code. Streams D / E / F bring up scans and CI gates. Bug-fix only from this point.
- **Wk 8 end** — pre-publication checklist signed off; Commons feed entry approved; `v1.0.0` tagged.

---

## 5. Phase 1.5 — Wk 9–12 (20 working days)

**Goal:** Compare-LFIs, Underwriting Scenario panel, persona library to 13, fixture distribution, Arabic / RTL.

**Exit criteria** (PRD §11): ≥ 50 unique external monthly users; ≥ 1 external citation; AML scenario (Aisha + PEP persona) demonstrated end-to-end.

| Stream | Tasks | EXP |
|---|---|---|
| **H — Compare-LFIs** | Side-by-side render for any two of {Rich, Median, Sparse}; diff highlighting matches the EXP-04 redaction logic; user can flip which profile is on which side. | EXP-16 |
| **I — Underwriting Scenario panel** | All four signals (Implied monthly net income with primary + Fallback A + Fallback B + final `—`, Total fixed commitments with multi-currency normalisation, Implied DBR, NSF/distress count); low-volume guard (Senior persona); Gig-fallback test; HNW multi-currency normalisation test; pinned-formula footnote on every signal. | EXP-18 |
| **J — Persona library v1.5** | Domestic Worker, PEP-flagged, Returning Expat. New synthetic-pool slices (Filipino lower-income, PEP markers, returning-expat international transfers). Stress-coverage extends Appendix F. | EXP-02, EXP-25 |
| **K — Fixture package** | `build-fixture-package.mjs` emits `@openfinance-os/sandbox-fixtures` with the EXP-20 v0.9 contents (JSON bundles + parsed SPEC + manifests + manifest.json). Publish to npm; mirror to PyPI. Round-trip tested in clean Node + Python environments. | EXP-20 |
| **L — Arabic / RTL** | `name_ar` + `narrative_ar` fields in manifests; RTL CSS pass; Arabic-Indic numeral toggle in the top bar; full-app translation file. | D-10 |
| **M — Phase 1.5 success-metric instrumentation** | M2 / M3 / M7 baseline reads at the end of Wk 12. AML scenario walkthrough (Aisha + PEP) recorded. | M2, M3, M7 |

### Phase 1.5 deliverable: tag `v1.5.0`.

---

## 6. Test infrastructure (cross-phase)

| Layer | Tool | Gates | Phase introduced |
|---|---|---|---|
| Unit + integration | Vitest | EXP-04, EXP-05, EXP-06, EXP-15, EXP-25, §6.8 | Phase 0 |
| Spec validation | `ajv` against vendored v2.1 OpenAPI | EXP-10 (every persona × LFI × endpoint) | Phase 0 (subset) → Phase 1 (full matrix) |
| Replay | Vitest with byte-comparison | EXP-05 | Phase 0 |
| Persona schema | Vitest + `js-yaml` | EXP-02, EXP-25 | Phase 0 |
| Synthetic-pool trace | Vitest | EXP-07, EXP-22 (a) | Phase 0 (subset) → Phase 1 (full) |
| Watermark scan | Vitest | EXP-19, EXP-22 (b) | Phase 1 |
| Identity-posture scan | Playwright | EXP-22 (c) | Phase 1 |
| Analytics-payload scan | Playwright | EXP-21 | Phase 1 |
| GitHub-issue pre-fill | Vitest snapshot | EXP-26 | Phase 1 |
| URL roundtrip | Vitest | EXP-17, §6.8 | Phase 1 |
| a11y | `@axe-core/playwright` | EXP-23 | Phase 0 (subset) → Phase 1 (full + manual SR walkthrough) |
| Performance | `@lhci/cli` | EXP-24 | Phase 1 |
| Spec-shape verifier | `tools/verify-spec-shape.mjs` | R-EXP-08 | Phase 0 |
| No-handauthored-fields lint | `tools/lint-no-handauthored-fields.mjs` | EXP-01 | Phase 0 (subset) → Phase 1 (full) |
| No-institution-leak lint | `tools/lint-no-institution-leak.mjs` | NG5 | Phase 1 |
| No-glyph-only lint | `tools/lint-no-glyph-only.mjs` | EXP-23 (g) | Phase 1 |
| Fixture roundtrip | Vitest + a Python smoke test | EXP-20 | Phase 1.5 |

The CI matrix runs every push and every PR. Failures block merge. The pre-publication checklist (PRD §11) re-runs the full suite on the release tag.

---

## 7. Risks during implementation (additive to PRD §12)

These are *implementation-time* risks the PRD's R-EXP-NN list doesn't cover.

| ID | Risk | Mitigation |
|---|---|---|
| **I-01** | The v2.1 OpenAPI YAML's structure has surprises that break `parse-spec.mjs` in Phase 0 — conditional-rule encoding in particular varies across OpenAPI tooling. | Phase 0 task 0.3 includes `verify-spec-shape.mjs` as a CI gate; if the parser hits an unrecognised structure, the build fails loudly and we extend the parser before proceeding. The build-time failure is preferable to a runtime drift. |
| **I-02** | Persona generator complexity outstrips the "no build chain" constraint, especially around v1.5 underwriting-scenario formulas across multi-currency. | Keep the generator pure-JS, no build chain. If the math gets unwieldy, extract pure-function helpers into `src/shared/` rather than reaching for TypeScript. |
| **I-03** | Lighthouse-90 budget is hard to maintain as personas / endpoints grow — large `dist/SPEC.json` and large persona bundles risk page-weight regression. | Phase 1 Stream F.6 makes the budget a CI gate so regressions are caught at PR time. If we approach the limit, the first lever is lazy-loading the SPEC sections per active endpoint, then per-persona JSON files (already small). The 250 KB gzipped budget allows comfortable headroom for v1. |
| **I-04** | Mid-tier mobile real-device test (EXP-24 — gen < 200 ms) is hard to automate; we'll rely on emulated profiles in CI plus a manual real-device check pre-launch. | Document the manual-check protocol; record results in `CHANGELOG.md` per release. |
| **I-05** | Snapshot-test suite at full matrix (10 personas × 3 LFI × 12 endpoints = 360 baselines + per-test files) gets noisy when the generator legitimately changes. | Adopt a snapshot-update workflow: a flag forces regeneration across the matrix; CI rejects PRs that update snapshots without an accompanying note in `CHANGELOG.md` explaining what changed and why. |
| **I-06** | Spec-pin SHA bumps may bring breaking schema changes from upstream. | Per §16 the spec-pin SLA is 30 days. Per R-EXP-08 the build-time check fails loudly. We pin upgrades through a PR that runs the full snapshot suite — diffs are auditable. |
| **I-07** | The synthetic identity pool is the second-most-load-bearing artefact after the spec parser. Authoring it is content work, not engineering. | Treat pool-authoring as a parallel track to the engineering streams. Author Phase 0 slices first (just enough to feed Sara), then expand in lock-step with Stream B (persona-library expansion). |
| **I-08** | Hassan-validated R-EXP-04 closure signal depends on finding a real LFI-side compliance officer for usability test. | Outreach starts at Wk 4 (synced with the Stream B / Stream C mid-checkpoint) so the test slot is locked before Wk 8. If no Hassan-shaped tester is available, fall back to a sympathetic ex-LFI contact and document the substitution. |

---

## 8. Open implementation decisions (need confirmation before Phase 0 starts)

These are the eight decisions that shape Phase 0. None are blockers if the recommendations stand.

1. **Repo URL.** Recommend `github.com/openfinance-os/data-sandbox` (matches the `@openfinance-os/...` namespace from D-06). Alternative: `github.com/<michael-personal-org>/of-data-sandbox` if the OF-OS Commons org isn't yet provisioned.
2. **Test runner.** Recommend Vitest. Alternative: Node native test runner. Vitest costs one dep but pays for itself with snapshot ergonomics.
3. **TypeScript or plain JS + JSDoc?** Recommend **plain JS + `@ts-check` JSDoc** for v1, revisit at v1.5. Keeps the "no build chain" promise and stays diff-friendly.
4. **`dist/SPEC.json` checked in or built?** Recommend **checked in** for Phase 0 (simpler — no Action runs needed for someone reading the repo); switch to **built artefact** at Phase 1 once the build is reliable. The pinned SHA in `spec/SPEC_PIN.txt` is the source of truth either way.
5. **Spec SHA target.** Recommend pinning to the **latest v2.1 final** SHA at Phase 0 start. If only `v2.1-rc2` is available at the date Phase 0 begins, pin to the rc and bump to final via the §16 30-day SLA. The skill reference says v2.1-rc2 was published Nov 2025 — the v2.1 final timing is the gate.
6. **PostHog project key.** Recommend creating a dedicated **OF-OS Commons** PostHog project with a single key reused across the Commons properties (consistent with D-08 framing). If a key already exists for OF-OS Commons, reuse it. Confirm with the Commons maintainer (= author).
7. **License attribution.** Recommend `LICENSE` (MIT — code) + `LICENSE-DATA` (CC0 — synthetic data) at repo root, per §14. Phase 0 task 0.1.
8. **Commons publication workflow handshake.** Recommend a dry-run of the publication workflow at Wk 7 (one week before Phase 1 launch), against a staging slug. The Commons maintainer (= author) confirms artefact shape and metadata. If the publication workflow is Hugo / Eleventy / Next.js / static-asset upload — confirm by Wk 6 so we can shape the release tarball accordingly.

---

## 9. Out of scope for this plan

- Phase 2 work: community contribution flow, Open Wealth, Insurance, Service Initiation extensions, persona-authoring tool, replay mode against real Al Tareq sandbox calls. Phase 2 gets its own plan once v1.5 ships.
- Marketing, comms, social-media plan. There is no separate marketing surface — the OF-OS Commons feed is the surface (NG7).
- Internal LFI-specific calibration data of any kind (NG4 / NG5).

---

## 10. Sequence of immediate next steps

After this plan is approved:

1. Confirm the eight Open Implementation Decisions (§8). I'll proceed with the recommendations unless flagged.
2. Start Phase 0 task 0.1 (project bootstrap) and 0.2 (vendor v2.1 spec) in parallel; everything else in Phase 0 sequences from these two.
3. Phase 0 demo at the end of Wk 2; self-approval kicks off Phase 1.
