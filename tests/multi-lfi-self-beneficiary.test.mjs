// Phase D-lite (D-14) — for personas with multi_lfi_footprint, the primary
// bundle's beneficiary list MUST include one self-at-other-LFI beneficiary
// per declared non-primary slot. Each carries:
//   - Reference            = "self-to-secondary" or "self-to-tertiary"
//   - AccountHolderName    = persona's own signatory name
//   - CreditorAgent.Name   = a real UAE bank from the slot's
//                            plausible_lfi_candidates that exists in
//                            the counterparty pool
//   - CreditorAccount.Name = persona's own signatory name (self-transfer
//                            shape)
//   - CreditorAccount.Identification = a deterministic synthetic IBAN
//                            keyed on (persona_id, role, candidate-bank)
//
// Determinism: the cross-LFI self-IBAN is a pure function of
// (persona_id, role, bank.iban_prefix), independent of the bundle's
// `seed` arg. When a future full Phase D slice generates a separate
// secondary bundle, that bundle's account[0].IBAN can be made to
// match this IBAN to close the cross-bundle reference loop without
// any plumbing changes.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { repoRoot } from '../tools/load-fixtures.mjs';
import {
  deriveCrossLfiSelfIban,
} from '../src/generator/multi-lfi.js';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const MANIFEST_PATH = path.join(PKG_DIR, 'manifest.json');
const POOL_PATH = path.join(
  repoRoot,
  'synthetic-identity-pool/counterparty-banks/uae-real.yaml',
);
const FIXTURES_BUILT = fs.existsSync(MANIFEST_PATH);
const POOL = yaml.load(fs.readFileSync(POOL_PATH, 'utf8'));
const POOL_BY_NAME = new Map(POOL.banks.map((b) => [b.name, b]));

function readEnv(rel) {
  return JSON.parse(fs.readFileSync(path.join(PKG_DIR, rel), 'utf8'));
}

describe('Phase D-lite — cross-LFI self-IBAN derivation is pure', () => {
  it('same (persona, role, bank) yields the same IBAN every call', () => {
    const bank = POOL.banks[0];
    const a = deriveCrossLfiSelfIban('sme_fnb_multi_outlet', 'secondary', bank);
    const b = deriveCrossLfiSelfIban('sme_fnb_multi_outlet', 'secondary', bank);
    expect(a).toBe(b);
  });

  it('different roles produce different IBANs', () => {
    const bank = POOL.banks[0];
    const sec = deriveCrossLfiSelfIban('sme_fnb_multi_outlet', 'secondary', bank);
    const ter = deriveCrossLfiSelfIban('sme_fnb_multi_outlet', 'tertiary', bank);
    expect(sec).not.toBe(ter);
  });

  it('different personas produce different IBANs', () => {
    const bank = POOL.banks[0];
    const a = deriveCrossLfiSelfIban('sme_fnb_multi_outlet', 'secondary', bank);
    const b = deriveCrossLfiSelfIban('sme_saas_freezone', 'secondary', bank);
    expect(a).not.toBe(b);
  });

  it('different banks produce different IBANs (bank_code embedded at positions 5–7)', () => {
    const a = deriveCrossLfiSelfIban('sme_fnb_multi_outlet', 'secondary', POOL.banks[0]);
    const b = deriveCrossLfiSelfIban('sme_fnb_multi_outlet', 'secondary', POOL.banks[1]);
    expect(a).not.toBe(b);
    // Slice 3: under the mod-97 path the IBAN is AE + check(2) + bank_code(3)
    // + account(16). Positions 5–7 carry the per-bank routing identifier.
    expect(a.slice(4, 7)).toBe(POOL.banks[0].bank_code);
    expect(b.slice(4, 7)).toBe(POOL.banks[1].bank_code);
  });

  it('IBAN body length is 23 chars (matching drawIban contract)', () => {
    const iban = deriveCrossLfiSelfIban('any_persona', 'secondary', POOL.banks[0]);
    expect(iban).toHaveLength(23);
  });
});

if (!FIXTURES_BUILT) {
  describe.skip("Phase D-lite — cross-LFI self-beneficiary surface (run 'npm run build:fixtures' to enable)", () => {
    it.skip('fixture package not built', () => {});
  });
} else describe('Phase D-lite — cross-LFI self-beneficiary surfaces in primary bundle', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  // Find personas with multi_lfi_footprint declared.
  const personasWithFootprint = [];
  for (const [pid, info] of Object.entries(manifest.personas)) {
    if (info.domain !== 'banking') continue;
    const personaJson = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'personas', `${pid}.json`), 'utf8'),
    );
    if (personaJson.multi_lfi_footprint) {
      personasWithFootprint.push({ pid, persona: personaJson });
    }
  }

  it('at least 5 personas declare multi_lfi_footprint (the Phase 2.x SME expansion set)', () => {
    expect(personasWithFootprint.length).toBeGreaterThanOrEqual(5);
  });

  for (const { pid, persona } of personasWithFootprint) {
    const expectedRoles = ['secondary', 'tertiary'].filter((r) => {
      const slot = persona.multi_lfi_footprint[r];
      if (!slot) return false;
      // The slot only yields a self-beneficiary if at least one candidate
      // exists in the counterparty pool. Acquirer/PSP-only slots are
      // silently skipped — see pickRoleBank in src/generator/multi-lfi.js.
      return (slot.plausible_lfi_candidates ?? []).some((n) => POOL_BY_NAME.has(n));
    });

    for (const lfi of ['rich', 'median', 'sparse']) {
      const fxKey = `${pid}|${lfi}|${persona.default_seed}`;
      const fx = manifest.fixtures[fxKey];
      if (!fx) continue;
      const operatingId = (fx.accountIds ?? [])[0];
      if (!operatingId) continue;

      it(`${fxKey} — primary bundle's beneficiaries include 'self-to-<role>' for each non-primary footprint slot`, () => {
        const env = readEnv(fx.endpoints[`/accounts/${operatingId}/beneficiaries`]);
        const beneficiaries = env.Data?.Beneficiary ?? [];
        const selfBeneficiaries = beneficiaries.filter((b) =>
          (b.Reference ?? '').startsWith('self-to-'),
        );
        const selfRoles = new Set(
          selfBeneficiaries.map((b) => b.Reference.replace('self-to-', '')),
        );
        expect(selfRoles).toEqual(new Set(expectedRoles));

        for (const ben of selfBeneficiaries) {
          // Bank name from the pool (NG5/D-14 allow-site).
          const bankName = ben.CreditorAgent?.Name;
          expect(POOL_BY_NAME.has(bankName), `bank "${bankName}" must be in pool`).toBe(true);
          // BIC matches the pool entry's bic stem.
          expect(ben.CreditorAgent.Identification).toBe(POOL_BY_NAME.get(bankName).bic);
          // The CreditorAccount holder name is the persona's own
          // signatory — self-transfer shape.
          expect(ben.CreditorAccount?.[0]?.Name).toBeTruthy();
          // The IBAN is the deterministic cross-LFI self-IBAN.
          const role = ben.Reference.replace('self-to-', '');
          const expectedIban = deriveCrossLfiSelfIban(pid, role, POOL_BY_NAME.get(bankName));
          expect(ben.CreditorAccount[0].Identification).toBe(expectedIban);
        }
      });
    }
  }
});
