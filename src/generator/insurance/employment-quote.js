// Employment-quote generator — Phase 2.1.
// PolicyIssued-state quote shaped to AEInsuranceQuoteReadResponseBody1.
// ILOE quote-side Premium uses the same AEInsurancePremiumProperties
// shape as motor / home / life / travel quote-Premium (VAT split required).

import { aed } from './motor-policy.js';
import { genUuid } from './identity.js';
import { MS_PER_DAY } from '../constants.js';

function quoteReference(rng) {
  return `EMPQ-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

function serviceRating() {
  return {
    FinancialStrength: { SolvencyRatio: 78.0, YearsInBusiness: 12 },
    ClaimsServicePerformance: {
      AverageClaimSettlementTime: 21.0,
      ClaimSettlementRatio: 92.0,
      ClaimRejectionRate: 6.0,
      ClaimsPaymentCapacityRatio: 6.0,
    },
    CustomerServiceComplaintHandling: {
      CustomerComplaintRate: 3.0,
      ComplaintResolutionTime: 10,
      NetPromoterScore: 35,
    },
    PolicyDigitalConvenience: {
      InstantDigitalPolicyIssuance: false,
      DigitalClaimsFiling: true,
      SelfServiceOptions: ['MobileApp', 'WebPortal'],
      CustomerSupportAvailability: ['CallCenter', 'Email'],
    },
  };
}

export function generateEmploymentQuote({ persona, rng, now }) {
  const e = persona.employment;
  const quoteCreatedDays = e.policy.start_date_offset_days + 5;
  const creationDateTime = new Date(now.getTime() - quoteCreatedDays * MS_PER_DAY).toISOString();
  const expirationDateTime = new Date(
    now.getTime() - (quoteCreatedDays - 30) * MS_PER_DAY,
  ).toISOString();

  // ILOE pricing — see employment-policy.js generateEmploymentPremium.
  const isB = e.policy.scheme_category === 'CategoryB';
  const monthly = isB ? 10 : 5;
  const base = monthly * 12;
  const vat = Math.round(base * 0.05);
  const total = base + vat;

  return {
    QuoteStatus: 'PolicyIssued',
    QuoteId: genUuid(rng),
    QuoteReference: quoteReference(rng),
    CreationDateTime: creationDateTime,
    ExpirationDateTime: expirationDateTime,
    PlanName: e.policy.scheme_category === 'CategoryB' ? 'ILOE Category B' : 'ILOE Category A',
    LevelOfCover:
      e.policy.scheme_category === 'CategoryB'
        ? 'ILOE — Salary > AED 16,000'
        : 'ILOE — Salary ≤ AED 16,000',
    ServiceRating: serviceRating(),
    PolicyIssuanceAllowed: {
      CustomerVerification: true,
      Payment: true,
      PolicyDocuments: true,
    },
    Takaful: false,
    Premium: {
      Status: 'Final',
      PremiumAmountExcludingVAT: aed(base),
      VATAmount: aed(vat),
      VATPercentage: 5.0,
      TotalPremiumAmount: aed(total),
      PaymentFrequency: e.policy.premium_frequency,
    },
  };
}
