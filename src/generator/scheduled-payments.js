// /accounts/{AccountId}/scheduled-payments generation.
// AEReadScheduledPayment requires ScheduledPaymentId, ScheduledType,
// ScheduledPaymentDateTime, InstructedAmount, CreditorAgent, CreditorAccount.

import { rngInt, rngPick } from '../prng.js';
import { drawIban, drawCounterpartyBank, drawName } from './identity.js';

export function generateScheduledPayments({ persona, accounts, rng, pools, now }) {
  const out = [];
  void persona;
  for (const acc of accounts) {
    if (acc._meta.kind !== 'CurrentAccount') continue;
    // 0–2 scheduled payments per current account.
    const count = rngInt(rng, 0, 3);
    for (let i = 0; i < count; i++) {
      const counterpartyBank = drawCounterpartyBank(rng, pools.counterpartyBanks);
      const iban = drawIban(rng, pools.ibans, counterpartyBank.iban_prefix);
      const beneficiary = drawName(rng, pools.names);
      const date = futureDate(now, rngInt(rng, 7, 90));
      out.push({
        _accountId: acc.AccountId,
        ScheduledPaymentId: `${acc.AccountId}-sp-${String(i + 1).padStart(2, '0')}`,
        ScheduledType: rngPick(rng, ['Arrival', 'Execution']),
        ScheduledPaymentDateTime: isoOf(date),
        Reference: `SCHED-${rngInt(rng, 1000, 9999)}`,
        InstructedAmount: { Amount: rngInt(rng, 100, 5000).toFixed(2), Currency: acc.Currency },
        CreditorAgent: { SchemeName: 'BICFI', Identification: iban.slice(0, 8) },
        CreditorAccount: [
          { SchemeName: 'IBAN', Identification: iban, Name: beneficiary.full },
        ],
      });
    }
  }
  return out;
}

function futureDate(now, days) {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(11, 0, 0, 0);
  return d;
}

function isoOf(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
