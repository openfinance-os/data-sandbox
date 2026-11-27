# PRD Spec Validation — OF Sandbox Explorer

> **Status: APPLIES TO PROTOTYPE HTML, not to PRD v0.8+.** PRD §7.4 examples (`Flags=Payroll`, `IsShariaCompliant`, `IsSalaryTransferRequired`, etc.) are already v2.1-correct. The prototype-correction list in this doc is actioned during the Phase 0 prototype-hygiene tasks (PRD §11). The build-time spec-shape check is captured in PRD §6.3 and R-EXP-08. Retained for the prototype-correction checklist.

| Field | Value |
|---|---|
| **Document type** | Companion to `PRD_OF_Data_Explorer.md` (v0.3) |
| **Version** | 0.2 — re-validated against upstream Nebras v2.1 spec |
| **Date** | 28 April 2026 |
| **Author** | Woven Product (Michael Hartmann) |
| **Spec source used** | **`uae-account-information-openapi.yaml` v2.1** — pulled from `github.com/Nebras-Open-Finance/api-specs/tree/ozone/dist/standards/v2.1` (commit on `ozone` branch as of validation date). 6,213 lines, 225 KB. |
| **Earlier draft (v0.1) used** | Locally-vendored Ozone Connect Release 2024.34 (`da-of-api/cbuae-api-specs/cbuae-ozone-connect-data-sharing.yaml`) — older. Findings have been re-derived against upstream v2.1 below. |
| **Verdict** | PRD framework is sound. The prototype's hand-coded `SPEC` object is **closer to v2.1 truth than the earlier validation suggested** — PascalCase field naming is correct (it's Ozone Connect 2024.34 that used camelCase, not v2.1). However, several enum values, the endpoint inventory, and a few mandatory sets are still wrong. All errors are mechanical and resolved by EXP-01 — generating from the spec, not authoring by hand. |

---

## 0. The most important conclusion

**EXP-01 — derive field metadata from the published OpenAPI spec, not from hand-authored tables — is exactly the right call.** Every error found below would have been caught at build time by EXP-01. Build the v1 generator off the upstream Nebras YAML directly and most of this section becomes a non-issue.

---

## 1. Spec sources — the actual ground truth

| Source | URL | Version | Use for |
|---|---|---|---|
| **Upstream Nebras OF Standards (v2.1)** | `github.com/Nebras-Open-Finance/api-specs/blob/ozone/dist/standards/v2.1/uae-account-information-openapi.yaml` | **v2.1** (Account Information API) | **Authoritative source for v1 build** |
| Upstream — Product API | `…/v2.1/uae-product-openapi.yaml` | v2.1 | Product detail when surfacing the per-account product endpoint |
| Upstream — Bank Service Initiation | `…/v2.1/uae-bank-initiation-openapi.yaml` | v2.1 | Out of scope for v1 (payments) |
| Upstream — Insurance | `…/v2.1/uae-insurance-openapi.yaml` (833 KB) | v2.1 | Out of scope for v1 |
| Upstream — Account Opening (Service Init) | `…/v2.1/uae-account-opening-service-initiation-openapi.yaml` | v2.1 | Out of scope for v1 |
| Upstream — FX Service Initiation | `…/v2.1/uae-fx-service-initiation-openapi.yaml` | v2.1 | Out of scope for v1 |
| Upstream — CoP, ATM, Auth, Webhook | `…/v2.1/uae-{confirmation-of-payee, atm, authorization-endpoints, webhook-template}-openapi.yaml` | v2.1 | Out of scope for v1 |
| Locally vendored Ozone Connect | `da-of-api/cbuae-api-specs/cbuae-ozone-connect-data-sharing.yaml` | Release 2024.34 | **Older — do not use as the v1 source.** Use only as a cross-reference when migrating. |
| Woven internal TPP gateway | `of-tpp-api.wiki/openapi.yaml` | v2.0 (Woven internal) | Our consumption layer — not the standard. Not the right input. |

