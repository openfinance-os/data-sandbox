# Open Finance specification audit

**Checked:** 8 October 2026. **Sandbox baseline:** `47873dd591b8263c5e95c7a17a912d149c0fa4de`. Used the [Open Finance UAE skill](/Users/michartmann/.agents/skills/open-finance-uae/SKILL.md), its freshness checker, and its per-file errata resolver. Application code and vendored specifications were not changed.

**Conclusion:** The sandbox is not fully aligned with the latest published corrections. Banking misses a correction within its existing errata2 folder, insurance uses an older file, and insurance/ATM exports fail literal schema validation even against their current pins. Updating version labels alone would leave these payload problems unresolved.

## Which specification is current?

The sources currently disagree about publication progress:

| Source checked directly                           | Observed state                                                                                                      | Consequence                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Official consolidated v2.1/API Hub v8 errata page | Page version 7; updated 18 September 2026; includes **Errata 4**, dated 18 September                                | The skill's statement that errata3 is the latest published correction is stale                             |
| Community v2.1 errata register                    | Errata1–3; 23 corrections                                                                                           | This register alone misses the official Errata 4 update                                                    |
| Canonical `api-specs` repository, `main`          | Commit `a3c8b8bf22e080046a8e0fbd9933f57431604155`, 21 August; v2.1 folders through errata3; preview folder v2.2-rc1 | Resolve available wire files separately; there is no errata4 folder to select here                         |
| Community TPP documentation and version changelog | Advertises **v2.2-rc2**                                                                                             | A release candidate is visible, but its matching account-information file returned 404 on canonical `main` |

The official record instructs participants to apply its corrections alongside v2.1 and API Hub v8. Relevant Errata 4 items include insurance premium-adjustment direction and service ratios above 100, insurance quote/KYC lifecycle changes, and a product-mapping clarification. Some affect write operations or LFI/API Hub integration outside this sandbox's read-only scope.

The effective GitHub insurance errata3 file already incorporates some changes described under official Errata 4. **Document errata numbers and repository folder names are therefore not a reliable one-to-one mapping.** Select a file by content, provenance, and applicable correction, rather than relabelling every domain “errata4.”

The skill's `check_current.py --json --no-cache` returned `FRESH`, because it compares the repository and community register, which both still report errata3. That result does not cover the official consolidated page. Its preview description also stops at rc1, while the community documentation advertises rc2. The skill should be refreshed and its checker extended to the official record; this audit did not edit the installed skill.

