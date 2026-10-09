# Reviewed standards baseline and normalization

Verified 8 October 2026: official consolidated Errata 4, page 1366294554 v7, modified 18 September. Canonical api-specs main is a3c8b8bf22e080046a8e0fbd9933f57431604155. Per-file resolution is recorded in `spec/provenance.json`.

| Correction | Applied treatment | Scope/evidence boundary |
|---|---|---|
| Product mapping and permissions | Retain schema-derived product data/finance-rate fields | Read-only data; no claim of payment/permission certification |
| KYCCaptured ownership | Simulated authority remains API Hub; quote samples use PolicyIssued | TPP captures KYC; emulator does not issue real consent/tokens |
| Premium adjustment direction | Optional CreditDebitIndicator enum Credit/Debit; unsigned amount, absent direction means Debit | Wire enum is authoritative; official prose calls it boolean |
| Policy/quote identifiers | PolicyId UUID format relaxed in reviewed insurance wire file | Do not infer every QuoteId or other ID format is relaxed |
| Multiple KYC documents | Not emitted as an invented read property | Write operations outside the read-only corpus |
| Ratios above 100 | Generic ratios have no max100; claim settlement/rejection percentages remain 0..100 | Preserve the distinct schema types |
| Payment/CX corrections | Documented as outside corpus certification | A synthetic emulator is not a live Hub/LFI implementation |

## Literal versus normalized quote conformance

Insurance SHA-256 `1191bba351eefd29aff91f461ba8bda2d8bb2e554adba4d4f89718d9987a1818` is the only normalization-eligible source. Two QuoteReadResponseProperties wrappers close objects without declaring branch properties. Twenty-two status branches use allOf with a closed base that excludes their sibling QuoteStatus. Literal validation rejects legitimate branch fields.

The consumer adapter flattens only those named status branches, merging their declared properties and required arrays, and declares the property union on the two wrappers. Branch enums, required constraints and additionalProperties:false remain. Pending still accepts only its own branch fields. Unknown properties, invented status, incorrect Meta fields and a changed schema hash are negative tests.

No additionalProperties keyword is removed globally. Source YAML remains byte-identical to canonical wire files. Parser/type derivation uses the documented composition adapter and derives conditional status from alternative required arrays. Dated review evidence preserves the original diagnosis. A proposed upstream correction would apply the same closure-aware composition repair; no upstream issue or message has been sent.

Generated insurance detail/quote/consent Meta is empty; list Meta may include TotalPages. ATM has Data and Meta without invented Links. Banking fields are unchanged apart from reviewed source/schema updates. All rendered primary and role files are mapped, compiled and validated; a missing mapping/build/compile is a failure.

The exact proposed repair is saved as `docs/insurance-quote-normalization.patch.json` (24 component replacements). Building payload types saves the complete transformed schema as `packages/sandbox-fixtures/schemas/insurance.normalized.json`; raw YAML remains unchanged. Tests exercise all 24 generic/health status alternatives, mandatory removal and closure. These are schema-shape tests, not certification of business-state transitions.

Standing-order frequencies now use `IntervalMonthDay:1:<day>` for their observed monthly dates, following the pinned UAE Frequency description. The raw source places its frequency regex inside description text rather than an enforceable pattern, so schema acceptance alone would not catch the former legacy `EvryDay:01:01` value. Analytical consumers treat unknown frequency or amounts as insufficient evidence.
