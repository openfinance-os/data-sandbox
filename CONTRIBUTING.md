# Contributing

The Open Finance Data Sandbox is maintained as part of the
[OpenFinance-OS Commons](https://openfinance-os.org/commons/). v1 and v1.5
remain maintainer-curated; **community persona contributions open in v2**
alongside the SME review process described below (per PRD D-07).

This document is the v1 stub — it states the bar so contributors know what's
expected when v2 opens. Until then, please use the issue tracker for any
discussion.

## Before you contribute

Three load-bearing invariants. Violating any of them is a P0 bug, not a
stylistic choice — they're enforced by CI.

1. **No real customer data, ever** (PRD NG4 / EXP-07). Names, IBANs,
   phone numbers, dates of birth, employer names, merchant names — all
   draw from `/synthetic-identity-pool/`. Anonymised data, aggregated
   stats, derivations from any institution's customer base are equally
   forbidden. The `lint-pii-leak` test scans every persona × LFI bundle
   for identity strings outside the pool and fails CI on detection.

2. **No institution-specific operational detail, ever** (PRD NG5).
   LFI profiles are anonymous (Rich / Median / Sparse) — never named.
   Populate-rate guidance is published as ecosystem-wide assumption
   bands, never attributed to a specific bank. The
   `lint-no-institution-leak` test checks every file in `/personas/`,
   `/synthetic-identity-pool/`, and `/src/` against a denylist of
   real UAE LFI brand stems.

3. **Spec-driven field metadata** (EXP-01). Status badges
   (mandatory / optional / conditional), enums, types, and formats all
   flow from `dist/SPEC.json`, parsed live from the vendored v2.1
   OpenAPI YAML at the pinned commit SHA. Hand-authored field-status
   tables in source code are forbidden by `lint-no-handauthored-fields`.

## Reporting issues

Every field card in the app carries a "Report an issue" link that opens a
GitHub issue pre-filled with: field name + path + status + persona + LFI
profile + seed + pinned spec SHA + a 5-checkbox triage set. **Use this
affordance** rather than describing the issue from scratch — the
reproduction context is already attached for you, and the maintainer's
14-day triage SLA depends on it.

For non-field issues (UX, accessibility, performance, deploy) open a
[regular issue](https://github.com/openfinance-os/data-sandbox/issues/new).

## v2 persona contributions (planned)

When v2 opens (Q3 2026 — tied to UAE Open Finance Insurance Suite GA), the
process for proposing a new persona will be:

1. **Open an issue first.** Describe the persona's archetype, demographic
   shape, and the spec stress area it would uniquely cover. The
   maintainer + a UAE-OF SME pair check that:
   - The archetype isn't already covered by an existing persona (EXP-25
     uniqueness — every persona in the library exercises a previously
     untested spec area, drawn from PRD Appendix F's controlled
     vocabulary).
   - The shape is publicly observable from UAE-market patterns, not
     inferred from any specific institution's data.
2. **Open a PR with the YAML manifest** under `/personas/`. Required:
   `persona_id`, `name`, `archetype`, `default_seed`, `stress_coverage`
   (≥ 1 term from Appendix F), `demographics`, `income`, `accounts`. See
   [`personas/_schema.yaml`](./personas/_schema.yaml) and existing
   manifests for the pattern.
3. **Add identity-pool slices if needed.** New name pools, employer
   pools, or merchant pools go under `/synthetic-identity-pool/<category>/`.
   Every name in the persona must be drawn from the pool.
4. **CI must pass.** Spec-validation (360 + new combinations), the four
   invariant lints, persona-manifest schema, EXP-25 uniqueness check,
   bundle-weight gate.
5. **Maintainer review.** Then the persona ships in the next quarterly
   populate-rate recalibration cycle.

## Development setup

```bash
git clone https://github.com/openfinance-os/data-sandbox.git
cd data-sandbox
npm install
npm run build:spec       # parse the vendored YAML into dist/SPEC.json
npm run build:data       # bundle personas + pools as dist/data.json
npm run serve            # http://localhost:8000/index.html
```

```bash
npm test            # 413 unit tests
npm run lint        # 4 invariant lints
npm run test:e2e    # 15 Playwright e2e tests + axe-core a11y
npm run test:perf   # Lighthouse-CI mobile profile
npm run ci          # full suite
```

## Style

- **Vanilla HTML/CSS/JS, no build chain.** ES modules served as-is.
- **No new dependencies in v1 frontend.** Build-time tools may use
  `js-yaml` (already a dep) and otherwise should stick to Node stdlib.
- **No comments restating what the code does.** Comments justify
  non-obvious decisions, hidden constraints, and surprising behaviour.
- **Tests over assurances.** New invariants are CI lints, not docstrings.

## Licensing

By submitting a PR you agree your contribution is licensed under MIT
(code) and CC0 (synthetic data).

## Conduct

The OpenFinance-OS Commons code of conduct applies (link TBD on Commons
launch). Be kind, be specific, be patient — the maintainer is one person.
