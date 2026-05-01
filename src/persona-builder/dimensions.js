// Preset tables for the Custom Persona Builder. Each preset maps a
// human-readable knob (e.g. income_band="mid") to the underlying numeric /
// enum values the persona schema expects. Centralised here so the UI and
// the expander stay in sync.

export const INCOME_BANDS = {
  thin: { monthly_amount_aed: 8500, variability: 'low' },
  mid: { monthly_amount_aed: 22000, variability: 'low' },
  affluent: { monthly_amount_aed: 60000, variability: 'low' },
  hnw: { monthly_amount_aed: 120000, variability: 'low' },
  gig: { monthly_amount_aed: 12000, variability: 'high' },
};

export const SPEND_INTENSITIES = {
  low: {
    groceries_aed_per_month_band: [200, 800],
    fuel_aed_per_month_band: [100, 300],
    dining_per_month_count_band: [1, 4],
  },
  med: {
    groceries_aed_per_month_band: [800, 2200],
    fuel_aed_per_month_band: [300, 700],
    dining_per_month_count_band: [4, 10],
  },
  high: {
    groceries_aed_per_month_band: [2200, 5000],
    fuel_aed_per_month_band: [700, 1500],
    dining_per_month_count_band: [10, 25],
  },
};

export const DISTRESS_LEVELS = {
  none: [0, 0],
  occasional: [0, 2],
  frequent: [2, 6],
};

export const CARD_LIMITS = {
  low: 12000,
  mid: 35000,
  high: 90000,
};

// Segment → cash-flow band tables. Used when segment != Retail to seed
// customer-inflow / supplier-outflow / payroll bands on the persona's
// cash_flow block.
export const CASH_FLOW_BANDS = {
  SME: {
    low: { customer: [80000, 160000], supplier: [40000, 90000], payroll: 18000 },
    med: { customer: [180000, 320000], supplier: [90000, 180000], payroll: 38000 },
    high: { customer: [400000, 700000], supplier: [200000, 400000], payroll: 75000 },
  },
  Corporate: {
    low: { customer: [800000, 1400000], supplier: [400000, 750000], payroll: 220000 },
    med: { customer: [2400000, 4200000], supplier: [1100000, 2300000], payroll: 680000 },
    high: { customer: [6000000, 12000000], supplier: [3000000, 6500000], payroll: 1500000 },
  },
};

// Stress-coverage controlled vocabulary (PRD Appendix F). Surfaced in the
// builder UI as advisory chips. Custom personas don't enter the EXP-25
// uniqueness check — these are informational only.
export const STRESS_TAGS = [
  'multi_party_accounts',
  'joint_custodian',
  'power_of_attorney',
  'fx_currency_exchange',
  'multi_currency_accounts',
  'pep_kyc_claims',
  'verified_claims_block',
  'low_volume_inference',
  'cash_dominant_flows',
  'high_dbr',
  'nsf_distress',
  'thin_file_short_tenure',
  'tenure_rich_uae_thin',
  'remittance_outflow',
  'gig_irregular_inflow',
  'salary_payroll_flag',
  'mortgage_long_dated',
  'credit_line_block',
  'sharia_compliant_product',
  'salary_assigned_lending',
];
