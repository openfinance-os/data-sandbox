// Insurance generator orchestrator.
// Turns (insurance persona, lfi, seed) into a bundle covering the in-scope
// insurance endpoints. Phase 2.1 GA covers all 7 lines: motor, home, health,
// life, travel, renters, employment. Each persona declares a `line` field —
// defaulting to 'motor' for back-compat with the original 3 motor personas.
//
// Adding a new line is a registry entry below + a `<line>-policy.js` /
// `<line>-quote.js` pair — no orchestrator changes.
//
// EXP-05 / §8.3: bundle is a pure function of (persona, lfi, seed, now).

import { makePrng } from '../../prng.js';
import { generateInsuranceIdentity, genUuid, isoDate } from './identity.js';
import { generateMotorProduct, generateClaims, generatePremium } from './motor-policy.js';
import { generateMotorQuote } from './motor-quote.js';
import { generateHomeProduct, generateHomeClaims, generateHomePremium } from './home-policy.js';
import { generateHomeQuote } from './home-quote.js';
import {
  generateHealthProduct,
  generateHealthEmployment,
  generateHealthClaims,
  generateHealthPremium,
} from './health-policy.js';
import { generateHealthQuote } from './health-quote.js';
import { generateLifeProduct, generateLifeClaims, generateLifePremium } from './life-policy.js';
import { generateLifeQuote } from './life-quote.js';
import {
  generateTravelProduct,
  generateTravelClaims,
  generateTravelPremium,
} from './travel-policy.js';
import { generateTravelQuote } from './travel-quote.js';
import {
  generateRentersProduct,
  generateRentersClaims,
  generateRentersPremium,
} from './renters-policy.js';
import { generateRentersQuote } from './renters-quote.js';
import {
  generateEmploymentProduct,
  generateEmploymentEmployment,
  generateEmploymentAddress,
  generateEmploymentClaims,
  generateEmploymentPremium,
} from './employment-policy.js';
import { generateEmploymentQuote } from './employment-quote.js';
import { generateConsentRecord } from './consents.js';
import { applyInsuranceLfiProfile } from './lfi-profile.js';
import {
  makePolicyDetail,
  makePolicySummary,
  makePaymentDetails,
  makeBundleIdentity,
  pickRandomBankName,
} from './_shared.js';
import { findInsuranceCrossDomainLink, pickFootprintSlotBank } from '../multi-lfi.js';

const DEFAULT_NOW = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

const DEFAULT_BANKS_POOL = 'counterparty_banks_uae_real';

function resolvePools(persona, indexedPools) {
  const namePool = indexedPools.namesByPoolId[persona.demographics.nationality_pool];
  if (!namePool) {
    throw new Error(
      `name pool '${persona.demographics.nationality_pool}' not found for persona ${persona.persona_id}`,
    );
  }
  // Per-line bank-pool refs: motor.finance, home.mortgage, life.finance.
  const banksPoolId =
    persona.finance?.bank_pool ??
    persona.home?.mortgage?.bank_pool ??
    persona.life?.finance?.bank_pool ??
    DEFAULT_BANKS_POOL;
  const banks = indexedPools.counterpartyBanksByCategory[banksPoolId];
  if (!banks) {
    throw new Error(`banks pool '${banksPoolId}' not found for persona ${persona.persona_id}`);
  }
  return { names: namePool, banks };
}

// UAE IBAN: "AE" + 2 check digits + 19 BBAN digits (23 chars total). Used for
// the per-line payment-details payload (Account.Identification with IBAN
// SchemeName).
function genUaeIban(rng) {
  const checkDigits = String(2 + Math.floor(rng() * 98)).padStart(2, '0');
  const bban1 = String(Math.floor(rng() * 1e9)).padStart(9, '0');
  const bban2 = String(Math.floor(rng() * 1e10)).padStart(10, '0');
  return `AE${checkDigits}${bban1}${bban2}`;
}

// Per-line builder registry. New lines drop in here without touching
// the dispatcher. Each builder MUST return a bundle that already has its
// per-line LFI profile applied — `buildInsuranceBundle` only adds the
// (LFI-exempt) consent record on top.
const LINE_BUILDERS = {
  motor: buildMotorBundle,
  home: buildHomeBundle,
  health: buildHealthBundle,
  life: buildLifeBundle,
  travel: buildTravelBundle,
  renters: buildRentersBundle,
  employment: buildEmploymentBundle,
};

