// Browser lazy entry — async buildBundle that dynamic-imports non-banking
// domain pipelines on first use (C-P1 / EXP-24). Banking is static: it's the
// cold-landing default, so it belongs on the critical path; insurance + ATM
// load only when a persona actually declares them (domain switch — already an
// async flow via rebuildAndRender / switchDomain).
//
// Node consumers and the Service Worker keep using the sync full entry
// (src/generator/index.js) — same registry core (dispatch.js), same bytes out
// (EXP-05). A new domain registers a loader here AND a static entry there.

import { bankingPipeline } from './pipelines/banking.js';
import { buildBundleWith, resolveDomains } from './dispatch.js';

const loadedPipelines = { banking: bankingPipeline };

const PIPELINE_LOADERS = {
  insurance: () => import('./pipelines/insurance.js').then((m) => m.insurancePipeline),
  atm: () => import('./pipelines/atm.js').then((m) => m.atmPipeline),
};

/**
 * Async counterpart of the sync buildBundle in ./index.js. Resolves the
 * persona's declared domains, loads any not-yet-loaded pipeline via dynamic
 * import (cached thereafter), then dispatches through the shared registry
 * core. Unknown domains throw the same error as the sync entry.
 */
export async function buildBundle(args) {
  const domains = resolveDomains(args.persona);
  for (const domain of domains) {
    if (loadedPipelines[domain]) continue;
    const loader = PIPELINE_LOADERS[domain];
    if (!loader) throw new Error(`unknown persona domain: ${domain}`);
    loadedPipelines[domain] = await loader();
  }
  return buildBundleWith(loadedPipelines, args);
}

export { DEFAULT_NOW } from './dispatch.js';
