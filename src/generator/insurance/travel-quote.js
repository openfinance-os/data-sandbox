// Travel-quote generator — Phase 2.1.
// PolicyIssued-state quote shaped to AEInsuranceQuoteReadResponseBody1.
// Premium uses AEInsurancePremiumProperties (VAT split mandatory),
// matching the motor / home / health / life quote-side Premium shape.

import { aed } from './motor-policy.js';
import { genUuid } from './identity.js';

function quoteReference(rng) {
  return `TRVQ-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

function serviceRating() {
  return {
    FinancialStrength: { SolvencyRatio: 68.0, YearsInBusiness: 18 },
    ClaimsServicePerformance: {
      AverageClaimSettlementTime: 7.0,
      ClaimSettlementRatio: 94.0,
      ClaimRejectionRate: 5.0,
      ClaimsPaymentCapacityRatio: 3.5,
    },
    CustomerServiceComplaintHandling: {
      CustomerComplaintRate: 2.5,
      ComplaintResolutionTime: 3,
      NetPromoterScore: 40,
    },
    PolicyDigitalConvenience: {
      InstantDigitalPolicyIssuance: true,
      DigitalClaimsFiling: true,
      SelfServiceOptions: ['MobileApp', 'WebPortal'],
      CustomerSupportAvailability: ['CallCenter', 'WhatsApp'],
    },
  };
}

export function generateTravelQuote({ persona, rng, now }) {
  const t = persona.travel;
  const quoteCreatedDays = t.policy.start_date_offset_days + 5;
  const creationDateTime = new Date(now.getTime() - quoteCreatedDays * 86400000).toISOString();
  const expirationDateTime = new Date(
    now.getTime() - (quoteCreatedDays - 30) * 86400000,
  ).toISOString();

  const travellers = 1 + (t.companions?.length ?? 0);
  const base = t.policy.multi_trip
    ? travellers * 600
    : travellers * t.policy.trip_duration_days * 8;
  const vat = Math.round(base * 0.05);
  const total = base + vat;

  const quote = {
    QuoteStatus: 'PolicyIssued',
    QuoteId: genUuid(rng),
    QuoteReference: quoteReference(rng),
    CreationDateTime: creationDateTime,
    ExpirationDateTime: expirationDateTime,
    PlanName: t.policy.product_name ?? 'Travel Single Trip',
    LevelOfCover: t.policy.multi_trip
      ? `Annual multi-trip, ${t.policy.destination_region}`
      : `Single trip, ${t.policy.trip_duration_days} days, ${t.policy.destination_region}`,
    ServiceRating: serviceRating(),
    PolicyIssuanceAllowed: {
      CustomerVerification: true,
      Payment: true,
      PolicyDocuments: true,
    },
    Takaful: t.policy.takaful,
    Premium: {
      Status: 'Final',
      PremiumAmountExcludingVAT: aed(base),
      VATAmount: aed(vat),
      VATPercentage: 5.0,
      TotalPremiumAmount: aed(total),
      PaymentFrequency: 'OneTime',
    },
  };

  if (t.policy.takaful) {
    quote.AlternativeBrandName = `${quote.PlanName} Takaful`;
  }

  return quote;
}
