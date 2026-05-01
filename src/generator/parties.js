// /accounts/{AccountId}/parties + /parties generation.
// AEParty requires PartyId, PartyType (Delegate|Joint|Sole), PartyCategory
// (Retail|SME|Corporate), AccountRole (Administrator|Beneficiary|...),
// VerifiedClaims (array — empty array satisfies the requirement at the
// container level).
//
// Joint and custodian-for-minor accounts emit multiple Party records per
// account: the primary holder + secondary holder for Joint, and the custodian
// + each minor dependent for custodian-for-minor.
//
// SME / Corporate personas (persona.organisation present) emit one Party per
// declared signatory in addition to (or in place of) the individual-side
// holder. PartyType + AccountRole come from the persona's organisation.signatories
// entries — values constrained to spec enums by
// tools/lint-persona-spec-conformance.mjs (EXP-01).

import { drawName } from './identity.js';

const ROLE_BY_INDEX = ['Granter', 'Beneficiary'];

export function generateParties({ persona, accounts, identity, rng, pools, now }) {
  void now;
  const perAccount = [];
  const personaSegment = persona.segment ?? 'Retail';

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const accSpec = persona.accounts[i];
    const role = ROLE_BY_INDEX[Math.min(i, ROLE_BY_INDEX.length - 1)];

    if (acc.AccountType !== 'Retail' && Array.isArray(persona.organisation?.signatories)) {
      // Business-segment account: one Party per signatory. Spec values are
      // copied verbatim from the persona (lint guarantees they're valid).
      persona.organisation.signatories.forEach((sig, idx) => {
        const sigName = sig._resolved?.fullName ?? identity.fullName;
        perAccount.push(makeParty({
          _accountId: acc.AccountId,
          partySuffix: String(idx + 1).padStart(2, '0'),
          personaId: persona.persona_id,
          type: sig.party_type ?? 'Sole',
          role: sig.account_role ?? 'Principal',
          category: acc.AccountType,
          name: sigName,
        }));
      });
      continue;
    }

    // Retail-segment account (or no organisation declared): individual holder.
    perAccount.push(makeParty({
      _accountId: acc.AccountId,
      partySuffix: '01',
      personaId: persona.persona_id,
      type: accSpec?.party_type === 'Joint' ? 'Joint' : 'Sole',
      role,
      category: acc.AccountType,
      name: identity.fullName,
    }));

    // Secondary holder for Joint accounts.
    if (accSpec?.party_type === 'Joint' && persona.secondary_holder) {
      const secondary = persona.secondary_holder;
      perAccount.push(makeParty({
        _accountId: acc.AccountId,
        partySuffix: '02',
        personaId: persona.persona_id,
        type: 'Joint',
        role: 'Granter',
        category: acc.AccountType,
        name: `${secondary.given} ${secondary.surname}`,
      }));
    }

    // Custodian-for-minor: one party per minor dependent.
    if (accSpec?.custodian_for_minor && Array.isArray(persona.minor_dependents)) {
      persona.minor_dependents.forEach((minor, idx) => {
        perAccount.push(makeParty({
          _accountId: acc.AccountId,
          partySuffix: String(idx + 2).padStart(2, '0'),
          personaId: `${persona.persona_id}-minor-${idx + 1}`,
          type: 'Sole',
          role: 'CustodianForMinor',
          category: acc.AccountType,
          name: `${minor.given} ${minor.surname}`,
        }));
      });
    }
  }

  // Calling-user /parties (single record). PartyCategory mirrors the persona
  // segment; for an SME/corporate persona the calling user is the principal
  // signatory's record rather than the natural-person identity.
  const callingUserName =
    personaSegment !== 'Retail' && persona.organisation?.signatories?.[0]?._resolved?.fullName
      ? persona.organisation.signatories[0]._resolved.fullName
      : identity.fullName;
  const callingUser = {
    PartyId: `${persona.persona_id.replace(/_/g, '-')}-party`,
    PartyType: persona.organisation?.signatories?.[0]?.party_type ?? 'Sole',
    PartyCategory: personaSegment,
    Name: callingUserName,
    EmailAddress: synthEmailFromName(callingUserName),
    FullLegalName: callingUserName,
    VerifiedClaims: [],
  };

  // Suppress unused-warning when we don't need rng/pools in this call.
  void drawName;
  void rng;
  void pools;

  return { perAccount, callingUser };
}

function makeParty({ _accountId, partySuffix, personaId, type, role, category, name }) {
  const slug = personaId.replace(/_/g, '-');
  return {
    _accountId,
    PartyId: `${slug}-party-${partySuffix}`,
    PartyType: type,
    PartyCategory: category ?? 'Retail',
    AccountRole: role,
    Name: name,
    FullLegalName: name,
    EmailAddress: synthEmailFromName(name),
    VerifiedClaims: [],
  };
}

function synthEmailFromName(name) {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
  return `${slug}@example.test`;
}
