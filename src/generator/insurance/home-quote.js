// Home-quote generator — Phase 2.1.
// Synthesizes the Data object for GET /home-insurance-quotes/{QuoteId},
// shaped to AEInsuranceQuoteReadPolicyIssuedResponseProperties (the
// `QuoteStatus: PolicyIssued` variant of the discriminated oneOf — the
// natural state for a persona who already has an active home policy).
// Mirrors the motor-quote structure so quote totals line up with the
// issued-policy total.

import { aed, refNumber } from './_shared.js';
import { genUuid } from './identity.js';
import { MS_PER_DAY } from '../constants.js';

const quoteReference = (rng) => refNumber('HOMQ', rng);

function serviceRating() {
  return {
    FinancialStrength: {
      SolvencyRatio: 65.0,
      YearsInBusiness: 24,
    },
    ClaimsServicePerformance: {
      AverageClaimSettlementTime: 14.0,
      ClaimSettlementRatio: 95.0,
      ClaimRejectionRate: 4.0,
      ClaimsPaymentCapacityRatio: 4.0,
    },
    CustomerServiceComplaintHandling: {
      CustomerComplaintRate: 1.5,
      ComplaintResolutionTime: 6,
      NetPromoterScore: 38,
    },
    PolicyDigitalConvenience: {
      InstantDigitalPolicyIssuance: true,
      DigitalClaimsFiling: true,
      SelfServiceOptions: ['MobileApp', 'WebPortal'],
      CustomerSupportAvailability: ['CallCenter', 'LiveChat'],
    },
  };
}

export function generateHomeQuote({ persona, rng, now }) {
  const h = persona.home;
  const quoteCreatedDays = h.policy.start_date_offset_days + 5;
  const creationDateTime = new Date(now.getTime() - quoteCreatedDays * MS_PER_DAY).toISOString();
  const expirationDateTime = new Date(
    now.getTime() - (quoteCreatedDays - 30) * MS_PER_DAY,
  ).toISOString();

  const value = h.property_value.market_value_aed;
  const premiumExVat = Math.round(value * 0.0015);
  const vat = Math.round(premiumExVat * 0.05);
  const total = premiumExVat + vat;

  const quote = {
    QuoteStatus: 'PolicyIssued',
    QuoteId: genUuid(rng),
    QuoteReference: quoteReference(rng),
    CreationDateTime: creationDateTime,
    ExpirationDateTime: expirationDateTime,
    PlanName: 'Home Buildings & Contents',
    LevelOfCover: 'Buildings + Contents',
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
