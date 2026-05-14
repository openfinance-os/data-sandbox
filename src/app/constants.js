// Static configuration tables for the sandbox UI. Extracted from src/app.js
// so the orchestrator stays focused on wiring + rendering. Anything that
// depends on `state` or DOM state stays in app.js; this module is pure data.

// Pseudo-endpoints for the EXP-18 Underwriting Scenario panel and the
// Persona Overview landing card. Both are derived views over the bundle —
// not wire endpoints — but they live in the navigator so users can jump
// to them like any other endpoint.
export const UNDERWRITING_PSEUDO = '/(underwriting)';
export const OVERVIEW_PSEUDO = '/(overview)';

// All 12 v1 banking endpoints (PRD Appendix C) plus the two pseudo-endpoints.
// Three are bundle-level (no AccountId scope): /accounts, /parties, and the
// two pseudos. The others are per-account.
export const ENDPOINTS = [
  { path: OVERVIEW_PSEUDO, scope: 'bundle' },
  { path: '/accounts', scope: 'bundle' },
  { path: '/accounts/{AccountId}', scope: 'account' },
  { path: '/accounts/{AccountId}/balances', scope: 'account' },
  { path: '/accounts/{AccountId}/transactions', scope: 'account' },
  { path: '/accounts/{AccountId}/standing-orders', scope: 'account' },
  { path: '/accounts/{AccountId}/direct-debits', scope: 'account' },
  { path: '/accounts/{AccountId}/beneficiaries', scope: 'account' },
  { path: '/accounts/{AccountId}/scheduled-payments', scope: 'account' },
  { path: '/accounts/{AccountId}/product', scope: 'account' },
  { path: '/accounts/{AccountId}/parties', scope: 'account' },
  { path: '/parties', scope: 'bundle' },
  { path: '/accounts/{AccountId}/statements', scope: 'account' },
  { path: UNDERWRITING_PSEUDO, scope: 'bundle' },
];

export const ACCOUNT_SCOPED_PATHS = ENDPOINTS.filter((e) => e.scope === 'account').map((e) => e.path);
export const BUNDLE_SCOPED_PATHS = ENDPOINTS.filter((e) => e.scope === 'bundle').map((e) => e.path);

// JTBD presets — map a job-to-be-done bucket (per PRD §3) to the
// stress_coverage terms a persona must include to qualify. One-tap
// filters for Aisha (AML), Faisal (affordability/DBR), Layla (FX),
// Daniel/Maryam (low-volume edge cases), Hamid (Sharia/multi-product).
export const JTBD_PRESETS = Object.freeze({
  affordability: { label: 'Affordability',  terms: ['salary_payroll_flag', 'high_dbr', 'mortgage_long_dated', 'credit_line_block', 'gig_irregular_inflow'] },
  aml:           { label: 'AML',            terms: ['cash_dominant_flows', 'multi_party_accounts', 'joint_custodian'] },
  thinFile:      { label: 'Thin file',      terms: ['thin_file_short_tenure'] },
  fx:            { label: 'FX',             terms: ['fx_currency_exchange', 'multi_currency_accounts'] },
  distress:      { label: 'NSF / distress', terms: ['nsf_distress', 'low_volume_inference'] },
  sharia:        { label: 'Sharia',         terms: ['sharia_compliant_product'] },
});

// Insurance JTBD presets — Phase 2.1 stress terms grouped by the
// scenario-tab families called out in the v1 refinement spec. Same shape
// as JTBD_PRESETS so the rail renderer is domain-agnostic.
export const INSURANCE_JTBD_PRESETS = Object.freeze({
  highClaim:    { label: 'High-claim frequency', terms: ['high_claim_frequency'] },
  multiDriver:  { label: 'Multi-driver',         terms: ['multi_driver_household', 'motor_comprehensive_financed'] },
  takaful:      { label: 'Takaful',              terms: ['sharia_takaful_product'] },
  thirdParty:   { label: 'Third-party',          terms: ['third_party_liability_only'] },
  mortgageLinked: { label: 'Mortgage-linked',    terms: ['mortgage_linked_home_cover', 'life_mortgage_protection_term'] },
  familyCover:  { label: 'Family cover',         terms: ['employer_sponsored_health_family', 'renters_furnished_apartment_lease'] },
  iloe:         { label: 'ILOE',                 terms: ['iloe_private_category_b'] },
});

export function getJtbdPresets(domain) {
  return domain === 'insurance' ? INSURANCE_JTBD_PRESETS : JTBD_PRESETS;
}

// "Best for" — per-stress-term human one-liner driving the persona-card
// summary. Derived from PRD §3.2 JTBD wording so the library answers
// "which persona answers my job?" without reading every narrative.
export const STRESS_BEST_FOR = Object.freeze({
  salary_payroll_flag:       'Baseline affordability case (Flags=Payroll income marker)',
  credit_line_block:         'Credit-line / card commitment shape',
  multi_currency_accounts:   'Multi-currency / FX edge cases',
  fx_currency_exchange:      'CurrencyExchange handling',
  multi_party_accounts:      'Multi-party / custodianship accounts',
  joint_custodian:           'Joint + custodian-for-minor account roles',
  high_dbr:                  'DBR-stretched affordability stress test',
  mortgage_long_dated:       'Long-dated mortgage commitments',
  nsf_distress:              'NSF / behavioural distress signal detection',
  thin_file_short_tenure:    'Thin-file / short-tenure underwriting',
  sharia_compliant_product:  'Sharia-compliant product handling',
  cash_dominant_flows:       'AML rule design — sparse merchant detail',
  gig_irregular_inflow:      'Income verification for gig / variable patterns',
  low_volume_inference:      'Low-volume / pension cadence (formula breaks here)',
});

export const LFI_CAPTIONS = Object.freeze({
  rich:   'Rich. Every populate-band optional field set — best-case ecosystem.',
  median: 'Median. Universal=1.0, Common=0.7, Variable=0.4, Rare=0.1 (v1 calibration).',
  sparse: 'Sparse. Mandatory + Universal-band only — every other optional field dropped.',
});

// Side-pane collapse class names — the .left-collapsed / .right-collapsed
// modifiers on #three-pane drive the CSS grid columns.
export const PANE_COLLAPSE_CLASS = Object.freeze({
  'persona-pane': 'left-collapsed',
  'field-detail': 'right-collapsed',
});

// Below this viewport width the navigator can't comfortably host both side
// panes at once — keeping both expanded squeezes the rendered table below
// readable column widths. JS listens on a matchMedia of (max-width: NARROW-1)
// and, when both side panes are open, auto-collapses the opposite one
// (the rail chevron stays visible to restore). Existing manual collapse via
// the header chevrons keeps working at any width.
//
// 1099 / 760 remain the prior structural breakpoints (right-pane → overlay,
// stacked single-column). 1280 sits above both, so the auto-collapse only
// runs in the 1100–1279 band where the layout is still a three-column grid.
export const NARROW_PANE_BREAKPOINT_PX = 1280;

// Per-band Median populate-rate copy shown on field cards.
export const MEDIAN_HINT = Object.freeze({
  Universal: 'Median expectation: every LFI populates.',
  Common:    'Median expectation: ~70% of LFIs populate.',
  Variable:  'Median expectation: ~40% of LFIs populate.',
  Rare:      'Median expectation: ~10% of LFIs populate (premium-product only).',
});
