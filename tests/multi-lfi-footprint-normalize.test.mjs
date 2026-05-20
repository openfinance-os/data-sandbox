// Phase 2.2 — normalizeFootprint() canonicalises both the legacy D-14
// shape ({ primary, secondary?, tertiary? }) and the new slots[] shape
// to the same internal representation. Byte-equivalence with the
// legacy shape is verified by the existing multi-lfi-* test suites;
// this file pins the new code path that other personas (e.g. the
// upcoming retail multi-LFI aggregator) will rely on.

import { describe, it, expect } from 'vitest';
import {
  normalizeFootprint,
  findSlotByKey,
  listRoleSlotKeys,
} from '../src/generator/multi-lfi.js';

describe('normalizeFootprint — Phase 2.2', () => {
  it('returns null for missing footprint', () => {
    expect(normalizeFootprint(null)).toBeNull();
    expect(normalizeFootprint(undefined)).toBeNull();
  });

  it('returns null for an empty footprint', () => {
    expect(normalizeFootprint({})).toBeNull();
    expect(normalizeFootprint({ slots: [] })).toBeNull();
  });

  it('canonicalises the legacy {primary, secondary, tertiary} shape', () => {
    const legacy = {
      primary: { role: 'operating', plausible_lfi_candidates: ['A'] },
      secondary: { role: 'acquiring', plausible_lfi_candidates: ['B'] },
      tertiary: { role: 'digital_challenger', plausible_lfi_candidates: ['C'] },
    };
    const fp = normalizeFootprint(legacy);
    expect(fp.slots.length).toBe(3);
    expect(fp.slots[0].key).toBe('primary');
    expect(fp.slots[1].key).toBe('secondary');
    expect(fp.slots[2].key).toBe('tertiary');
    // SME-byte-identity codes: slot[1] → x2/s2, slot[2] → x3/s3.
    expect(fp.slots[1].xCode).toBe('x2');
    expect(fp.slots[1].txCode).toBe('s2');
    expect(fp.slots[2].xCode).toBe('x3');
    expect(fp.slots[2].txCode).toBe('s3');
  });

  it('handles a legacy footprint with no secondary (primary-only)', () => {
    const fp = normalizeFootprint({
      primary: { role: 'operating', plausible_lfi_candidates: ['A'] },
    });
    expect(fp.slots.length).toBe(1);
    expect(fp.slots[0].key).toBe('primary');
  });

  it('accepts the new slots[] shape with custom keys', () => {
    const fp = normalizeFootprint({
      slots: [
        { key: 'salary', role: 'salary_primary', plausible_lfi_candidates: ['Bank A'] },
        { key: 'everyday-card', role: 'secondary_card', plausible_lfi_candidates: ['Bank B'] },
        { key: 'digital', role: 'digital_sidekick', plausible_lfi_candidates: ['Bank C'] },
        { key: 'mortgage-lender', role: 'mortgage_lender', plausible_lfi_candidates: ['Bank D'] },
      ],
    });
    expect(fp.slots.length).toBe(4);
    expect(fp.slots.map((s) => s.key)).toEqual([
      'salary', 'everyday-card', 'digital', 'mortgage-lender',
    ]);
    expect(fp.slots[3].xCode).toBe('x4');
    expect(fp.slots[3].txCode).toBe('s4');
  });

  it('preserves role + lfi_default + plausible_lfi_candidates pass-through', () => {
    const fp = normalizeFootprint({
      slots: [
        {
          key: 'salary',
          role: 'salary_primary',
          lfi_default: 'Median',
          plausible_lfi_candidates: ['Abu Dhabi Commercial Bank'],
        },
      ],
    });
    expect(fp.slots[0].role).toBe('salary_primary');
    expect(fp.slots[0].lfi_default).toBe('Median');
    expect(fp.slots[0].plausible_lfi_candidates).toEqual(['Abu Dhabi Commercial Bank']);
  });
});

describe('findSlotByKey', () => {
  it('returns null when the footprint is empty or the key is missing', () => {
    expect(findSlotByKey(null, 'salary')).toBeNull();
    expect(findSlotByKey({}, 'salary')).toBeNull();
    expect(findSlotByKey({
      primary: { role: 'operating', plausible_lfi_candidates: ['A'] },
    }, 'tertiary')).toBeNull();
  });

  it('finds slots by key in both shapes', () => {
    const legacy = findSlotByKey({
      primary: { role: 'operating', plausible_lfi_candidates: ['A'] },
      secondary: { role: 'acquiring', plausible_lfi_candidates: ['B'] },
    }, 'secondary');
    expect(legacy?.role).toBe('acquiring');
    expect(legacy?.xCode).toBe('x2');

    const fresh = findSlotByKey({
      slots: [
        { key: 'salary', role: 'salary_primary', plausible_lfi_candidates: ['X'] },
        { key: 'mortgage-lender', role: 'mortgage_lender', plausible_lfi_candidates: ['Y'] },
      ],
    }, 'mortgage-lender');
    expect(fresh?.role).toBe('mortgage_lender');
    expect(fresh?.xCode).toBe('x2');
  });
});

describe('listRoleSlotKeys', () => {
  it('returns [] for personas without a footprint', () => {
    expect(listRoleSlotKeys({})).toEqual([]);
    expect(listRoleSlotKeys({ persona_id: 'x' })).toEqual([]);
  });

  it('returns non-primary slot keys in declaration order', () => {
    expect(listRoleSlotKeys({
      multi_lfi_footprint: {
        primary: { role: 'operating', plausible_lfi_candidates: [] },
        secondary: { role: 'acquiring', plausible_lfi_candidates: [] },
        tertiary: { role: 'digital_challenger', plausible_lfi_candidates: [] },
      },
    })).toEqual(['secondary', 'tertiary']);

    expect(listRoleSlotKeys({
      multi_lfi_footprint: {
        slots: [
          { key: 'salary', role: 'salary_primary', plausible_lfi_candidates: [] },
          { key: 'everyday-card', role: 'secondary_card', plausible_lfi_candidates: [] },
          { key: 'digital', role: 'digital_sidekick', plausible_lfi_candidates: [] },
          { key: 'mortgage-lender', role: 'mortgage_lender', plausible_lfi_candidates: [] },
        ],
      },
    })).toEqual(['everyday-card', 'digital', 'mortgage-lender']);
  });
});
