// T-08b — cross-LFI IBAN identity (APP_IMPROVEMENT_PLAN.md §3 T-08b).
//
// Two invariants that make the multi-LFI story reconcilable by a TPP:
//
//   (a) BUILT-CORPUS check: for every footprint persona × non-primary slot
//       with an emitted role bundle, the PRIMARY bundle's `self-to-<slot>`
//       beneficiary IBAN equals the ROLE bundle's first account IBAN
//       byte-for-byte. Verified over packages/sandbox-fixtures (the corpus
//       a TPP actually downloads), across every (lfi, seed) tuple the
//       builder emitted.
//
//   (b) IN-MEMORY check: every `_crossLfiPairId` has exactly two members —
//       equal Amount, opposite CreditDebitIndicator. `_crossLfiPairId` is a
//       generator-internal key and is (correctly — see
//       tests/underscore-strip-contract.test.mjs) stripped from rendered
//       fixtures, so this half runs against buildBundle/buildRoleBundle
//       output in memory rather than the staged corpus.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildBundle } from '../src/generator/index.js';
import { buildRoleBundle, listRoleSlotKeys } from '../src/generator/multi-lfi.js';
import { loadAllPersonas, loadAllPools, repoRoot } from '../tools/load-fixtures.mjs';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const MANIFEST_PATH = path.join(PKG_DIR, 'manifest.json');
const FIXTURES_BUILT = fs.existsSync(MANIFEST_PATH);

function readEnv(rel) {
  return JSON.parse(fs.readFileSync(path.join(PKG_DIR, rel), 'utf8'));
}

// ─── (a) beneficiary IBAN ≡ role-bundle account IBAN, over the corpus ───

if (!FIXTURES_BUILT) {
  describe.skip("T-08b(a) — cross-LFI IBAN identity in built fixtures (run 'npm run build:fixtures')", () => {
    it.skip('fixture package not built', () => {});
  });
} else
  describe('T-08b(a) — primary self-to-<slot> beneficiary IBAN ≡ role-bundle account IBAN', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const roleFixtures = manifest.roleFixtures ?? {};
    const roleKeys = Object.keys(roleFixtures);

    it('the corpus emits role bundles (footprint personas present)', () => {
      expect(roleKeys.length).toBeGreaterThan(0);
    });

    for (const [rkey, rfx] of Object.entries(roleFixtures)) {
      it(`${rkey} — IBAN identity closes the cross-bundle reference loop`, () => {
        const primaryKey = `${rfx.personaId}|${rfx.lfi}|${rfx.seed}`;
        const primary = manifest.fixtures[primaryKey];
        expect(primary, `primary fixture ${primaryKey} missing`).toBeDefined();

        // Role bundle's first account IBAN.
        const roleAccounts = readEnv(rfx.endpoints['/accounts']);
        const roleIban = roleAccounts.Data?.Account?.[0]?.AccountIdentifiers?.[0]?.Identification;
        expect(roleIban, 'role bundle account[0] has no IBAN').toBeTruthy();

        // Find the primary bundle's self-to-<slot> beneficiary. It lives on
        // the operating account, but scan every beneficiaries endpoint so a
        // future account-ordering change can't silently blind this test.
        const selfBens = [];
        for (const [endpoint, rel] of Object.entries(primary.endpoints)) {
          if (!endpoint.endsWith('/beneficiaries')) continue;
          const env = readEnv(rel);
          for (const b of env.Data?.Beneficiary ?? []) {
            if (b.Reference === `self-to-${rfx.slot}`) selfBens.push(b);
          }
        }
        expect(
          selfBens.length,
          `primary bundle carries no self-to-${rfx.slot} beneficiary`,
        ).toBeGreaterThan(0);
        for (const ben of selfBens) {
          expect(ben.CreditorAccount?.[0]?.Identification).toBe(roleIban);
        }
      });
    }
  });

// ─── (b) _crossLfiPairId pairing, in memory ─────────────────────────────

describe('T-08b(b) — every _crossLfiPairId has exactly 2 members, equal Amount, opposite indicators', () => {
  const personas = loadAllPersonas();
  const pools = loadAllPools();
  const footprintPersonas = Object.values(personas).filter((p) => p.multi_lfi_footprint);

  it('at least 5 personas declare a multi_lfi_footprint', () => {
    expect(footprintPersonas.length).toBeGreaterThanOrEqual(5);
  });

  for (const persona of footprintPersonas) {
    it(`${persona.persona_id} — ledger pairs mirror across primary + role bundles`, async () => {
      const seed = persona.default_seed;
      const lfi = 'rich';
      const primary = buildBundle({ persona, lfi, seed, pools });
      const allTx = [...(primary.transactions ?? [])];
      for (const slotKey of listRoleSlotKeys(persona)) {
        const roleBundle = await buildRoleBundle({ persona, slot: slotKey, lfi, seed, pools });
        if (roleBundle) allTx.push(...(roleBundle.transactions ?? []));
      }

      const byPair = new Map();
      for (const t of allTx) {
        if (!t._crossLfiPairId) continue;
        if (!byPair.has(t._crossLfiPairId)) byPair.set(t._crossLfiPairId, []);
        byPair.get(t._crossLfiPairId).push(t);
      }
      // Footprint personas emit a ledger only when slot candidates resolve
      // in the counterparty pool — but every current footprint persona has
      // at least one resolvable non-primary slot.
      expect(byPair.size, 'no cross-LFI ledger pairs emitted').toBeGreaterThan(0);

      for (const [pairId, members] of byPair.entries()) {
        expect(members.length, `${pairId} must have exactly 2 members`).toBe(2);
        const [a, b] = members;
        expect(a.Amount, `${pairId} Amount mismatch`).toEqual(b.Amount);
        const indicators = new Set(members.map((m) => m.CreditDebitIndicator));
        expect(indicators, `${pairId} must have opposite indicators`).toEqual(
          new Set(['Debit', 'Credit']),
        );
      }
    });
  }
});