The Account Information API in v2.1 is the singular file the sandbox needs. Pull it at build time; pin the commit SHA so the explorer's version label is reproducible.

---

## 2. Endpoint coverage — gaps vs. v2.1

The v2.1 Account Information API exposes **13 read endpoints** (plus consent management). The PRD lists six.

| Endpoint | In PRD / prototype? | v2.1 Status | Action |
|---|---|---|---|
| `GET /account-access-consents` | n/a (TPP-flow, not sandbox-flow) | Mandatory | Skip — sandbox is consumption-side, not consent-management-side |
| `GET /account-access-consents/{ConsentId}` | n/a | Mandatory | Skip |
| `PATCH /account-access-consents/{ConsentId}` | n/a | Mandatory | Skip |
| `GET /accounts` | ✅ | Mandatory | OK |
| `GET /accounts/{AccountId}` | ✅ (implicit) | Mandatory | OK |
| `GET /accounts/{AccountId}/balances` | ✅ | Mandatory | OK |
| `GET /accounts/{AccountId}/beneficiaries` | ✅ | Mandatory | OK |
| `GET /accounts/{AccountId}/direct-debits` | ✅ | Mandatory | OK |
| **`GET /accounts/{AccountId}/product`** (singular) | ❌ | Mandatory | **Add to v1.** Critical for credit underwriting — carries Charges, FinanceRates, DepositRates, IsSecured, IsSalaryTransferRequired (v2.1 new), Tenor (v2.1 new), AssetBacked, RewardsBenefits, ShariaStructure. |
| **`GET /accounts/{AccountId}/scheduled-payments`** | ❌ | Mandatory | **Add to v1.** Forward-dated payment commitments — relevant for affordability. |
| `GET /accounts/{AccountId}/standing-orders` | ✅ | Mandatory | OK |
| `GET /accounts/{AccountId}/transactions` | ✅ | Mandatory | OK |
| **`GET /accounts/{AccountId}/parties`** | ❌ | Mandatory | **Add to v1.** Multi-party detail per account — joint owners, custodians, attorneys (`AEReadParty2`). Important for joint-account underwriting. |
| **`GET /parties`** | ❌ | Mandatory | **Add to v1.** Single-party detail for the consenting user (`AEReadParty4`) — Party Identity Assurance / KYC. |
| **`GET /accounts/{AccountId}/statements`** | ❌ | Mandatory | **Add to v1.** Statements as documents. New resource type vs. PRD. |

**Net**: v1 scope grows from 6 to **10 endpoints** (excluding the 3 consent endpoints, which are TPP-flow not sandbox-flow):

1. `/accounts`
2. `/accounts/{AccountId}`
3. `/accounts/{AccountId}/balances`
4. `/accounts/{AccountId}/transactions`
5. `/accounts/{AccountId}/standing-orders`
6. `/accounts/{AccountId}/direct-debits`
7. `/accounts/{AccountId}/beneficiaries`
8. `/accounts/{AccountId}/product` ⬅︎ NEW
9. `/accounts/{AccountId}/scheduled-payments` ⬅︎ NEW
10. `/accounts/{AccountId}/parties` ⬅︎ NEW
11. `/parties` ⬅︎ NEW
12. `/accounts/{AccountId}/statements` ⬅︎ NEW

That's 12 if we include the singular `/parties` and the per-account `/parties` plural separately. **The Product, Parties, and Statements endpoints are particularly important for the credit-underwriting use case** — Product carries rates and fees, Parties carries KYC and joint-ownership detail, Statements is the document-level view.

