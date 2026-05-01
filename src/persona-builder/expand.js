// expandRecipe — turns a Custom Persona Builder recipe into a persona-shaped
// object that buildBundle() at src/generator/index.js consumes unchanged.
// Pure function; throws on any reference to an unknown pool so the URL never
// silently produces a partial bundle.

import { RECIPE_DEFAULTS, recipeHash, validateRecipe } from './recipe.js';
import {
  INCOME_BANDS,
  SPEND_INTENSITIES,
  DISTRESS_LEVELS,
  CARD_LIMITS,
  CASH_FLOW_BANDS,
} from './dimensions.js';

export function expandRecipe(recipeIn, indexedPools) {
  const recipe = { ...RECIPE_DEFAULTS, ...(recipeIn ?? {}) };
  const v = validateRecipe(recipe, indexedPools);
  if (!v.ok) {
    throw new Error(`expandRecipe: invalid recipe — ${v.errors.join('; ')}`);
  }
  const segment = recipe.segment;
  const incomePreset =
    INCOME_BANDS[recipe.income_band] ?? INCOME_BANDS[RECIPE_DEFAULTS.income_band];
  const spendPreset =
    SPEND_INTENSITIES[recipe.spend_intensity] ?? SPEND_INTENSITIES[RECIPE_DEFAULTS.spend_intensity];
  const distressBand =
    DISTRESS_LEVELS[recipe.distress] ?? DISTRESS_LEVELS[RECIPE_DEFAULTS.distress];

  const accounts = (recipe.products?.length ? recipe.products : ['CurrentAccount']).map(
    (kind) => {
      const acc = {
        type: kind,
        currency: 'AED',
        age_months: 36,
      };
      if (kind === 'CreditCard') {
        acc.credit_limit_aed = CARD_LIMITS[recipe.card_limit] ?? CARD_LIMITS.mid;
      }
      if (kind === 'Mortgage') {
        acc.age_months = 60;
      }
      return acc;
    }
  );

  const persona = {
    persona_id: `custom_${recipeHash(recipe)}`,
    domain: 'banking',
    name: 'Custom persona (not curated)',
    archetype: `custom_${segment.toLowerCase()}`,
    default_seed: 1,
    segment,
    stress_coverage: Array.isArray(recipe.stress_tags) && recipe.stress_tags.length > 0
      ? [...recipe.stress_tags]
      : ['custom_persona'],
    demographics: {
      nationality_pool: recipe.name_pool,
      age_band: recipe.age_band,
      emirate: recipe.emirate,
    },
    income: {
      primary_employer_pool: recipe.employer_pool ?? RECIPE_DEFAULTS.employer_pool,
      monthly_amount_aed: incomePreset.monthly_amount_aed,
      pay_day: 25,
      variability: incomePreset.variability,
      flag_payroll: !!recipe.flag_payroll,
    },
    accounts,
    fixed_commitments: [],
    spend_profile: {
      groceries_aed_per_month_band: spendPreset.groceries_aed_per_month_band,
      fuel_aed_per_month_band: spendPreset.fuel_aed_per_month_band,
      dining_per_month_count_band: spendPreset.dining_per_month_count_band,
    },
    fx_activity: !!recipe.fx_activity,
    cash_deposit_activity: !!recipe.cash_deposit,
    distress_signals: {
      nsf_events_per_year_band: distressBand,
    },
    narrative: '',
    _custom: { recipeHash: recipeHash(recipe) },
  };

  if (segment !== 'Retail') {
    persona.organisation = {
      legal_name_pool: recipe.legal_name_pool,
      signatories: [
        {
          signatory_pool: recipe.signatory_pool,
          account_role: recipe.signatory_account_role,
          party_type: recipe.signatory_party_type,
        },
      ],
    };
    const cfBand =
      (CASH_FLOW_BANDS[segment] ?? {})[recipe.cash_flow_intensity] ??
      CASH_FLOW_BANDS[segment].med;
    persona.cash_flow = {
      customer_inflows: {
        counterparty_pool: recipe.customer_inflow_pool,
        monthly_amount_aed_band: cfBand.customer,
        invoice_cadence: recipe.invoice_cadence,
      },
      supplier_outflows: {
        counterparty_pool: recipe.supplier_outflow_pool,
        monthly_amount_aed_band: cfBand.supplier,
      },
      payroll_outflow_aed: cfBand.payroll,
    };
  }

  return persona;
}
