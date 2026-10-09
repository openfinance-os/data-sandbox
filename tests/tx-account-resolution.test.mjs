// Corpus-wide structural guard (APP_IMPROVEMENT_PLAN.md §1 A-3): every
// transaction's internal _accountId must resolve to an account emitted in
// the SAME bundle. A dangling _accountId is silently dropped by
// envelopesFromBundle's per-account filter — the failure mode of the
// primary-anchor divergence this test was written against, and of any
// future generator that fabricates account references.
import { describe, it, expect } from 'vitest';
import { loadPersonasByDomain, loadAllPools } from '../tools/load-fixtures.mjs';
import { buildBundle } from '../src/generator/index.js';

const LFIS = ['rich', 'median', 'sparse'];

describe('transaction _accountId resolution (A-3)', () => {
  it('every _accountId in every banking bundle resolves to an emitted AccountId', async () => {
    const personas = await loadPersonasByDomain('banking');
    const pools = loadAllPools();
    for (const persona of Object.values(personas)) {
      for (const lfi of LFIS) {
        const bundle = buildBundle({
          persona,
          lfiProfile: lfi,
          seed: persona.default_seed ?? 1,
          pools,
        });
        const accountIds = new Set((bundle.accounts ?? []).map((a) => a.AccountId));
        const dangling = (bundle.transactions ?? [])
          .filter((t) => t._accountId != null && !accountIds.has(t._accountId))
          .map((t) => `${t.TransactionId}→${t._accountId}`);
        expect(
          dangling,
          `${persona.persona_id}/${lfi}: transactions reference accounts the bundle never emits`,
        ).toEqual([]);
      }
    }
  }, 120_000);
});