**Recommended PRD edit**: rewrite `Appendix C — Endpoint inventory` to the 12-endpoint list and reword EXP-03 accordingly. Mention that `/parties` and `/accounts/{AccountId}/parties` are different endpoints (one returns the calling user's identity, the other returns the parties for a specific account).

---

## 3. Schema-by-schema validation against v2.1

### 3.1 Field-name casing — IMPORTANT CORRECTION

**v2.1 uses PascalCase**: `AccountId`, `Status`, `Currency`, `AccountType`, `AccountSubType`, `OpeningDate`, `MaturityDate`, `AccountIdentifiers`, `Servicer`, `IsShariaCompliant`, `CreditDebitIndicator`, `Type`, `DateTime`, `Amount`, etc.

The prototype's PascalCase matches v2.1. **The earlier (v0.1) validation report incorrectly said field names should be camelCase**; that was based on Ozone Connect 2024.34 which uses camelCase, not on v2.1 which uses PascalCase. v0.1 was wrong on this; this v0.2 supersedes it.

---

### 3.2 `AEAccountArrayId` (returned in `/accounts` list) and `AEAccountId` (returned in `/accounts/{id}`)

| Aspect | Prototype | v2.1 | Severity |
|---|---|---|---|
| Field-name casing | PascalCase | PascalCase | ✅ Correct |
| `AEAccountArrayId` mandatory set | 5 (AccountId, Currency, AccountType, AccountSubType, Account) | **Only `AccountId`** at the schema level. The spec note says Currency / AccountType / AccountSubType "must be populated by LFI for non-switched accounts" — soft requirement, not enum-level mandatory. | High — prototype over-states required-ness |
| `AccountType` enum | `[Business, Personal]` | **`[Retail, SME, Corporate]`** | **High — wrong values** |
| `AccountSubType` enum | `[ChargeCard, CreditCard, CurrentAccount, EMoney, Loan, Mortgage, PrePaidCard, Savings]` | **`[CurrentAccount, Savings, CreditCard, Mortgage, Finance]`** | High — `Finance` is new, `ChargeCard / EMoney / Loan / PrePaidCard` don't exist. `Loan` is replaced by `Finance`. |
| `Status` enum | `[Enabled, Disabled, Deleted, ProForma, Pending]` | **`[Active, Inactive, Dormant, Unclaimed, Deceased, Suspended, Closed]`** | **High — wrong values.** |
| Identifiers field name | `Account` (array) | **`AccountIdentifiers`** (array) | Medium — wrong field name |
| `Nickname` (capital N) | `Nickname` | `Nickname` | ✅ Correct |
| **NEW v2.1 field**: `IsShariaCompliant` | not modelled | Boolean Sharia flag | Add |

The `IsShariaCompliant` field is a v2.1-introduced "Extended Product Enhancement" — relevant for the UAE market and for credit underwriting on Islamic products.

---

### 3.3 `AEBalance` — close to right

| Aspect | Prototype | v2.1 | Severity |
|---|---|---|---|
| Mandatory set | 4 (Amount, CreditDebitIndicator, Type, DateTime) | **4 (`CreditDebitIndicator, Type, DateTime, Amount`)** | ✅ Match |
| Field naming | PascalCase | PascalCase | ✅ Correct (note: not `timestamp` like in 2024.34 — `DateTime` is correct in v2.1) |
| `Type` enum (AEBalanceTypeCode) count | 9 values | **13 values** — adds `ClosingCleared`, `InterimCleared`, `OpeningCleared`, `PreviouslyClosedBooked` | Medium |
| `CreditLine` (NB: singular, array of objects) — required | `[Included, Type, Amount]` | **`[Included, Type, Amount]`** | ✅ Match |
| `CreditLine.Type` enum | `[Available, Credit, Emergency, Pre-Agreed, Temporary]` | **same** | ✅ Match |
| **NEW v2.1 field**: `Components` (array of `AEAmountWithCategorization`) | not modelled | Per-component balance categorisation | Add |

The Balance schema is the closest to right. Only the enum is missing four values and the v2.1 `Components` array is not modelled.

---

### 3.4 `AETransaction` — most diverged schema

| Aspect | Prototype | v2.1 | Severity |
|---|---|---|---|
| Mandatory set | 9 (TransactionId, CreditDebitIndicator, Status, BookingDateTime, TransactionDateTime, TransactionType, SubTransactionType, PaymentModes, Amount) | **8** (`TransactionId, CreditDebitIndicator, Status, BookingDateTime, Amount, TransactionDateTime, TransactionType, SubTransactionType`) — note `PaymentModes` is **optional** in v2.1, not mandatory | Medium — prototype is too strict on `PaymentModes` |
| `TransactionType` enum | `[CardPayment, CashDeposit, CashWithdrawal, DirectDebit, FeeCharges, FPSOut, FPSIn, InternalTransfer, OnlinePayment, Payment, StandingOrder, TransferIn, TransferOut, Other]` | **`[POS, ECommerce, ATM, BillPayments, LocalBankTransfer, SameBankTransfer, InternationalTransfer, Teller, Cheque, Other]`** | **High — completely different enum.** Almost no overlap. |
| `SubTransactionType` enum (`AESubTransactionType`) | `[ChargePayment, Purchase, Refund, Reversal, TransferToSelf, TransferToOther, SalaryPayment, Other]` (8) | **`[Purchase, Reversal, Refund, Withdrawal, WithdrawalReversal, Deposit, DepositReversal, MoneyTransfer, Repayments, Interest, Fee, Charges, Profit, Disbursement, Adjustment, Tax, Rewards, NotApplicable, LeaseRepayment]` (19)** | **High — `SalaryPayment` does not exist in v2.1.** Spec way to identify salary is via `Flags=Payroll` (see below). |
| `PaymentMode` enum (singular schema, plural field `PaymentModes`) | `[NEFT, RTGS, IPS, Other]` | **`[Online, Offline, Batch]`** | **High — conceptually wrong.** Prototype confused this with payment-rail. The v2.1 field describes the *mode* (online/offline/batch), not the rail. |
| `Status` enum (`AEEntryStatusCode`) | `[Booked, Pending]` | likely `[Booked, Pending, Rejected]` (per Ozone Connect; need confirm in v2.1 — spec uses `$ref` to a code) | Medium |
| **`Flags` enum (CRITICAL)** | not modelled accurately | **`[Cashback, Payroll, DirectDebit, StandingOrder, Finance, Dividend, OpenFinance]`** | **High — `Payroll` is the spec way to flag a salary credit.** This is the correct salary-detection signal, not `SubTransactionType=SalaryPayment`. |
| `StatementReference` shape | string | **string** (in v2.1, this is the schema definition; in 2024.34 it was an array — they reverted) | Low — prototype matches v2.1 |
| `CreditorAccount` shape | object | **array of `AECashAccount6_0`** | Medium — prototype models as object, spec wants array |
| `BankTransactionCode` fields | `[Code, SubCode]` (2) | **6 fields** (`domain, domainCode, family, familyCode, subFamily, subFamilyCode` — full ISO 20022 categorisation tree) | Medium |
| `CardInstrument.cardSchemeName` enum | `[AmericanExpress, Diners, Discover, MasterCard, VISA]` (5) | **`[AmericanExpress, Diners, Discover, GCC, MasterCard, UPI, VISA]`** (7) | Medium — missing `GCC` (Gulf Co-operation Council scheme) and `UPI` (Unified Payments Interface, India), both relevant in UAE |
| `CardInstrument.instrumentType` field name + enum | `AuthorisationType` with `[ConsumerDevice, Contactless, None, PIN]` | **`InstrumentType` with `[ApplePay, Contactless, MagStripe, Chip, Other]`** | High — wrong field name and wrong enum |
| **NEW v2.1 field**: `Allocations` (`AEAmountWithCategorization`) | not modelled | Component-level transaction breakdown | Add |
| **NEW v2.1 field**: `PaymentPurposeCode` (`AEPaymentPurposeCode`) | not modelled | ISO 20022 payment purpose | Add |

**Critical note for the credit-underwriting narrative**: the prototype's "salary credit" detection relies on `SubTransactionType=SalaryPayment`, which **does not exist in v2.1**. The v2.1 way is `Flags` array contains `"Payroll"`. This is a spec-clean enum match — *easier* and more reliable than the heuristic I described in v0.1 of this report. The prototype's `genTransactions` salary logic should set `Flags: ["Payroll"]` on the salary credit transaction; the field-card "real-LFI guidance" for `Flags` should highlight `Payroll` as the salary identifier.

---

### 3.5 `AEStandingOrder`

| Aspect | Prototype | v2.1 | Severity |
|---|---|---|---|
| Mandatory set | 4 (StandingOrderId, Frequency, NextPaymentAmount, NextPaymentDateTime) | **5 (`Frequency, StandingOrderId, FirstPaymentDateTime, StandingOrderStatusCode, FirstPaymentAmount`)** | High — prototype's mandatory set is wrong. NextPayment* is optional; FirstPayment* is mandatory; StandingOrderStatusCode is mandatory. |
| Optional fields prototype is missing | — | `StandingOrderType`, `LastPaymentDateTime`, `LastPaymentAmount`, `FinalPaymentDateTime`, `FinalPaymentAmount`, `NumberOfPayments`, `Purpose`, `CreditorAccount` (array), `CreditorReference`, `AccountHolderName/ShortName`, `SupplementaryData`, `CreditorAgent` | Medium |
| `StandingOrderType` enum | not modelled | (per `StandingOrderType` definition in spec) | Add |
| Note vs. earlier validation | — | `FinalPaymentDateTime`, `FinalPaymentAmount`, `NumberOfPayments` are **OPTIONAL in v2.1** (they were mandatory in 2024.34) | Migration note |

---

### 3.6 `AEDirectDebit`

| Aspect | Prototype | v2.1 | Severity |
|---|---|---|---|
| Mandatory set | 3 (DirectDebitId, MandateIdentification, DirectDebitStatusCode) | **5 (`DirectDebitId, MandateIdentification, DirectDebitStatusCode, Name, Frequency`)** | High — prototype treats `Name` and `Frequency` as optional; v2.1 marks them mandatory |
| `Frequency` (FrequencyDD) enum | not modelled | distinct from StandingOrder Frequency | Add |
| `DirectDebitStatusCode` (AEExternalDirectDebitStatusCode) enum | enum not specified in prototype | distinct from AEAccountStatusCode | Add |

---

### 3.7 `AEBeneficiary`

| Aspect | Prototype | v2.1 | Severity |
|---|---|---|---|
| Mandatory set | 1 (BeneficiaryId) | **3 (`BeneficiaryId, BeneficiaryType, AddedViaOF`)** | High |
| `BeneficiaryType` enum | `[Trusted, Ordinary]` | **`[Activated, NotActivated]`** | **High — completely different values.** Spec semantics: whether SCA was used to add the beneficiary, not "trusted vs. ordinary". |
| **NEW v2.1 field**: `AddedViaOF` (boolean) | not modelled | Whether the beneficiary was added via an Open Finance payment vs. existing LFI channel | Add — flag of v2.1 origin |

---

### 3.8 `AEScheduledPayment` (NEW — was missing entirely)

Required: `ScheduledPaymentId, ScheduledPaymentDateTime, ScheduledType, InstructedAmount` (4).

`ScheduledType` enum (`AEExternalScheduleTypeCode`): `[Arrival, Execution]`. Optional: `AccountHolderName, AccountHolderShortName, CreditorReference, DebtorReference, CreditorAgent, CreditorAccount` (array).

---

### 3.9 `AEProduct` (NEW — was missing entirely; carries v2.1 Extended Product Enhancement)

No required block at the AEProduct level — most fields are optional, but the schema is rich and credit-relevant.

| Field | Type | Note |
|---|---|---|
| `ShariaStructure` | enum | **`[Ijara, ServiceIjara, Murabaha, Musharaka, Tawarruq]`** — Islamic finance contract type |
| `Charges` | `AEProductCharges` array | Fees and charges |
| `FinanceRates` | `AEProductFinanceRates \| AEJwe` | Lending rates (note: `FinanceRates`, not `LendingRates` in v2.1) |
| `DepositRates` | `AEProductDepositRates` | |
| `IsSecured` | boolean | Whether the product is secured by collateral |
| `IsSalaryTransferRequired` | boolean | **NEW v2.1** — relevant for salary-assigned lending products |
| `Tenor` | object{OriginalTenor, RemainingTenor} | **NEW v2.1** — product tenor in `AEDuration` |
| `AssetBacked` | `AEProductAssetBackedProducts` | |
| `RewardsBenefits` | `AEProductRewardsBenefitsProperties` | |

This is the highest-value endpoint to add for credit underwriting. The combination of `Charges + FinanceRates + DepositRates + IsSecured + Tenor + IsSalaryTransferRequired` lets a consumer reason about cost-of-credit and product eligibility against a clean schema.

---

### 3.10 `AEReadParty4` (single party, calling user) and `AEReadParty2` (per-account parties) — both NEW

These two endpoints expose Party Identity Assurance — KYC and verified claims per the OpenID Connect for Identity Assurance 1.0 specification. v2.1 carries identity evidence (documents, electronic records), assurance details, and account-role data (joint owners, custodians, attorneys).

For the credit-underwriting use case, `/accounts/{AccountId}/parties` is the joint-ownership and authority tree for the account — important for SME and family-account underwriting.

---

## 4. Recommended PRD edits (v0.4)

| # | Change | Section | Severity |
|---|---|---|---|
| 1 | Update endpoint inventory to **12 endpoints** (add `/product`, `/scheduled-payments`, `/parties` (×2), `/statements`) | Appendix C; EXP-03 | High |
| 2 | Refresh §7.4 examples table — fix the `AccountType` / `AccountSubType` / `Status` / `TransactionType` / `SubTransactionType` / `PaymentMode` enums; introduce `Flags=Payroll` as the salary-detection example | §7.4 | High |
| 3 | Add `EXP-23` — pin spec source to a specific commit SHA on `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/uae-account-information-openapi.yaml` and surface that pin in the top bar | §4 | Medium |
| 4 | Add `EXP-24` — provide a "v2.0 → v2.1 delta" view derived from spec diff (highlight added fields, changed enums, added endpoints) | §4 | Medium |
| 5 | Update §5.3 "real-LFI guidance" examples to match v2.1 enum values | §5.3 | High for credibility |
| 6 | Update §14 Dependencies — replace the vague "Standards v2.1-final spec" line with a concrete pin to the Nebras GitHub raw URL + commit SHA, and note the upstream spec is the singular technical input | §14 | High |
| 7 | New OQ-EXP-15: Should the sandbox track multiple Standards versions in parallel (v2.0, v2.1, future v2.2) so users can compare schema deltas? Recommendation: yes, version-toggle is in §11 Phase 2 already | §13 | Low |
| 8 | New OQ-EXP-16: How to consume Insurance v2.1 spec (833 KB) in the v2 expansion — single-file vs. split-file? | §13 | Low |

---

## 5. Recommended prototype edits

The cleanest move is to replace the hand-coded `SPEC` object with a build-time-generated one from the YAML, per EXP-01. Until then, the in-prototype `SPEC` should be brought in line with v2.1:

| # | Change | File / location |
|---|---|---|
| 1 | Replace `AccountType` enum with `[Retail, SME, Corporate]` | `SPEC.Account.AccountType` |
| 2 | Replace `AccountSubType` enum with `[CurrentAccount, Savings, CreditCard, Mortgage, Finance]` | `SPEC.Account.AccountSubType` |
| 3 | Replace `Status` enum with `[Active, Inactive, Dormant, Unclaimed, Deceased, Suspended, Closed]` | `SPEC.Account.Status` |
| 4 | Rename `Account` (identifiers field) to `AccountIdentifiers` | `SPEC.Account.Account` → `AccountIdentifiers` |
| 5 | Add new field `IsShariaCompliant` (boolean) | `SPEC.Account` |
| 6 | Mark `AccountId` as the only schema-level mandatory; demote others to "expected for non-switched accounts" | `SPEC.Account` mandatory set |
| 7 | Replace `TransactionType` enum with `[POS, ECommerce, ATM, BillPayments, LocalBankTransfer, SameBankTransfer, InternationalTransfer, Teller, Cheque, Other]` | `SPEC.Transaction.TransactionType` |
| 8 | Replace `SubTransactionType` enum with the 19-value v2.1 list (`AESubTransactionType`) | `SPEC.Transaction.SubTransactionType` |
| 9 | Replace `PaymentModes` enum with `[Online, Offline, Batch]` (singular schema `PaymentMode`); demote field from mandatory to optional | `SPEC.Transaction.PaymentModes` |
| 10 | Add `Flags` field with enum `[Cashback, Payroll, DirectDebit, StandingOrder, Finance, Dividend, OpenFinance]`; this is the spec-clean salary marker | `SPEC.Transaction.Flags` |
| 11 | Replace `CardInstrument.AuthorisationType` with `InstrumentType` enum `[ApplePay, Contactless, MagStripe, Chip, Other]`; expand `CardSchemeName` to include `GCC` and `UPI` | `SPEC.Transaction.CardInstrument` |
| 12 | Make `CreditorAccount` an array | `SPEC.Transaction.CreditorAccount` |
| 13 | Expand `BankTransactionCode` to 6 fields (`Domain, DomainCode, Family, FamilyCode, SubFamily, SubFamilyCode`) | `SPEC.Transaction.BankTransactionCode` |
| 14 | Replace `BeneficiaryType` enum with `[Activated, NotActivated]`; add `AddedViaOF` (boolean) to mandatory; expand mandatory set to 3 | `SPEC.Beneficiary` |
| 15 | Update `StandingOrder` mandatory set to `[StandingOrderId, Frequency, FirstPaymentDateTime, StandingOrderStatusCode, FirstPaymentAmount]`; add `StandingOrderType`, `LastPayment*`, `FinalPayment*`, `NumberOfPayments`, `Purpose` | `SPEC.StandingOrder` |
| 16 | Update `DirectDebit` mandatory set to include `Name` and `Frequency`; add `FrequencyDD` enum | `SPEC.DirectDebit` |
| 17 | Add `ScheduledPayment`, `Product`, `Party2`, `Party4`, `Statement` schemas | new `SPEC.*` entries |
| 18 | Update salary-credit generation in `genTransactions` to use v2.1 mechanics: `TransactionType=LocalBankTransfer/SameBankTransfer`, `SubTransactionType=MoneyTransfer`, **`Flags: ["Payroll"]`**, employer in `TransactionInformation`/`MerchantDetails` | `genTransactions` in `of-sandbox-prototype.html` |
| 19 | Add v2.1 `Allocations` field on Transaction and `Components` field on Balance | `SPEC.Transaction`, `SPEC.Balance` |
| 20 | Add v2.1 `PaymentPurposeCode` on Transaction | `SPEC.Transaction` |

---

## 6. Summary line

The prototype's UX model and field-treatment pattern are right. The hand-coded `SPEC` is now closer to v2.1 than the v0.1 validation suggested (PascalCase is correct), but several enums and the endpoint inventory need to be brought into line with v2.1. The right next move is **EXP-01** — generate `SPEC` from the upstream YAML at build time — which makes most of this validation report self-resolving on every spec bump.

**Pin for v1 build**: `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/uae-account-information-openapi.yaml` at a specific commit SHA. Add a build-time check that fails CI if the upstream spec changes shape unexpectedly.
