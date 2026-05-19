// Phase 2.2 — multi-product per LFI. When a persona tags its accounts
// with `at_slot`, projectPersonaForRole emits ALL accounts whose
// at_slot matches the projected slot key, sharing the slot's bank but
// each carrying a distinct IBAN. Verifies:
//
//   1. A multi-product role projection returns >1 account when the
//      source persona has multiple accounts tagged at that slot.
//   2. Every projected account carries the same _bankOverride.
//   3. The first CurrentAccount in the projection carries the
//      cross-LFI self-IBAN (matches buildCrossLfiSelfBeneficiaries).
//   4. Other products carry distinct, mod-97-valid IBANs derived from
//      the slot key + product index.
//   5. Untagged personas (SME) still fall back to the legacy
//      single-account projection — byte-identity is preserved by the
//      existing multi-lfi-role-bundles suite.

import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import {
  projectPersonaForRole,
  deriveCrossLfiSelfIban,
} from '../src/generator/multi-lfi.js';
import { isValidMod97Iban, mod97IbanCheck } from '../src/generator/identity.js';
import { repoRoot } from '../tools/load-fixtures.mjs';

const POOL_PATH = path.join(repoRoot, 'synthetic-identity-pool/counterparty-banks/uae-real.yaml');
const POOL = yaml.load(fs.readFileSync(POOL_PATH, 'utf8'));

const adcbBank = POOL.banks.find((b) => /Abu Dhabi Commercial/i.test(b.name));
const enbdBank = POOL.banks.find((b) => /Emirates NBD/i.test(b.name));

