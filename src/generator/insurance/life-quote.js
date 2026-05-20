// Life-quote generator — Phase 2.1.
// Synthesizes the Data object for GET /life-insurance-quotes/{QuoteId}
// in the PolicyIssued state. Mirrors motor/home/health quote shape;
// Premium uses AEInsuranceDataSharingPremiumProperties (shared with
// motor/home, distinct from health's AEHealthInsurancePremium).

import { aed } from './motor-policy.js';
import { genUuid } from './identity.js';

function quoteReference(rng) {
  return `LIFQ-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

function serviceRating() {
  return {
    FinancialStrength: { SolvencyRatio: 72.0, YearsInBusiness: 30 },
    ClaimsServicePerformance: {
      AverageClaimSettlementTime: 18.0,
      ClaimSettlementRatio: 99.0,
      ClaimRejectionRate: 1.0,
      ClaimsPaymentCapacityRatio: 5.0,
    },
    CustomerServiceComplaintHandling: {
      CustomerComplaintRate: 1.0,
      ComplaintResolutionTime: 7,
      NetPromoterScore: 50,
    },
    PolicyDigitalConvenience: {
      InstantDigitalPolicyIssuance: false,
      DigitalClaimsFiling: true,
      SelfServiceOptions: ['MobileApp', 'WebPortal'],
      CustomerSupportAvailability: ['CallCenter', 'InPerson'],
    },
  };
}

export function generateLifeQuote({ persona, rng, now }) {
  const l = persona.life;
  const quoteCreatedDays = l.policy.start_date_offset_days + 5;
  const creationDateTime = new Date(now.getTime() - quoteCreatedDays * 86400000).toISOString();
  const expirationDateTime = new Date(
    now.getTime() - (quoteCreatedDays - 30) * 86400000,
  ).toISOString();

  const annualRate = l.policy.type_of_life_insurance === 'WholeLifeInsurance' ? 0.012 : 0.005;
  const premiumExVat = Math.round(l.policy.sum_assured_aed * annualRate);
  const vat = Math.round(premiumExVat * 0.05);
  const total = premiumExVat + vat;

  const quote = {
    QuoteStatus: 'PolicyIssued',
    QuoteId: genUuid(rng),
    QuoteReference: quoteReference(rng),
    CreationDateTime: creationDateTime,
    ExpirationDateTime: expirationDateTime,
    PlanName: l.policy.product_name ?? 'Life Term Cover',
    LevelOfCover:
      l.policy.type_of_life_insurance === 'WholeLifeInsurance'
        ? 'Whole-of-life'
        : `Level Term, ${l.policy.term_years} years`,
    ServiceRating: serviceRating(),
    PolicyIssuanceAllowed: {
      CustomerVerification: true,
      Payment: true,
      PolicyDocuments: true,
    },
    Takaful: l.policy.takaful,
    Premium: {
      Status: 'Final',
      PremiumAmountExcludingVAT: aed(premiumExVat),
      VATAmount: aed(vat),
      VATPercentage: 5.0,
      TotalPremiumAmount: aed(total),
      PaymentFrequency: 'Annually',
    },
  };

  if (l.policy.takaful) {
    quote.AlternativeBrandName = `${quote.PlanName} Takaful`;
  }

  return quote;
}
