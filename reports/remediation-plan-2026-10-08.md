# Data Sandbox remediation and value-improvement plan

**Proposed 8 October 2026.** Based on the [codebase review](/Users/michartmann/Documents/GitHub/data-sandbox/reports/data-sandbox-review-2026-10-08.md) and [Open Finance specification audit](/Users/michartmann/Documents/GitHub/data-sandbox/reports/open-finance-spec-audit-2026-10-08.md). This is a plan for review; application code, specifications, release settings, and the installed skill have not been changed.

## Delivery approach

Deliver a correctness release before expanding product features. Then deliver portable application testing, followed by learning and evaluation improvements. Use small changes with explicit acceptance criteria, each reviewed against the final implementation. Preserve the static explorer, vanilla frontend, synthetic-data boundary, Arabic support, and anonymous LFI profiles.

Keep the supported baseline on v2.1, applying the relevant published corrections per file. Record the official Errata 4/source-folder discrepancy explicitly. Do not switch the default corpus to a v2.2 release candidate merely because the documentation landing page now displays it.

## 1. Make the standards and validation contract explicit

**Files:** `SPEC/uae-*-openapi.yaml`, `SPEC/SPEC_PIN*`, `tools/domains.config.mjs`, `tools/parse-spec.mjs`, `tools/check-spec-drift.mjs`, `.github/workflows/spec-drift.yml`, `PRD_OF_Data_Explorer.md`, and the schema-validation suites.

- Assemble a correction matrix linking each relevant official Errata 4 item to the effective banking, insurance, or ATM wire schema. Mark payment initiation, quote submission, and LFI/API Hub operations outside the current read-only surface.
- Update banking to the corrected content of its errata2 file and insurance to the effective errata3 file after reviewing that matrix. Retain the matching ATM file. Record immutable upstream commit SHA, path, content hash, retrieval time, and official correction references for each domain.
- Generate badges and required-field rules from the reviewed schemas. Check that field-redaction bands never overlap mandatory fields and add example coverage for adjustment direction, non-UUID policy IDs, and insurance ratios above 100.
- Replace directory-commit counting as the sole freshness signal with effective-file resolution and content comparisons. Also check the official consolidated errata page's revision and relevant entries. Report unreachable sources as unverified, rather than fresh. Track preview changes separately.

**Upstream quote-schema dependency:** The closed `oneOf`/`allOf` composition cannot be treated as solved by deleting every `additionalProperties: false`. First prepare the exact proposed upstream correction and independently validate quote-status branches. If the publisher's corrected file is unavailable, any temporary schema adapter must be keyed to the exact affected file hash, narrowly normalize the identified composition defect, preserve branch-specific allowed and required fields, and reject injected unknown properties. Save the transformed schema and its diff alongside provenance. Report literal-source validation and normalized-contract validation separately. Do not claim literal raw-schema conformance until the source defect is resolved.

**Acceptance:** Applicable corrections are accounted for; exact baseline provenance is exposed; all schemas compile or have an explicit diagnosed source issue; mandatory-field preservation holds. No blanket schema relaxation and no silent endpoint skips.

## 2. Correct exported wire envelopes and close the test gap

**Files:** `src/ui/export.js`, `src/generator/insurance/`, `tests/spec-validation.insurance.test.mjs`, `tests/spec-validation.atm.test.mjs`, `tests/rendered-fixture-spec-validation.test.mjs`, and a new shared schema-validation helper.

- Make insurance metadata follow each endpoint's actual response schema. Remove `Meta.TotalPages` from response shapes that do not permit it; retain pagination metadata only where declared.
- Remove the undeclared ATM `Links` block from its canonical response. Keep navigational information in sandbox annotations or the UI, preserving watermarks.
- Check each insurance quote against its selected status schema. Correct any independently demonstrated generator mismatches rather than attributing all union errors to the generator.
- Extend the emitted-file sweep to banking, insurance, ATM, multi-domain cases, and role bundles. Strip only the documented underscore-prefixed sandbox annotations. Fail on missing schema mappings or compilation failures.
- Add meaningful negative tests: undeclared ATM `Links`, invalid insurance metadata, unknown nested fields, an invalid quote-status payload, and removal of mandatory fields must be rejected. Keep source-defect exceptions explicit and narrow.

**Acceptance:** Zero unexplained schema failures across the complete manifest-referenced corpus. The presently failing 1,116 insurance and three ATM files are resolved or individually covered by a clearly stated upstream dependency. A permissive test pass is not a release gate.

## 3. Make financial results and replay coherent

**Files:** `src/generator/balances.js`, `src/generator/statements.js`, `src/generator/transactions.js`, `src/generator/constants.js`, `src/generator/dispatch.js`, domain entry points, `tools/build-shared.mjs`, `tools/build-data.mjs`, fixture builders, `src/app.js`, `src/embed.js`, and MCP session construction.