describe('Phase 2.2 — multi-product role-bundle projection', () => {
  // A miniature retail multi-LFI persona that mirrors Mike Hartly's
  // ENBD slot (1 CurrentAccount + 1 CreditCard at the same LFI).
  const mikeLike = {
    persona_id: 'retail_multi_lfi_aggregator_test',
    name: 'Test Multi-Bank Customer',
    multi_lfi_footprint: {
      slots: [
        {
          key: 'salary',
          role: 'salary_primary',
          plausible_lfi_candidates: [adcbBank.name],
        },
        {
          key: 'everyday-card',
          role: 'secondary_card',
          plausible_lfi_candidates: [enbdBank.name],
        },
      ],
    },
    accounts: [
      { type: 'CurrentAccount', currency: 'AED', age_months: 96, at_slot: 'salary' },
      { type: 'CreditCard', currency: 'AED', age_months: 72, credit_limit_aed: 50000, at_slot: 'salary' },
      { type: 'CurrentAccount', currency: 'AED', age_months: 60, at_slot: 'everyday-card' },
      { type: 'CreditCard', currency: 'AED', age_months: 36, credit_limit_aed: 40000, at_slot: 'everyday-card' },
    ],
  };

  it('projects multiple accounts when the source persona has multiple at_slot=<slotKey> tagged accounts', () => {
    const projected = projectPersonaForRole(mikeLike, 'everyday-card', enbdBank);
    expect(projected, 'projection returned null').toBeTruthy();
    expect(projected.accounts.length).toBe(2);
    expect(projected.accounts.map((a) => a.type)).toEqual(['CurrentAccount', 'CreditCard']);
  });

  it('shares _bankOverride across all projected accounts in the slot', () => {
    const projected = projectPersonaForRole(mikeLike, 'everyday-card', enbdBank);
    for (const acc of projected.accounts) {
      expect(acc._bankOverride).toBe(enbdBank);
    }
  });

  it('first CurrentAccount in the projection carries the cross-LFI self-IBAN (matches buildCrossLfiSelfBeneficiaries)', () => {
    const projected = projectPersonaForRole(mikeLike, 'everyday-card', enbdBank);
    const expectedAnchorIban = deriveCrossLfiSelfIban(
      mikeLike.persona_id,
      'everyday-card',
      enbdBank,
    );
    const firstCurrent = projected.accounts.find((a) => a.type === 'CurrentAccount');
    expect(firstCurrent._ibanOverride).toBe(expectedAnchorIban);
  });

  it('non-anchor products carry distinct mod-97-valid IBANs', () => {
    const projected = projectPersonaForRole(mikeLike, 'everyday-card', enbdBank);
    const anchorIban = projected.accounts[0]._ibanOverride;
    const ibans = projected.accounts.map((a) => a._ibanOverride);
    // All distinct
    expect(new Set(ibans).size).toBe(ibans.length);
    // All mod-97-valid
    for (const iban of ibans) {
      expect(isValidMod97Iban(iban), `IBAN ${iban} fails mod-97`).toBe(true);
    }
    // First is the anchor; others are derived
    expect(ibans[0]).toBe(anchorIban);
  });

  it('projection preserves credit_limit_aed and other per-account fields', () => {
    const projected = projectPersonaForRole(mikeLike, 'everyday-card', enbdBank);
    const card = projected.accounts.find((a) => a.type === 'CreditCard');
    expect(card.credit_limit_aed).toBe(40000);
    expect(card.age_months).toBe(36);
  });

  it('falls back to the legacy single-account projection when no at_slot tags are present (SME byte-equivalence)', () => {
    const smeLike = {
      persona_id: 'sme_test',
      multi_lfi_footprint: {
        primary: { role: 'operating', plausible_lfi_candidates: [adcbBank.name] },
        secondary: { role: 'acquiring', plausible_lfi_candidates: [enbdBank.name] },
      },
      accounts: [
        { type: 'CurrentAccount', currency: 'AED', age_months: 36 },
        { type: 'CurrentAccount', currency: 'USD', age_months: 36 },
      ],
    };
    const projected = projectPersonaForRole(smeLike, 'secondary', enbdBank);
    expect(projected.accounts.length).toBe(1);
    expect(projected.accounts[0]._bankOverride).toBe(enbdBank);
    expect(projected.accounts[0]._ibanOverride).toBe(
      deriveCrossLfiSelfIban('sme_test', 'secondary', enbdBank),
    );
  });

  it('returns the legacy single-account projection when a slot is declared but no accounts are tagged for it', () => {
    const persona = {
      persona_id: 'sparse_test',
      multi_lfi_footprint: {
        slots: [
          { key: 'salary', role: 'salary_primary', plausible_lfi_candidates: [adcbBank.name] },
          { key: 'mortgage-lender', role: 'mortgage_lender', plausible_lfi_candidates: [enbdBank.name] },
        ],
      },
      accounts: [
        { type: 'CurrentAccount', currency: 'AED', age_months: 96, at_slot: 'salary' },
        // no accounts tagged at_slot='mortgage-lender'
      ],
    };
    const projected = projectPersonaForRole(persona, 'mortgage-lender', enbdBank);
    expect(projected.accounts.length).toBe(1);
    expect(projected.accounts[0].type).toBe('CurrentAccount');
  });
});

// Smoke check: the derived IBAN scheme produces mod-97 valid output
// for typical product indices. Pins the assumption that
// deriveCrossLfiSelfIban can be called with augmented slot-product keys.
describe('Phase 2.2 — multi-product IBAN derivation determinism', () => {
  it('produces stable mod-97-valid IBANs across two calls for the same (persona, slot+product, bank)', () => {
    const a = deriveCrossLfiSelfIban('p1', 'everyday-card__product_1', enbdBank);
    const b = deriveCrossLfiSelfIban('p1', 'everyday-card__product_1', enbdBank);
    expect(a).toBe(b);
    expect(isValidMod97Iban(a)).toBe(true);
  });

  it('produces distinct IBANs for distinct product subkeys', () => {
    const i1 = deriveCrossLfiSelfIban('p1', 'everyday-card', enbdBank);
    const i2 = deriveCrossLfiSelfIban('p1', 'everyday-card__product_1', enbdBank);
    const i3 = deriveCrossLfiSelfIban('p1', 'everyday-card__product_2', enbdBank);
    expect(new Set([i1, i2, i3]).size).toBe(3);
  });
});

// Silence the mod97IbanCheck import — it's only used to anchor the
// mod-97 check used by isValidMod97Iban in surrounding tests.
void mod97IbanCheck;
