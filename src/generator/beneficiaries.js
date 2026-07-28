// /accounts/{AccountId}/beneficiaries generation.
// AEReadBeneficiary requires BeneficiaryId, BeneficiaryType (Activated|NotActivated),
// AddedViaOF (boolean), CreditorAgent.SchemeName/Identification/PostalAddress.Country,
// CreditorAccount.SchemeName/Identification.

import { rngInt, rngPick } from '../prng.js';
import { drawIban, drawCounterpartyBank, drawName } from './identity.js';

export function generateBeneficiaries({ accounts, rng, pools, excludeBankNames }) {
  const out = [];
  // Phase D-lite coordination (D-14): if cross-LFI self-beneficiaries
  // are about to be appended for `multi_lfi_footprint` personas, the
  // banks they reserve are passed in via excludeBankNames so a regular
  // beneficiary doesn't coincidentally land at the same bank — keeping
  // the rendered bundle's multi-bank surface visually distinct.
  const reservedNames = new Set(excludeBankNames ?? []);
  const filteredBanksPool =
    reservedNames.size === 0
      ? pools.counterpartyBanks
      : {
          ...pools.counterpartyBanks,
          banks: pools.counterpartyBanks.banks.filter((b) => !reservedNames.has(b.name)),
        };
  // Phase 1 default: 3 named beneficiaries per current account, 1 per credit-card account.
  for (const acc of accounts) {
    const count = acc._meta.kind === 'CurrentAccount' ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const counterpartyBank = drawCounterpartyBank(rng, filteredBanksPool);
      const iban = drawIban(rng, pools.ibans, counterpartyBank);
      const beneficiaryName = drawName(rng, pools.names);
      out.push({
        _accountId: acc.AccountId,
        BeneficiaryId: `${acc.AccountId}-ben-${String(i + 1).padStart(2, '0')}`,
        BeneficiaryType: rngPick(rng, ['Activated', 'NotActivated']),
        AddedViaOF: rngInt(rng, 0, 2) === 0,
        Reference: `BEN-${rngInt(rng, 1000, 9999)}`,
        // Beneficiary's account-holder name lives at the AEBeneficiary
        // level (per spec); AECashAccount5_0 (which CreditorAccount uses)
        // is locked to {SchemeName, Identification} and disallows Name.
        AccountHolderName: beneficiaryName.full,
        CreditorAgent: {
          SchemeName: 'BICFI',
          Identification: counterpartyBank.bic ?? iban.slice(0, 8),
          // AEBranchAndFinancialInstitutionIdentification6_0 (the shape
          // used by AEBeneficiary.CreditorAgent) allows an optional Name —
          // surface the real-UAE counterparty bank name from the pool so
          // multi-banking is visible in rendered fixtures, not just
          // inferable from IBAN prefix. NG5/D-14: counterparty-pool
          // names are an allowed site for real bank names.
          ...(counterpartyBank.name ? { Name: counterpartyBank.name } : {}),
          PostalAddress: { AddressLine: ['Synthetic Branch'], Country: 'AE' },
        },
        CreditorAccount: [{ SchemeName: 'IBAN', Identification: iban }],
      });
    }
  }
  return out;
}
