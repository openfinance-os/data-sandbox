// Health-policy generator — Phase 2.1.
// Synthesizes the Product (Policy, InsuredParties, Sponsor), Claims, and
// Premium sub-objects for AEHealthInsurancePolicyProperties1. Health
// diverges from motor/home in three notable places:
//   1. PolicyHolder includes an Employment block (mandatory in the
//      flattened parser view; in the spec, mandatory only when present).
//   2. Product.Policy requires CoverSubjects, IsPolicyholderInsured, and
//      PolicyTerm (ISO-8601 duration).
//   3. Premium uses AEHealthInsurancePremium — different from the shared
//      AEInsuranceDataSharingPremiumProperties used by home/motor.

import { drawName } from '../identity.js';
import { aed } from './motor-policy.js';
import { isoDate } from './identity.js';

// Persona policy.channel → spec PolicyPurchaseChannelType enum.
const CHANNEL_MAP = {
  Direct: 'Direct',
  Agent: 'Agent',
  Broker: 'Broker',
  Bank: 'Bank',
  TPA: 'TPA',
  Aggregator: 'Aggregation',
};

function policyNumber(rng) {
  return `HLT-${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`;
}

// ISO-8601 duration: Pn[Y]n[M] — spec pattern is ^P(\d+Y)?(\d+M)?$.
function policyTermDuration(years, months = 0) {
  let s = 'P';
  if (years > 0) s += `${years}Y`;
  if (months > 0) s += `${months}M`;
  if (s === 'P') s = 'P1Y';
  return s;
}

// nationality_pool → ISO 3166-1 alpha-3 (mirrors identity.js, kept local
// to avoid importing a private const).
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

function generateInsuredParties({ persona, names, rng, now }) {
  const h = persona.health;
  const out = [];
  for (const dep of h.insured_parties ?? []) {
    const draw = drawName(rng, names);
    const given = dep.given_name ?? draw.given;
    const surname = dep.surname ?? draw.surname;
    const nationality = NATIONALITY_BY_POOL[persona.demographics.nationality_pool] ?? 'ARE';
    const party = {
      RelationshipToPolicyholder: dep.relationship,
      FirstName: given,
      LastName: surname,
      Gender: dep.gender ?? (rng() < 0.5 ? 'Male' : 'Female'),
      DateOfBirth: dobFromAge(dep.age, rng, now),
      Nationality: nationality,
      Address: [
        {
          AddressLine: [
            `Building ${1 + Math.floor(rng() * 99)}`,
            `Street ${1 + Math.floor(rng() * 30)}`,
            persona.demographics.emirate,
          ],
          Country: 'AE',
        },
      ],
    };
    if (persona.demographics.has_visa) {
      party.Identity = {
        EmiratesId: { EmiratesIdNumber: genEmiratesId(rng) },
        Visa: { VisaType: 'Residence', VisaNumber: genVisaNumber(rng) },
      };
    } else {
      party.Identity = {
        EmiratesId: { EmiratesIdNumber: genEmiratesId(rng) },
      };
    }
    out.push(party);
  }
  return out;
}

function generateSponsor({ persona }) {
  const s = persona.health.sponsor;
  if (!s) return null;
  return [
    {
      PersonSponsored: 'Policyholder',
      SponsorEntityID: String(s.entity_id ?? '000000'),
      SponsorEntityIDType: s.entity_id_type ?? 'EstablishmentCode',
      SponsorType: s.type ?? 'Resident',
    },
  ];
}

