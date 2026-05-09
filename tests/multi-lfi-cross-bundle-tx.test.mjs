// Slice 7 — cross-LFI mirror ledger. For personas with multi_lfi_footprint,
// the primary bundle's transaction stream now carries 12 monthly self-sweep
// outflows per declared non-primary slot, byte-mirrored as inflows in the
// corresponding role bundle. This test asserts:
//
//   1. computeCrossLfiLedger is pure: same persona+pool → same ledger.
//   2. For every (persona, lfi, seed) with multi_lfi_footprint, the primary
//      bundle's /accounts/{id}/transactions includes 12 XLFI-prefixed outflows
//      per declared role slot.
//   3. The role bundle's transactions list has the matching 12 inflows.
//   4. Each (primary outflow, role inflow) pair shares
//      TransactionDateTime, Amount, Currency, TransactionReference, AND
//      cross-pointers (CreditorAccount.Identification on primary ==
//      role bundle's account[0].IBAN; DebtorAccount.Identification on
//      role == primary bundle's account[0].IBAN).
//   5. Both sides satisfy mod-97 IBAN validation.
//   6. TransactionType='LocalBankTransfer' + SubTransactionType='MoneyTransfer'
//      (v2.1 spec enums).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { repoRoot, loadAllPools } from '../tools/load-fixtures.mjs';
import { computeCrossLfiLedger, derivePrimaryAccountIban } from '../src/generator/multi-lfi.js';
import { isValidMod97Iban } from '../src/generator/identity.js';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const MANIFEST_PATH = path.join(PKG_DIR, 'manifest.json');
const POOL_PATH = path.join(repoRoot, 'synthetic-identity-pool/counterparty-banks/uae-real.yaml');
const FIXTURES_BUILT = fs.existsSync(MANIFEST_PATH);
const POOL = yaml.load(fs.readFileSync(POOL_PATH, 'utf8'));

