// Renters-quote generator — Phase 2.1.
// PolicyIssued-state quote shaped to AEInsuranceQuoteReadResponseBody1.
// Premium uses AEInsurancePremiumProperties (VAT split mandatory),
// matching the established quote-side Premium shape.

import { aed, refNumber } from './_shared.js';
import { genUuid } from './identity.js';
import { MS_PER_DAY } from '../constants.js';

const quoteReference = (rng) => refNumber('RNTQ', rng);

function serviceRating() {
  return {
    FinancialStrength: { SolvencyRatio: 64.0, YearsInBusiness: 16 },
    ClaimsServicePerformance: {
      AverageClaimSettlementTime: 11.0,
      ClaimSettlementRatio: 95.5,
      ClaimRejectionRate: 4.5,
      ClaimsPaymentCapacityRatio: 4.0,
    },
    CustomerServiceComplaintHandling: {
      CustomerComplaintRate: 2.2,
      ComplaintResolutionTime: 5,
      NetPromoterScore: 39,
    },
    PolicyDigitalConvenience: {
      InstantDigitalPolicyIssuance: true,
      DigitalClaimsFiling: true,
      SelfServiceOptions: ['MobileApp', 'WebPortal'],
      CustomerSupportAvailability: ['CallCenter', 'LiveChat'],
    },
  };
}

export function generateRentersQuote({ persona, rng, now }) {
  const r = persona.renters;
  const quoteCreatedDays = r.policy.start_date_offset_days + 5;
  const creationDateTime = new Date(now.getTime() - quoteCreatedDays * MS_PER_DAY).toISOString();
  const expirationDateTime = new Date(
    now.getTime() - (quoteCreatedDays - 30) * MS_PER_DAY,
  ).toISOString();

  const base = Math.round(r.contents.declared_value_aed * 0.005);
  const vat = Math.round(base * 0.05);
  const total = base + vat;

  const quote = {
    QuoteStatus: 'PolicyIssued',
    QuoteId: genUuid(rng),
    QuoteReference: quoteReference(rng),
    CreationDateTime: creationDateTime,
    ExpirationDateTime: expirationDateTime,
    PlanName: r.policy.product_name ?? 'Renters Contents',
    LevelOfCover: 'Contents only',
    ServiceRating: serviceRating(),
    PolicyIssuanceAllowed: {
      CustomerVerification: true,
      Payment: true,
      PolicyDocuments: true,
    },
    Takaful: r.policy.takaful,
    Premium: {
      Status: 'Final',
      PremiumAmountExcludingVAT: aed(base),
      VATAmount: aed(vat),
      VATPercentage: 5.0,
      TotalPremiumAmount: aed(total),
      PaymentFrequency: 'Annually',
    },
  };

  if (r.policy.takaful) {
    quote.AlternativeBrandName = `${quote.PlanName} Takaful`;
  }

  return quote;
}
