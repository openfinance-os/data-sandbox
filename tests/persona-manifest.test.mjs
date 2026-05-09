import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { repoRoot } from '../tools/load-fixtures.mjs';

const MANIFEST_DIR = path.join(repoRoot, 'personas');

function listManifests() {
  return fs
    .readdirSync(MANIFEST_DIR)
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'));
}

// Domain-specific required top-level keys. Common keys live at the top of
// each list; the tail is domain- and (for insurance) line-shaped. See
// personas/_schema.{banking,insurance}.yaml for the canonical reference.
const COMMON_INSURANCE_KEYS = [
  'persona_id',
  'domain',
  'name',
  'archetype',
  'default_seed',
  'stress_coverage',
  'demographics',
];
const REQUIRED_BY_DOMAIN = {
  banking: [
    'persona_id',
    'domain',
    'name',
    'archetype',
    'default_seed',
    'stress_coverage',
    'demographics',
    'income',
    'accounts',
  ],
  // Insurance keys are line-aware; resolved per-persona below.
  insurance: COMMON_INSURANCE_KEYS,
};
const REQUIRED_BY_INSURANCE_LINE = {
  motor: [...COMMON_INSURANCE_KEYS, 'vehicle', 'policy'],
  home: [...COMMON_INSURANCE_KEYS, 'home'],
  health: [...COMMON_INSURANCE_KEYS, 'health'],
  life: [...COMMON_INSURANCE_KEYS, 'life'],
  travel: [...COMMON_INSURANCE_KEYS, 'travel'],
  renters: [...COMMON_INSURANCE_KEYS, 'renters'],
  employment: [...COMMON_INSURANCE_KEYS, 'employment'],
};

const ALLOWED_DOMAINS = new Set(Object.keys(REQUIRED_BY_DOMAIN));

const ALLOWED_LFI_PROFILES = ['rich', 'median', 'sparse'];
void ALLOWED_LFI_PROFILES;

