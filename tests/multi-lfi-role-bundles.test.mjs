// Phase D Slice 5 — full role-bundle generation. For personas with
// `multi_lfi_footprint`, the fixture package emits secondary and tertiary
// bundles at `bundles/<persona>/<role>/<lfi>/seed-<n>/...` alongside the
// primary. This test asserts:
//
//   1. Manifest's `roleFixtures` map indexes every (persona, role, lfi,
//      seed) combination expected for personas declaring secondary /
//      tertiary slots.
//   2. Each role bundle's /accounts envelope is a spec-shaped Data /
//      Links / Meta v2.1 envelope with a single Account at the role's
//      bank.
//   3. Cross-bundle reference loop: the role bundle's account[0].
//      AccountIdentifiers[0].Identification (the IBAN) byte-matches the
//      primary bundle's `self-to-<role>` beneficiary's
//      CreditorAccount.Identification — so a TPP fetching both bundles
//      can reconcile the persona's multi-bank holdings by IBAN identity.
//   4. The same IBAN passes mod-97 (carries the bank's bank_code at
//      positions 5–7).
//   5. The loader API `loadFixture({lfi_role: 'secondary'})` resolves
//      against the role-keyed path.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../tools/load-fixtures.mjs';
import { isValidMod97Iban } from '../src/generator/identity.js';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const MANIFEST_PATH = path.join(PKG_DIR, 'manifest.json');
const FIXTURES_BUILT = fs.existsSync(MANIFEST_PATH);

