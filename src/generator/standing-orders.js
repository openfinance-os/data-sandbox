// /accounts/{AccountId}/standing-orders generation.
// Standing orders are persona.fixed_commitments[kind=standing_order] surfaced
// at the resource level. v2.1 AEReadStandingOrder requires StandingOrderId,
// Frequency, FirstPaymentDateTime, StandingOrderStatusCode, FirstPaymentAmount,
// NextPaymentAmount, LastPaymentAmount, FinalPaymentAmount, CreditorAgent,
// CreditorAccount.

import { rngInt } from '../prng.js';
import { drawIban, drawCounterpartyBank } from './identity.js';

export function generateStandingOrders({ persona, accounts, rng, pools, now }) {
  const out = [];
  const currentAccounts = accounts.filter((a) => a._meta.kind === 'CurrentAccount');
  for (const acc of currentAccounts) {
    const sos = (persona.fixed_commitments ?? []).filter((c) => c.kind === 'standing_order');
    sos.forEach((c, i) => {
      const day = parseScheduleDay(c.schedule);
      if (day == null) return;
      const amount = c.amount_aed ?? rngInt(rng, c.amount_aed_band[0], c.amount_aed_band[1] + 1);
      const counterpartyBank = drawCounterpartyBank(rng, pools.counterpartyBanks);
      const creditorIban = drawIban(rng, pools.ibans, counterpartyBank.iban_prefix);
      const firstPayment = monthsAgoAtDay(now, 24, day);
      const nextPayment = nextOccurrence(now, day);
      out.push({
        _accountId: acc.AccountId,
        StandingOrderId: `${acc.AccountId}-so-${String(i + 1).padStart(2, '0')}`,
        Reference: c.purpose,
        Frequency: 'EvryDay:01:01',
        FirstPaymentDateTime: isoOf(firstPayment),
        NextPaymentDateTime: isoOf(nextPayment),
        StandingOrderStatusCode: 'Active',
        FirstPaymentAmount: amountObj(amount, acc.Currency),
        NextPaymentAmount: amountObj(amount, acc.Currency),
        LastPaymentAmount: amountObj(amount, acc.Currency),
        FinalPaymentAmount: amountObj(amount, acc.Currency),
        CreditorAgent: { SchemeName: 'BICFI', Identification: creditorIban.slice(0, 8) },
        CreditorAccount: [
          { SchemeName: 'IBAN', Identification: creditorIban, Name: prettyPurpose(c.purpose) },
        ],
      });
    });
  }
  return out;
}

function amountObj(amount, currency) {
  return { Amount: amount.toFixed(2), Currency: currency };
}
function parseScheduleDay(schedule) {
  const m = /^monthly_(\d{1,2})$/.exec(schedule);
  return m ? parseInt(m[1], 10) : null;
}
function monthsAgoAtDay(now, months, day) {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - months);
  d.setDate(Math.min(day, 28));
  d.setHours(11, 0, 0, 0);
  return d;
}
function nextOccurrence(now, day) {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() + 1);
  d.setDate(Math.min(day, 28));
  d.setHours(11, 0, 0, 0);
  return d;
}
function isoOf(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function prettyPurpose(p) {
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
