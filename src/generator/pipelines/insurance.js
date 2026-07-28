// Insurance pipeline registry entry — see src/generator/dispatch.js for the
// pipeline contract. Dynamic-imported by the browser lazy entry so the
// banking cold landing never ships the 7-line insurance generator tree
// (C-P1 / EXP-24). The multi-domain merge logic moved here verbatim from the
// pre-split orchestrator (src/generator/index.js).

import { buildInsuranceBundle } from '../insurance/index.js';

function mergeInsuranceInto(bundle, { persona, lfi, seed, pools, now }) {
  const lines = persona.insurance?.lines ?? (persona.line ? [persona.line] : []);
  const accumulatedConsents = [];
  for (const line of lines) {
    const linePersona = { ...persona, line };
    const lineBundle = buildInsuranceBundle({ persona: linePersona, lfi, seed, pools, now });
    // Strip per-bundle scalars that collide across lines:
    //   - identity, name: same value across all lines (drawn from
    //     the same name pool with the same seed); banking's wins.
    //   - consents: accumulate one-per-line.
    //   - paymentDetails: each line emits its own payment-details
    //     payload, so rename to <line>PaymentDetails on merge.
    //     emitLineEnvelopes reads the per-line key first, falling
    //     back to bundle.paymentDetails for single-line bundles.
    //   - domain, line: single-line markers; envelopesFromBundle
    //     reads bundle.domains[] for multi-domain dispatch instead.
    const {
      identity: _ignoreInsuranceIdentity,
      consents,
      paymentDetails,
      domain: _ignoreDomain,
      line: _ignoreLine,
      ...rest
    } = lineBundle;
    if (consents) accumulatedConsents.push(...consents);
    if (paymentDetails) bundle[`${line}PaymentDetails`] = paymentDetails;
    bundle = { ...bundle, ...rest };
  }
  if (accumulatedConsents.length > 0) bundle.consents = accumulatedConsents;
  return bundle;
}

export const insurancePipeline = {
  build: (args) => buildInsuranceBundle(args),
  mergeInto: mergeInsuranceInto,
};