describe('persona manifests — EXP-02', () => {
  const manifests = listManifests();
  it.each(manifests)('%s conforms to the schema shape', (file) => {
    const m = yaml.load(fs.readFileSync(path.join(MANIFEST_DIR, file), 'utf8'));

    expect(ALLOWED_DOMAINS.has(m.domain), `${file} has invalid domain ${m.domain}`).toBe(true);
    let required = REQUIRED_BY_DOMAIN[m.domain];
    if (m.domain === 'insurance') {
      const line = m.line ?? 'motor';
      expect(REQUIRED_BY_INSURANCE_LINE[line], `${file} has unknown insurance line ${line}`).toBeTruthy();
      required = REQUIRED_BY_INSURANCE_LINE[line];
    }
    for (const key of required) {
      expect(m, `${file} missing required key ${key}`).toHaveProperty(key);
    }
    expect(m.persona_id).toMatch(/^[a-z][a-z0-9_]*$/);
    // file name must match persona_id (with _ → -).
    const expectedFile = `${m.persona_id.replace(/_/g, '-')}.yaml`;
    expect(file).toBe(expectedFile);
    expect(Array.isArray(m.stress_coverage)).toBe(true);
    expect(m.stress_coverage.length).toBeGreaterThan(0);
    expect(typeof m.default_seed).toBe('number');

    if (m.domain === 'banking') {
      expect(Array.isArray(m.accounts)).toBe(true);
      expect(m.accounts.length).toBeGreaterThan(0);
      for (const a of m.accounts) {
        expect(a).toHaveProperty('type');
        expect(a).toHaveProperty('currency');
      }
    } else if (m.domain === 'insurance') {
      const line = m.line ?? 'motor';
      if (line === 'motor') {
        expect(m.vehicle).toHaveProperty('make');
        expect(m.vehicle).toHaveProperty('model');
        expect(typeof m.vehicle.year).toBe('number');
        expect(['Comprehensive', 'ThirdPartyLiability']).toContain(m.policy.type);
      } else if (line === 'home') {
        expect(m.home.property).toHaveProperty('type_of_property');
        expect(['Villa', 'House', 'Apartment', 'Flat']).toContain(m.home.property.type_of_property);
        expect(typeof m.home.property_value.market_value_aed).toBe('number');
        expect(typeof m.home.policy.excess_aed).toBe('number');
      } else if (line === 'health') {
        expect(m.health.policy).toHaveProperty('cover_subjects');
        expect(['Self', 'SelfAndSpouse', 'Spouse', 'SelfAndFamily', 'Dependents', 'Other'])
          .toContain(m.health.policy.cover_subjects);
        expect(typeof m.health.policy.annual_limit_aed).toBe('number');
        expect(typeof m.health.policy.policyholder_insured).toBe('boolean');
      } else if (line === 'life') {
        expect(['Sole', 'Joint']).toContain(m.life.policy.cover_type);
        expect(['WholeLifeInsurance', 'LevelTermInsurance', 'DecreasingTermInsurance'])
          .toContain(m.life.policy.type_of_life_insurance);
        expect(['PersonalCover', 'FamilyProtection', 'MortgageCover'])
          .toContain(m.life.policy.insurance_purpose);
        expect(typeof m.life.policy.sum_assured_aed).toBe('number');
        expect(typeof m.life.policy.term_years).toBe('number');
      } else if (line === 'travel') {
        expect(typeof m.travel.policy.trip_duration_days).toBe('number');
        expect(typeof m.travel.policy.multi_trip).toBe('boolean');
        expect(['Personal', 'Business']).toContain(m.travel.policy.purpose);
        expect(['Individual', 'Couple', 'Family', 'Group'])
          .toContain(m.travel.policy.travelling_with);
        expect(['WithinUAE', 'Worldwide', 'WorldwideExcludingUSAandCanada'])
          .toContain(m.travel.policy.destination_region);
      } else if (line === 'renters') {
        expect(['Villa', 'House', 'Apartment', 'Flat']).toContain(m.renters.property.type_of_property);
        expect(typeof m.renters.contents.declared_value_aed).toBe('number');
        expect(typeof m.renters.policy.excess_aed).toBe('number');
      } else if (line === 'employment') {
        expect(['CategoryA', 'CategoryB']).toContain(m.employment.policy.scheme_category);
        expect(['Private', 'FederalGovernment']).toContain(m.employment.policy.sector);
        expect(typeof m.employment.policy.term_years).toBe('number');
        expect(typeof m.employment.employer.monthly_income_aed).toBe('number');
      }
    }
  });

  it('persona ids are unique across the library', () => {
    const ids = manifests.map((f) => yaml.load(fs.readFileSync(path.join(MANIFEST_DIR, f), 'utf8')).persona_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stress_coverage adds at least one new term per persona — EXP-25', () => {
    // Phase 0 only has Sara, so this is trivially true, but the test will
    // bite as soon as a second persona ships.
    const seen = new Set();
    for (const f of manifests) {
      const m = yaml.load(fs.readFileSync(path.join(MANIFEST_DIR, f), 'utf8'));
      const novel = m.stress_coverage.filter((t) => !seen.has(t));
      expect(novel.length, `${f} adds no new stress coverage`).toBeGreaterThan(0);
      for (const t of m.stress_coverage) seen.add(t);
    }
  });

  // Segment + organisation invariants — added with the SME / Corporate
  // expansion. Spec enum-conformance is enforced separately by
  // tools/lint-persona-spec-conformance.mjs.
  it.each(manifests)('%s — segment / organisation shape is consistent', (file) => {
    const m = yaml.load(fs.readFileSync(path.join(MANIFEST_DIR, file), 'utf8'));
    if (m.domain !== 'banking') return;
    const segment = m.segment ?? 'Retail';
    expect(['Retail', 'SME', 'Corporate']).toContain(segment);
    if (segment !== 'Retail') {
      expect(m.organisation, `${file} segment=${segment} requires organisation block`).toBeTruthy();
      expect(typeof m.organisation.legal_name_pool).toBe('string');
      expect(Array.isArray(m.organisation.signatories)).toBe(true);
      expect(m.organisation.signatories.length).toBeGreaterThan(0);
      for (const sig of m.organisation.signatories) {
        expect(typeof sig.signatory_pool).toBe('string');
        expect(typeof sig.account_role).toBe('string');
        expect(typeof sig.party_type).toBe('string');
      }
    }
    if (Array.isArray(m.accounts)) {
      for (const a of m.accounts) {
        if (a.account_type != null) {
          expect(['Retail', 'SME', 'Corporate']).toContain(a.account_type);
        }
      }
    }
  });
});
