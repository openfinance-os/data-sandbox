// Motor-quote generator — Phase 2.0 motor full-coverage slice.
// Synthesizes the Data object for GET /motor-insurance-quotes/{QuoteId},
// shaped to AEInsuranceQuoteReadPolicyIssuedResponseProperties (the
// `QuoteStatus: PolicyIssued` variant of the discriminated oneOf — the
// natural state for a persona who already has an active motor policy).
// Emits the mandatory AEInsuranceQuoteProperties fields plus a coherent
// Premium / PlanName / LevelOfCover so the quote reflects the issued policy.

import { aed } from './motor-policy.js';
import { isoDate, genUuid } from './identity.js';

function quoteReference(rng) {
  return `MTRQ-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

// Spec multiplier: AEInsuranceServiceRatingRateOrRatio is "decimal, 1 dp,
// max 100". Pinned values keep the bundle deterministic and avoid floating
// drift in the AJV format checker.
function serviceRating() {
  return {
    FinancialStrength: {
      // AEInsuranceServiceRatingRateOrRatio caps at 100; the spec field is
      // expressed as a normalised score, not the real-world Solvency II
      // percentage where >100% is common.
      SolvencyRatio: 65.0,
      YearsInBusiness: 24,
    },
    ClaimsServicePerformance: {
      AverageClaimSettlementTime: 12.0,
      ClaimSettlementRatio: 96.5,
      ClaimRejectionRate: 3.5,
      ClaimsPaymentCapacityRatio: 4.2,
    },
    CustomerServiceComplaintHandling: {
      CustomerComplaintRate: 1.8,
      ComplaintResolutionTime: 5,
      NetPromoterScore: 42,
    },
    PolicyDigitalConvenience: {
      InstantDigitalPolicyIssuance: true,
      DigitalClaimsFiling: true,
      SelfServiceOptions: ['MobileApp', 'WebPortal'],
      CustomerSupportAvailability: ['CallCenter', 'LiveChat'],
    },
  };
}

/**
 * Build the read-quote payload (Data) in the `Available` state for the
 * given persona. Premium mirrors the policy generator's heuristic so the
 * quoted total lines up with the issued-policy total.
 *
 * @returns {object} AEInsuranceQuoteReadAvailableResponseProperties
 */
export function generateMotorQuote({ persona, rng, now }) {
  const quoteCreatedDays = persona.policy.start_date_offset_days + 5;
  const creationDateTime = new Date(now.getTime() - quoteCreatedDays * 86400000).toISOString();
  const expirationDateTime = new Date(
    now.getTime() - (quoteCreatedDays - 30) * 86400000,
  ).toISOString();

  const v = persona.vehicle.valuation_aed;
  const baseRate = persona.policy.type === 'Comprehensive' ? 0.045 : 0.025;
  const premiumExVat = Math.round(v * baseRate);
  const vat = Math.round(premiumExVat * 0.05);
  const total = premiumExVat + vat;

  const quote = {
    QuoteStatus: 'PolicyIssued',
    QuoteId: genUuid(rng),
    QuoteReference: quoteReference(rng),
    CreationDateTime: creationDateTime,
    ExpirationDateTime: expirationDateTime,
    PlanName: persona.policy.type === 'Comprehensive' ? 'Motor Comprehensive Plus' : 'Motor TPL',
    LevelOfCover:
      persona.policy.type === 'Comprehensive'
        ? 'Comprehensive — Own Damage + Third Party'
        : 'Third Party Liability only',
    ServiceRating: serviceRating(),
    PolicyIssuanceAllowed: {
      CustomerVerification: true,
      Payment: true,
      PolicyDocuments: true,
    },
    Takaful: persona.policy.takaful,
    Premium: {
      Status: 'Final',
      PremiumAmountExcludingVAT: aed(premiumExVat),
      VATAmount: aed(vat),
      VATPercentage: 5.0,
      TotalPremiumAmount: aed(total),
      PaymentFrequency: 'Annually',
    },
  };

  if (persona.policy.takaful) {
    quote.AlternativeBrandName = `${quote.PlanName} Takaful`;
  }

  return quote;
}
