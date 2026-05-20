# Open Finance Data Sandbox

> Interactive, client-side static explorer for UAE Open Finance Bank Data
> Sharing payloads. Synthetic data, narratively realistic personas,
> spec-driven mandatory/optional/conditional badges. Contributed to the
> [OpenFinance-OS Commons](https://openfinance-os.org/commons/).

**[→ Live demo](https://openfinance-os.github.io/data-sandbox/src/index.html)**
&nbsp; · &nbsp;
**[→ /about](https://openfinance-os.github.io/data-sandbox/src/about.html)**
&nbsp; · &nbsp;
**[→ Embed mode](https://openfinance-os.github.io/data-sandbox/src/embed.html?persona=salaried_expat_mid&lfi=median&endpoint=/accounts/%7BAccountId%7D/transactions&seed=4729&height=600)**

## Why

UAE Open Finance is moving from spec-on-paper to data-flowing-through-pipes.
Every TPP team — banks, Hub71/ADGM fintechs, Al Tareq cohorts, independent
developers — faces the same first-day problem: **the spec tells you the
schema, but not what the data actually looks like in practice.**

This sandbox is the show-don't-tell answer: load a synthetic UAE persona and
read every UAE Open Finance v2.1 Bank Data Sharing payload they would
receive — accounts, balances, transactions, standing orders, direct debits,
beneficiaries, scheduled payments, product, parties, statements — with
mandatory / optional / conditional treatment derived live from the published
OpenAPI spec. Toggle an LFI population profile (Rich / Median / Sparse) to
stress-test downstream design decisions against worst-case and best-case
field shapes.

## What's in the box

- **38 synthetic UAE personas** — 21 banking-only (retail, SME, corporate) +
  9 insurance-only (motor / home / health / life / travel / renters /
  employment) + 8 multi-domain personas whose `domains: [banking, insurance]`
  declaration emits both endpoint families at the same persona path. The
  sandbox banking tab renders 29 personas (21 + 8 multi-domain); the
  insurance tab renders 17 (9 + 8). Together they cover 30+ globally-unique
  stress-coverage terms. The banking set spans salaried expat / Emirati, gig,
  senior, thin-file, mortgage DBR-heavy, NSF / distressed, HNW
  multi-currency, joint family, corporate treasury, and 8 SME archetypes
  (cash-heavy retail, F&B multi-outlet, e-commerce marketplace, free-zone
  SaaS, construction sub-contractor, healthcare clinic, RAK Emirati-owned
  trading, general trading). Most SME personas declare a
  `multi_lfi_footprint` so role bundles can be fetched independently and
  reconciled by IBAN; the flagship multi-domain `retail-multi-banker` adds
  N-slot multi-LFI (4 banks × multiple products) + multi-insurer coverage.
- **All 12 v2.1 Account Information endpoints** for banking + the 4-endpoint
  motor-MVP for insurance — all generated and validated against the v2.1
  OpenAPI schema (1500+ spec-validation tests across persona × LFI × endpoint
  after `npm run build:site`).
- **Three LFI populate-rate profiles** — Rich (every populate-band field
  populated) · Median (Commons-curated v1 calibration: Universal=1.0,
  Common=0.7, Variable=0.4, Rare=0.1) · Sparse (Universal-only worst case).
- **EXP-16 Compare-LFIs** — side-by-side render of the same persona under
  two LFI profiles with cell-level diff highlighting.
- **EXP-18 Underwriting Scenario panel** — illustrative pinned formulas:
  Implied monthly net income (Payroll → Fallback A → Fallback B → `—`),
  Total fixed commitments (frequency-normalised, multi-currency converted
  to AED at the pinned snapshot rate), Implied DBR, NSF / distress count.
  Low-volume guard for the Senior persona (PRD §4.4).
- **Spec-wide find** (⌘K) — search field names, paths, enums, persona
  narratives.
- **Tour** — 5-step walkthrough of Sara's bundle.
- **Export** — JSON per endpoint, CSV per resource, tarball — all watermarked.
- **Embed mode** — chrome-less variant for iframe consumption (slide decks,
  blog posts, LMS modules).

The full set of v1 EXP-NN PRD requirements is implemented; Phase 2.x adds
multi-LFI footprints, role-keyed bundles, mod-97-valid IBANs, and an MCP
server (`packages/sandbox-mcp/`).

## Architecture

- **Vanilla HTML/CSS/JS, no build chain.** ES modules served as-is. Production
  CDN handles gzip + HTTP/2 multiplexing.
- **Spec source.** `uae-account-information-openapi.yaml` v2.1 vendored from
  [Nebras-Open-Finance/api-specs](https://github.com/Nebras-Open-Finance/api-specs)
  on the `ozone` branch, pinned by commit SHA. Build-time tooling
  (`tools/parse-spec.mjs`) parses the YAML and emits the JSON `SPEC` object
  the frontend consumes — every status badge, enum value, and mandatory/
  optional flag flows from the spec, never hand-authored. Linter rule
  enforces this invariant.
- **Synthetic generator.** Runs entirely in the browser. Deterministic seeded
  PRNG (mulberry32 + FNV-mixed seed). `(persona_id, lfi_profile, seed)` →
  bundle is a pure function. Same URL on different machines, different
  caches, different days produces byte-identical output.
- **No backend, no database, no auth.** Static deployment. Anonymous PostHog
  analytics only.
- **Old-core-banking realism in transaction shapes** —
  `TransactionInformation` reads `SAL/PAYROLL/HELIXDATA` not "Salary credit
  — Helix Data Group", reference numbers vary by channel
  (`IPP9444186899`, `BRN149202505058032`, `UTIL2025051124`), POS amounts
  carry fils precision, ValueDateTime drifts T+1 to T+3 for FX / cross-bank,
  `Status=Pending` for transactions in the last 24-48h, NSF events emit
  paired Rejected debit + Booked bounce-fee.

## Quick start

```bash
git clone https://github.com/openfinance-os/data-sandbox.git
cd data-sandbox
npm install
npm run build:spec       # parse the vendored YAML into dist/SPEC.json
node tools/build-data.mjs   # bundle personas + pools as dist/data.json
npm run serve            # http://localhost:8000/index.html
```

## CI

```bash
npm test            # 413 unit tests (Vitest) — replay determinism, spec
                    # validation across 10 × 3 × 12, LFI mechanics,
                    # underwriting calculator, exports, identity posture
npm run lint        # 4 invariant lints — no-handauthored-fields (EXP-01),
                    # no-institution-leak (NG5), pii-leak (EXP-07/22),
                    # no-glyph-only (EXP-23)
npm run test:e2e    # 15 Playwright e2e tests + axe-core a11y (EXP-23)
npm run test:perf   # Lighthouse-CI mobile profile (EXP-24)
npm run ci          # full suite
```

## TPP integration

If you are wiring sandbox personas into a TPP demo journey to overcome the
intentionally-thin mock data in the Nebras-operated regulatory sandbox,
the [integration guide](./src/integrate.html) walks through four plug
points (iframe, npm `loadJourney()`, PyPI `load_journey()`, raw HTTPS
fixtures at `/fixtures/v1/`). A worked example lives in
[`examples/tpp-budgeting-demo/`](./examples/tpp-budgeting-demo/).

## Docs

- **PRD** — [`PRD_OF_Data_Explorer.md`](./PRD_OF_Data_Explorer.md) (v0.9)
- **Implementation plan** — [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)
- **Methodology, citation guidance, stewardship** — [/about](./src/about.html)
- **TPP integration guide** — [/integrate](./src/integrate.html)

## Licensing

- **Code:** [MIT](./LICENSE)
- **Synthetic data + fixtures:** [CC0](./LICENSE-DATA) — public domain
- **Vendored OpenAPI YAML:** inherits the upstream
  [Nebras-Open-Finance/api-specs](https://github.com/Nebras-Open-Finance/api-specs)
  licence.

## Stewardship

Maintained as part of the OpenFinance-OS Commons. Quarterly populate-rate
band recalibration. Spec-pin updates within 30 days of upstream Nebras
v2.x releases. Issue triage within 14 days. Persona library reviewed
quarterly. 24-month minimum maintenance window from launch with a public
EOL clause if the maintainer can no longer continue.

## Reporting issues

Every field card carries a "Report an issue" link with a pre-filled
GitHub issue body — field name + path + status + persona + LFI + seed +
pinned spec SHA + a 5-checkbox triage set.