export function generateHealthProduct({ persona, names, rng, now }) {
  const h = persona.health;
  const startOffset = h.policy.start_date_offset_days;
  const startDate = isoDate(now, -startOffset);
  const endDate = isoDate(now, 365 - startOffset);

  const policyCovers = [
    {
      CoverType: 'InpatientCover',
      Description: 'Inpatient hospitalisation cover within the care network.',
      Required: true,
      CoverLimit: aed(h.policy.annual_limit_aed),
      CoverInclusionsAndExclusions: [
        {
          InclusionAndExclusionDescription:
            'Includes inpatient treatment at network hospitals; excludes elective cosmetic surgery.',
        },
      ],
      CoverExcess: aed(h.policy.excess_aed),
    },
  ];

  const policy = {
    CoverSubjects: h.policy.cover_subjects,
    PolicyStartDate: startDate,
    IsPolicyholderInsured: h.policy.policyholder_insured,
    TypeOfPolicy: h.policy.type_of_policy ?? 'HealthInsuranceIndividual',
    PolicyTerm: policyTermDuration(1),
    CareNetwork: h.policy.care_network ?? 'Network A',
    RegionsCoverage: h.policy.regions_coverage ?? 'UAE',
    Takaful: h.policy.takaful,
    ProductName: h.policy.product_name ?? 'Health Comprehensive',
    PolicyEndDate: endDate,
    PolicyExcess: aed(h.policy.excess_aed),
    PolicyCoverAndBenefits: policyCovers,
    PolicyPurchaseChannelType: CHANNEL_MAP[h.policy.channel] ?? 'Other',
  };

  const product = {
    Policy: policy,
  };

  const insuredParties = generateInsuredParties({ persona, names, rng, now });
  if (insuredParties.length > 0) product.InsuredParties = insuredParties;

  const sponsor = generateSponsor({ persona });
  if (sponsor) product.Sponsor = sponsor;

  return { product, policyNumber: policyNumber(rng), startDate, endDate };
}

// Health PolicyHolder requires an Employment.MonthlyIncomeAmount when an
// Employment block is present. Returns the block to merge into the
// generator's PolicyHolder; null when persona doesn't declare employment.
export function generateHealthEmployment({ persona }) {
  const e = persona.health.employment;
  if (!e) return null;
  const out = {
    EmployerName: e.employer_name ?? 'Synthetic Employer LLC',
    MonthlyIncomeAmount: aed(e.monthly_income_aed),
    AnnualIncomeAmount: aed(e.monthly_income_aed * 12),
    EmployerAddress: {
      AddressLine: [
        `Building ${1 + (e.monthly_income_aed % 99)}`,
        persona.demographics.emirate,
      ],
      Country: 'AE',
    },
  };
  if (e.salary_band) out.SalaryBand = e.salary_band;
  if (e.profession) out.Profession = e.profession;
  if (e.job_title) out.JobTitle = e.job_title;
  return out;
}

export function generateHealthClaims({ persona }) {
  const c = persona.health.claims ?? {};
  const summary = [
    {
      NumberOfMonthsInPeriod: c.history_months ?? 12,
      Claims: c.claims_in_period ?? 0,
      ApprovedClaims: c.approved_claims ?? 0,
      TotalGrossApprovedClaimAmount: aed(c.total_gross_aed ?? 0),
      TotalGrossPaidAmount: aed(c.total_gross_aed ?? 0),
    },
  ];
  return { Summary: summary, NoClaimsDiscountAvailable: (c.claims_in_period ?? 0) === 0 };
}

export function generateHealthPremium({ persona }) {
  // Heuristic: ~AED 3.5K per insured party per year baseline, scaled by
  // annual limit to keep premium ≈ 1% of the limit on the comprehensive
  // tier — recognisable shape for UAE health insurance pricing.
  const h = persona.health;
  const numInsured = 1 + (h.insured_parties?.length ?? 0);
  const base = numInsured * Math.round(h.policy.annual_limit_aed * 0.01);
  const premiumExVat = base;
  const vat = Math.round(premiumExVat * 0.05);
  const total = premiumExVat + vat;
  return {
    Status: 'Final',
    PremiumAmountExcludingVAT: aed(premiumExVat),
    VATAmount: aed(vat),
    VATPercentage: 5.0,
    TotalPremiumAmount: aed(total),
    PaymentFrequency: 'Annually',
  };
}
