// Health-quote generator — Phase 2.1.
// Synthesizes the Data object for GET /health-insurance-quotes/{QuoteId}
// in the PolicyIssued state. Mirrors motor-quote / home-quote shape; the
// Premium block is the AEHealthInsurancePremium variant (different
// schema from the home/motor premium — adds Status + VATPercentage as
// part of the required surface, plus matches the health-policy premium).

import { aed, refNumber } from './_shared.js';
import { genUuid } from './identity.js';
import { MS_PER_DAY } from '../constants.js';

const quoteReference = (rng) => refNumber('HLTQ', rng);

function serviceRating() {
  return {
    FinancialStrength: { SolvencyRatio: 70.0, YearsInBusiness: 22 },
    ClaimsServicePerformance: {
      AverageClaimSettlementTime: 9.0,
      ClaimSettlementRatio: 97.0,
      ClaimRejectionRate: 3.0,
      ClaimsPaymentCapacityRatio: 4.5,
    },
    CustomerServiceComplaintHandling: {
      CustomerComplaintRate: 2.0,
      ComplaintResolutionTime: 4,
      NetPromoterScore: 45,
    },
    PolicyDigitalConvenience: {
      InstantDigitalPolicyIssuance: true,
      DigitalClaimsFiling: true,
      SelfServiceOptions: ['MobileApp', 'WebPortal'],
      CustomerSupportAvailability: ['CallCenter', 'LiveChat'],
    },
  };
}

export function generateHealthQuote({ persona, rng, now }) {
  const h = persona.health;
  const quoteCreatedDays = h.policy.start_date_offset_days + 5;
  const creationDateTime = new Date(now.getTime() - quoteCreatedDays * MS_PER_DAY).toISOString();
  const expirationDateTime = new Date(
    now.getTime() - (quoteCreatedDays - 30) * MS_PER_DAY,
  ).toISOString();

  const numInsured = 1 + (h.insured_parties?.length ?? 0);
  const premiumExVat = numInsured * Math.round(h.policy.annual_limit_aed * 0.01);
  const vat = Math.round(premiumExVat * 0.05);
  const total = premiumExVat + vat;

  const quote = {
    QuoteStatus: 'PolicyIssued',
    QuoteId: genUuid(rng),
    QuoteReference: quoteReference(rng),
    CreationDateTime: creationDateTime,
    ExpirationDateTime: expirationDateTime,
    PlanName: h.policy.product_name ?? 'Health Comprehensive',
    LevelOfCover:
      h.policy.cover_subjects === 'SelfAndFamily'
        ? 'Comprehensive — Self + Family'
        : 'Comprehensive — Self',
    ServiceRating: serviceRating(),
    PolicyIssuanceAllowed: {
      CustomerVerification: true,
      Payment: true,
      PolicyDocuments: true,
    },
    Takaful: h.policy.takaful,
    Premium: {
      Status: 'Final',
      PremiumAmountExcludingVAT: aed(premiumExVat),
      VATAmount: aed(vat),
      VATPercentage: 5.0,
      TotalPremiumAmount: aed(total),
      PaymentFrequency: 'Annually',
    },
  };

  if (h.policy.takaful) {
    quote.AlternativeBrandName = `${quote.PlanName} Takaful`;
  }

  return quote;
}
