// Insurance generator orchestrator — Phase 2.0 Motor MVP.
// Turns (insurance persona, lfi, seed) into a bundle covering the three
// motor-insurance endpoints scoped in tools/domains.config.mjs.
//
// EXP-05 / §8.3: bundle is a pure function of (persona, lfi, seed, now).

import { makePrng } from '../../prng.js';
import { generateInsuranceIdentity, genUuid, isoDate } from './identity.js';
import {
  generateMotorProduct,
  generateClaims,
  generatePremium,
} from './motor-policy.js';
import { applyInsuranceLfiProfile } from './lfi-profile.js';

const DEFAULT_NOW = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

const DEFAULT_BANKS_POOL = 'counterparty_banks_domestic';

function resolvePools(persona, indexedPools) {
  const namePool = indexedPools.namesByPoolId[persona.demographics.nationality_pool];
  if (!namePool) {
    throw new Error(
      `name pool '${persona.demographics.nationality_pool}' not found for persona ${persona.persona_id}`
    );
  }
  const banksPoolId = persona.finance?.bank_pool ?? DEFAULT_BANKS_POOL;
  const banks = indexedPools.counterpartyBanksByCategory[banksPoolId];
  if (!banks) {
    throw new Error(
      `banks pool '${banksPoolId}' not found for persona ${persona.persona_id}`
    );
  }
  return { names: namePool, banks };
}

export function buildInsuranceBundle({ persona, lfi, seed, pools, now = DEFAULT_NOW }) {
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

  // Full motor-policy detail object (Data of GET /motor-insurance-policies/{id}).
  const motorPolicyDetail = {
    InsurancePolicyId: insurancePolicyId,
    PolicyHolder: policyHolder,
    Identity: identity,
    Product: product,
    Claims: claims,
    Premium: premium,
  };

  // Summary form (item of Data.Policies in GET /motor-insurance-policies).
  // PolicyStatus enum: New | Renewed | Expired | Lapsed | Cancelled | PaidUp |
  //   Converted | Surrendered | DeathClaim | RiderClaim. "New" fits the
  //   first-policy-of-a-mid-tier-policyholder narrative.
  const motorPolicySummary = {
    InsurancePolicyId: insurancePolicyId,
    PolicyNumber: product.Policy.PolicyNumber,
    PolicyStatus: 'New',
    PolicyStartDate: product.Policy.PolicyStartDate,
    PolicyEndDate: isoDate(now, 365 - persona.policy.start_date_offset_days),
  };

  // Payment-details (Data of GET /motor-insurance-policies/{id}/payment-details).
  // Use the same bank as CarFinance when available; otherwise draw one.
  const bank =
    product.CarFinance?.BankName ??
    p.banks.banks[Math.floor(rng() * p.banks.banks.length)].name;
  // UAE IBAN: "AE" + 2 check digits + 19 BBAN digits (23 chars total).
  const checkDigits = String(2 + Math.floor(rng() * 98)).padStart(2, '0');
  const bban1 = String(Math.floor(rng() * 1e9)).padStart(9, '0');
  const bban2 = String(Math.floor(rng() * 1e10)).padStart(10, '0');
  const accountIban = `AE${checkDigits}${bban1}${bban2}`;
  const paymentDetails = {
    Account: {
      Identification: accountIban,
      SchemeName: 'IBAN',
      Name: `${name.given} ${name.surname}`,
    },
    Bank: {
      Name: bank,
    },
  };

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'insurance',
    identity: {
      fullName: `${name.given} ${name.surname}`,
      given: name.given,
      surname: name.surname,
      namePoolId: persona.demographics.nationality_pool,
    },
    motorPolicies: [motorPolicyDetail],
    motorPolicySummaries: [motorPolicySummary],
    paymentDetails,
  };

  return applyInsuranceLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}
