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

const REQUIRED_TOP_LEVEL = [
  'persona_id',
  'name',
  'archetype',
  'default_seed',
  'stress_coverage',
  'demographics',
  'income',
  'accounts',
];

const ALLOWED_LFI_PROFILES = ['rich', 'median', 'sparse'];
void ALLOWED_LFI_PROFILES;

describe('persona manifests — EXP-02', () => {
  const manifests = listManifests();
  it.each(manifests)('%s conforms to the schema shape', (file) => {
    const m = yaml.load(fs.readFileSync(path.join(MANIFEST_DIR, file), 'utf8'));

    for (const key of REQUIRED_TOP_LEVEL) {
      expect(m, `${file} missing required key ${key}`).toHaveProperty(key);
    }
    expect(m.persona_id).toMatch(/^[a-z][a-z0-9_]*$/);
    // file name must match persona_id (with _ → -).
    const expectedFile = `${m.persona_id.replace(/_/g, '-')}.yaml`;
    expect(file).toBe(expectedFile);
    expect(Array.isArray(m.stress_coverage)).toBe(true);
    expect(m.stress_coverage.length).toBeGreaterThan(0);
    expect(typeof m.default_seed).toBe('number');
    expect(Array.isArray(m.accounts)).toBe(true);
    expect(m.accounts.length).toBeGreaterThan(0);
    for (const a of m.accounts) {
      expect(a).toHaveProperty('type');
      expect(a).toHaveProperty('currency');
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
});
