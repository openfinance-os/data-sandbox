// Identity-pool loader — works in both Node and the browser.
// In Node we read YAML files directly; in the browser we fetch pre-bundled
// JSON copies. Phase 0 keeps things simple by exposing the same load() shape.

const POOL_FILES = [
  ['namesExpatIndian', 'names/expat_indian.yaml'],
  ['employersTechFreezone', 'employers/tech_freezone.yaml'],
  ['merchantsGroceries', 'merchants/groceries.yaml'],
  ['merchantsFuel', 'merchants/fuel.yaml'],
  ['merchantsDining', 'merchants/dining.yaml'],
  ['merchantsUtilities', 'merchants/utilities.yaml'],
  ['counterpartyBanksDomestic', 'counterparty-banks/domestic.yaml'],
  ['ibansSynthetic', 'ibans/synthetic.yaml'],
];

export const POOL_FILE_LIST = POOL_FILES.slice();

export function indexPoolsByPoolId(pools) {
  const namesByPoolId = {};
  for (const [k, v] of Object.entries(pools)) {
    if (k.startsWith('names') && v && v.pool_id) {
      namesByPoolId[v.pool_id] = v;
    }
  }
  return { ...pools, namesByPoolId };
}
