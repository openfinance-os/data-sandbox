// Domain config registry — drives tools/parse-spec.mjs and (later) dist/domains.json.
// Phase 2.0 step 1: banking-only. Output for banking must remain byte-identical
// to Phase 1 (regression-protected by tests/replay.test.mjs and the dist/SPEC.json
// snapshot consumed by the UI).
//
// Adding a domain in Phase 2.1+ is a config addition here, not new code.

export const DOMAINS = [
  {
    id: 'banking',
    label: 'Bank Data Sharing',
    status: 'ga',
    specPath: 'spec/uae-account-information-openapi.yaml',
    pinPath: 'spec/SPEC_PIN.sha',
    retrievedPath: 'spec/SPEC_PIN.retrieved',
    bandsPath: 'spec/lfi-bands.banking.yaml',
    outPath: 'dist/SPEC.json',
    upstreamRepo: 'Nebras-Open-Finance/api-specs',
    upstreamPath: 'dist/standards/v2.1/uae-account-information-openapi.yaml',
    defaultEndpoint: '/accounts',
    // PRD Appendix C — v1 = 12 GETs.
    inScopePaths: [
      '/accounts',
      '/accounts/{AccountId}',
      '/accounts/{AccountId}/balances',
      '/accounts/{AccountId}/transactions',
      '/accounts/{AccountId}/standing-orders',
      '/accounts/{AccountId}/direct-debits',
      '/accounts/{AccountId}/beneficiaries',
      '/accounts/{AccountId}/scheduled-payments',
      '/accounts/{AccountId}/product',
      '/accounts/{AccountId}/parties',
      '/parties',
      '/accounts/{AccountId}/statements',
    ],
  },
  {
    id: 'insurance',
    label: 'Insurance Data Sharing',
    // 'preview' = vendored from upstream but not yet endpoint-scoped. The UI
    // domain selector should hide preview domains unless ?preview=1 is set.
    // Flips to 'ga' once endpoint scoping + LFI bands + at least one
    // insurance persona land (slices 5-6).
    status: 'preview',
    specPath: 'spec/uae-insurance-openapi.yaml',
    pinPath: 'spec/SPEC_PIN.insurance.sha',
    retrievedPath: 'spec/SPEC_PIN.insurance.retrieved',
    bandsPath: 'spec/lfi-bands.insurance.yaml',
    outPath: 'dist/SPEC.insurance.json',
    upstreamRepo: 'Nebras-Open-Finance/api-specs',
    upstreamPath: 'dist/standards/v2.1-errata1/uae-insurance-openapi.yaml',
    defaultEndpoint: '/motor-insurance-policies',
    // Phase 2.1 in-scope: motor (full from Phase 2.0) + home + health +
    // life + travel. Each line follows the same 4-endpoint shape: list,
    // detail, payment-details, read-quote. POST/PATCH on the bare
    // /<line>-insurance-quotes path are TPP→LFI write ops, outside the
    // read-only sandbox surface. The remaining 2 lines (Employment,
    // Renters) + Insurance Consents land in subsequent slices.
    inScopePaths: [
      '/motor-insurance-policies',
      '/motor-insurance-policies/{InsurancePolicyId}',
      '/motor-insurance-policies/{InsurancePolicyId}/payment-details',
      '/motor-insurance-quotes/{QuoteId}',
      '/home-insurance-policies',
      '/home-insurance-policies/{InsurancePolicyId}',
      '/home-insurance-policies/{InsurancePolicyId}/payment-details',
      '/home-insurance-quotes/{QuoteId}',
      '/health-insurance-policies',
      '/health-insurance-policies/{InsurancePolicyId}',
      '/health-insurance-policies/{InsurancePolicyId}/payment-details',
      '/health-insurance-quotes/{QuoteId}',
      '/life-insurance-policies',
      '/life-insurance-policies/{InsurancePolicyId}',
      '/life-insurance-policies/{InsurancePolicyId}/payment-details',
      '/life-insurance-quotes/{QuoteId}',
      '/travel-insurance-policies',
      '/travel-insurance-policies/{InsurancePolicyId}',
      '/travel-insurance-policies/{InsurancePolicyId}/payment-details',
      '/travel-insurance-quotes/{QuoteId}',
    ],
  },
];
