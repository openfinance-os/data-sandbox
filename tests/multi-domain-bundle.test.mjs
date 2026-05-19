// Phase 2.2 — multi-domain persona dispatch. When a persona declares
// `domains: [banking, insurance]`, buildBundle returns a single
// composite bundle carrying both banking AND insurance fields, and
// envelopesFromBundle emits both endpoint families at the same persona
// path.
//
// Strategy: synthesise a multi-domain persona by stitching together a
// real banking persona + a real insurance persona's line-specific data,
// so we test the dispatch without requiring the flagship persona to
// have landed yet.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { envelopesFromBundle } from '../src/ui/export.js';
import { loadPersona, loadAllPools, personaDomains } from '../tools/load-fixtures.mjs';

const NOW = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

describe('Phase 2.2 — multi-domain bundle dispatch', () => {
  // Pull a real banking persona (gig-variable-income) and graft on the
  // motor-insurance data shape from the senior-driver-tplo motor persona.
  // Use seed values from the banking side so the bundle is reproducible.
  const banking = loadPersona('gig_variable_income');
  const motor = loadPersona('motor_comprehensive_mid');
  const pools = loadAllPools();

  const multiDomainPersona = {
    ...banking,
    persona_id: 'test_multi_domain_inline',
    name: 'Multi-Domain Test Persona',
    // Drop the legacy single domain in favour of the array shape.
    domain: undefined,
    domains: ['banking', 'insurance'],
    // Insurance side: single line (motor) with the shape from the
    // motor persona.
    insurance: { lines: ['motor'] },
    vehicle: motor.vehicle,
    policy: motor.policy,
    claims: motor.claims,
    finance: motor.finance,
  };

  it('buildBundle returns a composite bundle with both banking and insurance fields', () => {
    const bundle = buildBundle({
      persona: multiDomainPersona,
      lfi: 'rich',
      seed: 1234,
      pools,
      now: NOW,
    });
    // Banking side
    expect(Array.isArray(bundle.accounts)).toBe(true);
    expect(bundle.accounts.length).toBeGreaterThan(0);
    expect(Array.isArray(bundle.transactions)).toBe(true);
    // Insurance side (motor)
    expect(Array.isArray(bundle.motorPolicies)).toBe(true);
    expect(bundle.motorPolicies.length).toBe(1);
    expect(Array.isArray(bundle.consents)).toBe(true);
    expect(bundle.consents.length).toBeGreaterThan(0);
    // Multi-domain marker
    expect(bundle.domains).toEqual(['banking', 'insurance']);
  });

  it('persona name appears identically on both banking identity and motor policyHolder', () => {
    const bundle = buildBundle({
      persona: multiDomainPersona,
      lfi: 'rich',
      seed: 1234,
      pools,
      now: NOW,
    });
    const bankingFullName = bundle.identity?.fullName;
    const policyHolder = bundle.motorPolicies[0]?.PolicyHolder;
    expect(bankingFullName).toBeTruthy();
    // PolicyHolder shape: { FirstName, LastName, ... } per v2.1 insurance.
    const policyHolderName = [
      policyHolder?.FirstName,
      policyHolder?.LastName,
    ].filter(Boolean).join(' ');
    expect(policyHolderName).toBe(bankingFullName);
  });

  it('envelopesFromBundle emits both banking and insurance endpoints', () => {
    const bundle = buildBundle({
      persona: multiDomainPersona,
      lfi: 'rich',
      seed: 1234,
      pools,
      now: NOW,
    });
    const envelopes = envelopesFromBundle(bundle, {
      personaId: multiDomainPersona.persona_id,
      lfi: 'rich',
      seed: 1234,
      specVersion: 'v2.1',
      specSha: 'test',
      retrievedAt: NOW.toISOString(),
    });
    const keys = Object.keys(envelopes);
    // Banking endpoints
    expect(keys).toContain('/accounts');
    expect(keys).toContain('/parties');
    expect(keys.some((k) => k.startsWith('/accounts/') && k.includes('/transactions'))).toBe(true);
    // Insurance endpoints
    expect(keys).toContain('/motor-insurance-policies');
    expect(keys).toContain('/insurance-consents');
  });

  it('determinism: same (persona, lfi, seed) produces byte-identical composite bundle', () => {
    const a = buildBundle({ persona: multiDomainPersona, lfi: 'rich', seed: 1234, pools, now: NOW });
    const b = buildBundle({ persona: multiDomainPersona, lfi: 'rich', seed: 1234, pools, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('personaDomains helper', () => {
  it('returns [domain] for single-domain personas', () => {
    expect(personaDomains({ domain: 'banking' })).toEqual(['banking']);
    expect(personaDomains({ domain: 'insurance' })).toEqual(['insurance']);
  });
  it('returns domains[] for multi-domain personas', () => {
    expect(personaDomains({ domains: ['banking', 'insurance'] }))
      .toEqual(['banking', 'insurance']);
  });
  it('falls back to banking when neither field is set', () => {
    expect(personaDomains({})).toEqual(['banking']);
    expect(personaDomains(null)).toEqual(['banking']);
  });
  it('prefers domains[] over domain when both are present', () => {
    expect(personaDomains({ domain: 'banking', domains: ['banking', 'insurance'] }))
      .toEqual(['banking', 'insurance']);
  });
});
