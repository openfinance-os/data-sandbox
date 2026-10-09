// Generator orchestrator — the SYNC full entry that turns (persona, lfi,
// seed) into a payload bundle. Node consumers (tools/build-fixture-package,
// lints, tests) and the Service Worker import { buildBundle } from here
// synchronously; browser pages use src/generator/lazy.js instead so the
// banking cold landing doesn't ship the insurance + ATM pipelines
// (C-P1 / EXP-24).
//
// EXP-05 / §8.3 invariant: the bundle is a pure function of
// (persona, lfi, seed, now). `now` defaults to a build-time anchor so that
// two visitors hitting the same URL on different days see byte-identical
// bundles.
//
// Domain pipeline registry — the single place a new domain (Open Wealth,
// Service Initiation) plugs into generation: add a pipeline module under
// src/generator/pipelines/ and register it here AND in lazy.js. Any domain
// missing from the registry is a hard error at buildBundle time, never a
// silent partial bundle (A-6).

import { bankingPipeline } from './pipelines/banking.js';
import { insurancePipeline } from './pipelines/insurance.js';
import { atmPipeline } from './pipelines/atm.js';
import { buildBundleWith, DEFAULT_NOW } from './dispatch.js';

const DOMAIN_PIPELINES = {
  banking: bankingPipeline,
  insurance: insurancePipeline,
  atm: atmPipeline,
};

export function buildBundle(args) {
  return buildBundleWith(DOMAIN_PIPELINES, args);
}

export { DEFAULT_NOW };
