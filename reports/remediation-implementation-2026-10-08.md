# Data Sandbox remediation implementation

**8 October 2026 — unpublished candidate.** Application source and local distributables are at `46b4138cf4eeb2cc11c71bae485cd8698a1d0c3b`, on `codex/sandbox-remediation`. [Draft PR #118](https://github.com/openfinance-os/data-sandbox/pull/118) contains the changes. The original review, specification audit and approved plan remain historical baseline documents.

The sandbox now provides a coherent synthetic corpus and useful application-testing tasks. The implementation fixes wire-envelope errors, posted-money calculations, competing clocks, fixture discovery, and incomplete numerical retrieval. It adds a portable mock, four labs, evidence-aware comparisons, evaluation inputs, tables and types. Public publication and deployment have not occurred. Real-user task completion and production performance are still unverified.

## Delivery against the approved plan

| Plan phase | Delivered and locally verified | Remaining boundary |
| --- | --- | --- |
| 1. Standards and validation | Effective per-domain wire files, immutable upstream hashes, official Errata 4 evidence, strict shared validator, exact quote-normalization patch, live drift checker | Upstream must repair the literal insurance quote composition defect; normalized acceptance is explicitly distinguished from literal-source conformance |
| 2. Wire envelopes | Endpoint-specific insurance metadata; ATM without undeclared Links; corrected premiums/claims fields; mandatory/unknown-field negative cases; complete emitted-file validation | No unexplained local schema failures; the documented quote-source dependency remains |
| 3. Financial coherence and replay | Integer minor units; Booked-only ledger; completed and continuous statements; currency-aware settlement; shared 1 May 2026 clock; full scenario identity; corpus-version URLs; retained candidate archives | Official historical release archives must be retained when publishing; the static `/fixtures/v1/` alias remains mutable |
| 4. Integrations | Deployment-prefix-aware paths; published seed/role membership; working staged examples; unsupported paths return 404; custom downloads/runtime/mock; clean npm/wheel clients | Public registry and deployed-origin journeys await publication |
| 5. Release parity | Trusted successful-main-CI revision selection; expanded deployment inputs; dependency publication ordering; revision/pins/catalogue health; four real HTTP synthetic read checks; local rollback baseline | Publisher ownership/authentication, final release review, and actual post-release parity remain gates |
| 6. Application testing and MCP | Curated/custom/role HTTP scenarios; complete opaque-cursor retrieval; empty/short/sparse/error/consent cases; explicit simulated API Hub authority; currency/status/period summaries and source evidence | Transport controls are simulations, not a real consent service or regulatory sandbox |
| 7. User value | Income, SME reconciliation, consent and combined insurance labs; answer keys; Rich/Sparse outcome comparison; label-separated evaluation; CSV joins; payload types; reusable validator; optional data archives | Five-minute first-result target and usefulness need observed sessions with potential users; synthetic scores do not establish real-world accuracy |
| 8. Documentation and skill | Root/package/integration documentation, PRD amendments, changelog, anonymous completion allowlist, installed Open Finance skill freshness refresh | `noindex` is retained until the corrected public experience is verified; non-standards skill pricing/legal references were not re-audited |

## Standards result

The stable baseline remains v2.1 with applicable [official consolidated Errata 4](https://openfinanceuae.atlassian.net/wiki/spaces/OF/pages/1366294554/Standards+V2.1+API+Hub+V8+-+Consolidated+Errata), dated 18 September 2026, page revision 7. Canonical API files at upstream commit `a3c8b8bf22e080046a8e0fbd9933f57431604155` resolve to banking errata2, insurance errata3, and the unchanged base ATM file. The folder name alone is not the correction baseline. Documentation's v2.2-rc2 and the repository's rc1 are recorded as a preview disagreement; neither is adopted as stable.

Exact evidence is in [provenance](/Users/michartmann/Documents/GitHub/data-sandbox/spec/provenance.json) and the [conformance matrix](/Users/michartmann/Documents/GitHub/data-sandbox/docs/standards-conformance.md). Corrections include unsigned adjustments with string Credit/Debit direction, non-UUID insurance resource identifiers, generic ratios above 100 where allowed, valid endpoint envelopes, and monthly standing-order frequency semantics.

The insurance adapter is keyed to the exact source hash. It addresses only the diagnosed closed `allOf`/`oneOf` quote compositions, preserves mandatory/status/allowed fields, and rejects injected unknown properties. Tests exercise all 24 generic/health quote-status alternatives, required-field removals, unknown fields and changed-source-hash refusal. The exact [proposed patch](/Users/michartmann/Documents/GitHub/data-sandbox/docs/insurance-quote-normalization.patch.json) and generated normalized schema are saved. The raw vendored YAML remains byte-identical to upstream, including its trailing whitespace; hand-authored changes pass whitespace checks separately.

The installed [Open Finance skill](/Users/michartmann/.agents/skills/open-finance-uae/SKILL.md) and its version references, verification log and checker were refreshed. Its final live check reports `VERIFIED_WITH_SOURCE_DISAGREEMENT`, with no unexpected changes or source errors. It now checks official page revision/substantive content and per-file hashes, orders versions numerically, distinguishes previews, and reports unreachable sources as unverified. This skill deliverable is outside the Git repository.

## Verification evidence

- Node 22.23.1 local `CI=true npm run ci`: **2,206 core tests, 120 MCP tests and 20 Python tests passed**. Generated files match the committed sources; strict conformance, field/privacy/realism lint, formatting and workflow syntax checks pass. Python was 3.12 locally; Linux CI supplies the separate runtime evidence.
- **6,399 unique manifest-referenced envelopes**: 3,936 banking, 2,460 insurance and 3 ATM, across 117 primary and 96 role scenarios. The builder checks all 6,428 emitted canonical/alias JSON files before accepting them. Missing mappings and schema compilation errors are fatal.
- Final functional browser run: **330 passed, 10 existing skips**, across Chromium, Firefox, WebKit, mobile Chrome and mobile WebKit. This includes accessibility, Arabic/RTL, copied HTTP examples, custom personas, export/keyboard journeys, labs and corpus-version refusal. The skips cover existing tour-refresh/clipboard/mobile-view coverage gaps; they are not reported as passes.
- Final external installations: npm fixture and MCP tarballs, TypeScript positive/negative contracts, strict reusable validation, an actual posted-money calculation, MCP CLI and a clean Python wheel client passed without workspace links.
- Final real MCP HTTP smoke: all 51 required tool names, exact expected revision, corpus/pins/catalogue identity, and actual banking, motor-insurance, secondary-bank and ATM reads passed with release-fixture hash and schema comparisons. This was local HTTP, not a production claim.
- Seven lab executions passed: income, reconciliation and insurance cover under Rich/Sparse, plus consent revocation. The consent runner returns no current financial answer after the simulated denial. Insufficient-evidence answers remain explicit.
- Evaluation separation/holdout checks pass: 98,625 training and 6,213 holdout records. Observed inputs omit underscore labels; labels are separate. Persona-family/merchant holdouts keep correlated variants together. Generator-specific shortcuts and synthetic-to-real generalization remain limitations.
- CSV exports for the trading SME and combined Takaful persona were read back and their account joins checked. Tables include accounts, transactions, balances, statements, commitments and policies; unknown cells stay blank and amounts retain currency/direction.
- All domain/full archive manifests carry the same candidate revision and all referenced files are present. Changed canonical bytes under an existing corpus version are rejected. Checksum inventories are retained.

The first Linux PR CI run passed core tests, workflow lint, CodeQL, Lighthouse and all 330 functional browser cases. Five old screenshots differed because of corrected dates/calculations, new comparison copy, and the Labs link. The images were inspected individually against their old baselines. The Labs link is being integrated into the existing menu to preserve pane space; reviewed Linux baselines and a final CI rerun are pending. Local macOS functional checks do not replace Linux visual acceptance.

## Performance and distribution cost

The explorer startup uses a small published-scenario membership index instead of blocking on the full 1.7 MB endpoint manifest. Monthly calculation code loads when transactions are opened. Initial header space is reserved, and the About layout prevents long revision hashes from widening the mobile viewport. The existing deterministic **250 KB** asset gate and Lighthouse thresholds are retained.

Final local mobile-simulation scores across three runs:

| Page | Performance | Layout shift | LCP |
| --- | --- | --- | --- |
| Explorer | 0.81–0.82 | 0.173 | 3.18–3.31 s |
| About | 1.00 | 0 | 1.505–1.506 s |
| Embed | 0.95–0.97 | 0.071 | 2.28–2.72 s |

The explorer improved from the initial local 0.63–0.69 result but still falls below the **0.90 product target**. That remains an open improvement, alongside actual CDN/mobile measurement. Passing the existing CI threshold does not establish production acceptance.

Local distributables are approximately 9.38 MB for npm fixtures, 44.8 KB for MCP, and 18.33 MB for the Python wheel. Candidate data archives are 9.28 MB banking, 0.86 MB insurance, 31 KB ATM, 11.76 MB full, and 6.55 MB optional evaluation. These are downloadable data packs; the individual domain archives are not separate published npm runtimes.

## Remaining release and user-validation work

1. Confirm ownership of the npm scope/package names and PyPI project, configure npm publication and PyPI Trusted Publisher, and review the candidate. Public npm package lookups and the PyPI JSON lookup returned 404; local npm publishing authentication returned `ENEEDAUTH`. No npm token was observed in the repository/production environment metadata previously inspected. Organization-level secrets and Trusted Publisher ownership are still unverified.
2. Publish fixtures before the dependent MCP package from the exact validated trusted main revision; then verify registry installs. Publish the reviewed site and MCP, compare their revision/corpus/date/pins/representative fixture hashes, and run the copied URL, embed and synthetic read journeys on the deployed origins.
3. Retain the actual previous production artifact for rollback. The saved `47873dd` archive is the locally built reviewed baseline, not proof of the exact last production deployment.
4. Continue explorer performance work and measure the deployed mobile profile. Run voluntary sessions with target developers, analysts and educators to validate the five-minute useful-result target, unknown-data understanding, and lab usefulness. No outreach, real-user research or retention claim was made.
5. Revisit `noindex` after public verification, and retire the quote adapter when a verified upstream correction becomes available. The saved patch is prepared for review; no external issue or message was sent.

The [machine-readable implementation evidence](/Users/michartmann/Documents/GitHub/data-sandbox/reports/remediation-implementation-evidence-2026-10-08.json) indexes the local logs, checksums and candidate artifacts. This report records local implementation readiness and external gates separately.
