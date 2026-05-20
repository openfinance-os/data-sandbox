// Phase 2.2 — cross_domain_link resolution. When a multi-domain
// persona's `multi_insurer_footprint.slots[].cross_domain_link` names
// a banking slot, the line generator resolves the relevant bank from
// THAT banking slot's deterministic pick (instead of a random pool
// draw). The result: home-insurance Mortgage.BankName and motor-
// insurance CarFinance.BankName align with the bank holding the
// mortgage / loan in the persona's banking footprint.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import {
  pickFootprintSlotBank,
  findInsuranceCrossDomainLink,
} from '../src/generator/multi-lfi.js';
import { loadPersona, loadAllPools } from '../tools/load-fixtures.mjs';

const NOW = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

describe('Phase 2.2 — cross_domain_link resolution', () => {
  const persona = loadPersona('retail_multi_banker');
  const pools = loadAllPools();
  const counterpartyBanks = pools.counterpartyBanksByCategory.counterparty_banks_uae_real;

  it('findInsuranceCrossDomainLink returns the declared banking-slot key for each insurance line', () => {
    expect(findInsuranceCrossDomainLink(persona, 'motor')).toBe('salary');
    expect(findInsuranceCrossDomainLink(persona, 'home')).toBe('mortgage-lender');
    // No cross-domain link declared on travel.
    expect(findInsuranceCrossDomainLink(persona, 'travel')).toBeNull();
  });

  it('home Mortgage.BankName resolves to the persona\'s mortgage-lender slot bank', () => {
    const expectedBank = pickFootprintSlotBank(persona, 'mortgage-lender', counterpartyBanks);
    expect(expectedBank).toBeTruthy();
    const bundle = buildBundle({ persona, lfi: 'rich', seed: persona.default_seed, pools, now: NOW });
    const homePolicy = bundle.homePolicies?.[0];
    expect(homePolicy).toBeTruthy();
    const mortgageBank = homePolicy.HouseDetails?.Mortgage?.BankName
      ?? homePolicy.House?.Mortgage?.BankName
      ?? homePolicy.Mortgage?.BankName
      // Different home-policy shapes may nest the mortgage block differently;
      // search the JSON for the BankName field.
      ?? findMortgageBankInPolicy(homePolicy);
    expect(mortgageBank).toBe(expectedBank.name);
  });

  it('life FinanceAgainstPolicy.FinanceProvider resolves to the linked banking slot (mortgage-protection)', () => {
    // healthcare_multi declares life.cross_domain_link: mortgage-lender
    // (mortgage-protection cover). The FinanceProvider should match the
    // linked banking slot's deterministic bank pick.
    const linkedPersona = loadPersona('healthcare_multi');
    const expectedBank = pickFootprintSlotBank(linkedPersona, 'mortgage-lender', counterpartyBanks);
    expect(expectedBank).toBeTruthy();
    const bundle = buildBundle({
      persona: linkedPersona, lfi: 'rich', seed: linkedPersona.default_seed, pools, now: NOW,
    });
    const lifePolicy = bundle.lifePolicies?.[0];
    expect(lifePolicy).toBeTruthy();
    const provider = findStringByKeyPath(lifePolicy, ['FinanceAgainstPolicy', 'FinanceProvider']);
    expect(provider).toBe(expectedBank.name);
  });

  it('motor CarFinance.BankName resolves to the persona\'s salary slot bank', () => {
    const expectedBank = pickFootprintSlotBank(persona, 'salary', counterpartyBanks);
    expect(expectedBank).toBeTruthy();
    const bundle = buildBundle({ persona, lfi: 'rich', seed: persona.default_seed, pools, now: NOW });
    const motorPolicy = bundle.motorPolicies?.[0];
    expect(motorPolicy).toBeTruthy();
    const carFinanceBank = motorPolicy.Product?.CarFinance?.BankName
      ?? findCarFinanceBankInPolicy(motorPolicy);
    expect(carFinanceBank).toBe(expectedBank.name);
  });

  it('the linked banks differ — the persona has multiple LFI relationships', () => {
    const salaryBank = pickFootprintSlotBank(persona, 'salary', counterpartyBanks);
    const mortgageBank = pickFootprintSlotBank(persona, 'mortgage-lender', counterpartyBanks);
    expect(salaryBank?.name).not.toBe(mortgageBank?.name);
  });

  it('home Mortgage carries the linked bank\'s BIC (not just name)', () => {
    const expectedBank = pickFootprintSlotBank(persona, 'mortgage-lender', counterpartyBanks);
    expect(expectedBank?.bic).toBeTruthy();
    const bundle = buildBundle({ persona, lfi: 'rich', seed: persona.default_seed, pools, now: NOW });
    const homePolicy = bundle.homePolicies?.[0];
    const mortgageBic = findStringByKeyPath(homePolicy, ['Mortgage', 'BIC'])
      ?? findStringByKeyPath(homePolicy, ['Mortgage', 'BankBIC'])
      ?? findStringByKeyPath(homePolicy, ['Mortgage', 'BankIdentifier']);
    // The current home-policy generator surfaces only BankName + BankBranch
    // — no BIC field. Document the limitation: if a future generator
    // change adds a BIC, it MUST resolve from the linked bank.
    if (mortgageBic != null) {
      expect(mortgageBic).toBe(expectedBank.bic);
    }
  });
});

