# PRD — Open Finance Data Sandbox

| Field | Value |
|---|---|
| **Document type** | Standalone product PRD (discovery stage) |
| **Version** | 0.10 (draft — reconciles PRD with shipped code: persona-library swap recorded, EXP-33/34 added for the Custom Persona Builder, EXP-06 acceptance tightened, D-08 PostHog deferral, D-10 Arabic/RTL slip, D-12 canonical slug locked, phasing table synced to reality through v1.6 + v2.0 insurance preview) |
| **Date** | 2 May 2026 |
| **Author** | Michael Hartmann |
| **Status** | Draft — for OF-OS Commons stewardship review |
| **Classification** | Public-by-design product. Synthetic data, derived entirely from the published UAE Open Finance Standards. |
| **Product name** | **Open Finance Data Sandbox** (resolved per former OQ-EXP-02). Hosted as part of the OpenFinance-OS Commons. |
| **Hosting** | **`https://openfinance-os.org/commons/[slug]`** — alongside *Velox: Open Finance Interactive Demo*, the *Leveraging Open Finance Data for Credit Underwriting in the UAE* article, and *Open Finance Hackathon Docs*. Final slug confirmed by the Commons publication workflow (per former OQ-EXP-05, handled by the maintainer). |
| **Brand framing** | The artefact is fully part of OpenFinance-OS Commons; it inherits OF-OS Commons styling and metadata. There is no separate contributor branding. |
| **Standards baseline** | UAE Open Finance Standards **v2.1 only** — `uae-account-information-openapi.yaml` from `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/`, pinned by commit SHA. (No multi-version toggle, per former OQ-EXP-01.) |
| **Scope discipline** | This PRD is about a public OF data sandbox and its synthetic data only. It contains nothing about any specific institution's internal systems, teams, processes, or data. |

---

## 1. Why this exists

UAE Open Finance is moving from spec-on-paper to data-flowing-through-pipes. Anyone consuming this data as a TPP — a regulated bank, a Hub71/ADGM fintech, an Al Tareq onboarding cohort, an independent developer — faces the same first-day problem: **the spec tells you the schema, but not what the data actually looks like in practice.**

The Bank Data Sharing schema is shaped by a single regulatory document, but **the actual content will vary dramatically across the 50+ LFIs in scope**:

- A subset of fields are spec-mandatory and will always be present.
- A larger subset are optional — and each LFI populates them based on its own systems, data quality, and product mix.
- A further subset are conditional — present only when other field values trigger them.
- Some fields look mandatory on paper but in practice carry low-quality or LFI-proprietary content.

There is no shared answer in the UAE OF ecosystem to "what does this data actually look like?". Every TPP team is solving the same intuition gap from scratch — against slide decks, OpenAPI specs, and Confluence pages. Field-level decisions ("can I rely on `MerchantCategoryCode` for affordability scoring?", "what does six months of transactions look like for a salaried expat?") get made against documents, not data.

The **OpenFinance-OS Commons** is the natural home for the answer. It already hosts *Velox* (an interactive Open Finance demo) and an article *Leveraging Open Finance Data for Credit Underwriting in the UAE*. This sandbox is the show-don't-tell companion to that article: an interactive surface that lets a TPP-perspective user load a synthetic UAE persona and read every OF Bank Data Sharing payload they would receive for that persona, with mandatory/optional/conditional field treatment derived live from the published OpenAPI spec.

Beyond direct readers, the sandbox is also designed to feed the demo journeys that TPPs build *while* they integrate against the Nebras-operated regulatory sandbox. The Nebras sandbox is the conformance environment — its mock data is intentionally thin (a couple of accounts, a handful of canned transactions, no narrative coherence across endpoints), which is the right tradeoff for certification but leaves a TPP's investor pitch / sales deck / regulator demo / internal-QA showcase looking empty. TPPs who want narratively-coherent synthetic personas for those *showcase* journeys can point their demo UI at this sandbox's fixtures via four plug points (iframe, npm, PyPI, raw HTTPS JSON) and get persona-coherent (`AccountId`, `CustomerId`, transactions all line up across endpoints) data. This sandbox is **not endorsed by Nebras / CBUAE / any LFI** and is not a substitute for Nebras-sandbox certification (per R-EXP-03). See §4.5 / EXP-28..EXP-32 and the integration guide at `/integrate`.

The artefact is built entirely from public inputs:

- The **published OpenAPI 3.1 spec** for UAE Open Finance Standards v2.1.
- **Synthetic personas** designed to be narratively realistic for the UAE market.
- **Configurable LFI population profiles** (rich / median / sparse) so users can stress-test design decisions against best-case and worst-case shapes.

Nothing in the product depends on any specific institution's internal data, systems, or processes. The artefact is publishable safely on the open web because, by construction, there is nothing private in it.

The output is **shared intuition for the UAE Open Finance ecosystem**, contributed back to the Commons.

---

## 2. Goals & non-goals

### 2.1 Goals (v1)

- **G1.** Let any TPP-perspective user load a synthetic UAE persona and explore every OF Bank Data Sharing payload they would receive for that persona end-to-end (accounts, balances, transactions, standing orders, direct debits, beneficiaries, scheduled payments, product, parties, statements) — with **zero login required**.
- **G2.** Make **mandatory / optional / conditional** field status visually unmistakable at every level of the payload, with definitions, formats, enum values, and "what to expect from real LFIs" guidance one click away. All of this is derived from the published OpenAPI spec and Commons-curated cross-LFI commentary.
- **G3.** Generate synthetic data that is **persona-driven, narratively realistic for the UAE market, and spec-compliant** — not random fuzz. The data tells a story (this person earns AED 25k, pays AED 8k rent, has two direct debits, gets paid on the 25th).
- **G4.** Let users toggle an **LFI population profile** (rich / median / sparse) so they can stress-test downstream design decisions against worst-case (mandatory only) and best-case (every optional populated) shapes from the same persona.
- **G5.** Become the canonical UAE-OF reference for "what does this data actually look like?" — cited by Hub71/ADGM cohorts, peer LFIs, the developer community, journalists, and academics, and surfaced from the OF-OS Commons feed.
- **G6.** **Strengthen the Commons.** A high-quality, useful, recurring-use contribution sets the bar and the format for further community contributions.

### 2.2 Non-goals (v1)

- **NG1.** Not a production decisioning system. The sandbox never runs a real credit decision, payment, or any other operation against live data.
- **NG2.** Not a TPP runtime. The sandbox does not call the Al Tareq API Hub. It synthesises data from the spec; it does not consume real payloads.
- **NG3.** Not Open Wealth, Insurance, Service Initiation, FX, or Pay Request in v1. v1 is **Bank Data Sharing only** (the v2.1 Account Information API). Other OF domains are deferred to v2 (see §11 Phasing).
- **NG4.** **No real customer data, ever.** No anonymised data, no aggregated data, no statistical tables derived from any institution's customer base. Personas are fictional, designed from scratch against publicly observable UAE-market patterns. This is permanent.
- **NG5.** **No institution-specific operational detail, ever.** The sandbox does not encode any specific bank's product mix, categorisation rules, populate-rate observations, or internal logic. Cross-LFI populate-rate guidance is published as ecosystem-wide assumption bands, never attributed to a specific LFI.
- **NG6.** No separate contributor branding anywhere in the artefact — it is fully part of OF-OS Commons, takes the Commons visual identity, and does not single out a contributing organisation.
- **NG7.** Not a marketing site. No in-product pitches, no sales funnels, no upsells.

---

## 3. Users & jobs-to-be-done

The sandbox is built for **anyone working with UAE Open Finance data from the TPP perspective**. Users self-identify via what they're trying to do; the product does not gate by employer or affiliation.

### 3.1 Primary use case: spec-to-intuition for a TPP-side analyst

Sara is a credit underwriter working on UAE-market lending. She has years of experience pricing risk on her own institution's ledger, but has never seen a payload from another bank under the OF spec.

**Jobs-to-be-done:**
- **JTBD-1.1** — *"Show me what 12 months of transactions look like for a typical salaried expat so I can sanity-check my income-verification logic."*
- **JTBD-1.2** — *"Which fields can I rely on from every LFI for DBR (debt burden ratio) calculation, and which only some banks populate?"*
- **JTBD-1.3** — *"What does a 'cash-heavy SME owner' persona look like in OF data? Where do the gaps show up?"*
- **JTBD-1.4** — *"Compare the same persona seen through a 'rich LFI' versus a 'sparse LFI' — does my affordability calc still work?"*

The companion *Leveraging Open Finance Data for Credit Underwriting in the UAE* article on the Commons covers the conceptual side; this sandbox is the interactive surface where a reader of that article goes to *see the data*.

### 3.2 Other user types and their jobs-to-be-done

Each of the user types below has 1–2 named jobs-to-be-done. The product is designed to make every JTBD reachable in under 5 minutes from first landing.

**Fintech founder (Layla)** — Hub71 / ADGM cohort, or pre-licence applicant assessing UAE OF feasibility.
- *JTBD-2.1* — *"Show me what data I'd actually have to work with on day one of a TPP licence, so I can decide whether my use case is feasible before raising the next round."*
- *JTBD-2.2* — *"Compare a Median LFI to a Sparse LFI — my product needs to work even on the worst case, and I need to know if it will."*

**Risk modeller (Faisal)** — credit / market / operational risk on the TPP side.
- *JTBD-3.1* — *"Export 5,000 transactions for the Mortgage-DBR persona under Median LFI as CSV so I can prototype an affordability model in my own notebook."*
- *JTBD-3.2* — *"Show me the populate-rate distribution across all optional fields so I know which to feature-engineer and which to skip."*

**AML / financial crime analyst (Aisha)** — behavioural monitoring rule design.
- *JTBD-4.1* — *"Show me the Cash-Heavy SME persona — where would I expect to see suspicious patterns, and which fields are populated densely enough to design rules on?"*

**Product manager (Daniel)** — scoping downstream UI / decision pipelines / customer-facing displays.
- *JTBD-5.1* — *"Surface the worst-case (Sparse LFI) shape of every endpoint so I can scope downstream UI for the absent-fields case."*
- *JTBD-5.2* — *"Walk a stakeholder through a single persona end-to-end as a 5-minute demo so they grasp the data shape without me explaining."*

**Data scientist / ML engineer (Priya)** — model prototyping ahead of live data.
- *JTBD-6.1* — *"Give me a stable, deterministic fixture URL for a known-good payload I can paste into my unit tests and notebooks."*

**Developer / technical writer (Yusuf)** — reference manual with examples; may share screenshots, write blog posts.
- *JTBD-7.1* — *"Give me a stable URL for a specific persona+LFI+seed I can embed in my own blog post or Hackathon submission."*
- *JTBD-7.2* — *"Show me the Raw JSON for an FX transaction so I have a concrete v2.1 example to paste into my code."*

