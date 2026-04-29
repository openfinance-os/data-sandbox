// /accounts/{AccountId}/product generation.
// AEProduct1 has many deeply-nested mandatory fields under Charges /
// FinanceRates / DepositRates / AssetBacked / RewardsBenefits, but each of
// these is conditional on the parent block being populated. Phase 1 emits
// minimal product records: ProductName + ProductType + Currency, with the
// optional blocks left out (the per-leaf "mandatory" applies only when the
// containing array is non-empty). This satisfies the spec for the v1 use
// case (read the product reference data of the active account).

export function generateProducts({ accounts }) {
  const out = [];
  for (const acc of accounts) {
    out.push({
      _accountId: acc.AccountId,
      ProductId: `${acc.AccountId}-product`,
      ProductType: productTypeFor(acc._meta.kind),
      ProductSubType: acc.AccountSubType,
      ProductName: productNameFor(acc),
      Currency: acc.Currency,
      Description: descriptionFor(acc._meta.kind),
    });
  }
  return out;
}

function productTypeFor(kind) {
  switch (kind) {
    case 'CreditCard':
      return 'CreditCard';
    case 'Mortgage':
      return 'Mortgage';
    case 'Savings':
      return 'Savings';
    case 'Finance':
      return 'Finance';
    default:
      return 'CurrentAccount';
  }
}

function productNameFor(acc) {
  return `Synthetic ${acc.AccountSubType} (${acc.Currency})`;
}

function descriptionFor(kind) {
  switch (kind) {
    case 'CreditCard':
      return 'Synthetic credit-card product reference. Not a real product.';
    case 'Mortgage':
      return 'Synthetic mortgage product reference. Not a real product.';
    case 'Savings':
      return 'Synthetic savings product reference. Not a real product.';
    default:
      return 'Synthetic current-account product reference. Not a real product.';
  }
}
