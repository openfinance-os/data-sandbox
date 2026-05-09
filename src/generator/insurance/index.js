// Insurance generator orchestrator.
// Turns (insurance persona, lfi, seed) into a bundle covering the in-scope
// insurance endpoints. Phase 2.0 shipped Motor (4 endpoints, 3 personas);
// Phase 2.1 adds Home as the first non-motor line. Each persona declares a
// `line` field (motor | home) — defaulting to 'motor' for back-compat with
// the existing 3 motor personas.
//
// EXP-05 / §8.3: bundle is a pure function of (persona, lfi, seed, now).

import { makePrng } from '../../prng.js';
import { generateInsuranceIdentity, genUuid, isoDate } from './identity.js';
import {
  generateMotorProduct,
  generateClaims,
  generatePremium,
} from './motor-policy.js';
import { generateMotorQuote } from './motor-quote.js';
import {
  generateHomeProduct,
  generateHomeClaims,
  generateHomePremium,
} from './home-policy.js';
import { generateHomeQuote } from './home-quote.js';
import {
  generateHealthProduct,
  generateHealthEmployment,
  generateHealthClaims,
  generateHealthPremium,
} from './health-policy.js';
import { generateHealthQuote } from './health-quote.js';
import { applyInsuranceLfiProfile } from './lfi-profile.js';

const DEFAULT_NOW = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

const DEFAULT_BANKS_POOL = 'counterparty_banks_uae_real';

function resolvePools(persona, indexedPools) {
  const namePool = indexedPools.namesByPoolId[persona.demographics.nationality_pool];
  if (!namePool) {
    throw new Error(
      `name pool '${persona.demographics.nationality_pool}' not found for persona ${persona.persona_id}`
    );
  }
  // Motor uses persona.finance.bank_pool; home uses persona.home.mortgage.bank_pool.
  const banksPoolId =
    persona.finance?.bank_pool ??
    persona.home?.mortgage?.bank_pool ??
    DEFAULT_BANKS_POOL;
  const banks = indexedPools.counterpartyBanksByCategory[banksPoolId];
  if (!banks) {
    throw new Error(
      `banks pool '${banksPoolId}' not found for persona ${persona.persona_id}`
    );
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

export function buildInsuranceBundle({ persona, lfi, seed, pools, now = DEFAULT_NOW }) {
  const line = persona.line ?? 'motor';
  if (line === 'motor') return buildMotorBundle({ persona, lfi, seed, pools, now });
  if (line === 'home') return buildHomeBundle({ persona, lfi, seed, pools, now });
  if (line === 'health') return buildHealthBundle({ persona, lfi, seed, pools, now });
  throw new Error(`unknown insurance line '${line}' for persona ${persona.persona_id}`);
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

  const product = generateMotorProduct({
    persona,
    names: p.names,
    banks: p.banks,
    rng,
    now,
  });
  const claims = generateClaims({ persona });
  const premium = generatePremium({ persona });

  const insurancePolicyId = genUuid(rng);

  const motorPolicyDetail = {
    InsurancePolicyId: insurancePolicyId,
    PolicyHolder: policyHolder,
    Identity: identity,
    Product: product,
    Claims: claims,
    Premium: premium,
  };

  const motorPolicySummary = {
    InsurancePolicyId: insurancePolicyId,
    PolicyNumber: product.Policy.PolicyNumber,
    PolicyStatus: 'New',
    PolicyStartDate: product.Policy.PolicyStartDate,
    PolicyEndDate: isoDate(now, 365 - persona.policy.start_date_offset_days),
  };

  const bank =
    product.CarFinance?.BankName ??
    p.banks.banks[Math.floor(rng() * p.banks.banks.length)].name;
  const accountIban = genUaeIban(rng);
  const paymentDetails = {
    Account: { Identification: accountIban, SchemeName: 'IBAN', Name: `${name.given} ${name.surname}` },
    Bank: { Name: bank },
  };

  const motorQuote = generateMotorQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'motor',
    identity: {
      fullName: `${name.given} ${name.surname}`,
      given: name.given,
      surname: name.surname,
      namePoolId: persona.demographics.nationality_pool,
    },
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

  const healthPolicyDetail = {
    InsurancePolicyId: insurancePolicyId,
    PolicyHolder: policyHolder,
    Identity: identity,
    Product: product,
    Claims: claims,
    Premium: premium,
  };

  const healthPolicySummary = {
    InsurancePolicyId: insurancePolicyId,
    PolicyNumber: policyNumber,
    PolicyStatus: 'New',
    PolicyStartDate: startDate,
    PolicyEndDate: endDate,
  };

  const bankName = p.banks.banks[Math.floor(rng() * p.banks.banks.length)].name;
  const accountIban = genUaeIban(rng);
  const paymentDetails = {
    Account: { Identification: accountIban, SchemeName: 'IBAN', Name: `${name.given} ${name.surname}` },
    Bank: { Name: bankName },
  };

  const healthQuote = generateHealthQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'health',
    identity: {
      fullName: `${name.given} ${name.surname}`,
      given: name.given,
      surname: name.surname,
      namePoolId: persona.demographics.nationality_pool,
    },
    healthPolicies: [healthPolicyDetail],
    healthPolicySummaries: [healthPolicySummary],
    paymentDetails,
    healthQuote,
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
  let mortgageBankName = null;
  if (persona.home?.mortgage?.has_mortgage) {
    mortgageBankName = p.banks.banks[Math.floor(rng() * p.banks.banks.length)].name;
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

  const homePolicyDetail = {
    InsurancePolicyId: insurancePolicyId,
    PolicyHolder: policyHolder,
    Identity: identity,
    Product: product,
    Claims: claims,
    Premium: premium,
  };

  const homePolicySummary = {
    InsurancePolicyId: insurancePolicyId,
    PolicyNumber: policyNumber,
    PolicyStatus: 'New',
    PolicyStartDate: startDate,
    PolicyEndDate: endDate,
  };

  const bankName =
    mortgageBankName ?? p.banks.banks[Math.floor(rng() * p.banks.banks.length)].name;
  const accountIban = genUaeIban(rng);
  const paymentDetails = {
    Account: { Identification: accountIban, SchemeName: 'IBAN', Name: `${name.given} ${name.surname}` },
    Bank: { Name: bankName },
  };

  const homeQuote = generateHomeQuote({ persona, rng, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    line: 'home',
    identity: {
      fullName: `${name.given} ${name.surname}`,
      given: name.given,
      surname: name.surname,
      namePoolId: persona.demographics.nationality_pool,
    },
    homePolicies: [homePolicyDetail],
    homePolicySummaries: [homePolicySummary],
    paymentDetails,
    homeQuote,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}
