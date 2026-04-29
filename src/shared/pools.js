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
    }
  }
  return {
    namesByPoolId,
    employersByPoolId,
    merchantsByCategory,
    counterpartyBanksByCategory,
    ibansByCategory,
  };
}