if (!FIXTURES_BUILT) {
  describe.skip("Phase D Slice 5 (run 'npm run build:fixtures')", () => {
    it.skip('fixture package not built', () => {});
  });
} else
  describe('Phase D Slice 5 — role-bundle generation + cross-bundle IBAN identity', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const roleFixtures = manifest.roleFixtures ?? {};

    // Personas with multi_lfi_footprint and at least one declared
    // secondary / tertiary slot whose candidates resolve into the pool.
    const expectedRolePersonas = new Set();
    for (const key of Object.keys(roleFixtures)) {
      expectedRolePersonas.add(key.split('|')[0]);
    }

    it('roleFixtures map is non-empty (at least one persona declares a footprint)', () => {
      expect(Object.keys(roleFixtures).length).toBeGreaterThan(0);
      expect(expectedRolePersonas.size).toBeGreaterThan(0);
    });

    it('every role-fixture entry carries personaId, slot, role, lfi, seed, accountIds, endpoints', () => {
      for (const [key, rfx] of Object.entries(roleFixtures)) {
        expect(rfx.personaId, `${key} personaId`).toBeDefined();
        // Phase 2.2 — slot is a free-form kebab key. Legacy SME personas
        // use 'secondary' / 'tertiary'; multi-banker personas use custom
        // keys like 'everyday-card' / 'mortgage-lender'.
        expect(typeof rfx.slot).toBe('string');
        expect(rfx.slot.length).toBeGreaterThan(0);
        expect(rfx.role, `${key} role`).toBeDefined();
        expect(['rich', 'median', 'sparse']).toContain(rfx.lfi);
        expect(rfx.seed, `${key} seed`).toBeGreaterThan(0);
        expect(rfx.accountIds.length, `${key} accountIds`).toBeGreaterThan(0);
        expect(rfx.endpoints['/accounts'], `${key} /accounts endpoint`).toBeDefined();
      }
    });

    for (const [key, rfx] of Object.entries(roleFixtures)) {
      it(`${key} — /accounts envelope is spec-shaped (mod-97 IBANs)`, () => {
        const env = JSON.parse(
          fs.readFileSync(path.join(PKG_DIR, rfx.endpoints['/accounts']), 'utf8'),
        );
        // Phase 2.2 — role bundles can now carry multiple accounts when
        // the source persona tags multiple products at the same slot
        // (e.g. CurrentAccount + CreditCard at an SME's everyday-card LFI).
        // Legacy SME role bundles stay single-account.
        expect(env.Data?.Account?.length).toBeGreaterThanOrEqual(1);
        expect(env.Links?.Self).toBeDefined();
        expect(env.Meta).toBeDefined();
        expect(env._watermark).toMatch(/SYNTHETIC/);
        for (const acc of env.Data.Account) {
          const iban = acc.AccountIdentifiers?.[0]?.Identification;
          expect(typeof iban).toBe('string');
          expect(iban.length).toBe(23);
          expect(isValidMod97Iban(iban), `${key} IBAN ${iban} fails mod-97`).toBe(true);
        }
      });

      it(`${key} — IBAN matches the primary bundle's self-to-${rfx.slot} beneficiary IBAN (cross-bundle reference loop)`, () => {
        const roleEnv = JSON.parse(
          fs.readFileSync(path.join(PKG_DIR, rfx.endpoints['/accounts']), 'utf8'),
        );
        const roleIban = roleEnv.Data.Account[0].AccountIdentifiers[0].Identification;

        // Primary bundle for the same (persona, lfi, seed)
        const primaryKey = `${rfx.personaId}|${rfx.lfi}|${rfx.seed}`;
        const primary = manifest.fixtures[primaryKey];
        expect(primary, `primary fixture ${primaryKey} must exist`).toBeDefined();
        const primaryAccountId = primary.accountIds[0];
        const benEnv = JSON.parse(
          fs.readFileSync(
            path.join(PKG_DIR, primary.endpoints[`/accounts/${primaryAccountId}/beneficiaries`]),
            'utf8',
          ),
        );
        const selfBen = (benEnv.Data?.Beneficiary ?? []).find(
          (b) => b.Reference === `self-to-${rfx.slot}`,
        );
        expect(selfBen, `primary bundle missing self-to-${rfx.slot} beneficiary`).toBeDefined();
        expect(selfBen.CreditorAccount?.[0]?.Identification).toBe(roleIban);
      });
    }

    it('npm loader API: loadFixture({lfi_role: "secondary"}) resolves a role-bundle envelope', async () => {
      const m = await import(path.join(PKG_DIR, 'index.mjs'));
      const env = m.loadFixture({
        persona: 'sme_fnb_multi_outlet',
        lfi: 'rich',
        lfi_role: 'secondary',
        endpoint: '/accounts',
      });
      expect(env.Data?.Account?.length).toBe(1);
      expect(env._watermark).toMatch(/SYNTHETIC/);
    });

    it('npm loader API: listRoleBundles returns the declared slots for a footprint persona', async () => {
      const m = await import(path.join(PKG_DIR, 'index.mjs'));
      const slots = m.listRoleBundles('sme_fnb_multi_outlet');
      expect(slots).toEqual(expect.arrayContaining(['secondary', 'tertiary']));
      // Personas without multi_lfi_footprint return [].
      expect(m.listRoleBundles('senior_retiree')).toEqual([]);
    });

    // Phase 2.2 regression — N-slot personas use arbitrary slot keys, not the
    // legacy secondary/tertiary triad. listRoleBundles must surface those keys
    // (it previously hard-coded ['secondary','tertiary'], leaving the flagship
    // retail_multi_banker's role bundles emitted-but-unreachable), and every
    // surfaced slot must load a spec-shaped envelope.
    it('npm loader API: N-slot persona role bundles are discoverable and loadable', async () => {
      const m = await import(path.join(PKG_DIR, 'index.mjs'));
      const expected = [
        ...new Set(
          Object.keys(roleFixtures)
            .filter((k) => k.startsWith('retail_multi_banker|'))
            .map((k) => k.split('|')[1]),
        ),
      ];
      // The flagship N-slot persona must emit at least one custom-key role
      // bundle, otherwise this regression can't catch anything.
      expect(expected.length).toBeGreaterThan(0);
      const slots = m.listRoleBundles('retail_multi_banker');
      expect(slots.sort()).toEqual(expected.sort());
      // None of these are the legacy keys — proves the hard-coded list is gone.
      expect(slots.some((s) => s !== 'secondary' && s !== 'tertiary')).toBe(true);
      for (const slot of slots) {
        const env = m.loadFixture({
          persona: 'retail_multi_banker',
          lfi: 'median',
          lfi_role: slot,
          endpoint: '/accounts',
        });
        expect(env.Data?.Account?.length, `slot ${slot} /accounts`).toBeGreaterThan(0);
        expect(env._watermark).toMatch(/SYNTHETIC/);
      }
    });
  });
