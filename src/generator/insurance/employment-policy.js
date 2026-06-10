// Employment-policy generator — Phase 2.1.
// Synthesizes AEEmploymentInsurancePolicyProperties1: Product (Policy with
// SchemeCategory + Sector + PolicyTerm + PremiumFrequency +
// PolicyPurchaseChannelType all required), Claims, Premium. This is the
// UAE Involuntary Loss of Employment Insurance (ILOE) line — mandatory
// since 2022 for federal-government and private-sector employees.
//
// PolicyHolder requires a per-line embedded address structure (different
// from the shared AEInsuranceAddress used by other lines — it carries
// AddressType, BuildingNumber, BuildingName etc.) plus an Employment
// block whose MonthlyIncomeAmount is mandatory when present.
//
// SchemeCategory: CategoryA (≤ AED 16,000 salary) | CategoryB (> AED 16,000).
// Sector: Private | FederalGovernment.
// Premium uses shared AEInsuranceDataSharingPremiumProperties.

import { aed, refNumber, channelMap } from './_shared.js';
import { isoDate } from './identity.js';

const CHANNEL_MAP = channelMap({ OnlineInsideUAE: 'OnlineInsideUAE' });

const policyNumber = (rng) => refNumber('EMP', rng);

function policyTermDuration(years) {
  return `P${Math.max(1, years)}Y`;
}

export function generateEmploymentProduct({ persona, rng, now }) {
  const e = persona.employment;
  const startOffset = e.policy.start_date_offset_days;
  const startDate = isoDate(now, -startOffset);
  const endDate = isoDate(now, e.policy.term_years * 365 - startOffset);

  const policy = {
    SchemeCategory: e.policy.scheme_category,
    Sector: e.policy.sector,
    PolicyTerm: policyTermDuration(e.policy.term_years),
    PremiumFrequency: e.policy.premium_frequency,
    PolicyStartDate: startDate,
    PolicyEndDate: endDate,
    PolicyPurchaseChannelType: CHANNEL_MAP[e.policy.channel] ?? 'Other',
  };

  return { product: { Policy: policy }, policyNumber: policyNumber(rng), startDate, endDate };
}

// PolicyHolder Employment block (employment-line-specific shape — this
// schema mandates MonthlyIncomeAmount when Employment present and
// allows AdditionalCompensation[]).
export function generateEmploymentEmployment({ persona }) {
  const e = persona.employment;
  const block = {
    EmployerName: e.employer.name,
    NatureOfEmployerBusiness: e.employer.nature_of_business ?? 'Private Holding',
    MonthlyIncomeAmount: aed(e.employer.monthly_income_aed),
    AnnualIncomeAmount: aed(e.employer.monthly_income_aed * 12),
    EmployerAddress: {
      AddressLine: [
        `${e.employer.name}`,
        `Building ${1 + (e.employer.monthly_income_aed % 99)}`,
        persona.demographics.emirate,
      ],
      Country: 'AE',
    },
    EmploymentStatus: e.employer.employment_status ?? 'Employed',
    // YAML may parse `2023-08-15` as a Date object; the spec requires
    // `format: date` ISO-string. Coerce defensively.
    StartDate:
      typeof e.employer.start_date === 'string'
        ? e.employer.start_date
        : new Date(e.employer.start_date).toISOString().slice(0, 10),
  };
  if (e.additional_compensation) {
    block.AdditionalCompensation = e.additional_compensation.map((c) => ({
      Description: c.description,
      CompensationAmount: aed(c.amount_aed),
    }));
  }
  return block;
}

// Employment PolicyHolder uses the line's own Address shape — emit one
// Residential address that conforms to the embedded schema's required
// AddressLine + Country.
export function generateEmploymentAddress({ persona, rng }) {
  return [
    {
      AddressType: 'Residential',
      AddressLine: [
        `Building ${1 + Math.floor(rng() * 99)}`,
        `Street ${1 + Math.floor(rng() * 30)}`,
        persona.demographics.emirate,
      ],
      CountrySubDivision: persona.demographics.emirate,
      Country: 'AE',
    },
  ];
}

export function generateEmploymentClaims({ persona }) {
  const c = persona.employment.claims ?? {};
  const summary = [
    {
      NumberOfMonthsInPeriod: c.history_months ?? 12,
      Claims: c.claims_in_period ?? 0,
      ApprovedClaims: c.approved_claims ?? 0,
      TotalGrossApprovedClaimAmount: aed(c.total_gross_aed ?? 0),
      TotalGrossPaidAmount: aed(c.total_gross_aed ?? 0),
    },
  ];
  return { Summary: summary };
}

export function generateEmploymentPremium({ persona }) {
  // ILOE pricing per CBUAE: AED 5/month (CategoryA) or AED 10/month
  // (CategoryB), annualised. + 5% VAT.
  const isB = persona.employment.policy.scheme_category === 'CategoryB';
  const monthly = isB ? 10 : 5;
  const base = monthly * 12;
  const vat = Math.round(base * 0.05);
  const total = base + vat;
  return {
    TotalPremiumAmount: aed(total),
    PaymentFrequency: 'Annually',
    PaymentMode: 'BankTransfer', // ILOE typically deducted via WPS bank transfer.
  };
}
