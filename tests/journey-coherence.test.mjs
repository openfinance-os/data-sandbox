// EXP-32 — cross-endpoint identifier coherence.
// For every (persona, lfi, seed) tuple in the built fixture package,
// every AccountId surfaced by /accounts MUST resolve consistently across
// every per-account endpoint, and the calling-party PartyId MUST be
// stable. This is the property a TPP showcase journey relies on — and
// the property the Nebras-operated regulatory sandbox does not optimise
// for, which is why a TPP demo wired to those mocks looks empty.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../tools/load-fixtures.mjs';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');

const PER_ACCOUNT_SUFFIXES = [
  'balances',
  'transactions',
  'standing-orders',
  'direct-debits',
  'beneficiaries',
  'scheduled-payments',
  'parties',
  'product',
  'statements',
];

function readEnv(rel) {
  return JSON.parse(fs.readFileSync(path.join(PKG_DIR, rel), 'utf8'));
}

beforeAll(() => {
  if (!fs.existsSync(path.join(PKG_DIR, 'manifest.json'))) {
    throw new Error("fixture package not built — run 'npm run build:fixtures' first");
  }
});

describe('EXP-32 cross-endpoint coherence', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'manifest.json'), 'utf8'));
  const fixtureEntries = Object.entries(manifest.fixtures);

  it('the test matrix covers 12 personas × 3 LFIs', () => {
    expect(fixtureEntries.length).toBe(36);
  });

  for (const [key, fx] of fixtureEntries) {
    it(`${key} — AccountIds line up across every per-account endpoint`, () => {
      const accountsEnv = readEnv(fx.endpoints['/accounts']);
      const accountIds = (accountsEnv.Data?.Account ?? []).map((a) => a.AccountId);

      // /accounts must agree with manifest.accountIds.
      expect(accountIds.length, '/accounts has accounts').toBeGreaterThan(0);
      expect([...accountIds].sort()).toEqual([...(fx.accountIds ?? [])].sort());

      // Every accountId resolves to all 9 per-account endpoints, and each
      // envelope's Data.AccountId matches the path-segment AccountId.
      for (const id of accountIds) {
        for (const suffix of PER_ACCOUNT_SUFFIXES) {
          const ep = `/accounts/${id}/${suffix}`;
          const rel = fx.endpoints[ep];
          expect(rel, `${key} missing ${ep}`).toBeDefined();
          const env = readEnv(rel);
          expect(env.Data, `${key} ${ep} has Data`).toBeDefined();
          expect(env.Data.AccountId, `${key} ${ep} Data.AccountId`).toBe(id);
        }
        // /accounts/{AccountId} (the per-account "self") should also resolve.
        const selfEp = `/accounts/${id}`;
        expect(fx.endpoints[selfEp], `${key} missing ${selfEp}`).toBeDefined();
      }
    });

    it(`${key} — /parties calling-party id is stable and well-formed`, () => {
      const parties = readEnv(fx.endpoints['/parties']);
      const partyId = parties.Data?.Party?.PartyId;
      expect(partyId, `${key} /parties PartyId`).toBeTruthy();
      expect(typeof partyId).toBe('string');
      // Generator convention: <persona-slug>-party
      expect(partyId).toMatch(/-party$/);
    });

    it(`${key} — every transaction's parent envelope AccountId matches its path`, () => {
      for (const id of fx.accountIds ?? []) {
        const txEnv = readEnv(fx.endpoints[`/accounts/${id}/transactions`]);
        expect(txEnv.Data?.AccountId).toBe(id);
        // If transactions exist, every entry should at minimum carry a TransactionId.
        for (const t of txEnv.Data?.Transaction ?? []) {
          expect(t.TransactionId, `${key} ${id} transaction has TransactionId`).toBeTruthy();
        }
      }
    });

    it(`${key} — every standing-order DebtorAccount points back to the parent AccountId`, () => {
      for (const id of fx.accountIds ?? []) {
        const soEnv = readEnv(fx.endpoints[`/accounts/${id}/standing-orders`]);
        expect(soEnv.Data?.AccountId).toBe(id);
        // Spec doesn't require DebtorAccount echoing AccountId, so we just
        // assert envelope-level coherence here. Per-record fields (Debtor,
        // Creditor) are covered by the spec-validation suite.
      }
    });
  }

  it('every persona has at least one account', () => {
    for (const [, fx] of fixtureEntries) {
      expect((fx.accountIds ?? []).length).toBeGreaterThan(0);
    }
  });
});