describe('Slice 7 — computeCrossLfiLedger purity', () => {
  const fakePersona = {
    persona_id: 'sme_fnb_multi_outlet',
    name: 'Saffron Plate Group LLC',
    multi_lfi_footprint: {
      primary: { role: 'operating', plausible_lfi_candidates: ['Mashreq Bank'] },
      secondary: { role: 'acquiring', plausible_lfi_candidates: ['Mashreq Bank'] },
      tertiary: { role: 'digital_challenger', plausible_lfi_candidates: ['Wio Bank', 'Zand Bank'] },
    },
  };
  const now = new Date(Date.UTC(2026, 3, 1));
  const primaryAccountId = 'sme-fnb-multi-outlet-acct-01';
  const primaryIban = derivePrimaryAccountIban('sme_fnb_multi_outlet', 0);

  it('returns 12 monthly entries per declared non-primary slot, no entries for primary slot itself', () => {
    const a = computeCrossLfiLedger({
      persona: fakePersona, primaryAccountId, primaryIban, counterpartyBanksPool: POOL, now,
    });
    expect(a.primary.length).toBe(24); // 12 secondary + 12 tertiary
    expect(a.secondary.length).toBe(12);
    expect(a.tertiary.length).toBe(12);
  });

  it('two calls with identical inputs return byte-identical ledgers (EXP-05 across-bundle)', () => {
    const a = computeCrossLfiLedger({
      persona: fakePersona, primaryAccountId, primaryIban, counterpartyBanksPool: POOL, now,
    });
    const b = computeCrossLfiLedger({
      persona: fakePersona, primaryAccountId, primaryIban, counterpartyBanksPool: POOL, now,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('primary outflows + role inflows mirror by Amount, Currency, DateTime, Reference', () => {
    const a = computeCrossLfiLedger({
      persona: fakePersona, primaryAccountId, primaryIban, counterpartyBanksPool: POOL, now,
    });
    // Pair primary outflows with their role-side inflows by _crossLfiPairId.
    const byPair = new Map();
    for (const t of [...a.primary, ...a.secondary, ...a.tertiary]) {
      if (!byPair.has(t._crossLfiPairId)) byPair.set(t._crossLfiPairId, {});
      const side = t.CreditDebitIndicator === 'Debit' ? 'out' : 'in';
      byPair.get(t._crossLfiPairId)[side] = t;
    }
    expect(byPair.size).toBeGreaterThanOrEqual(12);
    for (const [pid, sides] of byPair.entries()) {
      expect(sides.out, `${pid} missing out`).toBeDefined();
      expect(sides.in, `${pid} missing in`).toBeDefined();
      expect(sides.out.Amount).toEqual(sides.in.Amount);
      expect(sides.out.TransactionDateTime).toBe(sides.in.TransactionDateTime);
      expect(sides.out.TransactionReference).toBe(sides.in.TransactionReference);
      expect(sides.out.CreditDebitIndicator).toBe('Debit');
      expect(sides.in.CreditDebitIndicator).toBe('Credit');
    }
  });
});

if (!FIXTURES_BUILT) {
  describe.skip("Slice 7 — cross-LFI mirror in built fixtures (run 'npm run build:fixtures')", () => {
    it.skip('fixture package not built', () => {});
  });
} else describe('Slice 7 — cross-LFI mirror in built fixtures', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  function readEnv(rel) {
    return JSON.parse(fs.readFileSync(path.join(PKG_DIR, rel), 'utf8'));
  }

  // For each role-fixture entry, check the cross-bundle mirror.
  const roleFixtures = manifest.roleFixtures ?? {};
  // XLFI markers survive any LFI profile via the always-mandatory
  // TransactionId field — the format is `<persona-slug>-xlfi-<sN>-<NN>-<dir>`.
  const isXlfi = (t) => typeof t.TransactionId === 'string' && t.TransactionId.includes('-xlfi-');

  for (const [rkey, rfx] of Object.entries(roleFixtures)) {
    const primaryKey = `${rfx.personaId}|${rfx.lfi}|${rfx.seed}`;
    const primary = manifest.fixtures[primaryKey];
    const primaryAccountId = primary.accountIds[0];

    it(`${rkey} — primary bundle has 12 XLFI outflows targeting this slot (TransactionId-keyed; field-redaction-stable)`, () => {
      const primaryTx = readEnv(primary.endpoints[`/accounts/${primaryAccountId}/transactions`]);
      const slotTag = rfx.slot === 'secondary' ? 's2' : 's3';
      const xlfiToSlot = (primaryTx.Data.Transaction ?? []).filter(
        (t) => isXlfi(t) && t.TransactionId.includes(`-xlfi-${slotTag}-`) && t.TransactionId.endsWith('-out'),
      );
      expect(xlfiToSlot.length).toBe(12);
      for (const t of xlfiToSlot) {
        expect(t.CreditDebitIndicator).toBe('Debit');
        expect(t.TransactionType).toBe('LocalBankTransfer');
        expect(t.SubTransactionType).toBe('MoneyTransfer');
      }
    });

    it(`${rkey} — role bundle has 12 XLFI inflows`, () => {
      const roleAccountId = rfx.accountIds[0];
      const roleTx = readEnv(rfx.endpoints[`/accounts/${roleAccountId}/transactions`]);
      const xlfiIn = (roleTx.Data.Transaction ?? []).filter(
        (t) => isXlfi(t) && t.TransactionId.endsWith('-in'),
      );
      expect(xlfiIn.length).toBe(12);
      for (const t of xlfiIn) {
        expect(t.CreditDebitIndicator).toBe('Credit');
        expect(t.TransactionType).toBe('LocalBankTransfer');
        expect(t.SubTransactionType).toBe('MoneyTransfer');
      }
    });

    it(`${rkey} — primary outflows and role inflows mirror by datetime + amount`, () => {
      const primaryTx = readEnv(primary.endpoints[`/accounts/${primaryAccountId}/transactions`]);
      const roleAccountId = rfx.accountIds[0];
      const roleTx = readEnv(rfx.endpoints[`/accounts/${roleAccountId}/transactions`]);
      const slotTag = rfx.slot === 'secondary' ? 's2' : 's3';

      const xlfiOut = (primaryTx.Data.Transaction ?? []).filter(
        (t) => isXlfi(t) && t.TransactionId.includes(`-xlfi-${slotTag}-`) && t.TransactionId.endsWith('-out'),
      );
      const xlfiIn = (roleTx.Data.Transaction ?? []).filter(
        (t) => isXlfi(t) && t.TransactionId.endsWith('-in'),
      );

      // Pair by TransactionId stem (drop the -out / -in suffix).
      const stem = (id) => id.replace(/-(?:out|in)$/, '');
      const inByStem = new Map(xlfiIn.map((t) => [stem(t.TransactionId), t]));
      for (const out of xlfiOut) {
        const inRecord = inByStem.get(stem(out.TransactionId));
        expect(inRecord, `role inflow for ${out.TransactionId} missing`).toBeDefined();
        expect(inRecord.Amount).toEqual(out.Amount);
        expect(inRecord.TransactionDateTime).toBe(out.TransactionDateTime);
      }
    });

    // Cross-IBAN check: counterparty fields are Common-band, kept under
    // Rich, sometimes Median, stripped under Sparse. Only the Rich
    // bundle carries a guaranteed cross-IBAN signal.
    if (rfx.lfi === 'rich') {
      it(`${rkey} (rich) — cross-IBAN pointers byte-match`, () => {
        const primaryAccounts = readEnv(primary.endpoints['/accounts']);
        const primaryIban = primaryAccounts.Data.Account[0].AccountIdentifiers[0].Identification;
        const roleAccounts = readEnv(rfx.endpoints['/accounts']);
        const roleIban = roleAccounts.Data.Account[0].AccountIdentifiers[0].Identification;

        const primaryTx = readEnv(primary.endpoints[`/accounts/${primaryAccountId}/transactions`]);
        const slotTag = rfx.slot === 'secondary' ? 's2' : 's3';
        const xlfiOut = (primaryTx.Data.Transaction ?? []).filter(
          (t) => isXlfi(t) && t.TransactionId.includes(`-xlfi-${slotTag}-`) && t.TransactionId.endsWith('-out'),
        );
        for (const t of xlfiOut) {
          expect(t.CreditorAccount?.[0]?.Identification).toBe(roleIban);
          expect(isValidMod97Iban(t.CreditorAccount[0].Identification)).toBe(true);
        }

        const roleAccountId = rfx.accountIds[0];
        const roleTx = readEnv(rfx.endpoints[`/accounts/${roleAccountId}/transactions`]);
        const xlfiIn = (roleTx.Data.Transaction ?? []).filter(
          (t) => isXlfi(t) && t.TransactionId.endsWith('-in'),
        );
        for (const t of xlfiIn) {
          expect(t.DebtorAccount?.Identification).toBe(primaryIban);
          expect(isValidMod97Iban(t.DebtorAccount.Identification)).toBe(true);
        }
      });
    }
  }
});
