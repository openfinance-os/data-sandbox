// /accounts/{AccountId}/beneficiaries generation.
// AEReadBeneficiary requires BeneficiaryId, BeneficiaryType (Activated|NotActivated),
// AddedViaOF (boolean), CreditorAgent.SchemeName/Identification/PostalAddress.Country,
// CreditorAccount.SchemeName/Identification.

import { rngInt, rngPick } from '../prng.js';
import { drawIban, drawCounterpartyBank, drawName } from './identity.js';

export function generateBeneficiaries({ persona, accounts, rng, pools }) {
  const out = [];
  // Phase 1 default: 3 named beneficiaries per current account, 1 per credit-card account.
  for (const acc of accounts) {
    const count = acc._meta.kind === 'CurrentAccount' ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const counterpartyBank = drawCounterpartyBank(rng, pools.counterpartyBanks);
      const iban = drawIban(rng, pools.ibans, counterpartyBank.iban_prefix);
      const beneficiaryName = drawName(rng, pools.names);
      out.push({
        _accountId: acc.AccountId,
        BeneficiaryId: `${acc.AccountId}-ben-${String(i + 1).padStart(2, '0')}`,
        BeneficiaryType: rngPick(rng, ['Activated', 'NotActivated']),
        AddedViaOF: rngInt(rng, 0, 2) === 0,
        Reference: `BEN-${rngInt(rng, 1000, 9999)}`,
        CreditorAgent: {
          SchemeName: 'BICFI',
          Identification: iban.slice(0, 8),
          PostalAddress: { AddressLine: ['Synthetic Branch'], Country: 'AE' },
        },
        CreditorAccount: [
          { SchemeName: 'IBAN', Identification: iban, Name: beneficiaryName.full },
        ],
      });
    }
  }
  return out;
}
