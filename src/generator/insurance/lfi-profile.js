// Insurance-domain LFI profile filter — §8.3, EXP-04.
// Applies the Rich/Median/Sparse populate-rate calibration to a generated
// insurance bundle as a post-generation field-redaction filter. Mandatory
// fields are never redacted (NG / EXP-04 acceptance).
//
// Path literals here are insurance-shaped (PolicyHolder, Premium, Product)
// and tested-equal to spec/lfi-bands.insurance.yaml via tests/lfi-bands.test.mjs.
// The probability table + keep/drop rule + decision cache are shared via
// src/generator/lfi-profile-shared.js; only the band table and the
// per-line redaction walk live here.

import { redactionRng, makeCachedDecider } from '../lfi-profile-shared.js';

const OPTIONAL_FIELD_BANDS = [
  // Motor (Phase 2.0).
  { path: 'PolicyHolder.Salutation', band: 'Common' },
  { path: 'Premium.PaymentMode', band: 'Common' },
  { path: 'Product.AdditionalDrivers', band: 'Variable' },
  { path: 'Product.CarFinance', band: 'Variable' },
  // Home (Phase 2.1). Property structural facts are commonly populated;
  // mortgage details mirror motor's CarFinance and so band Variable.
  { path: 'Product.PropertyDetails.NumberOfFloors', band: 'Common' },
  { path: 'Product.PropertyDetails.NumberOfRooms', band: 'Common' },
  { path: 'Product.PropertyDetails.YearOfConstruction', band: 'Common' },
  { path: 'Product.Mortgage', band: 'Variable' },
  // Health (Phase 2.1). Care-network and regions-of-coverage strings are
  // commonly populated in UAE health bundles; the optional Sponsor block
  // surfaces the visa-sponsor relationship and is per-persona variable.
  { path: 'Product.Policy.CareNetwork', band: 'Common' },
  { path: 'Product.Policy.RegionsCoverage', band: 'Common' },
  { path: 'Product.Sponsor', band: 'Variable' },
  { path: 'PolicyHolder.Employment.SalaryBand', band: 'Variable' },
  // Life (Phase 2.1). Beneficiary list and finance-against-policy block
  // mirror motor's CarFinance / home's Mortgage Variable banding.
  { path: 'Product.Beneficiaries', band: 'Common' },
  { path: 'Product.FinanceAgainstPolicy', band: 'Variable' },
  { path: 'Product.Policy.SurrenderValueAmount', band: 'Variable' },
  { path: 'Product.Policy.MaturityValueAmount', band: 'Variable' },
  // Travel (Phase 2.1). Trip-level enums (PurposeOfTravel, TravellingWith,
  // TravelDestinationRegion) are commonly populated; OptionalTravelCover
  // / HighRiskActivities are per-product variable.
  { path: 'Product.Policy.PurposeOfTravel', band: 'Common' },
  { path: 'Product.Policy.TravellingWith', band: 'Common' },
  { path: 'Product.Policy.TravelDestinationRegion', band: 'Common' },
  { path: 'Product.OptionalTravelCoverOptions', band: 'Variable' },
  { path: 'Product.HighRiskActivities', band: 'Variable' },
  // Renters (Phase 2.1). LeaseDetails block + property structural facts.
  { path: 'Product.LeaseDetails', band: 'Common' },
  { path: 'Product.PropertyDetails.UsageByApplicant', band: 'Common' },
  // Employment / ILOE (Phase 2.1). PolicyHolder.Employment block lands as
  // Common (UAE ILOE policy is mandatory and tied to the employer); the
  // optional AdditionalCompensation array under it is Variable.
  { path: 'PolicyHolder.Employment', band: 'Common' },
  { path: 'PolicyHolder.Employment.AdditionalCompensation', band: 'Variable' },
];

/**
 * Apply the LFI profile to an insurance bundle. Bundle is mutated in place
 * and returned. `personaId`/`seed` seed an *independent* PRNG stream
 * (same tuple shape as banking, distinct stream from the generator's RNG).
 */