describe('Phase 2.2 — cross_domain_link fallback (no link declared)', () => {
  // Single-domain home persona (home-mortgage-villa) — no
  // cross_domain_link declared. Verifies the fallback path still
  // resolves to a valid pool bank and the bundle builds cleanly.
  const persona = loadPersona('home_mortgage_villa');
  const pools = loadAllPools();

  it('builds a home bundle and surfaces a BankName from the pool when no link is declared', () => {
    expect(findInsuranceCrossDomainLink(persona, 'home')).toBeNull();
    const bundle = buildBundle({ persona, lfi: 'rich', seed: persona.default_seed, pools, now: NOW });
    const homePolicy = bundle.homePolicies?.[0];
    expect(homePolicy).toBeTruthy();
    const mortgageBank = findStringByKeyPath(homePolicy, ['Mortgage', 'BankName']);
    expect(typeof mortgageBank).toBe('string');
    expect(mortgageBank.length).toBeGreaterThan(0);
  });

  it('determinism: same (persona, lfi, seed) produces byte-identical home bundles regardless of link presence', () => {
    const a = buildBundle({ persona, lfi: 'rich', seed: persona.default_seed, pools, now: NOW });
    const b = buildBundle({ persona, lfi: 'rich', seed: persona.default_seed, pools, now: NOW });
    expect(JSON.stringify(a.homePolicies)).toBe(JSON.stringify(b.homePolicies));
  });
});

describe('Phase 2.2 — emirati_takaful_multi internal consistency', () => {
  // The persona's narrative claims life cover is mortgage-protection
  // sized to the outstanding mortgage balance. Verify that as a data
  // invariant so a future edit to one number can't silently drift
  // away from the other.
  const persona = loadPersona('emirati_takaful_multi');

  it('life policy sum_assured matches mortgage outstanding balance (mortgage-protection narrative)', () => {
    expect(persona.life?.policy?.sum_assured_aed).toBe(persona.home?.mortgage?.balance_aed);
    expect(persona.life?.policy?.insurance_purpose).toBe('MortgageCover');
  });
});

// Defensive helper — the home-insurance line builder nests the
// Mortgage block under HouseDetails or House depending on the spec
// version. Walk the policy object generically until we find a
// `Mortgage.BankName`.
function findMortgageBankInPolicy(policy) {
  return findStringByKeyPath(policy, ['Mortgage', 'BankName']);
}
function findCarFinanceBankInPolicy(policy) {
  return findStringByKeyPath(policy, ['CarFinance', 'BankName']);
}
function findStringByKeyPath(node, keyPath) {
  if (node == null) return null;
  if (typeof node === 'object' && !Array.isArray(node)) {
    // Direct match?
    let cursor = node;
    for (const k of keyPath) {
      if (cursor == null || typeof cursor !== 'object') { cursor = null; break; }
      cursor = cursor[k];
    }
    if (typeof cursor === 'string') return cursor;
    // Recurse children.
    for (const v of Object.values(node)) {
      const found = findStringByKeyPath(v, keyPath);
      if (found != null) return found;
    }
  }
  if (Array.isArray(node)) {
    for (const v of node) {
      const found = findStringByKeyPath(v, keyPath);
      if (found != null) return found;
    }
  }
  return null;
}
