// ATM Locator pipeline registry entry — see src/generator/dispatch.js for
// the pipeline contract. Dynamic-imported by the browser lazy entry so the
// banking cold landing never ships the ATM generator (C-P1 / EXP-24).

import { buildAtmBundle } from '../atm/index.js';

export const atmPipeline = {
  build: (args) => buildAtmBundle(args),
  mergeInto: (bundle, args) => ({ ...bundle, ...buildAtmBundle(args) }),
};
