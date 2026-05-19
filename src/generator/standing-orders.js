// /accounts/{AccountId}/standing-orders generation.
// Standing orders are persona.fixed_commitments[kind=standing_order] surfaced
// at the resource level. v2.1 AEReadStandingOrder requires StandingOrderId,
// Frequency, FirstPaymentDateTime, StandingOrderStatusCode, FirstPaymentAmount,
// NextPaymentAmount, LastPaymentAmount, FinalPaymentAmount, CreditorAgent,
// CreditorAccount.

import { rngInt } from '../prng.js';
import { drawIban, drawCounterpartyBank } from './identity.js';
import { pickFootprintBankForPurpose } from './multi-lfi.js';

export function generateStandingOrders({ persona, accounts, rng, pools, now }) {
  const out = [];
  const currentAccounts = accounts.filter((a) => a._meta.kind === 'CurrentAccount');
  // Phase 2.2 — per-slot commitment routing. If ANY fixed_commitment
  // declares at_slot, all routing flows through it: each commitment
  // appears only on the CurrentAccount whose slotKey matches the
  // commitment's at_slot. Untagged personas (SME) keep the legacy
  // behaviour: every commitment appears on every CurrentAccount.
  const hasAtSlotCommitments = (persona.fixed_commitments ?? []).some(
    (c) => c.at_slot != null,
  );
  for (const acc of currentAccounts) {
    const accSlot = acc._meta?.slotKey ?? null;
    const sos = (persona.fixed_commitments ?? []).filter((c) => {
      if (c.kind !== 'standing_order') return false;
      if (hasAtSlotCommitments) return c.at_slot === accSlot;
      return true;
    });
    sos.forEach((c, i) => {
      const day = parseScheduleDay(c.schedule);
      if (day == null) return;
      const amount = c.amount_aed ?? rngInt(rng, c.amount_aed_band[0], c.amount_aed_band[1] + 1);
      // Slice 4 (D-14): if the SO's purpose maps to a footprint role
      // declared by the persona, route the CreditorAgent through a
      // candidate bank from that role's slot — so e.g. a zakat-distribution
      // SO points at an Islamic bank, a trade_finance SO at a foreign-
      // branch wholesale bank. Otherwise fall back to the random pool
      // draw (preserves the existing default behaviour).
      const counterpartyBank =
        pickFootprintBankForPurpose(persona, c.purpose, pools.counterpartyBanks)
        ?? drawCounterpartyBank(rng, pools.counterpartyBanks);
      const creditorIban = drawIban(rng, pools.ibans, counterpartyBank);
      const firstPayment = monthsAgoAtDay(now, 24, day);
      const nextPayment = nextOccurrence(now, day);
      out.push({
        _accountId: acc.AccountId,
        StandingOrderId: `${acc.AccountId}-so-${String(i + 1).padStart(2, '0')}`,
        // AEStandingOrder spec field is `CreditorReference` (not `Reference`).
        CreditorReference: c.purpose,
        // The purpose-as-name lives at the AEStandingOrder.AccountHolderName
        // level (allowed by spec); AECashAccount5_0 (which CreditorAccount
        // uses on this resource) is locked to {SchemeName, Identification}
        // and disallows Name.
        AccountHolderName: prettyPurpose(c.purpose),
        Frequency: 'EvryDay:01:01',
        FirstPaymentDateTime: isoOf(firstPayment),
        NextPaymentDateTime: isoOf(nextPayment),
        StandingOrderStatusCode: 'Active',
        FirstPaymentAmount: amountObj(amount, acc.Currency),
        NextPaymentAmount: amountObj(amount, acc.Currency),
        LastPaymentAmount: amountObj(amount, acc.Currency),
        FinalPaymentAmount: amountObj(amount, acc.Currency),
        // AEStandingOrder.CreditorAgent uses
        // AEBranchAndFinancialInstitutionIdentification5_1, which is locked
        // to { SchemeName, Identification } with additionalProperties: false
        // — so the bank Name cannot be surfaced here. The synthetic per-bank
        // BIC stem from the pool gives bank-distinctive Identification.
        CreditorAgent: {
          SchemeName: 'BICFI',
          Identification: counterpartyBank.bic ?? creditorIban.slice(0, 8),
        },
        CreditorAccount: [
          { SchemeName: 'IBAN', Identification: creditorIban },
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
