// Travel-policy generator — Phase 2.1.
// Synthesizes AETravelInsurancePolicyProperties1: Product (Policy with
// trip metadata + optional InsuredParties[]), Claims, and Premium. Travel
// diverges from motor/home/health/life:
//   1. Policy required surface includes TripDuration, NumberOfAdults /
//      NumberOfChildren / NumberOfSeniors / NumberOfInsuredCompanions
//      (all integer), MultiTrip (bool), and the same generic Takaful /
//      ProductName / PolicyCoverAndBenefits / PolicyPurchaseChannelType.
//   2. PurposeOfTravel (Personal|Business), TravellingWith (Individual|
//      Couple|Family|Group), TravelDestinationRegion (WithinUAE |
//      Worldwide | WorldwideExcludingUSAandCanada) are optional but
//      coherent with the persona's narrative.
//   3. Premium uses shared AEInsuranceDataSharingPremiumProperties.

import { drawName } from '../identity.js';
import { aed, refNumber, channelMap } from './_shared.js';
import { isoDate, NATIONALITY_BY_POOL, dobFromAge } from './identity.js';

const CHANNEL_MAP = channelMap({
  OnlineInsideUAE: 'OnlineInsideUAE',
  OnlineOutsideUAE: 'OnlineOutsideUAE',
});

const policyNumber = (rng) => refNumber('TRV', rng);

function generateTravelInsuredParties({ persona, names, rng, now }) {
  const t = persona.travel;
  const out = [];
  for (const dep of t.companions ?? []) {
    const draw = drawName(rng, names);
    const given = dep.given_name ?? draw.given;
    const surname = dep.surname ?? draw.surname;
    out.push({
      RelationshipToPrimaryTraveller: dep.relationship,
      FirstName: given,
      LastName: surname,
      DateOfBirth: dobFromAge(dep.age, rng, now),
      Nationality: NATIONALITY_BY_POOL[persona.demographics.nationality_pool] ?? 'ARE',
      Gender: dep.gender ?? (rng() < 0.5 ? 'Male' : 'Female'),
    });
  }
  return out;
}

export function generateTravelProduct({ persona, names, rng, now }) {
  const t = persona.travel;
  const startOffset = t.policy.start_date_offset_days;
  const startDate = isoDate(now, -startOffset);
  // Single-trip end-date = start + trip_duration_days; multi-trip end-date
  // = start + 365 (annual multi-trip is the UAE-market convention).
  const endDate = t.policy.multi_trip
    ? isoDate(now, 365 - startOffset)
    : isoDate(now, t.policy.trip_duration_days - startOffset);

  const policyCovers = [
    {
      CoverType: 'TripCancellation',
      Description: 'Trip cancellation cover for unforeseen events.',
      Required: true,
      CoverLimit: aed(t.policy.cover_limit_aed),
      CoverInclusionsAndExclusions: [
        {
          InclusionAndExclusionDescription:
            'Includes cancellation due to illness or family emergency; excludes pre-existing conditions.',
        },
      ],
    },
    {
      CoverType: 'EmergencyMedical',
      Description: 'Emergency medical and evacuation cover overseas.',
      Required: true,
      CoverLimit: aed(t.policy.medical_limit_aed),
      CoverInclusionsAndExclusions: [
        {
          InclusionAndExclusionDescription:
            'Includes emergency hospitalisation and medical evacuation; excludes elective treatment.',
        },
      ],
    },
  ];

  const companionsCount = t.companions?.length ?? 0;
  const adults = t.adults ?? 1 + companionsCount;
  const children = t.children ?? 0;
  const seniors = t.seniors ?? 0;

  const policy = {
    PolicyStartDate: startDate,
    PolicyEndDate: endDate,
    TripDuration: t.policy.trip_duration_days,
    NumberOfInsuredCompanions: companionsCount,
    NumberOfAdults: adults,
    NumberOfChildren: children,
    NumberOfSeniors: seniors,
    MultiTrip: t.policy.multi_trip,
    PurposeOfTravel: t.policy.purpose,
    TravellingWith: t.policy.travelling_with,
    TravelDestinationRegion: t.policy.destination_region,
    Takaful: t.policy.takaful,
    ProductName: t.policy.product_name ?? 'Travel Single Trip',
    PolicyExcess: aed(t.policy.excess_aed),
    PolicyCoverAndBenefits: policyCovers,
    PolicyPurchaseChannelType: CHANNEL_MAP[t.policy.channel] ?? 'Other',
  };

  const product = { Policy: policy };
  const insuredParties = generateTravelInsuredParties({ persona, names, rng, now });
  if (insuredParties.length > 0) product.InsuredParties = insuredParties;

  return { product, policyNumber: policyNumber(rng), startDate, endDate };
}

export function generateTravelClaims({ persona }) {
  const c = persona.travel.claims ?? {};
  const summary = [
    {
      NumberOfMonthsInPeriod: c.history_months ?? 24,
      Claims: c.claims_in_period ?? 0,
      ApprovedClaims: c.approved_claims ?? 0,
      TotalGrossApprovedClaimAmount: aed(c.total_gross_aed ?? 0),
      TotalGrossPaidAmount: aed(c.total_gross_aed ?? 0),
    },
  ];
  return { Summary: summary };
}

export function generateTravelPremium({ persona }) {
  // Heuristic: AED 8/day per traveller for single-trip Worldwide; AED 600
  // flat for an annual multi-trip baseline. Includes 5% VAT.
  const t = persona.travel;
  const travellers = 1 + (t.companions?.length ?? 0);
  const base = t.policy.multi_trip
    ? travellers * 600
    : travellers * t.policy.trip_duration_days * 8;
  const vat = Math.round(base * 0.05);
  const total = base + vat;
  return {
    TotalPremiumAmount: aed(total),
    PaymentFrequency: 'OneTime',
    PaymentMode: 'CreditCard', // optional; LFI-redactable.
  };
}