export function buildInsuranceBundle({ persona, lfi, seed, pools, now = DEFAULT_NOW }) {
  const line = persona.line ?? 'motor';
  const builder = LINE_BUILDERS[line];
  if (!builder) {
    throw new Error(`unknown insurance line '${line}' for persona ${persona.persona_id}`);
  }
  const bundle = builder({ persona, lfi, seed, pools, now });

  // Every insurance bundle carries one consent record covering its own
  // line. Consent generation uses an independent RNG stream so the consent
  // ids stay deterministic per (persona, lfi, seed) without being affected
  // by the upstream line generator's draw count. Consents come AFTER LFI
  // redaction (each per-line builder applies the redaction itself) — the
  // consent record itself isn't subject to LFI bands.
  //
  // Phase 2.2 — the line is included in the consent PRNG seed so that
  // multi-domain personas (whose buildMultiDomainBundle calls this
  // function once per declared line, all with the same persona_id +
  // seed) get a DISTINCT ConsentId per line. Without the line in the
  // seed, motor/home/travel consents collide on identical IDs and the
  // /insurance-consents/{ConsentId} detail endpoint overwrites itself
  // — a TPP asking for the motor consent would get travel data back.
  const consentRng = makePrng(persona.persona_id, 'consents', line, seed);
  bundle.consents = [generateConsentRecord({ persona, rng: consentRng, now })];
  return bundle;
}

