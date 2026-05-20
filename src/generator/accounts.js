// /accounts payload generation — v2.1 AEAccountArrayId shape.
// AEAccountArrayId requires AccountId only; Status, Currency, AccountType,
// AccountSubType, Nickname, OpeningDate, AccountIdentifiers, Servicer are
// optional and `additionalProperties: false` — no extra fields permitted.
// `_meta` is generator-internal and stripped before serialisation/validation.

import { rngInt } from '../prng.js';
import { drawIban, drawCounterpartyBank } from './identity.js';
import { derivePrimaryAccountIban, normalizeFootprint } from './multi-lfi.js';

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
  // Slice 7: for personas with multi_lfi_footprint, override the first
  // CurrentAccount's IBAN with a deterministic synthetic AE99/999 value
  // so cross-LFI mirror transactions in role bundles can carry the
  // primary's IBAN as DebtorAccount without re-running the primary
  // generator. Identifies the FIRST CurrentAccount index up front so
  // the per-account loop can short-circuit cleanly.
  const sourcePersona = persona._sourcePersona ?? persona;
  const isProjection = persona._projectedRoleSlot != null;
  const wantsPrimaryAnchor = !!sourcePersona.multi_lfi_footprint && !isProjection;

  // Phase 2.2 — multi-product per LFI. When a persona tags its accounts
  // with `at_slot`, the primary bundle only emits accounts at the
  // primary slot (slots[0].key). Untagged accounts (SME personas) pass
  // through unchanged — they're all considered primary-slot members.
  const sourceAccounts = persona.accounts ?? [];
  const hasAtSlotTags = sourceAccounts.some((a) => a.at_slot != null);
  const fp = normalizeFootprint(sourcePersona.multi_lfi_footprint);
  const primarySlotKey = fp?.slots[0]?.key;
  const filteredAccounts =
    !isProjection && hasAtSlotTags && primarySlotKey
      ? sourceAccounts.filter((a) => a.at_slot === primarySlotKey)
      : sourceAccounts;

  const firstCurrentIdx = wantsPrimaryAnchor
    ? filteredAccounts.findIndex((s) => s.type === 'CurrentAccount')
    : -1;
  const accounts = filteredAccounts.map((spec, idx) => {
    // Phase D Slice 5: a role-bundle's projected persona pre-pins the
    // bank + IBAN per account (so the secondary/tertiary bundle's
    // IBAN matches the cross-LFI self-IBAN already surfaced as a
    // beneficiary in the primary bundle). When neither is set, fall
    // back to the random-pool draw — the v1 / Phase 1 default.
    const bank = spec._bankOverride ?? drawCounterpartyBank(rng, pools.counterpartyBanks);
    let iban;
    if (spec._ibanOverride) {
      iban = spec._ibanOverride;
    } else if (idx === firstCurrentIdx) {
      iban = derivePrimaryAccountIban(persona.persona_id, idx);
    } else {
      iban = drawIban(rng, pools.ibans, bank);
    }
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
        // Phase 2.2 — anchors the account to its multi_lfi_footprint slot
        // so standing-order / direct-debit generation can match
        // slot-tagged commitments to the right host CurrentAccount.
        // For untagged personas (SME) this stays undefined; for
        // multi-LFI personas projecting a role bundle, every account
        // inherits the projected slot's key.
        slotKey: spec.at_slot ?? persona._projectedRoleSlot ?? null,
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
