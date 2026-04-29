// /accounts/{AccountId}/parties + /parties generation.
// AEParty requires PartyId, PartyType (Delegate|Joint|Sole), PartyCategory
// (Retail|SME|Corporate), AccountRole (Administrator|Beneficiary|...),
// VerifiedClaims (array — empty array satisfies the requirement at the
// container level).
//
// Joint and custodian-for-minor accounts emit multiple Party records per
// account: the primary holder + secondary holder for Joint, and the custodian
// + each minor dependent for custodian-for-minor.

import { drawName } from './identity.js';

const ROLE_BY_INDEX = ['Granter', 'Beneficiary'];

export function generateParties({ persona, accounts, identity, rng, pools, now }) {
  void now;
  const perAccount = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const accSpec = persona.accounts[i];
    const role = ROLE_BY_INDEX[Math.min(i, ROLE_BY_INDEX.length - 1)];

    // Primary holder (always).
    perAccount.push(makeParty({
      _accountId: acc.AccountId,
      partySuffix: '01',
      personaId: persona.persona_id,
      type: accSpec?.party_type === 'Joint' ? 'Joint' : 'Sole',
      role,
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
          name: `${minor.given} ${minor.surname}`,
        }));
      });
    }
  }

  // Calling-user /parties (single record).
  const callingUser = {
    PartyId: `${persona.persona_id.replace(/_/g, '-')}-party`,
    PartyType: 'Sole',
    PartyCategory: 'Retail',
    Name: identity.fullName,
    EmailAddress: synthEmail(identity),
    FullLegalName: identity.fullName,
    VerifiedClaims: [],
  };

  // Suppress unused-warning when we don't need rng/pools in this call.
  void drawName;
  void rng;
  void pools;

  return { perAccount, callingUser };
}

function makeParty({ _accountId, partySuffix, personaId, type, role, name }) {
  const slug = personaId.replace(/_/g, '-');
  return {
    _accountId,
    PartyId: `${slug}-party-${partySuffix}`,
    PartyType: type,
    PartyCategory: 'Retail',
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

function synthEmail(identity) {
  return synthEmailFromName(identity.fullName);
}