**Solutions / sales engineer (Omar)** — customer conversations across the ecosystem.
- *JTBD-8.1* — *"Drive a credible 'what your bank's data will look like' walkthrough during a customer call, without revealing any institution-specific information."*

**Journalist / researcher / academic (Maya)** — canonical concrete answer to "what is in UAE Open Finance data?".
- *JTBD-9.1* — *"Show me a citable example of `Flags=Payroll` in action so my article has a concrete reference."*
- *JTBD-9.2* — *"Give me a stable persona-level URL I can cite in a footnote that won't drift."*

**Internal compliance / audit at LFI (Hassan)** — works *inside* an LFI, not at a TPP. Uses the sandbox to verify his own bank's spec compliance — the opposite direction from every other persona above.
- *JTBD-10.1* — *"Show me what the v2.1 spec says my bank should be emitting so I can compare against what we're actually emitting in our certification environment."*
- *JTBD-10.2* — *"Walk me through a well-formed end-to-end payload for the 12 endpoints — I'm preparing for an OF certification audit and need a reference."*

Hassan matters for the artefact's positioning: an LFI-side user actively self-verifying against the sandbox is the strongest possible answer to R-EXP-04 (the risk that LFIs perceive the sandbox as implicit comparison).

**Educator / training designer (Maryam)** — runs a fintech bootcamp / university finance module / hackathon prep session. The Commons already hosts *Open Finance Hackathon Docs* as a sibling — Maryam is the audience for both.
- *JTBD-11.1* — *"Embed a specific persona+LFI in my slide deck or LMS so my class can interact with it during the lecture."*
- *JTBD-11.2* — *"Give me a 30-minute teaching exercise structure: load this persona, examine these fields, here's what to notice."*

Maryam's JTBDs drive the embedding requirement — without iframe-able views, the artefact stops at the sandbox URL and doesn't enter classrooms.

**Privacy / DPO (Reem)** — PDPL compliance officer at a TPP. PDPL is non-trivial in the UAE and currently has no surface in the user list.
- *JTBD-12.1* — *"Show me which fields contain PII so I can scope my data-handling controls under PDPL."*
- *JTBD-12.2* — *"Compare what data we strictly need under our consented use case vs. what we're actually receiving — am I over-collecting?"*

Reem's JTBDs make the sandbox useful for *governance*, not just product-build. The "PII at-a-glance" view becomes a natural derived feature. **(v1.5+ derivation.** Field-card metadata from EXP-14 is the substrate; a dedicated PII overlay is targeted for v1.5 alongside the Compare-LFIs mode. v1 already lets a careful reader walk the field-card stream and identify PII fields — the overlay is the ergonomic improvement.)

**OSS / SDK contributor (Hamid)** — building UAE OF SDKs in Python / Node / Go / Rust for the community.
- *JTBD-13.1* — *"Give me a multi-persona deterministic test corpus my SDK's CI can validate against, packaged as `@openfinance-os/...` fixtures I can pin."*
- *JTBD-13.2* — *"Show me edge cases (FX, conditional triggers, multi-party accounts, sparse-LFI shapes) my SDK has to handle correctly."*

Hamid's JTBDs elevate the EXP-20 fixture-package goal from "nice-to-have" to a primary use case. Turns the artefact from a *viewer* into shared *infrastructure* — the move that creates network effects in the Commons.

### 3.3 Persona library (the synthetic customers)

Distinct from the *user* archetypes above, the sandbox ships a curated library of synthetic UAE customer personas. **As of v1.5 the library is 12 banking personas + 1 insurance preview persona (v2.0).** Users load these to explore the data:

| # | Persona | Phase | Archetype | Why it matters |
|---|---|---|---|---|
| 1 | **Salaried Expat — Mid Tier** | v1 | AED 25k/mo salary, IT professional, single Current account, one credit card, monthly rent direct debit | Baseline affordability case — the most common UAE retail customer shape |
| 2 | **Salaried Emirati — Affluent** | v1 | AED 60k/mo, multi-account, FX activity, mortgage, multiple cards | Tests multi-currency, mortgage commitments, credit-line balance handling |
| 3 | **SME Owner — Cash-Heavy Retail** | v1 | UAE SME current + business, frequent cash deposits, sparse merchant detail | AML / behavioural monitoring stress test; thin merchant data |
| 4 | **Gig / Variable Income Worker** | v1 | Irregular inflows from multiple platforms (Careem, Talabat, freelance) | Tests income-verification logic against non-salary patterns |
| 5 | **Recent Graduate / Thin File** | v1 | Single account, 8 months history, occasional overdraft, building credit | Worst-case for thin-file underwriting |
| 6 | **HNW / Multi-Currency Holder** | v1 | 4 accounts (AED, USD, EUR, GBP), investment-related transfers, high-value transactions | Tests `CurrencyExchange` handling, large-amount edge cases |
| 7 | **Mortgage Holder — DBR Heavy** | v1 | Salaried, large mortgage standing order, multiple direct debits, high commitment ratio | Stress test for affordability calcs in DBR-stretched cases |
| 8 | **NSF / Distressed Borrower** | v1 | Bounced direct debits, low-balance events, late-month overdraft | Tests behavioural-distress signal detection |
| 9 | **Joint Account / Family** | v1 | UAE expat couple with joint current account + custodianship account for two minor children | Multi-party account ownership; exercises the v2.1 `/parties` and `/accounts/{id}/parties` endpoints heavily; tests `customerType=Joint`, `accountRole=CustodianForMinor`, `accountRole=PowerOfAttorney` |
| 10 | **Senior / Retiree** | v1 | UAE national, 67, retired with GCC pension scheme, low transaction volume, savings-heavy, occasional medical-related debits | Low-volume edge case; pension-specific income patterns; deliberately breaks the trailing-12-month income-stability assumption (see EXP-18 low-volume guard) |
| 11 | **SME Trading Business** | v1.5 | UAE trading-licensed SME, multi-currency invoicing, supplier outflows in USD/EUR, irregular inbound wires from overseas customers | Cross-border B2B flows; FX-heavy non-retail pattern; complements `sme-cash-heavy` (cash-dominant) with a wires-dominant counterweight |
| 12 | **Corporate Treasury — Listed** | v1.5 | Listed UAE corporate, treasury account, bulk payroll outflows, intercompany sweeps, high transaction volume | Top of the corporate volume curve; exercises high-volume `/transactions` rendering, payroll counterparty clustering, intercompany-sweep recognition |
| **I-1** | **Motor Comprehensive — Mid** *(insurance preview)* | v2.0 | Mid-tier motor comprehensive policy, single vehicle, one named driver, one prior claim | First Phase-2 Open Insurance persona; exercises motor policy / vehicle / claims envelopes against the vendored UAE Insurance OpenAPI |

All personas are **fictional** and designed from publicly observable UAE-market patterns — they do not encode any specific institution's customer-base statistics. Each persona's YAML manifest declares a `stress_coverage` field listing the spec elements that persona uniquely tests, per EXP-25.

