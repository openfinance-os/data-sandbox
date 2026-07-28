// /accounts/{AccountId}/product generation.
//
// Emits records shaped to the vendored v2.1 `AEProduct` schema: every
// property is optional but `additionalProperties: false`, so ONLY the
// spec's vocabulary may appear (ShariaStructure / Charges / FinanceRates /
// DepositRates / IsSecured / IsSalaryTransferRequired / Tenor /
// AssetBacked / RewardsBenefits). An earlier version of this module
// emitted a ProductId/ProductType/ProductName shape from a pre-v2.1 draft
// — every key of which the pinned schema rejects; it shipped unvalidated
// for as long as the rendered-fixture suite silently skipped this
// endpoint (see APP_IMPROVEMENT_PLAN.md §3 T-06).
//
// Determinism note: this generator deliberately draws NOTHING from the
// PRNG — all values derive from the account's kind — so it can change
// shape without shifting any other module's fingerprint (EXP-05).

export function generateProducts({ accounts }) {
  const out = [];
  for (const acc of accounts) {
    const kind = acc._meta.kind;
    const record = {
      _accountId: acc.AccountId,
      // Secured lending products (mortgage, auto/personal finance) vs
      // unsecured transactional products.
      IsSecured: kind === 'Mortgage' || kind === 'Finance',
      // Salary-assignment is the common UAE eligibility condition on
      // consumer finance; illustrative synthetic value only.
      IsSalaryTransferRequired: kind === 'Finance',
    };
    // Tenor only makes sense for term products. AEDuration pattern:
    // ^P(\d+Y)?(\d+M)?$ — fixed illustrative tenors, deterministic by kind.
    if (kind === 'Mortgage') {
      record.Tenor = { OriginalTenor: 'P25Y', RemainingTenor: 'P18Y' };
    } else if (kind === 'Finance') {
      record.Tenor = { OriginalTenor: 'P4Y', RemainingTenor: 'P2Y6M' };
    }
    out.push(record);
  }
  return out;
}
