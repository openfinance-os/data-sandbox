// Home-policy generator — Phase 2.1 (first non-motor line).
// Synthesizes the Product (Policy, PropertyDetails, PropertyValue, Mortgage),
// Claims, and Premium sub-objects for AEHomeInsurancePolicyProperties1.
// Mirrors the motor-policy structure: minimum-conformant body that hits
// every mandatory leaf the v2.1-errata1 home schemas require, plus a few
// optional enrichments LFI bands can redact.

import { aed, refNumber, channelMap } from './_shared.js';
import { isoDate } from './identity.js';

// Persona property type → spec TypeOfProperty enum.
const PROPERTY_TYPE_MAP = {
  Villa: 'Villa',
  House: 'House',
  Apartment: 'Apartment',
  Flat: 'Flat',
};

// Persona policy.channel → spec PolicyPurchaseChannelType enum.
const CHANNEL_MAP = channelMap();

const policyNumber = (rng) => refNumber('HOM', rng);

export function generateHomeProduct({ persona, rng, now }) {
  const h = persona.home;
  const startOffset = h.policy.start_date_offset_days;
  const startDate = isoDate(now, -startOffset);
  const endDate = isoDate(now, 365 - startOffset);

  const policyCovers = [
    {
      CoverType: 'BuildingsCover',
      Description: 'Buildings cover for the insured property structure.',
      Required: true,
      CoverLimit: aed(h.property_value.market_value_aed),
      CoverInclusionsAndExclusions: [
        {
          InclusionAndExclusionDescription:
            'Includes accidental damage to the building structure within the UAE.',
        },
      ],
      CoverExcess: aed(h.policy.excess_aed),
    },
  ];

  const policy = {
    PolicyStartDate: startDate,
    PolicyEndDate: endDate,
    Takaful: h.policy.takaful,
    ProductName: 'Home Buildings & Contents',
    PolicyExcess: aed(h.policy.excess_aed),
    PolicyCoverAndBenefits: policyCovers,
    PolicyPurchaseChannelType: CHANNEL_MAP[h.policy.channel] ?? 'Other',
  };

  const propertyDetails = {
    TypeOfProperty: PROPERTY_TYPE_MAP[h.property.type_of_property] ?? 'Other',
    OwnershipStatus: h.property.ownership_status,
    NumberOfFloors: h.property.number_of_floors,
    NumberOfRooms: h.property.number_of_rooms,
    InsuredPropertyAddress: {
      AddressLine: [
        `Building ${1 + Math.floor(rng() * 99)}`,
        `Street ${1 + Math.floor(rng() * 30)}`,
        h.property.address_emirate,
      ],
      Country: 'AE',
    },
    YearOfConstruction: String(h.property.year_of_construction),
  };

  const propertyValue = {
    MarketValueAmount: aed(h.property_value.market_value_aed),
    MostRecentAppraisalValueAmount: aed(h.property_value.appraisal_value_aed),
    PurchasePrice: aed(h.property_value.purchase_price_aed),
  };

  const product = {
    Policy: policy,
    PropertyDetails: propertyDetails,
    PropertyValue: propertyValue,
  };

  if (h.mortgage?.has_mortgage) {
    product.Mortgage = {
      BankName: h.mortgage.bank_name ?? 'Counterparty Bank',
      BankAddress: {
        AddressLine: [`${h.mortgage.bank_name ?? 'Bank'} Branch`, h.property.address_emirate],
        Country: 'AE',
      },
      MortgageBalanceAmount: aed(h.mortgage.balance_aed),
      MonthlyPaymentAmount: aed(h.mortgage.monthly_payment_aed),
    };
  }

  return { product, policyNumber: policyNumber(rng), startDate, endDate };
}

export function generateHomeClaims({ persona }) {
  const c = persona.home.claims ?? {};
  const summary = [
    {
      NumberOfMonthsInPeriod: c.history_months ?? 24,
      Claims: c.claims_in_period ?? 0,
      ApprovedClaims: c.approved_claims ?? 0,
      TotalGrossApprovedClaimAmount: aed(c.total_gross_aed ?? 0),
      TotalGrossPaidAmount: aed(c.total_gross_aed ?? 0),
    },
  ];
  return { Summary: summary, NoClaimsDiscountAvailable: (c.claims_in_period ?? 0) === 0 };
}

export function generateHomePremium({ persona }) {
  // Heuristic: ~0.15% of building market value, plus 5% VAT.
  const value = persona.home.property_value.market_value_aed;
  const premiumExVat = Math.round(value * 0.0015);
  const vat = Math.round(premiumExVat * 0.05);
  const total = premiumExVat + vat;
  return {
    PremiumAmount: aed(premiumExVat),
    VatAmount: aed(vat),
    TotalPremiumAmount: aed(total),
    PaymentFrequency: 'Annually',
    PaymentMode: 'DirectDebit', // optional; LFI-redactable.
  };
}