Sources: [Official consolidated errata](https://openfinanceuae.atlassian.net/wiki/spaces/OF/pages/1366294554/Standards+V2.1+API+Hub+V8+-+Consolidated+Errata), [community register](https://nebras-open-finance.com/tech/release-notes-and-erratas/erratas/v2.1/), [canonical repository](https://github.com/Nebras-Open-Finance/api-specs/tree/a3c8b8bf22e080046a8e0fbd9933f57431604155/dist/standards), [TPP documentation](https://nebras-open-finance.com/tech/tpp-standards), [version changelog](https://nebras-open-finance.com/tech/release-notes-and-erratas/changelog/v2.1-to-v2.2).

## Domain-by-domain status

| Domain    | Sandbox pin                                                                 | Effective available v2.1 file                           | Assessment                                                                                                                             |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Banking   | errata2, SHA `52caa147fa754f6b898757e4c39976574b755d66`, retrieved 20 May   | Current content of the errata2 account-information file | Correct folder, older content: `AESupplementaryData` is still a closed empty object locally; current upstream permits extension fields |
| Insurance | errata1, SHA `bc1cd976956d97195c5000235125cb65aca6aec8`, retrieved 30 April | Insurance file under errata3                            | Behind the effective file; lacks adjustment direction, policy-ID format relaxation, and revised service-rating schemas                 |
| ATM       | Base v2.1, SHA `ebde95804d9bf2a13d065804ea64334b673223ca`, retrieved 20 May | Base v2.1 ATM file                                      | Vendored file is byte-identical to current upstream; emitted envelope has a separate defect                                            |

The browser's live `/dist/domains.json` advertises the same old per-domain versions and pins. The public manifest uses the banking SHA as its top-level spec identity. Hosted MCP's exact deployed revision remains unreported, and its tool catalogue differs from local code as described in the main review.

Insurance wire differences verified directly:

- `Premium.Adjustments.CreditDebitIndicator` is an optional **string enum**, `Credit` or `Debit`; omitted means Debit. Amount remains unsigned. Do not implement it as a boolean merely because the official errata's prose calls it one.
- The insurance-policy identifier no longer requires UUID formatting; UUID v4 is recommended. This does not establish that every quote identifier or write-operation parameter has been relaxed.
- Claim settlement/rejection percentages use a percentage schema bounded from 0 to 100. The generic rate/ratio schema no longer has a maximum of 100.

These are contract and example-coverage changes; preserving the same old samples would not demonstrate the new optional cases to users.

## Do the payloads actually conform?

I validated **5,448 unique emitted files** referenced by the fixture manifest at resolved endpoint paths. Duplicate aliases, enrichment sidecars, and unreferenced build artifacts were excluded. The corpus was generated in a disposable copy of the reviewed commit.

The checker resolved each endpoint's actual GET 200 JSON schema from OpenAPI, retained `additionalProperties: false`, and recursively stripped only underscore-prefixed sandbox annotations. It applied the same OpenAPI-to-AJV conversions as the repository tests. OpenAPI's custom `decimal` format was accepted while its schema patterns and bounds remained enforced.

| Domain                                    | Files checked | Failures against pinned file | Failures against effective available v2.1 file |
| ----------------------------------------- | ------------: | ---------------------------: | ---------------------------------------------: |
| Banking, including role bundles           |         3,936 |                            0 |                                              0 |
| Insurance, including multi-domain bundles |         1,509 |                        1,116 |                                          1,116 |
| ATM, three profiles                       |             3 |                            3 |                                              3 |

Every checked file had an endpoint-schema mapping. This is a literal schema check; it does not prove all financial semantics or certification requirements.

### Confirmed sandbox defects

1. **Insurance metadata is invalid on affected endpoints.** [export.js:364](/Users/michartmann/Documents/GitHub/data-sandbox/src/ui/export.js:364) adds `Meta.TotalPages` indiscriminately. Policy detail, payment detail, quote, and consent-detail responses use the closed `Meta` schema, which declares no such property. All 1,116 failing insurance envelopes exhibited this problem.
2. **ATM has an unsupported root property.** [export.js:385](/Users/michartmann/Documents/GitHub/data-sandbox/src/ui/export.js:385) adds `Links`, although `AEReadAtms1` allows only `Data` and `Meta`. Being absent from `required` does not make an undeclared property optional when the schema is closed. All three profiles fail for this reason.
3. **Existing tests relax the rules that would catch these defects.** [insurance validation:51](/Users/michartmann/Documents/GitHub/data-sandbox/tests/spec-validation.insurance.test.mjs:51) and [ATM validation:35](/Users/michartmann/Documents/GitHub/data-sandbox/tests/spec-validation.atm.test.mjs:35) delete `additionalProperties: false`. The strict rendered-file sweep covers banking. The previously passing suites therefore do not establish strict insurance/ATM conformance.

Representative public insurance and ATM files were byte-identical to the locally checked files. These are deployed examples, rather than hypothetical future failures. The sampled public banking file also matched and its schema check passed.

### Upstream insurance schema issue

The insurance quote-read union also has `additionalProperties: false` on a `oneOf` wrapper without declaring properties at that wrapper level. Under literal JSON Schema evaluation, properties declared only inside the selected branch do not satisfy that enclosing closure rule. This contributes errors independently of the sandbox's invalid `Meta`.

Treat that as an upstream schema issue requiring clarification, not as evidence that every reported branch error is a generator defect. The insurance failure counts above remain meaningful because the invalid `Meta.TotalPages` independently affects each of those envelopes. Diagnostic checks of a quote's selected status branch must be kept separate from literal whole-response validation; an evaluator must not silently remove all closure rules and call the response conformant.

## Recommended correction plan

1. Fix domain-specific envelopes in `src/ui/export.js`: metadata according to the endpoint's actual schema, and no undeclared ATM `Links` property in the canonical payload. Keep useful navigation in sandbox annotations or UI state.
2. Extend strict emitted-file validation to every domain, preserving schema closure and asserting that no endpoint is silently skipped. Keep an explicit record of any narrowly scoped upstream-schema workaround.
3. Review the current banking and insurance files against official Errata 4, then update YAML, per-domain pins, retrieval metadata, and `tools/domains.config.mjs`. Confirm string enums and exact identifier types from wire schemas where prose disagrees.
4. Rebuild field metadata, fixtures, packages, browser assets, and MCP from that reviewed baseline. Prove parity on public deployment with file hashes, schema validation, per-domain pins, and remote tool discovery.
5. Extend `tools/check-spec-drift.mjs` and the skill checker to compare relevant file content **and** the official consolidated errata. A matching folder/version label is insufficient. Monitor release-candidate documentation separately from the supported stable corpus.

The v2.2 preview introduces material future changes, including required transaction narratives. The present Sparse profile is based on v2.1 optionality. A future preview corpus must derive required fields from its own resolved schemas and clearly display its preview status; changing the default baseline requires a deliberate PRD decision.

## Evidence and limits

The [machine-readable audit evidence](/Users/michartmann/Documents/GitHub/data-sandbox/reports/open-finance-spec-audit-evidence-2026-10-08.json) records source revisions, hashes, the checker result, schema-validation totals and examples, and public-file comparisons.

The earlier main suite results remain valid as test-run results. This follow-up corrects the broader inference that all emitted domain payloads were strictly spec-valid. The main review has been amended accordingly.

No application changes, specification migration, skill update, or deployment was performed. Release-candidate documentation and canonical repository content have not been reconciled by their publisher in the sources checked here. No live Trust Framework/API Hub certification flow was exercised.