**Deferred from v1.5 (originally specified, not shipped).** Three personas — *Domestic Worker / Lower-Income Salaried*, *High-Risk / PEP-flagged*, *Returning Expat* — were specified for v1.5 but not built; v1.5 substituted two SME/Corporate archetypes (#11, #12) plus the insurance preview (I-1) instead. The PEP-flagged drop in particular leaves Aisha's JTBD-4.1 (AML scenario) without its dedicated load-this-persona target; until that persona is restored, AML walk-throughs lean on `sme-cash-heavy` (cash-dominant flags) rather than a true PEP archetype. Restoration is tracked against v2.x; see §11.

---

## 4. Functional requirements

Each requirement carries an `EXP-NN` ID; downstream stories, designs, and tests reference these.

### 4.1 Data model & generation

| ID | Requirement | Acceptance | Phase |
|---|---|---|---|
| **EXP-01** | Synthetic data SHALL be generated from the **published Standards v2.1 OpenAPI definition** for the UAE Account Information API. The schema (field names, types, enums, mandatory/optional flags) is **derived from the spec, not authored manually**. Schema drift is a tracked invariant: version bumps regenerate fixtures from the updated spec. | Spec-driven status badges; if a CI test injects a fake `required: [extra_field]` into the YAML, the build either picks up the new mandatory or fails loudly. Hand-authored field metadata is forbidden in the codebase (linter rule). | v1 |
| **EXP-02** | The sandbox SHALL ship a **persona library** of at least 10 named UAE customer archetypes at Phase 1 launch (per §3.3) and at least 12 by Phase 1.5. Personas are versioned and curated against publicly observable UAE-market patterns. Persona definitions contain no information sourced from any specific institution. The Phase 2 insurance preview ships at least one Open Insurance persona alongside the banking library. | At Phase 1 launch ≥ 10 banking personas published; at Phase 1.5 ≥ 12 banking personas (the v1.5 trio recorded as deferred per §3.3); at v2.0 ≥ 1 Open Insurance persona (`status: "preview"` in `dist/domains.json`). Each has a YAML manifest in `/personas/` with a `stress_coverage` field per EXP-25. Each manifest passes a "no-institution-leak" lint that flags any reference to a specific bank or LFI. | v1 / v1.5 / v2.0 |
| **EXP-03** | The synthetic generator SHALL produce, for each persona, a complete payload bundle covering the v2.1 Account Information API endpoints listed in **Appendix C** (12 endpoints — all `GET`s; 12-month transaction history with realistic volumes 50–800 per persona per month). | All 12 endpoints render for every persona × LFI combination. Snapshot test covers the matrix; build fails on any unrendered endpoint. Transaction counts within band per archetype. | v1 |
| **EXP-04** | The generator SHALL accept an **LFI population profile** input controlling optional-field populate rates: **Rich** (every optional field populated where semantically valid), **Median** (calibrated mid-band populate rates derived from cross-LFI ecosystem assumptions), **Sparse** (mandatory only). The same persona under three profiles SHALL yield three valid spec-compliant bundles with identical mandatory content and divergent optional content. | Same `(persona, seed)` under Rich, Median, Sparse produces three bundles where (a) all mandatory fields have identical values, (b) Sparse populates only Universal-band optional fields, (c) Rich populates every populate-band field. Asserted by automated test. | v1 |
| **EXP-05** | Generation SHALL be **deterministic given a persona+LFI+seed tuple**, so any user can re-produce the exact bundle another user shared. The seed is part of the shareable URL (EXP-17). The same seed MUST drive every stochastic decision in the pipeline — including the LFI populate-decision PRNG (§8.3) — so a Median bundle is fully reproducible from `(persona, lfi, seed)` alone, not from any session-level or wall-clock entropy. | A URL captured at session N reproduces the exact same payload bundle when loaded at session N+1, even after a browser cache clear and across two different machines. CI replay test runs every build, asserting byte-identical bundles across two cold-start generations. | v1 |
| **EXP-06** | Persona transactions SHALL be **narratively coherent**: salaries arrive on a regular date (carrying `Flags=Payroll` per the v2.1 spec); rent direct debits hit the day after salary; merchant categories cluster (groceries, fuel, utilities, dining); FX appears only on FX-active personas; cash deposits appear only on cash-heavy personas; standing-order amounts match a transaction in the standing-order's history. Generation rules are documented in `Appendix D — Persona Generation Rulebook`. | Per-persona invariant tests in `tests/narrative-invariants.test.mjs` SHALL assert, across the full persona × LFI matrix: (a) every persona with `salary_pattern: monthly` has ≥ 1 `Flags=Payroll` credit in every full calendar month of the trailing-12-month window, posting within ±2 days of the configured pay-day; (b) every rent direct-debit posts within 0–3 days of the matched salary credit; (c) FX transactions appear *only* on personas with `fx_active: true`; (d) cash deposits appear *only* on personas with `cash_active: true`; (e) the recipient set of every active standing order is a subset of the persona's beneficiary list; (f) every active standing order has ≥ 1 historical execution in `/transactions` whose amount and counterparty match the order. Cross-endpoint identifier coherence is covered separately by EXP-32. Failures fail the build. | v1 |
| **EXP-07** | Generated data SHALL be **PII-free by construction** — names, IBANs, phone numbers, dates of birth, account holder details, **and employer / counterparty names** are drawn from a synthetic identity pool maintained for the sandbox. The product never accepts, stores, or serves real customer data of any kind. | Linter rule: no name, IBAN, phone, DOB, account-holder, or employer/counterparty field outside the documented synthetic identity pool. CI fails on detection. Pool is auditable in `/synthetic-identity-pool/` and includes `employers/`, `merchants/`, and `counterparty-banks/` sub-directories. | v1 |

### 4.2 Navigation & exploration

| ID | Requirement | Acceptance | Phase |
|---|---|---|---|
| **EXP-08** | The UI SHALL present a **three-pane layout** on wide screens (persona library, account/endpoint navigator, field detail) and a **responsive collapse** to two-pane / single-column on narrower viewports — matching the OF-OS Commons site's mobile-first feel. | At ≥ 1100 px viewport, three panes visible. At 760–1099 px, field-detail becomes a slide-over. At < 760 px, persona library and account-tree collapse to a top-bar dropdown. Manual responsive QA on 320 / 768 / 1024 / 1440 px widths. | v1 |
| **EXP-09** | The top bar SHALL expose, at all times: active persona, active LFI profile, Standards version (locked to v2.1 in v1, with the upstream commit SHA visible on hover), and a coverage meter (EXP-15). | All four elements render at every viewport width including 320 px (with ellipsis if needed). Hovering the version pin reveals full SHA. | v1 |
| **EXP-10** | Each payload SHALL be viewable in two modes via a single toggle: **Rendered** (human-readable table/timeline view per resource type) and **Raw JSON** (the literal OF-spec-compliant payload as it would arrive over the wire). The two views SHALL be backed by the same model — they cannot diverge. | Toggle round-trips cleanly (state preserved on switch back). The Raw JSON validates against the v2.1 OpenAPI schema for the active resource — automated test runs on every persona × LFI × endpoint. | v1 |
| **EXP-11** | The Transactions view SHALL support: filter by date range, transaction type, sub-transaction type, credit/debit indicator, amount band, MCC; full-text search on `TransactionInformation`; sort on every visible column. | All seven filter dimensions functional; filters compose (multiple active simultaneously); search is case-insensitive substring match; sort is stable (ties preserve insertion order). | v1 |
| **EXP-12** | Standing Orders, Direct Debits, Beneficiaries, and Scheduled Payments SHALL each have a dedicated panel that links bidirectionally to the matching transactions in the Transactions view. | Clicking a standing order highlights its historical executions in the transactions view (jump + filter); clicking back returns to the panel. Bidirectional navigation tested for all four resource types. | v1 |

### 4.3 Mandatory / optional / conditional treatment

This is the load-bearing UX of the entire product. Implementation follows §7.

| ID | Requirement | Acceptance | Phase |
|---|---|---|---|
| **EXP-13** | Every field SHALL carry a **status badge**: **MANDATORY** (solid pill), **OPTIONAL** (dashed outline pill), **CONDITIONAL** (outline pill with rule icon). Status is derived from the OpenAPI spec's `required` arrays and the standards' conditional rules — never authored by hand. | Snapshot test of every (persona × LFI × endpoint) combination — every field rendered has a visible status badge; no field renders without one. Badges convey meaning by colour AND shape (a11y). | v1 |
| **EXP-14** | Hovering or focusing a field SHALL show a **field card** containing: spec field name, type, format/length constraint, enum values (if any), example value from the current persona, status badge, the conditional rule (if any), spec citation (link to the v2.1 anchor), and a one-sentence "what to expect from real LFIs" guidance. | Field card opens within 100 ms of hover/focus. All nine elements present and populated for every field in scope. Spec-citation link resolves to a live anchor on the upstream Nebras GitHub spec at the pinned SHA. | v1 |
| **EXP-15** | A **Coverage Meter** SHALL display, at the active persona+LFI level: (a) total fields in scope, (b) % of optional fields actually populated by the current persona+LFI, (c) % of conditional fields whose conditions were triggered. The top-bar meter is computed across the **full v1 endpoint scope (Appendix C)**; an additional **per-endpoint sub-meter** renders inline in the Account & Endpoint Navigator so users can localise where coverage is thin. | Bundle-level meter recalculates on persona change and LFI change; per-endpoint meter recalculates on endpoint navigation. Meter value matches the count of populated optional fields divided by total optional fields, rounded to nearest %. Asserted by automated test against a known-state fixture for both bundle-level and per-endpoint scopes. | v1 |

### 4.4 Comparison & scenarios

| ID | Requirement | Acceptance | Phase |
|---|---|---|---|
| **EXP-16** | A **Compare LFIs** mode SHALL show the same persona under two LFI profiles side-by-side, with a per-field diff highlighting which fields are populated under one profile but not the other. | Side-by-side renders for any two of {Rich, Median, Sparse}; diff highlights match the field-by-field redaction logic of EXP-04; user can flip which profile is on which side. | v1.5 |
| **EXP-17** | A persona+LFI+seed combination SHALL be **shareable as a URL**. Loading the URL recreates the exact bundle for another user. | URL captured at session N reproduces exact bundle at session N+1; URL works after browser cache clear; URL works across machines. URLs are stable across deployments — pin tested at every build. | v1 |
| **EXP-18** | An **Underwriting Scenario Panel** SHALL surface, for the active persona, four computed signals using **pinned, textbook-generic formulas** documented inline. Each signal exposes the source fields it consumed so the user can audit. Formulas are illustrative only and explicitly not tied to any specific institution's policy. | All four signals render for every persona × LFI; clicking a signal expands to show the contributing transactions / fields; values match the pinned formulas (asserted by automated test against a known-state fixture). Each signal carries a footnote: *"Generic / illustrative. Not tied to any specific institution's underwriting policy. Adjust to your own policy when applying."* | v1.5 |

**Pinned EXP-18 formulas (v1.5):**

- **Implied monthly net income** = trailing-12-month average of credit transactions where `Flags` array contains `Payroll`. **Fallback A** (date-stable) — if no `Payroll`-flagged credits in the window: largest recurring credit on the same calendar day each month, treating recurrence as ≥ 3 occurrences within the window. **Fallback B** (irregular-cadence) — if Fallback A produces no value: monthly average of credits from the top recurring counterparty (clustered by `CreditorName` / `RemittanceInformation`) over the window, requiring ≥ 6 inflows from that counterparty within 12 months. **Final fallback** — if neither produces a value (e.g., very gig-irregular or short-tenure): the panel shows `—` with a tooltip explaining *"insufficient income-cadence signal — adjust to your own segment-specific policy"*. **Source-field display**: list of contributing transactions with `Flags`, `Amount`, `BookingDateTime`, `CreditorName`.
- **Total fixed commitments** = sum of `NextPaymentAmount` across all `StandingOrderStatusCode = Active` standing orders + average of `PreviousPaymentAmount` across all `DirectDebitStatusCode = Active` direct debits. All values normalised to monthly via the resource's `Frequency` field (`Annual ÷ 12`, `Monthly × 1`, `Quarterly ÷ 3`, `Weekly × 4.33`, etc.). **Source-field display**: list of contributing standing orders + direct debits with their amounts and frequencies.
- **Implied DBR (Debt Burden Ratio)** = (Total fixed commitments) ÷ (Implied monthly net income), expressed as percentage. Undefined if Implied monthly net income is zero or negative; UI shows "—" with a tooltip explaining why.
- **NSF / distress event count** = count of transactions in trailing 12 months where (`Status = Rejected`) OR (debit posted on a day where `ClosingBooked` balance for that account became negative). **Source-field display**: list of contributing transactions with date, amount, narrative.

**Low-volume guard.** The Senior / Retiree persona deliberately exposes the case where trailing-12-month-average breaks: typical retirees have < 10 transactions per month, the income signal is monthly pension arrival, and behavioural signals (NSF, recurring spend) are sparse. For any persona / LFI combination where `count(transactions in trailing 12 months) < 50` OR `count(distinct months with transactions) < 6`, the panel:
1. Renders the four signals with "Insufficient transaction volume for stable inference" labels.
2. Suppresses DBR display (shows "—" with a tooltip explaining the volume threshold).
3. Surfaces a "What this persona shows" callout explaining that low-volume cases are a real underwriting reality and that off-the-shelf affordability formulas need a different treatment for this segment.

The thresholds (`< 50` transactions, `< 6` distinct months) are pinned for v1.5 and recalibrated quarterly alongside the populate-rate bands (§7.3); revisions are noted on `/changelog` with rationale.

**Acceptance for EXP-18 income/DBR signals across the persona library.** The four signals SHALL render a value or an explicit `—` with explanatory tooltip for every persona × LFI combination — the panel never crashes, never shows raw `NaN`, and never silently omits a signal. The Senior / Retiree persona MUST trigger the low-volume guard under all three LFI profiles. The Gig / Variable Income Worker persona MUST exercise Fallback B (irregular-cadence counterparty clustering) under at least the Median profile. The HNW persona MUST exercise the multi-currency normalisation step in Total Fixed Commitments (commitments in non-AED currencies converted to AED at a published mid-market rate snapshot pinned alongside the spec SHA).

This guard is itself a teaching moment: the Senior persona becomes the case study for "your formulas don't generalise"; the Gig persona is the case study for "income cadence is not always monthly".

These formulas are illustrative defaults. Real-world policies vary by institution and product type. The v1.5 panel makes that disclaimer prominent next to the displayed values.

### 4.5 Export & integration

| ID | Requirement | Acceptance | Phase |
|---|---|---|---|
| **EXP-19** | Users SHALL be able to **export** the active bundle as: (a) full OF-spec JSON (per endpoint), (b) flat CSV per resource, (c) a single tarball. Exports are unrestricted (the data is synthetic and public) but watermarked per §6.5. | All three export formats download successfully; JSON validates against the v2.1 schema; CSV opens cleanly in Excel/Numbers/Google Sheets without parsing errors; tarball extracts to the expected file tree. Watermark present in every file. | v1 |
| **EXP-20** | The sandbox SHALL publish its synthetic dataset as the **canonical fixture** consumable by any TPP integration test suite. Distribution as a versioned package (e.g., on npm / PyPI) is targeted for v1.5; the OF-OS Commons listing carries a download link. **Package contents (locked at v1.5)**: (a) JSON bundles for every persona × LFI × endpoint combination — the same payloads EXP-19 export emits, (b) the parsed `SPEC` object derived from the pinned v2.1 OpenAPI YAML, (c) the persona YAML manifests from `/personas/`, (d) a `manifest.json` index keyed by `(persona_id, lfi_profile, seed)`. Package version is coupled to the sandbox release version (semver). | Package published to a public registry under MIT (code) + CC0 (data); package version matches sandbox release version; install + import + read-fixture round-trips in a clean Node + Python environment using the documented `(persona, lfi, seed)` keying; manifest.json validates against a published schema. | v1.5 |
| **EXP-26** | **Bug-report / feedback path** — every field card and every persona view SHALL carry a "Report an issue" link that opens a pre-filled issue in the sandbox's **GitHub issue tracker** with: field name + schema, current persona, current LFI profile, current seed, current pinned spec SHA, and a checkbox set: `[ ] spec-interpretation error` / `[ ] populate-rate band disagreement` / `[ ] guidance unclear` / `[ ] generator bug` / `[ ] other`. (If the OF-OS Commons grows a public forum at v1.5+, the destination may move; until then GitHub is canonical.) | Every field card has a visible "Report an issue" affordance; click round-trips to a pre-filled GitHub issue form within 1 click; pre-fill payload validated by snapshot test. Maintainer commitment: ≤ 14 days from report to triage. | v1 |
| **EXP-27** | **Embedding mode** — a chrome-less variant available at `/[slug]/embed?persona=<id>&lfi=<rich\|median\|sparse>&endpoint=<endpoint>&seed=<int>&height=<px>` that renders a single persona+endpoint view suitable for `<iframe>` embedding in articles, slide decks, and LMS courses. oEmbed metadata published. Top bar collapses to a thin attribution strip linking back to the full sandbox. | URL shape works; embed renders in < 1 s on a CDN warm cache; `<iframe>` integration tested in 3 hosts (a basic HTML page, a Notion embed block, a Moodle / Canvas LMS module); oEmbed discovery returns valid JSON. | v1 |
| **EXP-28** | The sandbox SHALL publish its fixture set as **raw HTTPS-fetchable JSON** at a stable major-version path slot — `/[slug]/fixtures/v1/bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json` plus `manifest.json`, `spec.json`, persona manifests, and a TPP-friendly `index.json` discovery doc. CORS-permissive headers (`Access-Control-Allow-Origin: *`) so a browser-hosted TPP demo on a different origin can fetch directly. Path slot is the breakage boundary (per D-11); within `/v1/`, evolution is forward-compatible only. | `curl` against the deployed `/fixtures/v1/manifest.json` returns 200 + valid JSON with `specVersion === "v2.1"`; cross-origin browser fetch from a foreign host succeeds; CI staging-contract test asserts the layout. | v1.6 |
| **EXP-29** | The npm and PyPI fixture packages SHALL expose a journey-level helper — `loadJourney({ persona, lfi, seed })` / `load_journey(persona, lfi=, seed=)` — returning the full coherent bundle for one tuple in a single call: `{ persona, lfi, seed, accountIds, customerId, specVersion, specSha, version, endpoints: { '/accounts': envelope, '/parties': envelope, '/accounts/{AccountId}/balances': envelope, ... } }`. AccountIds, CustomerId and per-endpoint envelopes are coherent (per EXP-32) so a TPP demo can drop the helper in where it currently fetches from the Nebras-operated sandbox without losing referential integrity. | Vitest + a Python smoke check assert: 12+ endpoint keys returned; every accountId resolves to `/balances` and `/transactions`; `customerId` is non-null and matches `/parties.Data.Party.PartyId`; two consecutive calls return strictly equal JSON. | v1.6 |
| **EXP-30** | The persona overview SHALL render a **"Use this persona in your demo"** panel with four copy-to-clipboard plug-point snippets — iframe embed, npm `loadJourney()` one-liner, PyPI `load_journey()` one-liner, raw-URL `curl` one-liner — each pre-filled with the live `(persona, lfi, seed)`. The panel carries the R-EXP-03 disclaimer ("Not endorsed by Nebras / CBUAE / any LFI; not a substitute for the Nebras-operated regulatory sandbox at certification time") above the snippets. | Panel renders for every persona; each "Copy" button writes the expected snippet to the clipboard (covered by an e2e test); disclaimer text is present and unhidden. | v1.6 |
| **EXP-31** | A dedicated **TPP integration guide** at `/[slug]/integrate.html` SHALL document the four plug points (iframe / npm / PyPI / raw HTTPS), the cross-endpoint coherence guarantee, the versioning + pinning contract, and the common pitfalls (populate rates illustrative-not-authoritative, watermarks must travel, AED-only default). Audience is the TPP developer, not the academic reader. Linked from the index top-bar nav, the persona panel, the README, and `/about`. | Page exists; staging-contract test asserts all four Path-N sections, the disclaimer, and the live spec-pin metadata fields are present; cross-links from the four entry points resolve. | v1.6 |
| **EXP-32** | A CI test SHALL assert **cross-endpoint identifier coherence** for every (persona, lfi, seed): every `Data.Account[].AccountId` in `/accounts` appears as the `Data.AccountId` of the corresponding `/balances`, `/transactions`, `/standing-orders`, `/direct-debits`, `/beneficiaries`, `/scheduled-payments`, `/parties`, `/product`, `/statements` envelopes; the calling-party `PartyId` in `/parties` is non-null and stable. This is the property the Nebras-operated sandbox does not optimise for and the reason a TPP showcase journey wired to those mocks looks empty. | `tests/journey-coherence.test.mjs` runs across the full 30-fixture matrix in `npm test`. Build fails on any mismatch. | v1.6 |

### 4.5b Identity, analytics & posture

These two requirements were previously implicit in §6.4 / §6.5 / D-08; v0.9 elevates them to first-class IDs so they can be referenced from acceptance tests and the Decisions log.

| ID | Requirement | Acceptance | Phase |
|---|---|---|---|
| **EXP-21** | **Anonymous analytics surface.** PostHog (per D-08), event set restricted to: persona load, LFI switch, field click, endpoint navigation, raw-JSON toggle, export, share. No PII, no fingerprinting, no cross-site identifiers, no user-input strings captured. The PostHog config (project key, autocapture flags, identity/session settings) is treated as part of the deployed bundle and reviewed at every release. | At every release the PostHog config is audited against this allowlist and any drift fails the release gate. CI test asserts no event emitted by the bundle contains: free-text user input, an IP address payload, or any persistent identifier outside an opaque session token that resets on reload. | v1 |
| **EXP-22** | **No-PII export & identity posture.** The sandbox runs anonymously (no login, no auth, no profiles, no server-side persistence per §6.4). Every export from EXP-19 contains only synthetic-pool data (per EXP-07) and carries the §6.5 watermark. Share/save happens via URL only (per EXP-17). | Snapshot test scans every exported JSON / CSV / tarball across the persona × LFI × endpoint matrix and asserts: (a) no string value falls outside the synthetic identity pool, (b) the watermark is present in every file in every export format, (c) no cookie, localStorage, or server call carries an identity beyond the URL-encoded `(persona, lfi, seed)` tuple. | v1 |

### 4.5c Custom persona builder

The Custom Persona Builder (Workstream B; shipped at v1.6) lets a TPP developer assemble an *ephemeral* persona from a controlled set of dimensions instead of picking from the curated library. It exists alongside the curated library, not in place of it. EXP-33 specifies the surface; EXP-34 carves out which library invariants apply to recipe-built personas and which do not.

| ID | Requirement | Acceptance | Phase |
|---|---|---|---|
| **EXP-33** | The sandbox SHALL expose a **Custom Persona Builder** (`personaId='custom'`) that lets a user select from a controlled set of dimensions (employment / income / product mix / FX activity / cash activity / etc.) and a recipe is encoded into the share URL via `recipe=<base64url-json>` (`src/persona-builder/recipe.js`). The recipe is canonicalised before encoding so logically-equivalent inputs produce byte-identical URLs. The recipe drives the same generator pipeline as curated personas, including the LFI redactor and watermark. The builder SHALL also expose: a per-recipe ZIP fixture export (the curated-persona analogue of EXP-19's tarball, namespaced by recipe hash), and an in-browser Service Worker fixture mock (`src/sw-fixtures.js`) that serves the recipe's bundle at the EXP-28 raw URL shape so a TPP demo running locally can be wired to `localhost` without a server. | Round-trip test: any recipe `r` satisfies `decodeRecipe(encodeRecipe(r)) ≡ canonicalise(r)`. Determinism: two cold loads of the same `(recipe, lfi, seed)` URL produce byte-identical bundles (extends EXP-05 — the recipe hash is mixed into the generator PRNG seed tuple). Recipe-validation rejects any value outside the documented enums / synthetic-pool whitelists *before* generation. ZIP fixture export passes the same watermark + spec-validation tests as EXP-19. SW mock test in `tests/fixture-handler.test.mjs` covers the URL shape. | v1.6 |
| **EXP-34** | Recipe-built personas SHALL satisfy the same product invariants as curated personas in every place where the invariant protects users — and SHALL be excluded from the library-curation invariants where the invariant only applies to the curated set. Specifically: every recipe-generated bundle MUST pass `lint-pii-leak` (EXP-07), `lint-no-institution-leak` (NG5), the watermark check (EXP-19), and v2.1 spec validation (EXP-10). Recipe-built personas are EXCLUDED from EXP-25 cross-persona stress-coverage uniqueness (recipes are ephemeral and not part of the curated library), EXP-26 "Report an issue" pre-fill (use the curated-persona path or open a generic issue), and the §3.3 persona-library count. Recipe-built personas SHALL render with a visible "Custom (not curated)" badge so users do not mistake an ephemeral persona for a curated archetype. | Recipe-validation lives in `validateRecipe()` and rejects any unknown enum / pool value before any generator code runs (so the four shared invariants cannot be violated by an out-of-vocabulary recipe). Custom-persona UI carries the "Custom (not curated)" badge in the top-bar persona slot and on the share-URL panel. CI does not run EXP-25 uniqueness against `personaId='custom'`. | v1.6 |

### 4.6 Accessibility, performance & non-functional

| ID | Requirement | Acceptance | Phase |
|---|---|---|---|
| **EXP-23** | **Accessibility — WCAG 2.1 AA at launch and at every subsequent release.** Specifically: (a) every interactive element keyboard-reachable and operable; (b) every status badge conveys meaning by both colour and shape (mandatory = solid pill + "M" label; optional = dashed outline + "O" label; conditional = outline + "C" + rule icon); (c) text contrast ≥ 4.5:1 against background; (d) focus visible at all times; (e) screen-reader-friendly labels on every persona-card, endpoint-link, and field-cell; (f) `prefers-reduced-motion` honoured by the slide-over animation; (g) no semantic content is conveyed by glyph alone — the ✓ ⚠ ✗ markers in §5.3 "Real LFIs" guidance prose (and any equivalent symbols elsewhere) are decorative and the textual sentence carries the meaning. | axe-core CI check passes with zero violations; manual screen-reader walk-through (VoiceOver / NVDA) documented; keyboard-only navigation flow recorded; CI lint asserts no field-card guidance string consists only of a glyph or whose meaning collapses if the glyph is removed. Failures fail the build. | v1 |
| **EXP-24** | **Performance budget.** Time to interactive on a mid-tier mobile (4G / 5 Mbps): < 3 seconds. Total page weight (HTML + CSS + JS): < 250 KB gzipped. Synthetic-data generation for a single persona / single LFI: < 200 ms on the same target device. Lighthouse Performance ≥ 90 on mobile profile. | Lighthouse run is part of CI; the build fails if Performance score drops below 90 or page weight exceeds 250 KB gzipped. Mid-tier-device perf budget tested on real device pre-launch. | v1 |
| **EXP-25** | **Persona spec-stress coverage.** Every persona in the library SHALL exercise at least one previously-untested spec area (e.g., `/parties` multi-party logic, low-volume transaction edge cases, FX-heavy patterns, PEP / KYC verified-claims fields). The persona library is curated to expand spec stress coverage as it grows; new personas are reviewed against existing personas to identify their distinct stress contribution. | Each persona's YAML manifest declares a `stress_coverage` field listing the spec elements the persona uniquely tests. CI test verifies cross-persona uniqueness — adding a new persona that doesn't add new stress coverage fails the build. | v1 |

---

## 5. UX principles

### 5.1 Information architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Top bar:  [Persona ▾]  [LFI: Median ▾]  [v2.1 @ 7d3ab4c]  Coverage: 64%│
├──────────────┬──────────────────────────────────────┬────────────────────┤
│              │                                      │                    │
│  Persona     │   Account & Endpoint Navigator       │   Field Detail    │
│  Library     │                                      │                    │
│              │   ▾ Sara — Salaried Expat           │   TransactionType  │
│  • Salaried  │     ▾ AE12 0260 ... 1234 (Current)  │   ────────────────│
│    Expat ★   │       • Accounts                    │   Status: ⬛ MAND  │
│  • Emirati   │       • Balances (12mo)             │   Type: Enum       │
│    Affluent  │       • Transactions (4,217)        │   Values: POS,     │
│  • SME Cash  │       • Standing Orders (3)         │     ECommerce,     │
│  • Gig       │       • Direct Debits (5)           │     ATM, BillPay,  │
│  • Thin File │       • Beneficiaries (8)           │     LocalBankXfer, │
│  • HNW       │       • Scheduled Payments (2)      │     SameBankXfer…  │
│  • Mortgage  │       • Product                     │                    │
│  • Distressed│       • Parties                     │   Real LFIs:       │
│              │     ▾ AE14 0260 ... 7788 (Credit)   │   ✓ Always present │
│   [+ New]    │     ▾ AE … (Statements)              │   per spec         │
│              │                                      │                    │
└──────────────┴──────────────────────────────────────┴────────────────────┘
```

On narrow viewports the field-detail pane becomes a slide-over from the right, opened by clicking a field name and dismissed by clicking outside; the persona library collapses to a top-bar dropdown.

### 5.2 Field status visual language

- **Mandatory** — solid filled pill. Always shown, never collapsed.
- **Optional** — dashed-outline pill. When populated, shown inline; when null, shown collapsed under a "show absent fields" toggle.
- **Conditional** — outline pill with a small `?` icon. Tooltip cites the rule. When the rule is satisfied, the badge shows `triggered`; when not, `not triggered (this is correct for this transaction)`.

### 5.3 Tone of "Real LFIs" guidance

Each field card includes a one-line "what to expect from real LFIs" note, framed as ecosystem-wide assumption (never attributed to a specific LFI):

- ✓ *"Always present per spec. All LFIs populate. Safe to depend on."*
- ⚠ *"Optional. Median populate rate ~60% across the ecosystem. Do not depend on for primary logic."*
- ⚠ *"Conditional on `TransactionType=POS`. Even when the rule is satisfied, populate rates vary across the ecosystem."*
- ✗ *"Optional. In practice rarely populated outside of premium-product LFIs. Treat as a bonus."*

This guidance is editable as cross-LFI evidence accumulates from public reporting and ecosystem activity.

### 5.4 Tell-me-a-story mode

For first-time visitors arriving from the OF-OS Commons feed, a guided walkthrough mode loads the **Salaried Expat** persona under the **Median** LFI profile and steps through:

1. *"Here's Sara. She has two accounts: a salary current account and a credit card."*
2. *"Look at her balance for the last 90 days — see the predictable salary spikes on the 25th."*
3. *"Here are her transactions for last month. Notice the salary credit carries `Flags=Payroll` — that's the spec-clean way to identify income."*
4. *"Her DBR comes to 41%. Here are the four standing orders that drive it."*
5. *"Now switch to the Sparse LFI profile and watch which fields disappear. Notice that MCC, MerchantName, and GeoLocation all drop out — what does that do to your affordability logic?"*

The walkthrough converts first-time users into regular users in under 5 minutes (M1 in §9).

---

## 6. Architecture & implementation

### 6.1 Surface

The sandbox is a **Commons contribution** at `https://openfinance-os.org/commons/[slug]`, sitting alongside *Velox: Open Finance Interactive Demo*, *Leveraging Open Finance Data for Credit Underwriting in the UAE*, and *Open Finance Hackathon Docs*. The exact slug is picked by the Commons maintainer at publication (per D-05); plausible candidates are `/commons/sandbox/` or `/commons/data-sandbox/`.

The sandbox is:

- **Public-by-default** — anyone can land on the page, load any persona under any LFI profile, view any field, and copy/share a URL. No login wall, anywhere.
- **Indexable, shareable, citable** — server-rendered key paths, OpenGraph metadata, persistent URLs. The OF-OS Commons feed surfaces it. Pre-publication staging deployments carry `<meta name="robots" content="noindex">` (currently in `src/index.html`); the Commons publication flip removes the tag as part of the §11 pre-publication checklist.
- **Self-contained** — the artefact has no backend dependencies. It is a single static HTML+JS bundle that runs the synthetic-data generator client-side.

### 6.2 Stack

- **Frontend**: vanilla HTML/CSS/JS in v1, no build chain required. Optionally migrate to a small React or Svelte build at v1.5 if the maintenance surface justifies it. Intentionally simple to fit the Commons publication workflow.
- **Synthetic generator**: runs entirely in the browser. Deterministic seeded PRNG (mulberry32). The same `(persona_id, lfi_profile, seed)` always yields the same bundle.
- **Spec source**: vendored copy of `uae-account-information-openapi.yaml` from `github.com/Nebras-Open-Finance/api-specs` at a pinned commit SHA. Build-time tooling (a small Python or Node script) parses the YAML and emits a JSON `SPEC` object that the frontend consumes — so all status badges, enum values, and mandatory/optional flags flow from the spec, not from hand-authored tables (per EXP-01).
- **No database, no backend, no auth.** The artefact is a static deployment.

### 6.3 Spec source

The OpenAPI 3.1 spec for Standards v2.1 Account Information is pulled from `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/uae-account-information-openapi.yaml` at a pinned commit SHA, vendored in the project repository. The build tool fails if the upstream spec changes shape unexpectedly. The pinned SHA is shown in the top bar (and in `/about`) so users always know the exact spec version they are looking at.

### 6.4 Identity & access

The sandbox runs **anonymously**. There are no logins, no accounts, no profiles. Save / share happens via URL (EXP-17). Export is unrestricted (EXP-19).

If a future enhancement (annotations, saved scenarios, etc.) needs identity, the right move is to look at whatever identity OF-OS Commons exposes for community contributions, not to build a parallel auth surface inside the sandbox.

### 6.5 Hosting & web posture

- **Hosting**: served from `openfinance-os.org` infrastructure as part of the Commons. Publication workflow (Hugo / Eleventy / Next.js / static asset upload / etc.) handled by the Commons maintainer.
- **Analytics**: PostHog (the same analytics surface OF-OS Commons already uses). No PII collected; no fingerprinting; events captured cover persona load, LFI switch, field click, endpoint navigation, raw-JSON toggle, export, and share.
- **No PII, ever** (EXP-07). No live API calls to Al Tareq. No real customer data, ever (NG4).
- **Watermarking**: every CSV/JSON export carries an inline watermark `SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:{id} lfi:{profile} seed:{seed} retrieved:{timestamp}` so leaked artefacts are immediately recognisable.
- **Disclaimers**: persistent footer states (a) the data is synthetic, (b) the Median LFI profile is a Commons-curated ecosystem assumption — not authoritative, not endorsed by Nebras or CBUAE, (c) Standards version baseline is v2.1 at pinned SHA, (d) populate-rate guidance is curated for the Commons and revised quarterly as evidence accumulates.

### 6.6 Brand & attribution

The artefact takes the **OpenFinance-OS Commons visual identity** — type, palette, layout, footer, navigation. It is fully part of the Commons; there is no separate contributor brand.

The footer states only: *"SYNTHETIC · Open Finance Data Sandbox · OpenFinance-OS Commons · Standards v2.1 @ <pinned SHA>"*.

The `/about` page carries:

- A short description of what the sandbox is and the gap it fills.
- The methodology behind the populate-rate bands (calibration sources, revision cadence, confidence-band guidance).
- Citation guidance for academic / journalist / product references.
- The maintenance / publication cadence and changelog summary.

There is no in-product upsell, no logos beyond the OF-OS Commons identity, and no contributor-organisation chrome.

### 6.7 Integration with the rest of the OF-OS Commons

- **Static cross-link from the *Leveraging Open Finance Data for Credit Underwriting in the UAE* article** to the sandbox landing page (per D-04 — no persona+LFI deep-link). The sandbox is the show-don't-tell complement to the article; readers click through to the landing page and pick a persona themselves.
- **Listing in the Commons feed** with a clear preview card and tags (`bank-data-sharing`, `synthetic-data`, `developer-tool`, `credit-underwriting`).
- **Permalinks**: persona-level URLs (e.g., `/commons/[slug]/p/salaried-expat-mid?lfi=median&seed=4729`) so external citations are stable.
- **TPP integration plug points** (per EXP-28..EXP-31). The sandbox publishes its full fixture set as raw HTTPS JSON at `/[slug]/fixtures/v1/...`, an npm package (`@openfinance-os/sandbox-fixtures`), and a PyPI mirror (`openfinance-os-sandbox-fixtures`) under a stable path-slot contract. Recommended pin: `manifest.json.version`. TPP-developer-facing documentation lives at `/[slug]/integrate.html`; a worked example wires a faux budgeting widget against the raw URLs at `/[slug]/examples/tpp-budgeting-demo/`.

### 6.8 URL shapes (single source of truth)

There are three URL shapes in v1; all three deterministically resolve to the same `(persona, lfi, seed)` tuple per EXP-05. The slug `[slug]` is fixed at publication per D-05.

| Shape | Pattern | Anchor requirement | Notes |
|---|---|---|---|
| **Persona permalink** | `/commons/[slug]/p/<persona_id>?lfi=<rich\|median\|sparse>&seed=<int>` | EXP-17 (shareable URL) + §6.7 | Default landing target for citations and Commons-feed entries; persona+LFI+seed reproduce the exact bundle. If `seed` is omitted, the default seed for the persona is used (each persona ships a stable default in its YAML manifest). If `lfi` is omitted, `median` is assumed. |
| **Share URL** | same as persona permalink | EXP-17 | The "Share" affordance copies the active persona permalink with the live `lfi` and `seed`. There is no separate share-URL shape. |
| **Embed URL** | `/[slug]/embed?persona=<persona_id>&lfi=<rich\|median\|sparse>&endpoint=<endpoint>&seed=<int>&height=<px>` | EXP-27 (embed mode) | Chrome-less; renders a single endpoint view; oEmbed metadata published. The `endpoint` parameter draws from Appendix C path strings. |
| **Raw fixture URL** | `/[slug]/fixtures/v1/bundles/<persona_id>/<lfi>/seed-<int>/<endpoint>.json` (and `/[slug]/fixtures/v1/{manifest,spec,index}.json`) | EXP-28 (raw HTTPS fixtures) + D-11 | Static JSON, CORS-permissive (`Access-Control-Allow-Origin: *`). Filename encoding: `/` → `__`, `{`/`}` stripped (e.g. `/accounts/{AccountId}/transactions` → `accounts__AccountId__transactions.json`). `/v1/` is the major-version path slot (D-11). |

All three shapes are stable across deployments — the same URL on `openfinance-os.org/commons/[slug]/...` resolves identically on the staging preview path (under different host) for the same pinned spec SHA. Pin tested at every build (per EXP-17 acceptance).

---

## 7. Field-level mandatory/optional/conditional treatment (concrete)

The sandbox's hardest UX problem is making years of OF spec nuance legible to a non-technical user. The treatment below is the v1 specification.

### 7.1 Source of truth

Status comes from one place: the OpenAPI spec's `required: [...]` arrays at every level of the schema, plus standards-document conditional rules captured in a small companion YAML. Hand-authored status is forbidden — it is a known way to drift from spec.

### 7.2 Three categories, three behaviours

| Category | Source rule | UI treatment | When persona has no value |
|---|---|---|---|
| **Mandatory** | Field listed in OpenAPI `required` | Solid pill, always shown, value rendered prominently | Generator failure — bug, raised loudly |
| **Optional** | Field not in `required` | Dashed pill; shown when populated, collapsed when null with "show all optional" toggle | Shown collapsed; field card reachable |
| **Conditional** | Field is in `required` only when another field has a specific value | Outline pill with rule chip; status of "triggered" or "not triggered" | If rule is satisfied and field is null → bug; if rule is not satisfied → correctly absent |

### 7.3 Cross-LFI populate-rate guidance

Optional fields are where most design decisions live. Each optional field carries a Commons-curated populate-rate **band**, framed as an ecosystem-wide assumption (never attributed to a specific LFI):

- **Universal** — populated by all LFIs.
- **Common** — populated by most LFIs.
- **Variable** — populated by some LFIs.
- **Rare** — only premium-product or mature-integration LFIs.
- **Unknown** — no cross-LFI evidence yet.

These bands are *qualitative vocabulary*. Their numeric calibration — the populate probability used by the Median LFI generator — is the engineering contract pinned in §8.3 and is recalibrated quarterly as cross-LFI public evidence accumulates from the live API Hub and from ecosystem reporting. The revision history is published on `/about`. **§8.3 is the single source of truth for any test that depends on a specific populate probability.**

### 7.4 Examples (illustrative — full coverage matrix is in-product)

| Field | v2.1 status | Populate band | Practical use |
|---|---|---|---|
| `Transaction.Amount` | Mandatory | Universal | Always. Foundation of every cash-flow calc. |
| `Transaction.BookingDateTime` | Mandatory | Universal | Always. Time-series ordering. |
| `Transaction.Flags` (contains `Payroll`) | Optional, but **the v2.1 spec-clean salary marker** | Common (when used) | Salary detection — replaces ad-hoc heuristics. |
| `Transaction.MerchantDetails.MerchantCategoryCode` | Optional | Variable | Useful for spend categorisation; do not depend on for hard rules. |
| `Transaction.GeoLocation` | Optional | Rare | Bonus signal for AML; cannot underwrite on it. |
| `Transaction.CurrencyExchange.ExchangeRate` | Conditional (when `CurrencyExchange` present) | n/a | Triggered only on FX transactions. |
| `Account.AccountSubType` (`CurrentAccount/Savings/CreditCard/Mortgage/Finance`) | Optional in v2.1 spec, expected for non-switched accounts | Universal | Foundational for product-mix understanding. |
| `Account.IsShariaCompliant` (v2.1 new) | Optional | Variable | Important for Islamic-product underwriting. |
| `Product.IsSalaryTransferRequired` (v2.1 new) | Optional | Variable | Salary-assigned lending eligibility signal. |
| `Balance.CreditLine[].Type` (`Available/Credit/Emergency/Pre-Agreed/Temporary`) | Conditional (when `CreditLine` array present) | Variable | Critical for credit-card affordability when present. |

A complete v2.1 coverage matrix is built into the sandbox (EXP-13/14) and surfaced inline.

---

## 8. Synthetic data — generation philosophy

### 8.1 Three rules

1. **Spec-valid.** Every generated payload validates against the v2.1 model. Invalid payloads are bugs.
2. **Narratively coherent.** The data tells a story. A salaried expat receives a salary on the 25th (with `Flags=Payroll`); their rent direct debit hits on the 27th; their credit card statement closes on the 5th. Not random.
3. **Deterministic.** `(persona_id, lfi_profile, seed) → payload bundle` is a pure function. Two users with the same URL see the same data.

### 8.2 Rulebook (Appendix D)

Each persona is defined by a YAML manifest:

```yaml
persona_id: salaried_expat_mid
name: "Sara — Salaried Expat (Mid Tier)"
archetype: salaried_expat
demographics:
  nationality_pool: expat_indian   # synthetic identity pool
  age_band: 28-38
  emirate: dubai
income:
  primary_employer_pool: tech_freezone_employer   # draws from /synthetic-identity-pool/employers/tech_freezone.yaml per EXP-07
  monthly_amount_aed: 25000
  pay_day: 25
  variability: low
  flag_payroll: true               # carry Flags=Payroll in v2.1
accounts:
  - type: CurrentAccount
    currency: AED
    age_months: 24
  - type: CreditCard
    currency: AED
    credit_limit_aed: 50000
fixed_commitments:
  - kind: standing_order
    purpose: rent
    amount_aed: 8000
    schedule: monthly_27
  - kind: direct_debit
    purpose: utilities_dewa
    amount_aed_band: [400, 800]
    schedule: monthly_5
spend_profile:
  groceries_aed_per_month_band: [1200, 2200]
  fuel_aed_per_month_band: [400, 700]
  dining_per_month_count_band: [4, 12]
fx_activity: false
cash_deposit_activity: false
distress_signals:
  nsf_events_per_year_band: [0, 1]
```

The generator reads the manifest and emits a 12-month transaction set that respects every rule. The full rulebook lives in `Appendix D` (companion file, deferred to discovery v0.5).

### 8.3 LFI profile mechanics

Given a generated bundle, the LFI profile is applied as a **post-generation field-redaction filter** driven by a PRNG seeded from the same `(persona, lfi, seed)` tuple that produced the bundle (per EXP-05).

- `Rich`: every optional field with a populate band of Universal, Common, Variable, or Rare is populated.
- `Median`: each optional field is independently populated with the **v1 calibration** probability for its band:

  | Band | Median populate probability (v1) |
  |---|---|
  | Universal | 1.0 |
  | Common | 0.7 |
  | Variable | 0.4 |
  | Rare | 0.1 |
  | Unknown | 0.0 (treated as Rare-floor; revisited at first calibration) |

- `Sparse`: only Universal-band optional fields populated; the rest are nulled.

Mandatory fields are never redacted (otherwise the bundle is spec-invalid).

**Calibration cadence.** The Median probabilities above are the v1 ecosystem-wide assumption; they are recalibrated quarterly per §6.5 disclaimer (d) and the recalibration is published to `/changelog`. Tests that assert specific populate counts pin against this table at the version they were written for, not against the band names.

### 8.4 What this is NOT

It is **not** a faithful simulation of any specific LFI. The Median assumption is a Commons-curated ecosystem-wide estimate from publicly available spec evidence and is revised quarterly as broader evidence accumulates.

---

## 9. Success metrics

| ID | Metric | Target | Measurement |
|---|---|---|---|
| **M1** | Time-to-first-insight for a new visitor | < 5 minutes from first landing to first persona loaded and one field card read | PostHog event funnel (anonymous; events per D-08) |
| **M2** | Unique monthly visitors | ≥ 200 by 3 months post-launch; ≥ 1,000 by 12 months | PostHog (anonymous, no PII) |
| **M3** | External citations | ≥ 1 blog post, Hub71 onboarding doc, or peer-bank reference within 3 months of launch; ≥ 5 within 12 months | Manual web monitoring + opt-in citation form on `/about` |
| **M4** | Hub71 / ADGM cohort uptake | Sandbox referenced in ≥ 1 Hub71/ADGM cohort onboarding flow within 6 months | Direct outreach |
| **M5** | OF-OS Commons signal | Sandbox surfaces in the Commons "Featured Contributions" rotation within 3 months; sustained appearance | Direct observation |
| **M6** | Article complementarity | Cross-link traffic from the *Credit Underwriting in the UAE* Commons article to the sandbox accounts for ≥ 25% of total sandbox sessions in the first 90 days | Referrer tracking (anonymous) |
| **M7** | Fixture adoption (v1.5) | Published fixture package downloaded ≥ 100 times/month within 6 months of v1.5 release | npm / PyPI download stats |

M2 and M3 are the load-bearing public metrics — if visitors do not come and the artefact is not cited, it has not earned its existence. M5 is the load-bearing Commons-fit metric — if the OF-OS Commons doesn't surface it, we've mis-pitched the contribution.

---

## 10. Out-of-scope reminders

- Open Wealth, Insurance, Service Initiation, FX, Pay Request — all v2+.
- Live Al Tareq API calls — never. The sandbox is synthetic-only.
- Real customer data, anonymised customer data, or any data derived from a specific institution — never (NG4).
- Institution-specific operational detail, internal categorisation rules, or proprietary populate-rate observations — never (NG5).
- Production credit decisioning, payments, or any other operational use — never. The sandbox is a *learning surface*, not a *runtime*.
- Separate contributor branding in-product — never (NG6). The artefact is fully part of OF-OS Commons.

---

## 11. Phasing

This table reflects what shipped, not what was originally planned. Where v1.5 work landed in v1.0, or v1.5 substituted scope, the row records the substitution explicitly.

| Phase | Window | Status | Scope | Exit criteria / outcome |
|---|---|---|---|---|
| **Phase 0 — Spike** | Wk 1–2 | ✅ Shipped | One persona (Salaried Expat), three endpoints (accounts, balances, transactions), mandatory/optional badging only, internal preview hosted at `/commons/sandbox/preview/` with `<meta name="robots" content="noindex">`. Hardcoded LFI=Median. | Stakeholder review confirmed IA, field treatment, and Phase 1 feasibility. |
| **Phase 1 — V1.0** | Wk 3–8 | ✅ Shipped | **Ten personas** (1–8 baseline + Joint Account + Senior / Retiree), all 12 v2.1 Account Information endpoints, three LFI profiles, coverage meter, raw JSON toggle, anonymous export, share-via-URL, footer disclaimers, `/about` and citation guidance, embed mode (EXP-27). **Pulled forward from v1.5:** Compare-LFIs mode (EXP-16) and the Underwriting Scenario panel (EXP-18) both shipped at v1.0 rather than v1.5; CHANGELOG records this. | M1 hit (< 5 min time-to-first-insight); listed in the OF-OS Commons feed. |
| **Phase 1.5 — V1.5** | Wk 9–12 | ✅ Shipped (with substitutions) | Persona library extended from 10 to **12 banking personas** — added `sme-trading-business` and `corporate-treasury-listed`. **Substituted scope:** the originally-planned v1.5 trio (Domestic Worker, PEP-flagged, Returning Expat) is recorded as deferred in §3.3; the SME / Corporate substitutions plus the v2.0 insurance preview were prioritised instead. Fixture distribution shipped as `@openfinance-os/sandbox-fixtures` (npm) and `openfinance-os-sandbox-fixtures` (PyPI). | Fixture packages live; persona library at 12; PEP-flagged AML scenario (Aisha + PEP persona) acknowledged unmet — see §3.3 Deferred. |
| **Phase 1.6 — V1.6 (TPP showcase)** | 2026-Q2 | ✅ Shipped | EXP-28 raw-HTTPS fixtures at `/[slug]/fixtures/v1/...`, EXP-29 `loadJourney()` / `load_journey()` package helpers, EXP-30 four-snippet "Use this persona in your demo" panel, EXP-31 `/integrate.html` developer guide, EXP-32 cross-endpoint identifier-coherence CI, plus the **Custom Persona Builder** (Workstream B; EXP-33 / EXP-34) — recipe-driven ephemeral personas, ZIP fixture export, in-browser SW fixture mock. | TPP showcase journey demonstrably wires against `loadJourney()` (`examples/tpp-budgeting-demo/`); `tests/journey-coherence.test.mjs` runs across the full fixture matrix. |
| **Phase 2.0 — V2 (Insurance preview)** | 2026-Q2 in flight | ◐ In flight | Vendored `uae-insurance-openapi.yaml` pinned by SHA, motor-domain generator (`src/generator/insurance/`), three motor endpoints, one insurance persona (`motor-comprehensive-mid`), `status: "preview"` flag in `dist/domains.json`. Detailed scope in `PHASE2_INSURANCE_PLAN.md`. | Phase 2.0 MVP exit (per insurance plan): full v2.1 Insurance endpoint coverage for motor, ≥ 3 insurance personas, parity tests with the banking spec-validation suite. |
| **Phase 2.x — V2 (open scope)** | 2026-Q3+ | Planned | **Contributing guide + SME review process published first**, then community persona contributions (PR-style) opened. Open Wealth domain extension. **Restoration of the deferred v1.5 trio** (Domestic Worker, PEP-flagged, Returning Expat) tracked here. Replay mode (record real Al Tareq sandbox calls and replay deterministically). Arabic / RTL i18n per amended D-10. | Contributing guide live + ≥ 3 community-contributed personas accepted under it. |

The deployment-platform decision is resolved (OF-OS Commons), the analytics surface is set (PostHog with wiring deferred per amended D-08), and there is no separate contributor brand/legal/comms launch process — this is fully part of the Commons.

**Phase 0 prototype-hygiene tasks** (gates Phase 0 exit):

- Sweep `of-sandbox-prototype.html` for residual brand chrome — strip any contributor-organisation logos, colour overrides, or copy that breaks NG6 (no separate contributor branding).
- Apply v2.1 spec corrections from `PRD_OF_Data_Explorer_Spec_Validation.md` to the prototype's hand-coded SPEC object as a stop-gap, OR (preferred) replace the hand-coded SPEC with a build-time YAML parser per EXP-01.
- Confirm the badge-shape + label combinations (M / O / C) render correctly in every viewport per EXP-23.

**Pre-publication checklist** (gates Commons publication flip):

- Spec validation re-run against the latest pinned upstream commit.
- Disclaimer copy approved (synthetic, not endorsed by CBUAE / Nebras, populate-rate is a Commons-curated assumption).
- Cross-link from the *Credit Underwriting in the UAE* Commons article in place (static link — no deep-link with persona+LFI preselected, per resolved former OQ-EXP-04).
- Accessibility check (WCAG 2.1 AA target).
- PostHog analytics events instrumented and verified anonymous-only (per amended D-08 — wire-up may land in a v1.0.x patch rather than blocking publication).
- `<meta name="robots" content="noindex">` removed from `src/index.html` (currently set for staging per §6.1).
- Canonical OF-OS Commons slug locked across `src/url.js` (`slugBase` default) and `src/integrate.html` per D-12.

---

## 12. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| **R-EXP-01** | Synthetic data drifts from real LFI behaviour; users internalise patterns that don't reflect production. | High | (a) Median LFI profile is revised as cross-LFI public evidence accumulates. (b) Every persona/profile carries a "synthetic — last calibrated YYYY-MM-DD" watermark in the UI. (c) Phase 2 replay mode displaces synthetic with recorded real sandbox payloads where available. |
| **R-EXP-02** | Maintenance burden — every Standards version bump requires fixture regeneration, persona review, and "real LFI" guidance updates. | Medium | EXP-01 makes regeneration spec-driven (no hand-authored field list). Persona review is done quarterly on a published cadence; the cadence is documented on `/about`. |
| **R-EXP-03** | Users cite the Median LFI profile or specific personas as **authoritative** rather than as Commons-curated assumptions, leading to mis-attribution to CBUAE / Nebras or to the Commons implying endorsement. | Medium | Persistent "Commons-curated assumption, not endorsed by CBUAE or Nebras" footer. `/about` page with citation guidance and methodology. Quarterly recalibration is publicly published with version notes. Median profile carries a visible confidence band, not a single number. |
| **R-EXP-04** | Peer LFIs object to a publicly hosted "what UAE OF data looks like" reference because populate-rate guidance implicitly compares LFIs. | Low–Medium | LFI profiles are **anonymous** (Rich/Median/Sparse), never named. Guidance frames bands as ecosystem-wide assumptions. The Commons-only framing softens the perception further — this is community ecosystem work, not vendor publishing. **Closure signal**: Hassan's flow (LFI compliance officer self-verifying against the sandbox) is validated by a real LFI-side compliance officer in pre-launch usability testing, per Phase 1 exit criteria (§11). An LFI-side user actively self-verifying is the strongest possible counter to the implicit-comparison framing. |
| **R-EXP-05** | The Commons publication / editorial process introduces friction that delays launch. | Low | Maintainer-handled publication workflow (per resolved former OQ-EXP-05); pre-publication checklist run end-to-end before final upload. |
| **R-EXP-06** | Sandbox becomes a scrape target for synthetic-data ingestion into other tooling, eroding the artefact's signature value. | Low | The data is synthetic — no privacy harm. The ecosystem benefit of broad use outweighs the dilution risk. |
| **R-EXP-07** | The Sparse-LFI profile is too pessimistic, leading users to over-defensively scope downstream products. | Low | Make profile band assumptions visible and editable. Compare mode (EXP-16) makes the Median↔Sparse delta legible. |
| **R-EXP-08** | The v2.1 spec on the Nebras GitHub changes shape unexpectedly between pinned-SHA bumps, breaking the build. | Medium | Build-time check fails CI on unexpected spec shape changes; pin SHA bumps reviewed by the Commons maintainer before deploy. |

---

## 13. Decisions

All previously-open questions resolved. Recorded here as a decisions log; deltas-from-resolution would re-open them.

| ID | Decision | Notes |
|---|---|---|
| **D-01** *(was OQ-EXP-01)* | **Standards baseline is v2.1 only.** No v2.0 ↔ v2.1 toggle. | Single pinned-SHA source. Phase 2 follows v2.x onwards as the spec evolves; previous-version migration analysis is out of scope. |
| **D-02** *(was OQ-EXP-02)* | **Working name: *Open Finance Data Sandbox*.** Final slug confirmed by the Commons publication workflow. | Descriptive name in the *Velox*-sibling pattern; no separate single-word brand. |
| **D-03** *(was OQ-EXP-03)* | **No pre-publication courtesy brief to Nebras.** | The artefact is fully part of the Commons; standard publication path applies. |
| **D-04** *(was OQ-EXP-04)* | **Cross-link from the *Credit Underwriting in the UAE* article is a static link.** No deep-link with persona+LFI preselected. | Keeps the article and the sandbox loosely coupled. |
| **D-05** *(was OQ-EXP-05)* | **Publication workflow handled by the Commons maintainer.** | No PRD-level engineering work; standard `openfinance-os.org` publication path. |
| **D-06** *(was OQ-EXP-06)* | **Fixture package is MIT-licensed under `@openfinance-os/...`.** | Code: MIT. Data: still CC0 per EXP-20 acceptance. Namespace confirmed under the OF-OS org. |
| **D-07** *(was OQ-EXP-07)* | **Community persona contributions (PR-style) open in v2.** | Phase 2 launches a contributing guide and SME review process. v1 + v1.5 remain maintainer-curated. |
| **D-08** *(was OQ-EXP-08; amended v0.10)* | **Analytics: PostHog** (the same surface OF-OS Commons already uses). **Wire-up deferred** — at v1.6 the bundle correctly emits zero analytics events (asserted by `tests/e2e/smoke.spec.mjs`); the PostHog project key + autocapture config land in a v1.0.x patch tracked separately, not gating Commons publication. EXP-21 acceptance applies once wired. | Anonymous events only — no PII, no fingerprinting. Captured: persona load, LFI switch, field click, endpoint navigation, raw-JSON toggle, export, share. The deferral keeps EXP-22 (no-PII / no-cookies) trivially true in the interim. |
| **D-09** *(was OQ-EXP-09)* | **No v2.0 → v2.1 delta view.** Out of scope across all phases. | Consistent with D-01 (v2.1 only). |
| **D-10** *(new in v0.9; amended v0.10)* | **English-only through v1.6; Arabic / RTL deferred to Phase 2.x alongside Open Wealth.** Originally targeted v1.5; not delivered. The defer is recorded explicitly rather than as silent slip. | UAE is bilingual; the v1.5 target was missed because v1.5 prioritised SME / Corporate persona substitutions and the v1.6 TPP-showcase work, then v2.0 insurance came online. Phase 2.x SHALL ship parallel-text Arabic UI, RTL layout, Arabic-Indic numerals optional, Arabic persona narratives, and add `name_ar` / `narrative_ar` to the persona YAML manifest at that point. |
| **D-11** *(new — v1.6 TPP showcase)* | **Major-version path slot (`/fixtures/v1/`) is the breakage boundary for the raw-fixture URL contract; in-`v1` data evolution is forward-compatible only.** Snapshots under `/fixtures/v1/snapshots/<sandbox-version>/` are deferred. | Paired with EXP-28. TPPs pin via `manifest.json.version` (latest-only on raw URLs) or via the immutable npm/PyPI package version. Breaking changes (renaming a persona, dropping an endpoint, changing envelope shape, changing watermark format) cut a new `/v2/` slot; the previous `/v1/` continues to be served for at least the §16 stewardship window (24 months). |
| **D-12** *(new in v0.10)* | **Canonical published slug is `/commons/data-sandbox/`.** Resolves the inconsistency between `src/url.js` (default `slugBase = '/commons/sandbox'`) and `src/integrate.html` (uses `/commons/data-sandbox/`). | Picks the more descriptive of the two candidates flagged at D-05; matches the project name (`@openfinance-os/data-sandbox`) and the integrate-page URL already in production code. The pre-publication checklist (§11) gates the alignment. Once the Commons publication confirms otherwise, this decision can be re-opened — the gating constraint is *consistency across the codebase*, not the specific slug. |

---

## 14. Dependencies

**Technical**

- **Published OpenAPI v2.1 spec for UAE Open Finance Account Information** — the singular technical input. Source: `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/uae-account-information-openapi.yaml`, pinned by commit SHA.
- **OF-OS Commons publication workflow** — handled by the Commons maintainer (per D-05).
- **PostHog analytics** — the OF-OS Commons analytics surface (per D-08). Anonymous events only.
- **Static link from the *Credit Underwriting in the UAE* Commons article** — coordinated with the article author.

**Licensing**

- **Code (HTML / CSS / JS / build tooling)**: MIT.
- **Synthetic dataset / fixtures package**: published under `@openfinance-os/...` on npm + PyPI, MIT for code, CC0 for the data.
- **OpenAPI YAML (vendored)**: inherits the upstream Nebras licence; the Commons maintainer verifies compatibility at vendoring time and on every pin-SHA bump.

---

## 15. Appendices (companions)

- **Appendix A — Persona seed manifests** (one YAML file per persona; written during Phase 0)
- **Appendix B — v2.1 field-coverage matrix** (lives in the sandbox itself per EXP-13/14)
- **Appendix C — Endpoint inventory in scope (v1)**
  1. `GET /accounts`
  2. `GET /accounts/{AccountId}`
  3. `GET /accounts/{AccountId}/balances`
  4. `GET /accounts/{AccountId}/transactions`
  5. `GET /accounts/{AccountId}/standing-orders`
  6. `GET /accounts/{AccountId}/direct-debits`
  7. `GET /accounts/{AccountId}/beneficiaries`
  8. `GET /accounts/{AccountId}/scheduled-payments`
  9. `GET /accounts/{AccountId}/product`
  10. `GET /accounts/{AccountId}/parties`
  11. `GET /parties` (calling user)
  12. `GET /accounts/{AccountId}/statements`
- **Appendix D — Persona generation rulebook** (YAML rules + cross-references to v2.1 spec anchors; written during Phase 0)
- **Appendix E — Companion documents**
  - `PRD_OF_Data_Explorer_Spec_Validation.md` — **applies to the prototype HTML, not to PRD v0.8+.** PRD §7.4 examples (`Flags=Payroll`, `IsShariaCompliant`, `IsSalaryTransferRequired`, etc.) are already v2.1-correct. The doc's prototype-correction list is actioned during the Phase 0 prototype-hygiene tasks (§11). The build-time spec-shape check it advocates is captured in §6.3 + R-EXP-08.
  - `PRD_OF_Data_Explorer_Review.md` — **historical.** Most Tier-1 items folded into v0.5–v0.8; remainder closed in v0.9. Retained for traceability.
  - `PRD_OF_Data_Explorer_Deployment.md` — **superseded by v0.4 onwards.** The deployment-options matrix is moot now that hosting is locked to OF-OS Commons (D-05). Retained for reference / historical context only.
  - `of-sandbox-prototype.html` — original single-file prototype; superseded by the `src/` build (Phase 0 prototype-hygiene completed). Retained for historical reference.
  - `IMPLEMENTATION_PLAN.md` — **engineering companion.** Workstream-level plan (A: curated fixtures, B: Custom Persona Builder, C: integration plumbing) maintained alongside the PRD; tracks shipped vs. in-flight work at workstream granularity.
  - `PHASE2_INSURANCE_PLAN.md` — **Phase 2.0 engineering plan** for the Open Insurance domain extension. Defines the motor-domain MVP scope, the insurance-OpenAPI vendoring contract, and the parity targets against the banking spec-validation suite.
  - `CHANGELOG.md` — release notes per version, including the v1.0 / v1.5 / v1.6 deltas referenced in §11.
- **Appendix F — Stress-coverage controlled vocabulary (v1)** — manifests' `stress_coverage` arrays draw from this enumeration so EXP-25's CI uniqueness check has stable terms. Initial set: `multi_party_accounts`, `joint_custodian`, `power_of_attorney`, `fx_currency_exchange`, `multi_currency_accounts`, `pep_kyc_claims`, `verified_claims_block`, `low_volume_inference`, `cash_dominant_flows`, `high_dbr`, `nsf_distress`, `thin_file_short_tenure`, `tenure_rich_uae_thin`, `remittance_outflow`, `gig_irregular_inflow`, `salary_payroll_flag`, `mortgage_long_dated`, `credit_line_block`, `sharia_compliant_product`, `salary_assigned_lending`. The vocabulary is extended (never silently broken) when a new persona introduces a new stress area; additions land in v0.9.x patch revisions.

---

## 16. Stewardship

The sandbox is contributed and maintained as part of OpenFinance-OS Commons. The maintainer commits to a **24-month minimum maintenance window from public launch** (so through Q3 2028 against a Q3 2026 launch). Maintenance includes:

- **Quarterly populate-rate band recalibration** as cross-LFI public evidence accumulates. Each recalibration is published to `/changelog` with a one-paragraph note explaining what changed and why.
- **Spec-pin updates within 30 days** of any upstream Nebras `v2.x` release on the `ozone` branch. The Commons maintainer reviews the diff, regenerates fixtures (per EXP-01), and re-runs the spec-validation suite before deploy.
- **Bug-fix triage within 14 days** of an EXP-26 report. The maintainer is not committed to a fix SLA, only to a triage SLA — some fixes (e.g., spec-interpretation arguments) are intentionally deliberative.
- **Persona library reviews quarterly**, aligned with populate-rate recalibration. Personas may be retired, refined, or rewritten as evidence accumulates.

**End-of-life / hand-off.** If the maintainer can no longer continue, the sandbox SHALL be offered to OF-OS Commons stewards for take-over, with: full repository access, persona / rulebook YAML ownership, the `@openfinance-os/...` package namespace, and 90 days of consultative support from the outgoing maintainer. The artefact SHALL never go un-maintained without an explicit, public end-of-life notice on `/about` providing at least 90 days' warning.

**Open contribution.** From v2 onwards (per D-07), persona contributions and field-guidance edits are acceptable as PRs from any Commons participant, subject to the Phase 2 contributing guide and SME review. This is the path by which the artefact survives any single maintainer.

---

## 17. Approval

| Role | Name | Decision | Date |
|---|---|---|---|
| Author + OF-OS Commons maintainer | Michael Hartmann | Drafted v0.8; self-approval pending Phase 0 spike outcome | 28 Apr 2026 |
| Author + OF-OS Commons maintainer | Michael Hartmann | v0.9 — incorporated self-review pass: closed P0-1 (broken §17 ref → §11 Phase 0 hygiene), P0-2 (§7.3↔§8.3 reconciled — §8.3 is single source of truth for populate probabilities), P0-3 (EXP-18 Gig fallback + final-fallback `—`), P0-4 (added EXP-21 anonymous analytics, EXP-22 identity posture); closed P1-1..P1-8 (meter scope, PRNG seeding, low-volume threshold provenance, EXP-26 GitHub-only, employer pool, EXP-03 ↔ Appendix C alignment, Reem v1.5+ derivation, Phase 1 schedule slip to 6 weeks); closed P2-1..P2-8 (stress-coverage vocabulary in Appendix F, EXP-20 fixture contents, §6.8 URL shapes, EXP-23 no-glyph-only-semantics, R-EXP-04 Hassan closure signal, satellite-doc status annotations). Self-approval pending Phase 0 spike outcome. | 28 Apr 2026 |
| Author + OF-OS Commons maintainer | Michael Hartmann | v0.10 — PRD-vs-code reconciliation pass after the v1.6 TPP-showcase release. §3.3 persona library updated to the shipped 12-banking + 1-insurance set; v1.5 trio (Domestic Worker / PEP-flagged / Returning Expat) recorded as deferred to Phase 2.x. EXP-02 acceptance updated. EXP-06 narrative-coherence acceptance tightened with concrete invariants and a named test file. New §4.5c with EXP-33 / EXP-34 covering the Custom Persona Builder. §6.1 noindex-is-staging clarification. §11 phasing table rewritten to reflect what shipped vs. what was originally planned, including the Phase 2.0 insurance preview. D-08 amended (PostHog wire-up deferred), D-10 amended (Arabic/RTL slipped to Phase 2.x), D-12 added (canonical slug locked to `/commons/data-sandbox/`). Appendix E expanded with `IMPLEMENTATION_PLAN.md`, `PHASE2_INSURANCE_PLAN.md`, `CHANGELOG.md`. Self-approved. | 2 May 2026 |

The artefact is fully part of the Commons. Author and maintainer are the same person, so approval is self-certified — explicitly recorded as such for transparency. If a co-maintainer joins, this row gains a second signatory and the self-approval framing retires.