export function applyInsuranceLfiProfile({ bundle, personaId, lfi, seed }) {
  const decide = makeCachedDecider(lfi, redactionRng(personaId, lfi, seed));

  for (const policy of bundle.motorPolicies ?? []) {
    if (policy.PolicyHolder && !decide('PolicyHolder.Salutation', 'Common')) {
      delete policy.PolicyHolder.Salutation;
    }
    if (policy.Premium && !decide('Premium.PaymentMode', 'Common')) {
      delete policy.Premium.PaymentMode;
    }
    if (policy.Product) {
      if (!decide('Product.AdditionalDrivers', 'Variable')) {
        delete policy.Product.AdditionalDrivers;
      }
      if (!decide('Product.CarFinance', 'Variable')) {
        delete policy.Product.CarFinance;
      }
    }
  }

  for (const policy of bundle.rentersPolicies ?? []) {
    if (policy.PolicyHolder && !decide('PolicyHolder.Salutation', 'Common')) {
      delete policy.PolicyHolder.Salutation;
    }
    if (policy.Premium && !decide('Premium.PaymentMode', 'Common')) {
      delete policy.Premium.PaymentMode;
    }
    if (policy.Product?.LeaseDetails && !decide('Product.LeaseDetails', 'Common')) {
      delete policy.Product.LeaseDetails;
    }
    if (
      policy.Product?.PropertyDetails?.UsageByApplicant &&
      !decide('Product.PropertyDetails.UsageByApplicant', 'Common')
    ) {
      delete policy.Product.PropertyDetails.UsageByApplicant;
    }
  }

  for (const policy of bundle.employmentPolicies ?? []) {
    if (policy.PolicyHolder && !decide('PolicyHolder.Salutation', 'Common')) {
      delete policy.PolicyHolder.Salutation;
    }
    if (policy.Premium && !decide('Premium.PaymentMode', 'Common')) {
      delete policy.Premium.PaymentMode;
    }
    // PolicyHolder.Employment is Common but mandatory under the spec when
    // present; only redact the optional AdditionalCompensation child.
    if (
      policy.PolicyHolder?.Employment?.AdditionalCompensation &&
      !decide('PolicyHolder.Employment.AdditionalCompensation', 'Variable')
    ) {
      delete policy.PolicyHolder.Employment.AdditionalCompensation;
    }
  }

  for (const policy of bundle.travelPolicies ?? []) {
    if (policy.PolicyHolder && !decide('PolicyHolder.Salutation', 'Common')) {
      delete policy.PolicyHolder.Salutation;
    }
    if (policy.Premium && !decide('Premium.PaymentMode', 'Common')) {
      delete policy.Premium.PaymentMode;
    }
    if (policy.Product?.Policy) {
      if (!decide('Product.Policy.PurposeOfTravel', 'Common'))
        delete policy.Product.Policy.PurposeOfTravel;
      if (!decide('Product.Policy.TravellingWith', 'Common'))
        delete policy.Product.Policy.TravellingWith;
      if (!decide('Product.Policy.TravelDestinationRegion', 'Common'))
        delete policy.Product.Policy.TravelDestinationRegion;
    }
    if (
      policy.Product?.OptionalTravelCoverOptions &&
      !decide('Product.OptionalTravelCoverOptions', 'Variable')
    ) {
      delete policy.Product.OptionalTravelCoverOptions;
    }
    if (policy.Product?.HighRiskActivities && !decide('Product.HighRiskActivities', 'Variable')) {
      delete policy.Product.HighRiskActivities;
    }
  }

  for (const policy of bundle.lifePolicies ?? []) {
    if (policy.PolicyHolder && !decide('PolicyHolder.Salutation', 'Common')) {
      delete policy.PolicyHolder.Salutation;
    }
    if (policy.Premium && !decide('Premium.PaymentMode', 'Common')) {
      delete policy.Premium.PaymentMode;
    }
    if (policy.Product) {
      if (policy.Product.Beneficiaries && !decide('Product.Beneficiaries', 'Common')) {
        delete policy.Product.Beneficiaries;
      }
      if (
        policy.Product.FinanceAgainstPolicy &&
        !decide('Product.FinanceAgainstPolicy', 'Variable')
      ) {
        delete policy.Product.FinanceAgainstPolicy;
      }
      if (policy.Product.Policy) {
        if (
          policy.Product.Policy.SurrenderValueAmount &&
          !decide('Product.Policy.SurrenderValueAmount', 'Variable')
        ) {
          delete policy.Product.Policy.SurrenderValueAmount;
        }
        if (
          policy.Product.Policy.MaturityValueAmount &&
          !decide('Product.Policy.MaturityValueAmount', 'Variable')
        ) {
          delete policy.Product.Policy.MaturityValueAmount;
        }
      }
    }
  }

  for (const policy of bundle.healthPolicies ?? []) {
    if (policy.PolicyHolder && !decide('PolicyHolder.Salutation', 'Common')) {
      delete policy.PolicyHolder.Salutation;
    }
    if (
      policy.PolicyHolder?.Employment &&
      !decide('PolicyHolder.Employment.SalaryBand', 'Variable')
    ) {
      delete policy.PolicyHolder.Employment.SalaryBand;
    }
    if (policy.Product?.Policy) {
      if (!decide('Product.Policy.CareNetwork', 'Common')) delete policy.Product.Policy.CareNetwork;
      if (!decide('Product.Policy.RegionsCoverage', 'Common'))
        delete policy.Product.Policy.RegionsCoverage;
    }
    if (policy.Product?.Sponsor && !decide('Product.Sponsor', 'Variable')) {
      delete policy.Product.Sponsor;
    }
  }

  for (const policy of bundle.homePolicies ?? []) {
    if (policy.PolicyHolder && !decide('PolicyHolder.Salutation', 'Common')) {
      delete policy.PolicyHolder.Salutation;
    }
    if (policy.Premium && !decide('Premium.PaymentMode', 'Common')) {
      delete policy.Premium.PaymentMode;
    }
    if (policy.Product?.PropertyDetails) {
      const pd = policy.Product.PropertyDetails;
      if (!decide('Product.PropertyDetails.NumberOfFloors', 'Common')) delete pd.NumberOfFloors;
      if (!decide('Product.PropertyDetails.NumberOfRooms', 'Common')) delete pd.NumberOfRooms;
      if (!decide('Product.PropertyDetails.YearOfConstruction', 'Common'))
        delete pd.YearOfConstruction;
    }
    if (policy.Product?.Mortgage && !decide('Product.Mortgage', 'Variable')) {
      delete policy.Product.Mortgage;
    }
  }

  bundle._lfiProfile = lfi;
  return bundle;
}

export function getOptionalFieldBands() {
  return OPTIONAL_FIELD_BANDS.slice();
}
