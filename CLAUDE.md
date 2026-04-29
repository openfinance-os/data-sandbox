# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repo is **discovery-stage and PRD-only**. There is no source code, no build, no tests, and no git history yet. The single live artefact is `PRD_OF_Data_Explorer.md` (v0.9, draft), which fully specifies the product to be built. Treat the PRD as the source of truth for any implementation work; do not invent architecture that contradicts it.

The companion documents listed in PRD §15 Appendix E live alongside the main PRD in this repo:
- `PRD_OF_Data_Explorer_Review.md` — historical (Tier-1 items folded into v0.5–v0.8; remainder closed in v0.9).
- `PRD_OF_Data_Explorer_Spec_Validation.md` — applies to the prototype HTML, not the PRD.
- `PRD_OF_Data_Explorer_Deployment.md` — superseded (hosting locked to OF-OS Commons per D-05).
- `of-sandbox-prototype.html` — current single-file prototype; basis for the v1 build.

## What the product is

An interactive, **client-side static** sandbox that lets a TPP-perspective user load synthetic UAE customer personas and explore every UAE Open Finance Bank Data Sharing payload they would receive — with mandatory/optional/conditional field treatment derived live from the published OpenAPI spec. Hosted as a contribution to OpenFinance-OS Commons. Bank Data Sharing only in v1; Open Wealth/Insurance/Service Initiation are v2+.

## Planned architecture (PRD §6)

When code lands, expect:

- **Frontend**: vanilla HTML/CSS/JS in v1, no build chain. React/Svelte only considered at v1.5 if maintenance surface justifies it.
- **Synthetic generator**: runs entirely in the browser. Deterministic seeded PRNG (mulberry32). `(persona_id, lfi_profile, seed)` → bundle is a pure function.
- **Spec source**: vendored copy of `uae-account-information-openapi.yaml` from `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/`, **pinned by commit SHA**. The pinned SHA is shown in the UI top bar and on `/about`.
- **Build-time tooling**: small Python/Node script parses the vendored YAML and emits a JSON `SPEC` object the frontend consumes. This is what makes status badges spec-driven (see "load-bearing invariants" below).
- **No backend, no database, no auth.** Static deployment. Anonymous PostHog analytics only.
- **Persona definitions**: YAML manifests under `/personas/`, one per persona; schema is sketched in PRD §8.2 and §3.3. Each manifest declares a `stress_coverage` field per EXP-25.
- **Synthetic identity pool**: `/synthetic-identity-pool/` — names/IBANs/phones/DOBs all drawn from this pool, never elsewhere (EXP-07).

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

- **Phase 0 (spike)**: 1 persona × 3 endpoints, mandatory/optional badging only.
- **Phase 1 (v1)**: 10 personas × all 12 v2.1 Account Information endpoints × 3 LFI profiles. Endpoints listed in PRD Appendix C.
- **Phase 1.5**: Compare-LFIs mode, Underwriting Scenario panel, persona library to 13, fixture package `@openfinance-os/sandbox-fixtures` published to npm + PyPI (MIT code, CC0 data).
- **Phase 2**: Open Wealth + Insurance, community persona PRs.

## Working with the user

- The author/maintainer (Michael Hartmann) is also the OF-OS Commons maintainer — domain context is deep; concise technical responses preferred.
- Use the `open-finance-uae` skill for any UAE Open Finance regulatory / Standards / Al Tareq / Nebras / CBUAE questions — it's the authoritative source over training data.
- The PRD has a Decisions log (§13). Decisions D-01…D-10 are settled. If a discussion seems to re-open one, surface that explicitly.

## Filesystem note

The repo directory name has a **trailing space**: `open-finance-data-sandbox ` (the harness sometimes reports it without). Quote the path when shelling out, e.g. `ls "/Users/michartmann/Documents/GitHub/open-finance-data-sandbox /"`.
