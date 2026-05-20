// Life-policy generator — Phase 2.1.
// Synthesizes the Product (Policy, InsuredParties, optional Beneficiaries
// + FinanceAgainstPolicy + Riders), Claims, and Premium sub-objects for
// AELifeInsurancePolicyProperties1. Life diverges from motor/home/health:
//   1. Product.Policy required surface — CoverType (Sole|Joint),
//      IsPolicyholderLifeAssured, TypeOfLifeInsurance (WholeLife |
//      LevelTerm | DecreasingTerm), InsurancePurpose, SumAssuredAmount,
//      IsFinanceAgainstPolicy, Takaful, ProductName,
//      PolicyCoverAndBenefits, PolicyPurchaseChannelType.
//   2. Product.InsuredParties is mandatory (≥1) — life schema treats the
//      life-assured as a separate entity from the policyholder by
//      construction, even when IsPolicyholderLifeAssured=true.
//   3. Premium uses the shared AEInsuranceDataSharingPremiumProperties
//      (same shape as motor/home — TotalPremiumAmount + PaymentFrequency
//      mandatory).

import { drawName } from '../identity.js';
import { aed } from './motor-policy.js';
import { isoDate } from './identity.js';

const CHANNEL_MAP = {
  Direct: 'Direct',
  Agent: 'Agent',
  Broker: 'Broker',
  Bank: 'Bank',
  InvFinInst: 'InvFinInst',
  Aggregator: 'Aggregation',
};

