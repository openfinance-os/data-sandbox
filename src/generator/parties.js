// /accounts/{AccountId}/parties + /parties generation.
// AEParty requires PartyId, PartyType (Delegate|Joint|Sole), PartyCategory
// (Retail|SME|Corporate), AccountRole (Administrator|Beneficiary|...). The
// VerifiedClaims block is optional at the array level — Phase 1 leaves it
// empty so the deeply-nested mandatory leaves under VerifiedClaims are
// out-of-scope (vacuous when the array is empty).

const ROLE_BY_INDEX = ['Granter', 'Beneficiary'];

export function generateParties({ persona, accounts, identity, rng, now }) {
  void rng;
  const partyById = {};
  for (const acc of accounts) {
    const role = ROLE_BY_INDEX[Math.min(accounts.indexOf(acc), ROLE_BY_INDEX.length - 1)];
    partyById[acc.AccountId] = [
      {
        _accountId: acc.AccountId,
        PartyId: `${persona.persona_id.replace(/_/g, '-')}-party`,
        PartyType: 'Sole',
        PartyCategory: 'Retail',
        AccountRole: role,
        Name: identity.fullName,
        EmailAddress: synthEmail(persona, identity),
        FullLegalName: identity.fullName,
        VerifiedClaims: [],
      },
    ];
  }
  // Calling-user /parties (single record).
  const callingUser = {
    PartyId: `${persona.persona_id.replace(/_/g, '-')}-party`,
    PartyType: 'Sole',
    PartyCategory: 'Retail',
    Name: identity.fullName,
    EmailAddress: synthEmail(persona, identity),
    FullLegalName: identity.fullName,
    VerifiedClaims: [],
  };
  return { perAccount: Object.values(partyById).flat(), callingUser, _now: now };
}

function synthEmail(persona, identity) {
  const slug = `${identity.given}.${identity.surname}`.toLowerCase().replace(/[^a-z.]/g, '');
  return `${slug}@example.test`;
}