- Introduce one shared posted-ledger calculation. Use posted/booked items according to the pinned contract; rejected attempts do not change booked money, and pending items do not become booked expenditure. Apply account, currency, direction, and reference-timestamp rules consistently.
- Use currency-aware decimal arithmetic instead of repeated binary floating-point accumulation. Avoid adding different currencies without an explicitly defined settlement/conversion amount. Preserve credit-card liability and available-credit conventions.
- Generate completed statements for completed months. Ensure statement dates never extend beyond the reference timestamp. Verify opening balance plus net posted movement equals closing balance, with continuous periods.
- Add semantic cases for rejected/pending payments, refunds, transfers between a person's banks, credit cards, and multi-currency accounts. Keep failed payments available as distress signals.
- Define one explicit corpus reference timestamp, initially preserving the reviewed corpus date. Remove the dependency on spec retrieval timestamps and the competing April/May defaults. Pass the same context through browser, Node, Python fixtures, embed, and MCP.
- Introduce a shared scenario descriptor: corpus/generator version, persona or recipe hash, role, profile, seed, reference timestamp, and per-domain spec provenance. Use it in cache keys, exports, package manifests, and MCP session metadata.
- Publish immutable package versions and downloadable corpus archives for repeatable citations; keep a clearly labelled current alias. Add the corpus version to share URLs. Support immutable static fixture URLs only after verifying that the distribution pipeline retains their versioned payloads; otherwise make the pinned archive/package the supported replay route. Record the extension to deferred snapshot decision D-11 and explain why corrected data belongs in a new corpus release.

**Acceptance:** Failed attempts leave booked balances unchanged; periods reconcile; no future booked item is claimed as current; all adapters return the same canonical envelope for the same full scenario context. Old release snapshots remain immutable.

## 4. Make every advertised integration work

**Files:** `src/app.js`, `src/url.js`, `src/ui/export-popover.js`, `src/integrate.html`, `src/integrate.js`, `tools/stage-site.mjs`, fixture builders/loaders, package READMEs, examples, and `package.json`.

- Generate one deployment-aware fixture base shared by explorer, embeds, integration examples, and documentation. Support the actual site base path rather than deriving fixture storage from `/src/`.
- Read supported static seeds and roles from the manifest. Default curated scenarios to their published seed. For a non-published seed or custom recipe, provide downloaded JSON or a working runtime-generation command instead of a nonexistent static curl URL.
- Serve the staged site in the documented quick start, so all `dist/` and fixture dependencies are reachable.
- Test copied snippets from a clean external client. Require the correct content type and successful JSON parsing. Verify unsupported fixture paths produce a useful failure and do not silently succeed with explorer HTML; correct hosting fallback rules where needed.
- Retire the Service Worker route as an advertised portable HTTP integration. Browser custom generation remains usable through downloads and packages; the local mock in the next release supplies portable dynamic HTTP. Remove inaccurate scope/CORS claims and any unused route plumbing after confirming references.
- Add clean-install checks using built npm tarballs and Python wheels in directories outside the monorepo, without workspace symlinks. Check package exports, data lookup, and one real example calculation.

**Acceptance:** A fresh user can fetch the documented static example, install each package, run both worked examples, and replay a custom scenario through a supported adapter without maintainer help.

## 5. Release and prove the same reviewed build everywhere

**Files:** `.github/workflows/publish-fixtures.yml`, `publish-mcp.yml`, `deploy.yml`, `deploy-mcp.yml`, `packages/sandbox-mcp/scripts/smoke.mjs`, MCP health/transport code, and release tooling.

- Check registry ownership/publishing access, the npm release credential arrangement, and PyPI Trusted Publisher configuration. Treat these as release prerequisites; their configuration has not yet been verified. Build and validate distributable artifacts before publication.
- Publish fixture packages before publishing the MCP package that depends on them. Use the root version and existing tag-consistency checks. Confirm registry installation after publishing, rather than relying only on a successful workflow.
- Extend MCP deployment dependencies to shared generators, domain schemas, persona/pool inputs, and build tools. The current change filter can miss these inputs.
- Deploy artifacts from the exact validated trusted commit. Prevent a later unvalidated `main` tip from replacing the version that passed CI; retain protections against untrusted workflow inputs.
- Expose deployed revision, corpus version, date, per-domain pins/hashes, and tool catalogue identity in health metadata. Ensure hosted MCP includes the locally implemented ATM tool and domain filter.
- Replace the tool-count-only smoke gate with required-tool names and synthetic reads for banking, motor insurance, a secondary bank, and ATM. Compare representative live fixture hashes with the release manifest and validate their schemas.
- Run repository CI under the declared CI runtime, then browser/a11y/Arabic checks. Complete cross-browser and mobile-performance checks for the staged release, including the previously unperformed coverage. Keep visual and performance evidence distinct from schema correctness.

**Acceptance:** Registry packages, public explorer, fixtures, embeds, and hosted MCP expose the same release context. Copyable URLs work, required tools exist, and post-release synthetic journeys pass. Save the previous deployable artifact for rollback.

This completes the first correctness release. Public publishing and deployment are final release actions after a concrete reviewed build is ready.

## 6. Add portable application testing and reliable MCP retrieval

**Files:** New shared modules under `src/core/`, a local mock-server tool/package, existing custom-persona handlers, `packages/sandbox-mcp/src/server.mjs`, `session.mjs`, and integration examples.

