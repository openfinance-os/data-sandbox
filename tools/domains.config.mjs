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
    upstreamPath: 'dist/standards/v2.1-errata2/uae-account-information-openapi.yaml',
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
    // 'ga' as of Phase 2.1 completion: all 7 lines (motor + home + health
    // + life + travel + renters + employment) covered + Insurance
    // Consents. The UI domain selector surfaces 'ga' domains
    // unconditionally (no ?preview=1 gate).
    status: 'ga',
    specPath: 'spec/uae-insurance-openapi.yaml',
    pinPath: 'spec/SPEC_PIN.insurance.sha',
    retrievedPath: 'spec/SPEC_PIN.insurance.retrieved',
    bandsPath: 'spec/lfi-bands.insurance.yaml',
    outPath: 'dist/SPEC.insurance.json',
    upstreamRepo: 'Nebras-Open-Finance/api-specs',
    upstreamPath: 'dist/standards/v2.1-errata1/uae-insurance-openapi.yaml',
    defaultEndpoint: '/motor-insurance-policies',
    // Phase 2.1 full GET coverage — every read-only insurance endpoint
    // the v2.1-errata1 spec exposes. POST/PATCH on bare quote paths and
    // PATCH /insurance-consents/{ConsentId} are TPP→LFI write ops,
    // outside the read-only sandbox surface.
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
      '/renters-insurance-policies',
      '/renters-insurance-policies/{InsurancePolicyId}',
      '/renters-insurance-policies/{InsurancePolicyId}/payment-details',
      '/renters-insurance-quotes/{QuoteId}',
      '/employment-insurance-policies',
      '/employment-insurance-policies/{InsurancePolicyId}',
      '/employment-insurance-policies/{InsurancePolicyId}/payment-details',
      '/employment-insurance-quotes/{QuoteId}',
      '/insurance-consents',
      '/insurance-consents/{ConsentId}',
    ],
  },
  {
    id: 'atm',
    label: 'ATM Locator',
    // Phase 2.3 GA — single read endpoint (`GET /atms`) covering the
    // full v2.1 ATM Locator surface. Infrastructure data: a public
    // directory of an LFI's cash-machine fleet (locations, services,
    // accessibility, fees). Not bound to any customer / persona; the
    // sandbox plugs it into the existing (persona, lfi, seed)
    // pipeline via a sentinel `atm-directory` persona so the URL
    // contract stays uniform.
    status: 'ga',
    specPath: 'spec/uae-atm-openapi.yaml',
    pinPath: 'spec/SPEC_PIN.atm.sha',
    retrievedPath: 'spec/SPEC_PIN.atm.retrieved',
    bandsPath: 'spec/lfi-bands.atm.yaml',
    outPath: 'dist/SPEC.atm.json',
    upstreamRepo: 'Nebras-Open-Finance/api-specs',
    upstreamPath: 'dist/standards/v2.1/uae-atm-openapi.yaml',
    defaultEndpoint: '/atms',
    inScopePaths: ['/atms'],
  },
];
