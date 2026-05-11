# tests/

27 Vitest suites + 2 Playwright suites under `e2e/`. Total ~1,707 tests + 65 in
the workspace `packages/sandbox-mcp/` package.

## Quick reference

| Command | What runs | Build deps |
|---|---|---|
| `npm test` | All 27 vitest suites | none required, but expect 1 skip |
| `npm run test:e2e` | Playwright (smoke + analytics + a11y) | `npm run build:spec` |
| `npm run test:perf` | Lighthouse CI (EXP-24 perf budget) | `npm run build:spec`, `build:data` |
| `npm run test:mcp` | The MCP package's own vitest workspace | runs `build:fixtures` itself |
| `npm run ci` | The full local gate (no perf, no e2e) | runs all build steps itself |
| `npm run ci:full` | `ci` + `build:site` + `test:e2e` + `test:perf` | for full local verification |

## Why some suites skip

A handful of suites read from build artefacts that are **not** in git:

- Anything under `packages/sandbox-fixtures/` — produced by `npm run build:fixtures`.
- Anything under `_site/` — produced by `npm run build:site`.

Each gated suite uses a top-level `if (!fs.existsSync(...))` guard around a
`describe.skip(...)` placeholder, so unbuilt suites surface as a single skipped
test with a message naming the right command. Examples:

| Suite | Skip message |
|---|---|
| `fixture-package.test.mjs` | `fixture package not built — run npm run build:fixtures` |
| `iban-validity.test.mjs` (slice 3) | `fixture package not built` |
| `journey-coherence.test.mjs` (EXP-32) | `fixture package not built — run npm run build:fixtures` |
| `multi-lfi-self-beneficiary.test.mjs` | `fixture package not built` |
| `multi-lfi-role-bundles.test.mjs` (Slice 5) | `fixture package not built` |
| `multi-lfi-cross-bundle-tx.test.mjs` (Slice 7) | `fixture package not built` |
| `vat-breakdown.test.mjs` (Slice 10) | `fixture package not built` |
| `rendered-fixture-spec-validation.test.mjs` | `fixture package not built` |
| `counterparty-bank-realism.test.mjs` (D-14) | `fixture package not built` |
| `integrate-staging.test.mjs` (EXP-28..31) | `_site/ not staged — run npm run build:site` |

A clean `npm test` (no prior build) typically shows **1 skipped** test —
`integrate-staging`, because the other gated suites get unblocked by
`npm run test:mcp` (which runs `build:fixtures` as a side effect, and
the test files exist in the workspace cache by then).

To run the entire suite with **0 skips**:

```sh
npm run build:site && npm test
```

## Load-bearing tests

Per the PRD (`PRD_OF_Data_Explorer.md` §EXP-IDs) and CLAUDE.md invariants, do
**not** disable or relax these without a deliberate decision:

- `spec-validation.test.mjs` — every generated payload validates against the v2.1 OpenAPI schema (EXP-10).
- `rendered-fixture-spec-validation.test.mjs` — same gate, but on the built fixture-package output.
- `replay.test.mjs` — `(persona, lfi, seed)` → byte-identical bundle (EXP-05).
- `bundle-weight.test.mjs` — gzipped bundle ≤ 250 KB (EXP-24, hard cap).
- `iban-validity.test.mjs` — every emitted IBAN is ISO-13616 mod-97 valid.
- `analytics-allowlist.test.mjs` — bundle emits zero analytics events until the
  PostHog wire-up (D-08) is shipped.

## E2E coverage (`tests/e2e/`)

- `smoke.spec.mjs` — load index → pick persona → switch endpoint → cross-link → verify embed → axe-core a11y scan.
- `analytics.spec.mjs` — confirms the inert-by-default analytics surface.

E2E tests assume `python3 -m http.server` (Playwright's `webServer` block
auto-spawns it). They run against `src/` directly — **no build step needed**
because the spec is fetched from `dist/SPEC.json` which `npm run build:spec`
emits.

## Test data discipline

- All synthetic identity (names, IBANs, phones, DOBs) must come from
  `synthetic-identity-pool/`. Enforced by `tools/lint-pii-leak.mjs`.
- No real UAE bank names anywhere a populate-rate or product-mix claim is
  bound. Enforced by `tools/lint-no-institution-leak.mjs`.
- Field metadata is spec-derived only — no hand-authored status tables.
  Enforced by `tools/lint-no-handauthored-fields.mjs`.

These lints run as part of `npm run lint` (and therefore `npm run ci`).