function policyNumber(rng) {
  return `LIF-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

function policyTermDuration(years) {
  return `P${Math.max(1, years)}Y`;
}

const NATIONALITY_BY_POOL = {
  emirati: 'ARE',
  expat_arab: 'EGY',
  expat_indian: 'IND',
};

function genEmiratesId(rng) {
  const year = 1960 + Math.floor(rng() * 50);
  const seq = Math.floor(rng() * 9_999_999);
  const check = Math.floor(rng() * 10);
  return `784-${year}-${String(seq).padStart(7, '0')}-${check}`;
}

function genVisaNumber(rng) {
  return String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0');
}

function dobFromAge(age, rng, now) {
  const year = now.getUTCFullYear() - age;
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function genMobileNumber(rng) {
  const digits = Math.floor(rng() * 100_000_000);
  return `+9715${String(digits).padStart(8, '0')}`;
}

function generateInsuredParties({ persona, policyHolder, names, rng, now }) {
  const l = persona.life;
  const out = [];

  // If the policyholder is also life-assured, surface them as the first
  // InsuredParty (with the same identity as the PolicyHolder block but
  // shaped to the InsuredParty schema, which doesn't carry the same
  // mandatory subset — it requires only FirstName/LastName/Gender/DOB).
  if (l.policy.policyholder_life_assured) {
    out.push({
      FirstName: policyHolder.FirstName,
      LastName: policyHolder.LastName,
      Gender: policyHolder.Gender,
      DateOfBirth: policyHolder.DateOfBirth,
      Nationality: policyHolder.Nationality,
      MobileNumber: policyHolder.MobileNumber,
      EmailAddress: policyHolder.EmailAddress,
      Address: policyHolder.Address,
      Identity: {
        EmiratesId: { EmiratesIdNumber: genEmiratesId(rng) },
        ...(persona.demographics.has_visa
          ? { Visa: { VisaType: 'Residence', VisaNumber: genVisaNumber(rng) } }
          : {}),
      },
    });
  }

  for (const dep of l.insured_parties ?? []) {
    const draw = drawName(rng, names);
    const given = dep.given_name ?? draw.given;
    const surname = dep.surname ?? draw.surname;
    const nationality = NATIONALITY_BY_POOL[persona.demographics.nationality_pool] ?? 'ARE';
    out.push({
      FirstName: given,
      LastName: surname,
      Gender: dep.gender ?? (rng() < 0.5 ? 'Male' : 'Female'),
      DateOfBirth: dobFromAge(dep.age, rng, now),
      Nationality: nationality,
      MobileNumber: genMobileNumber(rng),
      Address: policyHolder.Address,
      Identity: {
        EmiratesId: { EmiratesIdNumber: genEmiratesId(rng) },
      },
    });
  }
  return out;
}

function generateBeneficiaries({ persona, names, rng }) {
  const list = persona.life.beneficiaries ?? [];
  const out = [];
  for (const b of list) {
    const draw = drawName(rng, names);
    out.push({
      FirstName: b.given_name ?? draw.given,
      LastName: b.surname ?? draw.surname,
      MobileNumber: genMobileNumber(rng),
      RelationshipToPolicyholder: b.relationship,
    });
  }
  return out;
}

function generateFinanceAgainstPolicy({ persona, banks, rng, preferredBank }) {
  const f = persona.life.finance;
  if (!f) return null;
  // Phase 2.2 — multi-domain personas can declare a cross_domain_link
  // from the life insurer slot to a banking slot (typically the
  // mortgage-lender, when life is mortgage-protection cover). The
  // FinanceProvider name resolves from that banking slot's deterministic
  // bank pick so the life-insurance and banking views agree on which
  // LFI holds the finance against the policy. The fallback random
  // draw runs unconditionally (and is discarded when preferredBank is
  // set) so RNG state is identical regardless of link presence —
  // EXP-05 trap-fix, mirrors motor + home.
  const fallbackBank = banks.banks[Math.floor(rng() * banks.banks.length)];
  const bank = preferredBank ?? fallbackBank;
  return {
    FinanceProvider: bank.name,
    FinanceAmount: aed(f.amount_aed),
    ValueOfFinanceAgainstPolicyAmount: aed(f.value_against_policy_aed ?? f.amount_aed),
  };
}

export function generateLifeProduct({ persona, policyHolder, names, banks, rng, now, preferredFinanceBank }) {
  const l = persona.life;
  const startOffset = l.policy.start_date_offset_days;
  const startDate = isoDate(now, -startOffset);
  const policyEnd = isoDate(now, l.policy.term_years * 365 - startOffset);

  const policyCovers = [
    {
      CoverType: 'DeathBenefit',
      Description: 'Death-benefit cover paid to nominated beneficiaries.',
      Required: true,
      CoverLimit: aed(l.policy.sum_assured_aed),
      CoverInclusionsAndExclusions: [
        {
          InclusionAndExclusionDescription:
            'Includes natural and accidental death; excludes self-inflicted death within the first policy year.',
        },
      ],
    },
  ];

  const policy = {
    CoverType: l.policy.cover_type,
    IsPolicyholderLifeAssured: l.policy.policyholder_life_assured,
    TypeOfLifeInsurance: l.policy.type_of_life_insurance,
    InsurancePurpose: l.policy.insurance_purpose,
    SumAssuredAmount: aed(l.policy.sum_assured_aed),
    PolicyTerm: policyTermDuration(l.policy.term_years),
    PolicyStartDate: startDate,
    IsFinanceAgainstPolicy: !!l.finance,
    Takaful: l.policy.takaful,
    ProductName: l.policy.product_name ?? 'Life Term Cover',
    PolicyEndDate: policyEnd,
    PolicyCoverAndBenefits: policyCovers,
    PolicyPurchaseChannelType: CHANNEL_MAP[l.policy.channel] ?? 'Other',
  };

  const product = {
    Policy: policy,
    InsuredParties: generateInsuredParties({ persona, policyHolder, names, rng, now }),
  };

  const beneficiaries = generateBeneficiaries({ persona, names, rng });
  if (beneficiaries.length > 0) product.Beneficiaries = beneficiaries;

  const finance = generateFinanceAgainstPolicy({ persona, banks, rng, preferredBank: preferredFinanceBank });
  if (finance) product.FinanceAgainstPolicy = finance;

  return { product, policyNumber: policyNumber(rng), startDate, endDate: policyEnd };
}

export function generateLifeClaims({ persona }) {
  const c = persona.life.claims ?? {};
  const summary = [
    {
      NumberOfMonthsInPeriod: c.history_months ?? 60,
      Claims: c.claims_in_period ?? 0,
      ApprovedClaims: c.approved_claims ?? 0,
      TotalGrossApprovedClaimAmount: aed(c.total_gross_aed ?? 0),
      TotalGrossPaidAmount: aed(c.total_gross_aed ?? 0),
    },
  ];
  return { Summary: summary, NoClaimsDiscountAvailable: (c.claims_in_period ?? 0) === 0 };
}

export function generateLifePremium({ persona }) {
  // Heuristic: ~0.5% of sum-assured per year for term life on a healthy
  // adult, +5% VAT. Keeps the heuristic mid-market and recognisable.
  const sa = persona.life.policy.sum_assured_aed;
  const annualRate = persona.life.policy.type_of_life_insurance === 'WholeLifeInsurance'
    ? 0.012
    : 0.005;
  const total = Math.round(sa * annualRate);
  return {
    TotalPremiumAmount: aed(total),
    PaymentFrequency: 'Annually',
    PaymentMode: 'DirectDebit', // optional; LFI-redactable.
  };
}