function buildMotorBundle({ persona, lfi, seed, pools, now }) {
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const p = resolvePools(persona, pools);

  const { name, policyHolder, identity } = generateInsuranceIdentity({
    persona,
    names: p.names,
    rng,
    now,
  });

  // Phase 2.2 — if the persona declares a cross_domain_link from the
  // motor insurer slot to a banking slot (typically the salary slot
  // where the auto loan sits), resolve the linked bank up front and
  // pass it to motor-policy as the preferred CarFinance bank.
  const motorLinkSlot = findInsuranceCrossDomainLink(persona, 'motor');
  const preferredFinanceBank = motorLinkSlot
    ? pickFootprintSlotBank(persona, motorLinkSlot, p.banks)
    : null;
  const product = generateMotorProduct({
    persona,
    names: p.names,
    banks: p.banks,
    rng,
    now,
    preferredFinanceBank,
  });
  const claims = generateClaims({ persona });
  const premium = generatePremium({ persona });

  const insurancePolicyId = genUuid(rng);

  const motorPolicyDetail = makePolicyDetail({
    insurancePolicyId,
    policyHolder,
    identity,
    product,
    claims,
    premium,
  });

  const motorPolicySummary = makePolicySummary({
    insurancePolicyId,
    policyNumber: product.Policy.PolicyNumber,
    startDate: product.Policy.PolicyStartDate,
    endDate: isoDate(now, 365 - persona.policy.start_date_offset_days),
  });

  // Motor's bank fallback uses CarFinance.BankName when present; only draw
  // from the counterparty pool otherwise — matches pre-refactor draw order.
  const bank = product.CarFinance?.BankName ?? pickRandomBankName(p.banks, rng);
  const accountIban = genUaeIban(rng);
  const paymentDetails = makePaymentDetails({ accountIban, name, bankName: bank });

  const motorQuote = generateMotorQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'motor',
    identity: makeBundleIdentity({ name, persona }),
    motorPolicies: [motorPolicyDetail],
    motorPolicySummaries: [motorPolicySummary],
    paymentDetails,
    motorQuote,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

function buildHealthBundle({ persona, lfi, seed, pools, now }) {
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const p = resolvePools(persona, pools);

  const { name, policyHolder, identity } = generateInsuranceIdentity({
    persona,
    names: p.names,
    rng,
    now,
  });

  // Health PolicyHolder also carries an Employment block (different schema
  // from motor/home PolicyHolder). Splice it onto the shared identity output.
  const employment = generateHealthEmployment({ persona });
  if (employment) policyHolder.Employment = employment;

  const { product, policyNumber, startDate, endDate } = generateHealthProduct({
    persona,
    names: p.names,
    rng,
    now,
  });
  const claims = generateHealthClaims({ persona });
  const premium = generateHealthPremium({ persona });

  const insurancePolicyId = genUuid(rng);

  const healthPolicyDetail = makePolicyDetail({
    insurancePolicyId,
    policyHolder,
    identity,
    product,
    claims,
    premium,
  });
  const healthPolicySummary = makePolicySummary({
    insurancePolicyId,
    policyNumber,
    startDate,
    endDate,
  });

  const bankName = pickRandomBankName(p.banks, rng);
  const accountIban = genUaeIban(rng);
  const paymentDetails = makePaymentDetails({ accountIban, name, bankName });

  const healthQuote = generateHealthQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'health',
    identity: makeBundleIdentity({ name, persona }),
    healthPolicies: [healthPolicyDetail],
    healthPolicySummaries: [healthPolicySummary],
    paymentDetails,
    healthQuote,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

function buildRentersBundle({ persona, lfi, seed, pools, now }) {
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const p = resolvePools(persona, pools);

  const { name, policyHolder, identity } = generateInsuranceIdentity({
    persona,
    names: p.names,
    rng,
    now,
  });

  const { product, policyNumber, startDate, endDate } = generateRentersProduct({
    persona,
    rng,
    now,
  });
  const claims = generateRentersClaims({ persona });
  const premium = generateRentersPremium({ persona });

  const insurancePolicyId = genUuid(rng);

  const rentersPolicyDetail = makePolicyDetail({
    insurancePolicyId,
    policyHolder,
    identity,
    product,
    claims,
    premium,
  });
  const rentersPolicySummary = makePolicySummary({
    insurancePolicyId,
    policyNumber,
    startDate,
    endDate,
  });

  const bankName = pickRandomBankName(p.banks, rng);
  const accountIban = genUaeIban(rng);
  const paymentDetails = makePaymentDetails({ accountIban, name, bankName });

  const rentersQuote = generateRentersQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'renters',
    identity: makeBundleIdentity({ name, persona }),
    rentersPolicies: [rentersPolicyDetail],
    rentersPolicySummaries: [rentersPolicySummary],
    paymentDetails,
    rentersQuote,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

function buildEmploymentBundle({ persona, lfi, seed, pools, now }) {
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const p = resolvePools(persona, pools);

  // Employment uses generateInsuranceIdentity for name/identity generation
  // but the employment-line PolicyHolder Address shape and Employment
  // block diverge from the shared AEInsuranceCustomerQuoteProperties used
  // by motor/home/life/renters. Splice in the line-specific overrides.
  const {
    name,
    policyHolder: basePolicyHolder,
    identity,
  } = generateInsuranceIdentity({
    persona,
    names: p.names,
    rng,
    now,
  });
  const policyHolder = {
    ...basePolicyHolder,
    Address: generateEmploymentAddress({ persona, rng }),
    Employment: generateEmploymentEmployment({ persona }),
  };

  const { product, policyNumber, startDate, endDate } = generateEmploymentProduct({
    persona,
    rng,
    now,
  });
  const claims = generateEmploymentClaims({ persona });
  const premium = generateEmploymentPremium({ persona });

  const insurancePolicyId = genUuid(rng);

  const employmentPolicyDetail = makePolicyDetail({
    insurancePolicyId,
    policyHolder,
    identity,
    product,
    claims,
    premium,
  });
  const employmentPolicySummary = makePolicySummary({
    insurancePolicyId,
    policyNumber,
    startDate,
    endDate,
  });

  const bankName = pickRandomBankName(p.banks, rng);
  const accountIban = genUaeIban(rng);
  const paymentDetails = makePaymentDetails({ accountIban, name, bankName });

  const employmentQuote = generateEmploymentQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'employment',
    identity: makeBundleIdentity({ name, persona }),
    employmentPolicies: [employmentPolicyDetail],
    employmentPolicySummaries: [employmentPolicySummary],
    paymentDetails,
    employmentQuote,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

function buildTravelBundle({ persona, lfi, seed, pools, now }) {
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const p = resolvePools(persona, pools);

  const { name, policyHolder, identity } = generateInsuranceIdentity({
    persona,
    names: p.names,
    rng,
    now,
  });

  const { product, policyNumber, startDate, endDate } = generateTravelProduct({
    persona,
    names: p.names,
    rng,
    now,
  });
  const claims = generateTravelClaims({ persona });
  const premium = generateTravelPremium({ persona });

  const insurancePolicyId = genUuid(rng);

  const travelPolicyDetail = makePolicyDetail({
    insurancePolicyId,
    policyHolder,
    identity,
    product,
    claims,
    premium,
  });
  const travelPolicySummary = makePolicySummary({
    insurancePolicyId,
    policyNumber,
    startDate,
    endDate,
  });

  const bankName = pickRandomBankName(p.banks, rng);
  const accountIban = genUaeIban(rng);
  const paymentDetails = makePaymentDetails({ accountIban, name, bankName });

  const travelQuote = generateTravelQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'travel',
    identity: makeBundleIdentity({ name, persona }),
    travelPolicies: [travelPolicyDetail],
    travelPolicySummaries: [travelPolicySummary],
    paymentDetails,
    travelQuote,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

function buildLifeBundle({ persona, lfi, seed, pools, now }) {
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const p = resolvePools(persona, pools);

  const { name, policyHolder, identity } = generateInsuranceIdentity({
    persona,
    names: p.names,
    rng,
    now,
  });

  const { product, policyNumber, startDate, endDate } = generateLifeProduct({
    persona,
    policyHolder,
    names: p.names,
    banks: p.banks,
    rng,
    now,
  });
  const claims = generateLifeClaims({ persona });
  const premium = generateLifePremium({ persona });

  const insurancePolicyId = genUuid(rng);

  const lifePolicyDetail = makePolicyDetail({
    insurancePolicyId,
    policyHolder,
    identity,
    product,
    claims,
    premium,
  });
  const lifePolicySummary = makePolicySummary({
    insurancePolicyId,
    policyNumber,
    startDate,
    endDate,
  });

  // Use the FinanceAgainstPolicy bank when present (mortgage-protection
  // narrative), otherwise draw a counterparty bank.
  const bankName =
    product.FinanceAgainstPolicy?.FinanceProvider ?? pickRandomBankName(p.banks, rng);
  const accountIban = genUaeIban(rng);
  const paymentDetails = makePaymentDetails({ accountIban, name, bankName });

  const lifeQuote = generateLifeQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'life',
    identity: makeBundleIdentity({ name, persona }),
    lifePolicies: [lifePolicyDetail],
    lifePolicySummaries: [lifePolicySummary],
    paymentDetails,
    lifeQuote,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

function buildHomeBundle({ persona, lfi, seed, pools, now }) {
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const p = resolvePools(persona, pools);

  const { name, policyHolder, identity } = generateInsuranceIdentity({
    persona,
    names: p.names,
    rng,
    now,
  });

  // Resolve mortgage bank deterministically up front so home-policy.js can
  // reference it without re-drawing — keeps bank identity consistent between
  // the persona's Mortgage.BankName and the payment-details Bank.Name.
  //
  // Phase 2.2 — for multi-domain personas declaring a `cross_domain_link`
  // from the home insurer slot to a banking slot (typically mortgage-lender),
  // resolve the mortgage bank from THAT banking slot's deterministic bank
  // pick. This keeps the home-insurance Mortgage.BankName visually
  // consistent with where the persona's mortgage actually sits in the
  // banking bundle. Falls back to the random pool draw for personas
  // without the cross-domain link declared.
  let mortgageBankName = null;
  if (persona.home?.mortgage?.has_mortgage) {
    // Always advance the RNG with a random pool draw FIRST, then
    // prefer the cross-domain-linked bank when declared. Otherwise the
    // RNG state diverges between personas with vs. without a
    // cross_domain_link, and retro-adding the link to an existing
    // persona silently shifts every downstream draw (insurance policy
    // id, IBAN, quote) — EXP-05 trap.
    const fallbackBankName = pickRandomBankName(p.banks, rng);
    const linkedSlotKey = findInsuranceCrossDomainLink(persona, 'home');
    const linkedBank = linkedSlotKey
      ? pickFootprintSlotBank(persona, linkedSlotKey, p.banks)
      : null;
    mortgageBankName = linkedBank?.name ?? fallbackBankName;
    persona = {
      ...persona,
      home: {
        ...persona.home,
        mortgage: { ...persona.home.mortgage, bank_name: mortgageBankName },
      },
    };
  }

  const { product, policyNumber, startDate, endDate } = generateHomeProduct({
    persona,
    rng,
    now,
  });
  const claims = generateHomeClaims({ persona });
  const premium = generateHomePremium({ persona });

  const insurancePolicyId = genUuid(rng);

  const homePolicyDetail = makePolicyDetail({
    insurancePolicyId,
    policyHolder,
    identity,
    product,
    claims,
    premium,
  });
  const homePolicySummary = makePolicySummary({
    insurancePolicyId,
    policyNumber,
    startDate,
    endDate,
  });

  const bankName = mortgageBankName ?? pickRandomBankName(p.banks, rng);
  const accountIban = genUaeIban(rng);
  const paymentDetails = makePaymentDetails({ accountIban, name, bankName });

  const homeQuote = generateHomeQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'home',
    identity: makeBundleIdentity({ name, persona }),
    homePolicies: [homePolicyDetail],
    homePolicySummaries: [homePolicySummary],
    paymentDetails,
    homeQuote,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}
