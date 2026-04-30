// Motor-policy generator — Phase 2.0 Motor MVP.
// Synthesizes the Product (Policy, VehicleDetails, CarRegistration,
// DrivingLicenseHistory, AdditionalDrivers, CarFinance), Claims, and Premium
// sub-objects. Shape conforms to the v2.1-errata1 motor schemas; mandatory
// children of any included optional parent are populated.

import { drawName } from '../identity.js';
import { isoDate } from './identity.js';

export function aed(amount) {
  const num = typeof amount === 'number' ? amount : Number(amount);
  return { Currency: 'AED', Amount: num.toFixed(2) };
}

// Persona body_type → spec BodyType enum.
const BODY_TYPE_MAP = {
  Sedan: 'Saloon',
  Saloon: 'Saloon',
  SUV: '4WD',
  Pickup: 'Pickup',
  Truck: 'Truck',
  Motorcycle: 'Motorcycle',
};

// Persona policy.channel → spec PolicyPurchaseChannelType enum.
const CHANNEL_MAP = {
  Direct: 'Direct',
  Broker: 'Broker',
  Aggregator: 'Aggregation',
  Bank: 'Bank',
  Agent: 'Agent',
};

function policyNumber(rng) {
  return `MTR-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

function drivingLicenseNumber(rng) {
  return String(Math.floor(rng() * 10_000_000)).padStart(7, '0');
}

function generateAdditionalDrivers({ count, names, rng }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const n = drawName(rng, names);
    out.push({ FullName: `${n.given} ${n.surname}` });
  }
  return out;
}

function generateCarFinance({ persona, banks, rng }) {
  if (!persona.finance?.has_finance) return null;
  const bank = banks.banks[Math.floor(rng() * banks.banks.length)];
  return {
    BankName: bank.name,
    FinanceAmount: aed(persona.finance.amount_aed),
    OutstandingFinanceBalance: aed(persona.finance.outstanding_aed),
  };
}

export function generateMotorProduct({ persona, names, banks, rng, now }) {
  const startOffset = persona.policy.start_date_offset_days;
  const startDate = isoDate(now, -startOffset);
  // Purchase predates start by a few days deterministically.
  const purchaseDate = isoDate(now, -(startOffset + 3 + Math.floor(rng() * 7)));

  const policyCovers = [
    {
      CoverType: 'OwnDamage',
      Description: 'Own damage cover for the insured vehicle',
      Required: true,
      CoverLimit: aed(persona.vehicle.valuation_aed),
      CoverInclusionsAndExclusions: [
        {
          InclusionAndExclusionDescription:
            'Includes accidental damage to the insured vehicle within the UAE.',
        },
      ],
      CoverExcess: aed(persona.policy.excess_aed),
    },
  ];

  const policy = {
    TypeOfPolicy: persona.policy.type,
    PolicyStartDate: startDate,
    CarUsage: 'Private',
    CarValuation: aed(persona.vehicle.valuation_aed),
    PolicyNumber: policyNumber(rng),
    PurchaseDate: purchaseDate,
    Takaful: persona.policy.takaful,
    ProductName:
      persona.policy.type === 'Comprehensive' ? 'Motor Comprehensive Plus' : 'Motor TPL',
    PolicyExcess: aed(persona.policy.excess_aed),
    PolicyCoverAndBenefits: policyCovers,
    PolicyPurchaseChannelType: CHANNEL_MAP[persona.policy.channel] ?? 'Other',
  };

  const vehicleDetails = {
    ModelYear: String(persona.vehicle.year),
    Make: persona.vehicle.make,
    Model: persona.vehicle.model,
    Trim: 'Standard',
    BodyType: BODY_TYPE_MAP[persona.vehicle.body_type] ?? 'Saloon',
    NoOfPassengersIncDriver: persona.vehicle.passenger_capacity,
  };

  const carRegistration = { EmirateOfRegistration: persona.vehicle.registration_emirate };
  const drivingLicenseHistory = { DrivingLicenseNumber: drivingLicenseNumber(rng) };

  const product = {
    Policy: policy,
    VehicleDetails: vehicleDetails,
    CarRegistration: carRegistration,
    DrivingLicenseHistory: drivingLicenseHistory,
  };

  const drivers = generateAdditionalDrivers({
    count: persona.additional_drivers?.count ?? 0,
    names,
    rng,
  });
  if (drivers.length > 0) product.AdditionalDrivers = drivers;

  const carFinance = generateCarFinance({ persona, banks, rng });
  if (carFinance) product.CarFinance = carFinance;

  return product;
}

export function generateClaims({ persona }) {
  const c = persona.claims ?? {};
  const summary = [
    {
      NumberOfMonthsInPeriod: c.history_months ?? 12,
      Claims: c.claims_in_period ?? 0,
      ApprovedClaims: c.approved_claims ?? 0,
      TotalGrossApprovedClaimAmount: aed(c.total_gross_aed ?? 0),
      TotalGrossPaidAmount: aed(c.total_gross_aed ?? 0),
    },
  ];
  return {
    Summary: summary,
    NoClaimsDiscountAvailable: (c.claims_in_period ?? 0) === 0,
  };
}

export function generatePremium({ persona }) {
  // Heuristic: ~3% of car valuation, comprehensive bumps to ~4.5%.
  const v = persona.vehicle.valuation_aed;
  const baseRate = persona.policy.type === 'Comprehensive' ? 0.045 : 0.025;
  const premium = Math.round(v * baseRate);
  const vat = Math.round(premium * 0.05);
  const total = premium + vat;
  return {
    TotalPremiumAmount: aed(total),
    PaymentFrequency: 'Annually',
    PaymentMode: 'DirectDebit', // optional; LFI-redactable.
  };
}
