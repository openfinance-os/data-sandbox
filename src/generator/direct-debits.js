// /accounts/{AccountId}/direct-debits generation.
// AEReadDirectDebit requires DirectDebitId, MandateIdentification,
// DirectDebitStatusCode, Name, Frequency, PreviousPaymentAmount.

import { rngInt } from '../prng.js';

export function generateDirectDebits({ persona, accounts, rng, now }) {
  const out = [];
  const currentAccounts = accounts.filter((a) => a._meta.kind === 'CurrentAccount');
  for (const acc of currentAccounts) {
    const dds = (persona.fixed_commitments ?? []).filter((c) => c.kind === 'direct_debit');
    dds.forEach((c, i) => {
      const amount = c.amount_aed ?? rngInt(rng, c.amount_aed_band[0], c.amount_aed_band[1] + 1);
      out.push({
        _accountId: acc.AccountId,
        DirectDebitId: `${acc.AccountId}-dd-${String(i + 1).padStart(2, '0')}`,
        MandateIdentification: `MAND-${rngInt(rng, 100000, 999999)}`,
        DirectDebitStatusCode: 'Active',
        Name: prettyPurpose(c.purpose),
        Frequency: 'Monthly',
        PreviousPaymentDateTime: prevPaymentIso(now),
        PreviousPaymentAmount: { Amount: amount.toFixed(2), Currency: acc.Currency },
      });
    });
  }
  return out;
}

function prettyPurpose(p) {
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function prevPaymentIso(now) {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - 1);
  d.setDate(5);
  d.setHours(11, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
