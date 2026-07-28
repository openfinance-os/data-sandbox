// Banking pipeline registry entry — see src/generator/dispatch.js for the
// pipeline contract. Kept as a thin module so the lazy browser entry can
// static-import banking (the cold-landing default) while insurance/ATM load
// on demand.

import { buildBankingBundle } from '../banking/index.js';

export const bankingPipeline = {
  build: (args) => buildBankingBundle(args),
  mergeInto: (bundle, args) => ({ ...bundle, ...buildBankingBundle(args) }),
};
