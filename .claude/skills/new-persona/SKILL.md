---
name: new-persona
description: >-
  Scaffold a new synthetic UAE Open Finance persona manifest (banking,
  insurance, or multi-domain) under personas/, wired to the identity pools and
  validated against the schema and conformance lints. Use when adding a persona
  to the library, e.g. "/new-persona an SME e-commerce seller" or "add a health
  family persona".
disable-model-invocation: true
---

# New persona

Scaffold a persona manifest the way this repo expects: a generator INPUT in
`personas/<slug>.yaml` that references only existing identity-pool files, claims
unique EXP-25 stress coverage, and passes the conformance lints. The persona
describes narrative parameters; the generator synthesises the actual bundle.

## Steps

1. **Settle the brief** (ask only if the user hasn't said):
   - Domain: `banking`, `insurance` (which `line`: motor/home/health/life/travel/
     renters/employment), or multi-domain (`domains: [banking, insurance]`).
   - Segment for banking: `Retail` (default) / `SME` / `Corporate`. SME/Corporate
     require an `organisation` block.
   - The archetype and the 1–3 narrative hooks that make it distinct.

2. **Read the schema for the chosen domain** — do not author from memory:
   - Banking → `personas/_schema.yaml`
   - Insurance → `personas/_schema.insurance.yaml`
   - Multi-domain → both.
   Read one or two existing manifests of the same shape as worked examples
   (e.g. `personas/salaried-expat-mid.yaml` for retail banking,
   `personas/sme-cash-heavy.yaml` for SME, `personas/health-family-comprehensive.yaml`
   for health insurance, `personas/retail-multi-banker.yaml` for multi-domain).

3. **Pick unique stress coverage (EXP-25)** — this is the load-bearing reason a
   persona is allowed to exist. The `stress_coverage` SET must not duplicate any
   other persona's. List what's already claimed before choosing:
   `grep -rh 'stress_coverage' -A6 personas/ | grep '  - '` (then dedupe), or
   read a few neighbours. Choose terms from the PRD Appendix-F controlled
   vocabulary that no existing persona already owns as a set.

4. **Resolve every pool reference to a real file** before writing it. Each
   `*_pool` value must point at an existing file:
   - `demographics.nationality_pool` → `synthetic-identity-pool/names/<id>.yaml`
   - `income.primary_employer_pool` → `synthetic-identity-pool/employers/<id>.yaml`
   - `organisation.legal_name_pool` → `synthetic-identity-pool/organisations/<id>.yaml`
   - `organisation.signatories[].signatory_pool` → `synthetic-identity-pool/names/<id>.yaml`
   - `cash_flow.*.counterparty_pool` → `synthetic-identity-pool/counterparties/<id>.yaml`
   - insurance `finance.bank_pool` / `mortgage.bank_pool` → `synthetic-identity-pool/banks/<id>.yaml`
   `ls` the relevant pool directory; if no suitable pool exists, add the pool
   file first (synthetic values only — invariant NG4/EXP-07) or reuse the
   closest existing one.

5. **Respect the institution-name rule (invariant 3 / D-14)**. LFI and insurer
   profiles are anonymous `Rich`/`Median`/`Sparse`. Real UAE bank/insurer names
   may appear ONLY inside `multi_lfi_footprint.*.plausible_lfi_candidates` or
   `multi_insurer_footprint.slots[].plausible_insurer_candidates` — never bound
   to a populate-rate or the emitting LFI identity. If the persona spans more
   than one LFI, prefer the N-slot `multi_lfi_footprint.slots[]` shape and tag
   accounts/commitments with `at_slot` (all-or-nothing).

6. **Write `personas/<slug>.yaml`** with `persona_id` == the filename slug,
   a `default_seed`, a human `name` (and optional `name_ar`), the narrative
   block (and optional `narrative_ar`), and the domain-specific blocks. Use an
   existing manifest's field order as the template.

7. **Validate** — run and report:
   ```
   npm run lint:persona-spec-conformance
   npm run lint:stress-coverage-uniqueness
   npx vitest run tests/persona-manifest.test.mjs
   ```
   (These need `dist/`; run `npm run build:spec && npm run build:data` first if
   they complain.) For a multi-LFI persona also run
   `npx vitest run tests/multi-lfi-role-bundles.test.mjs`. Fix any failure
   before declaring done — or hand the file to the `persona-conformance-checker`
   subagent for a second pass.

8. **Mention the follow-ups** the user owns: bumping persona counts in
   `CLAUDE.md`/README if they track totals, and a `CHANGELOG.md` entry
   (the `update-changelog` skill can draft it).

## Guardrails

- Never invent real names, IBANs, phones, Emirates IDs, or DOBs as literals —
  those come only from the identity pools (EXP-07).
- Never hand-author field status/enums; the manifest only sets narrative inputs.
- A persona with no unique stress coverage will fail CI — don't ship it.
