// /accounts payload generation — v2.1 AEAccountArrayId shape.
// AEAccountArrayId requires AccountId only; Status, Currency, AccountType,
// AccountSubType, Nickname, OpeningDate, AccountIdentifiers, Servicer are
// optional and `additionalProperties: false` — no extra fields permitted.
// `_meta` is generator-internal and stripped before serialisation/validation.

import { rngInt } from '../prng.js';
import { drawIban, drawCounterpartyBank } from './identity.js';

const SUBTYPE_BY_KIND = {
  CurrentAccount: 'CurrentAccount',
  Savings: 'Savings',
  CreditCard: 'CreditCard',
  Mortgage: 'Mortgage',
  Finance: 'Finance',
};

function makeAccountId(personaId, idx) {
  return `${personaId.replace(/_/g, '-')}-acct-${String(idx + 1).padStart(2, '0')}`;
}

export function generateAccounts({ persona, identity, rng, pools, now }) {
  const personaSegment = persona.segment ?? 'Retail';
  const orgHolderName = persona.organisation?._resolved?.legalName ?? null;
  const accounts = persona.accounts.map((spec, idx) => {
    const bank = drawCounterpartyBank(rng, pools.counterpartyBanks);
    const iban = drawIban(rng, pools.ibans, bank.iban_prefix);
    const opening = rngInt(rng, 1500, 9500);
    const accountType = spec.account_type ?? personaSegment;
    // Business accounts (SME/Corporate AccountType) use the organisation's
    // legal name as AccountHolderName; an explicit `Retail` override on a
    // business persona reverts to the individual's name (the personal-side
    // account a corporate might still hold).
    const holderName =
      accountType !== 'Retail' && orgHolderName ? orgHolderName : identity.fullName;
    return {
      AccountId: makeAccountId(persona.persona_id, idx),
      Status: 'Active',
      StatusUpdateDateTime: monthsAgoIso(rng, spec.age_months ?? 24, now),
      Currency: spec.currency,
      AccountType: accountType,
      AccountSubType: SUBTYPE_BY_KIND[spec.type] ?? 'CurrentAccount',
      Nickname: nicknameFor(spec.type),
      OpeningDate: monthsAgoIso(rng, spec.age_months ?? 24, now),
      AccountHolderName: holderName,
      AccountIdentifiers: [
        {
          SchemeName: 'IBAN',
          Identification: iban,
          Name: holderName,
        },
      ],
      Servicer: {
        SchemeName: 'BICFI',
        Identification: 'SYNAEAA',
      },
      _meta: {
        kind: spec.type,
        creditLimitAed: spec.credit_limit_aed,
        openingBalance: opening,
        servicerName: bank.name,
      },
    };
  });
  return accounts;
}

function nicknameFor(kind) {
  switch (kind) {
    case 'CreditCard':
      return 'Credit Card';
    case 'Mortgage':
      return 'Mortgage';
    case 'Savings':
      return 'Savings';
    case 'Finance':
      return 'Finance';
    default:
      return 'Current';
  }
}

function monthsAgoIso(rng, months, now) {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - months);
  d.setDate(rngInt(rng, 1, 28));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
