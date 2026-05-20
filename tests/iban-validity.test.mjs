// Slice 3 — every IBAN emitted into a v2.1 envelope across the fixture
// package MUST be ISO-13616 mod-97 valid. The synthetic 23-char shape is:
//   AE + check(2) + bank_code(3) + account(16)
//
// The check digits are computed by `mod97IbanCheck()` in the generator;
// `isValidMod97Iban()` is the symmetric verifier.
//
// Coverage: every IBAN that appears in any envelope's
//   /accounts                          — Account.AccountIdentifiers[].Identification
//   /accounts/{AccountId}/beneficiaries — CreditorAccount[].Identification
//   /accounts/{AccountId}/standing-orders — CreditorAccount[].Identification
//   /accounts/{AccountId}/scheduled-payments — CreditorAccount[].Identification
// is checked. That's 27 personas × 3 LFIs × ~10 IBAN-bearing records per
// account = several thousand validations.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../tools/load-fixtures.mjs';
import { isValidMod97Iban, mod97IbanCheck } from '../src/generator/identity.js';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const MANIFEST_PATH = path.join(PKG_DIR, 'manifest.json');
const FIXTURES_BUILT = fs.existsSync(MANIFEST_PATH);

describe('mod97IbanCheck — ISO-13616 reference vectors', () => {
  // Reference: GB82 WEST 1234 5698 7654 32 (well-known Wikipedia example).
  // BBAN = WEST12345698765432; computing check should give "82".
  it('matches a published ISO-13616 reference (GB82 WEST...)', () => {
    expect(mod97IbanCheck('GB', 'WEST12345698765432')).toBe('82');
  });

  it('any synthetic UAE BBAN passes round-trip validation', () => {
    const bban = '0301234567890123456'; // bank_code 030 + 16-digit account
    const check = mod97IbanCheck('AE', bban);
    const iban = `AE${check}${bban}`;
    expect(isValidMod97Iban(iban)).toBe(true);
  });

  it('isValidMod97Iban rejects an IBAN with a wrong check digit', () => {
    const iban = 'AE000301234567890123456'; // forced wrong check
    expect(isValidMod97Iban(iban)).toBe(false);
  });
});

if (!FIXTURES_BUILT) {
  describe.skip("Slice 3 — every fixture-package IBAN is mod-97 valid (run 'npm run build:fixtures')", () => {
    it.skip('fixture package not built', () => {});
  });
} else
  describe('Slice 3 — every fixture-package IBAN is mod-97 valid', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const bankingFixtures = Object.entries(manifest.fixtures).filter(
      ([, fx]) => (fx.domain ?? 'banking') === 'banking',
    );

    function readEnv(rel) {
      return JSON.parse(fs.readFileSync(path.join(PKG_DIR, rel), 'utf8'));
    }

    function* allIbansInBundle(fx) {
      const accountsEnv = readEnv(fx.endpoints['/accounts']);
      for (const acc of accountsEnv.Data?.Account ?? []) {
        for (const ai of acc.AccountIdentifiers ?? []) {
          if (ai.SchemeName === 'IBAN') yield { iban: ai.Identification, where: '/accounts' };
        }
      }
      for (const id of fx.accountIds ?? []) {
        for (const [suffix, listKey] of [
          ['beneficiaries', 'Beneficiary'],
          ['standing-orders', 'StandingOrder'],
          ['scheduled-payments', 'ScheduledPayment'],
        ]) {
          const env = readEnv(fx.endpoints[`/accounts/${id}/${suffix}`]);
          for (const rec of env.Data?.[listKey] ?? []) {
            for (const ca of rec.CreditorAccount ?? []) {
              if (ca.SchemeName === 'IBAN') yield { iban: ca.Identification, where: `${suffix}` };
            }
          }
        }
      }
    }

    for (const [key, fx] of bankingFixtures) {
      it(`${key} — every IBAN in the rendered bundle passes mod-97`, () => {
        let checked = 0;
        for (const { iban, where } of allIbansInBundle(fx)) {
          expect(typeof iban).toBe('string');
          expect(iban.length).toBe(23);
          expect(iban.slice(0, 2)).toBe('AE');
          expect(isValidMod97Iban(iban), `${key} ${where} IBAN ${iban} fails mod-97`).toBe(true);
          checked += 1;
        }
        expect(checked).toBeGreaterThan(0);
      });
    }
  });