- Move portable envelope and scenario logic out of the UI-owned module into a shared core, retaining compatible import paths during the change. Extract large modules only around the areas being changed; a broad frontend rewrite is unnecessary.
- Provide a local HTTP adapter using that core for curated/custom scenarios and real query-driven pagination. Keep the public explorer static.
- Add deterministic harness scenarios for empty/short history, optional-field absence, permission loss, simulated consent expiry/revocation, latency, rate limits, and temporary failures. Use pinned error contracts where defined. Harness controls and expected results live outside canonical API properties.
- Preserve the UAE control model in simulated consent journeys: API Hub authority, with clearly simulated state. Do not teach direct TPP-to-LFI token issuance or independent LFI consent ownership.
- Give MCP exhaustive transaction retrieval an opaque cursor tied to scenario and filters. Order by stable timestamp/ID keys; handle equal timestamps without duplicates or omissions. Report total/matched/returned counts and truncation.
- Define numerical summaries by period, booking status, and currency, and retain source record IDs. Do not aggregate currencies into one unexplained number.

**Acceptance:** An external application can replay success and failure cases, traverse every page, and verify expected results. MCP can exhaust equal-timestamp datasets and answer a known financial question with a complete evidence trail.

## 7. Turn the corpus into useful learning and evaluation

**Files:** Explorer/compare UI modules, new lab content and runners, worked examples, enrichment packaging, analytical exporters, generated types, and documentation.

- Add three guided labs using existing personas: income/fixed commitments, multi-bank SME reconciliation, and consent-aware personal finance. Include working code, expected observations, an answer key, and insufficient-evidence cases.
- Extend comparison to show effects on a use-case result, with source fields and calculations. Avoid uncalibrated confidence scores or institution-specific claims.
- Add a combined banking/insurance lab covering premium commitments, renewal dates, declared cover, and unknown information. Keep results descriptive.
- Package observed data separately from evaluation labels. Hidden merchant/MCC truth must not be available to the algorithm under evaluation. Include transfer, refund, income, categorization, and abstention cases; split holdouts by entity/persona family, not seed alone.
- Add numerical MCP evaluations checking source IDs, dates, currency, status, completeness, and justified abstention. Synthetic scores describe the synthetic test set only.
- Offer normalized CSV/table exports with stable joins and documented amount/date/null semantics. Generate useful payload types and expose the reusable validator from the reviewed schemas.
- Measure install/build cost and split optional banking, insurance, or evaluation data packs while retaining a compatible full-corpus option. Keep snapshot reproducibility and Python/Node parity.

**Acceptance:** Target users complete a useful task without maintainer assistance, can explain the effect of missing data, and can measure their own algorithm against known answers. Validate the proposed five-minute first-result target through observed user sessions.

## 8. Keep documentation and the Open Finance skill accurate

**Repository files:** `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `PRD_OF_Data_Explorer.md`, `/about`, `/integrate`, package docs, changelog, and the Commons catalogue where maintained.

- Reconcile counts, 24-month history, package availability, hosting paths, Service Worker claims, domain coverage, deployment versions, and supported adapters.
- Amend the PRD for scenario identity/snapshots, the local mock adapter, labs, evaluation packs, and any narrowly scoped schema normalization. Retain the v2.1 baseline decision.
- Review `noindex` as an explicit publication-stage choice after the corrected public experience is verified.
- Extend the existing analytics allowlist only for meaningful task/lab completion and integration choices, preserving anonymous operation. Supplement it with voluntary feedback; do not claim cross-session retention from the current design.

**Installed skill files:** `/Users/michartmann/.agents/skills/open-finance-uae/SKILL.md`, `references/standards-versions.md`, `references/verification-log.md`, and `scripts/check_current.py`.

- Record official Errata 4 and the rc2-documentation/rc1-repository discrepancy, with dated source evidence.
- Extend freshness checks to official page revisions and substantive changes within an existing errata group. Compare version numbers numerically, distinguish stable and preview lines, and make source disagreement/unavailability explicit.
- Keep the wire schema as the authority for exact fields where prose differs, such as insurance adjustment direction.

The skill refresh is a separate deliverable outside the application repository, with its own verification log.

## Reviewable change sequence

1. Baseline provenance, shared validator, and recorded upstream-schema diagnosis.
2. Envelope corrections, strict conformance gates, and applicable spec uplift.
3. Posted ledger, completed statement periods, shared clock, and scenario identity.
4. Fixture links, clean installs, documentation, release parity, and the first correctness release.
5. Portable mock, failure scenarios, and MCP pagination/calculation completeness.
6. Guided labs, outcome comparison, and combined insurance example.
7. Evaluation packs, normalized exports/types, and optional corpus packaging.
8. Skill freshness update and ongoing documentation/feedback integration.

Each change should state its requirement IDs, affected output, verification, and unresolved dependencies. Corrected data gets a new corpus version; immutable releases preserve old citations. Product improvements follow demonstrated user value rather than increasing the persona or endpoint count as an end in itself.
