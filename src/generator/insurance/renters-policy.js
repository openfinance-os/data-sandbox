// Renters-policy generator — Phase 2.1.
// Synthesizes AERentersInsurancePolicyProperties1: Product (Policy +
// PropertyDetails + optional LeaseDetails + optional ContentsCoverDetails),
// Claims, Premium. Renters mirrors home structurally — same TypeOfProperty
// enum + InsuredPropertyAddress shape — but adds a LeaseDetails block
// (TermType / FurnishingStatus / LandlordFullName / MonthlyRentAmount)
// and is anchored at OwnershipStatus=Tenant.
//
// Required surface:
//   Product.Policy: PolicyStartDate, Takaful, ProductName,
//     PolicyCoverAndBenefits, PolicyPurchaseChannelType
//   Product.PropertyDetails: TypeOfProperty
//   Product (top): Policy, PropertyDetails (both required)
//   Premium uses shared AEInsuranceDataSharingPremiumProperties.

import { aed } from './motor-policy.js';
import { isoDate } from './identity.js';

const PROPERTY_TYPE_MAP = {
  Villa: 'Villa',
  House: 'House',
  Apartment: 'Apartment',
  Flat: 'Flat',
};

const CHANNEL_MAP = {
  Direct: 'Direct',
  Agent: 'Agent',
  Broker: 'Broker',
  Bank: 'Bank',
  Aggregator: 'Aggregation',
  OnlineInsideUAE: 'OnlineInsideUAE',
};

function policyNumber(rng) {
  return `RNT-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

export function generateRentersProduct({ persona, rng, now }) {
  const r = persona.renters;
  const startOffset = r.policy.start_date_offset_days;
  const startDate = isoDate(now, -startOffset);
  const endDate = isoDate(now, 365 - startOffset);

  const policyCovers = [
    {
      CoverType: 'ContentsCover',
      Description: 'Contents cover for the renter\'s personal belongings.',
      Required: true,
      CoverLimit: aed(r.contents.declared_value_aed),
      CoverInclusionsAndExclusions: [
        {
          InclusionAndExclusionDescription:
            'Includes accidental damage and theft of contents within the leased premises.',
        },
      ],
      CoverExcess: aed(r.policy.excess_aed),
    },
  ];

  const policy = {
    PolicyStartDate: startDate,
    PolicyEndDate: endDate,
    Takaful: r.policy.takaful,
    ProductName: r.policy.product_name ?? 'Renters Contents',
    PolicyExcess: aed(r.policy.excess_aed),
    PolicyCoverAndBenefits: policyCovers,
    PolicyPurchaseChannelType: CHANNEL_MAP[r.policy.channel] ?? 'Other',
  };

  const propertyDetails = {
    TypeOfProperty: PROPERTY_TYPE_MAP[r.property.type_of_property] ?? 'Apartment',
    OwnershipStatus: 'Tenant',
    NumberOfFloors: r.property.number_of_floors ?? 1,
    NumberOfRooms: r.property.number_of_rooms,
    InsuredPropertyAddress: {
      AddressLine: [
        `Building ${1 + Math.floor(rng() * 99)}`,
        `Street ${1 + Math.floor(rng() * 30)}`,
        r.property.address_emirate,
      ],
      Country: 'AE',
    },
    UsageByApplicant: 'PrimaryResidence',
  };

  const product = {
    Policy: policy,
    PropertyDetails: propertyDetails,
  };

  if (r.lease) {
    const leaseStart = isoDate(now, -r.lease.start_offset_months * 30);
    const leaseEnd = isoDate(now, (r.lease.term_months - r.lease.start_offset_months) * 30);
    product.LeaseDetails = {
      TermType: r.lease.term_months >= 12 ? 'OneYear' : 'ShortTerm',
      StartDate: leaseStart,
      EndDate: leaseEnd,
      FurnishingStatus: r.lease.furnishing_status,
      MonthlyRentAmount: aed(r.lease.monthly_rent_aed),
    };
  }

  return { product, policyNumber: policyNumber(rng), startDate, endDate };
}

export function generateRentersClaims({ persona }) {
  const c = persona.renters.claims ?? {};
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

export function generateRentersPremium({ persona }) {
  // Heuristic: ~0.5% of declared contents value per year (UAE renters
  // contents-cover market band), +5% VAT.
  const v = persona.renters.contents.declared_value_aed;
  const base = Math.round(v * 0.005);
  const vat = Math.round(base * 0.05);
  const total = base + vat;
  return {
    TotalPremiumAmount: aed(total),
    PaymentFrequency: 'Annually',
    PaymentMode: 'DirectDebit',
  };
}
