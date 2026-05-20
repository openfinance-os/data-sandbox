// Identity-pool list and indexing helpers.
//
// As the persona library grows, pool files are added under
// /synthetic-identity-pool/. Phase 1: rather than hardcoding each file in
// this list, tools/load-fixtures.mjs (Node) and tools/build-data.mjs (browser
// build) walk the directory; this module exposes the indexing helper that
// turns the loaded set into name/employer/merchant lookups by pool_id.

export function indexPools(rawPools) {
  const namesByPoolId = {};
  const employersByPoolId = {};
  const merchantsByCategory = {};
  const counterpartyBanksByCategory = {};
  const ibansByCategory = {};
  const organisationsByPoolId = {};
  const counterpartiesByPoolId = {};
  // Phase R2 — synthetic UAE family-conglomerate registry. Discriminator
  // is the top-level `groups` array. Indexed as a flat { groupId →
  // groupRecord } map so the narrative-grammar helpers can resolve a
  // merchant's `parent_group` in O(1).
  const familyGroupsById = {};
  // Phase R3 — MCC confusion table. Discriminator is the top-level
  // `confusion` array. Indexed { correctMcc → [{ wrong, reason }] }
  // so the noise applier in mcc-noise.js can look up plausible
  // misrouting targets for a transaction's true MCC in O(1).
  let mccConfusion = null;

  for (const p of rawPools) {
    if (!p || typeof p.pool_id !== 'string') continue;
    if (Array.isArray(p.given_names) && Array.isArray(p.surnames)) {
      namesByPoolId[p.pool_id] = p;
    } else if (Array.isArray(p.employers)) {
      employersByPoolId[p.pool_id] = p;
    } else if (Array.isArray(p.merchants)) {
      merchantsByCategory[p.pool_id] = p;
    } else if (Array.isArray(p.banks)) {
      counterpartyBanksByCategory[p.pool_id] = p;
    } else if (Array.isArray(p.prefix_options)) {
      ibansByCategory[p.pool_id] = p;
    } else if (Array.isArray(p.organisations)) {
      organisationsByPoolId[p.pool_id] = p;
    } else if (Array.isArray(p.counterparties)) {
      counterpartiesByPoolId[p.pool_id] = p;
    } else if (Array.isArray(p.groups)) {
      for (const g of p.groups) {
        if (g && typeof g.id === 'string') familyGroupsById[g.id] = g;
      }
    } else if (Array.isArray(p.confusion)) {
      // Folded so duplicate confusion files (defensive — should be one)
      // merge their entries rather than the second clobbering the first.
      mccConfusion = mccConfusion ?? {};
      for (const e of p.confusion) {
        if (!e?.correct) continue;
        const arr = Array.isArray(e.wrong) ? e.wrong : [];
        const records = arr
          .map((w) =>
            typeof w === 'string'
              ? { wrong: w, reason: e.reason ?? '' }
              : { wrong: w?.wrong ?? null, reason: w?.reason ?? e.reason ?? '' },
          )
          .filter((r) => r.wrong);
        if (records.length === 0) continue;
        mccConfusion[e.correct] = [...(mccConfusion[e.correct] ?? []), ...records];
      }
    }
  }
  return {
    namesByPoolId,
    employersByPoolId,
    merchantsByCategory,
    counterpartyBanksByCategory,
    ibansByCategory,
    organisationsByPoolId,
    counterpartiesByPoolId,
    familyGroupsById,
    mccConfusion,
  };
}
