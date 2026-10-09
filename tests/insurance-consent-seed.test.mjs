// Regression guard for APP_IMPROVEMENT_PLAN.md §1 A-2: the insurance
// consent PRNG once dropped its seed argument (a 4-arg call to the 3-param
// makePrng), making ConsentId invariant across every seed for a given
// persona × line. EXP-05 requires the full (persona, lfi, seed) tuple to
// drive every generated identifier.
import { describe, it, expect } from 'vitest';
import { loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';
import { buildBundle } from '../src/generator/index.js';
import { makePrng } from '../src/prng.js';

describe('insurance ConsentId seed sensitivity (A-2)', () => {
  it('different seeds produce different ConsentIds for every insurance persona', async () => {
    const personas = await loadPersonasByDomain('insurance');
    const pools = loadAllPools();
    for (const persona of Object.values(personas)) {
      const ids = [1, 2, 999].map((seed) => {
        const bundle = buildBundle({ persona, lfiProfile: 'median', seed, pools });
        return (bundle.consents ?? []).map((c) => c.ConsentId).join('|');
      });
      expect(new Set(ids).size, `${persona.persona_id} consents must vary by seed`).toBe(3);
    }
  });

  it('makePrng rejects extra arguments instead of silently dropping them', () => {
    expect(() => makePrng('p', 'median', 'extra', 7)).toThrow(/expects/);
    expect(() => makePrng('p', 'median', 7)).not.toThrow();
  });
});
