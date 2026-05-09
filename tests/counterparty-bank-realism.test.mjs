// D-14 — counterparty-bank realism. The default `counterparty_banks_uae_real`
// pool ships 37 named UAE banks across Tier-1 / Tier-2 / Islamic / digital /
// foreign branches. This test asserts:
//
//   1. The pool itself spans at least 30 banks (catches accidental shrinkage),
//      every bank has a unique 4-char `iban_prefix`, and every bank has a
//      unique 8-char synthetic `bic` BIC stem.
//   2. For every banking persona × LFI fixture, the counterparty IBANs
//      surfaced in beneficiaries / standing orders / scheduled payments
//      span at least 3 distinct AE-prefixes (5 for SME/Corporate personas
//      that structurally have more counterparty volume).
//   3. For every banking persona × LFI fixture, beneficiaries surface a
//      counterparty bank NAME (CreditorAgent.Name) drawn from the pool —
//      so multi-banking is visible in rendered fixtures, not just inferable
//      from IBAN prefix. Beneficiaries use schema 6_0 which permits Name;
//      standing-orders / scheduled-payments use 5_1 which does not — they
//      get bank-distinctive BICs but no Name surface.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { repoRoot } from '../tools/load-fixtures.mjs';

const POOL_PATH = path.join(
  repoRoot,
  'synthetic-identity-pool/counterparty-banks/uae-real.yaml',
);
const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const MANIFEST_PATH = path.join(PKG_DIR, 'manifest.json');

const POOL = yaml.load(fs.readFileSync(POOL_PATH, 'utf8'));
const FIXTURES_BUILT = fs.existsSync(MANIFEST_PATH);

describe('D-14 counterparty-bank pool breadth', () => {
  it('the uae-real pool ships at least 30 banks', () => {
    expect(POOL.pool_id).toBe('counterparty_banks_uae_real');
    expect(Array.isArray(POOL.banks)).toBe(true);
    expect(POOL.banks.length).toBeGreaterThanOrEqual(30);
  });

  it('every bank has a unique iban_prefix (4-char AE prefix)', () => {
    const prefixes = POOL.banks.map((b) => b.iban_prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const p of prefixes) expect(p).toMatch(/^AE\d{2}$/);
  });

  it('every bank has a unique synthetic 8-char BIC stem', () => {
    const bics = POOL.banks.map((b) => b.bic);
    expect(new Set(bics).size).toBe(bics.length);
    for (const b of bics) expect(b).toMatch(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}$/);
  });

  it('the pool covers all four UAE bank tiers/types (Tier-1 conventional, Tier-1 Islamic, digital-only, foreign)', () => {
    // Lightweight membership probe — the lint already enforces NG5/D-14
    // allow-listing; this check just makes sure the pool stays representative.
    const names = POOL.banks.map((b) => b.name);
    const probes = [
      'First Abu Dhabi Bank',          // Tier-1 conventional
      'Dubai Islamic Bank',            // Tier-1 Islamic
      'Wio Bank',                      // digital-only
      'HSBC Bank Middle East',         // foreign branch
      'RAKBANK',                       // Tier-2 conventional
      'Sharjah Islamic Bank',          // Tier-2 Islamic-leaning
    ];
    for (const p of probes) expect(names).toContain(p);
  });
});

if (!FIXTURES_BUILT) {
  describe.skip("D-14 generator counterparty-bank breadth (run 'npm run build:fixtures' to enable)", () => {
    it.skip('fixture package not built — run `npm run build:fixtures`', () => {});
  });
} else describe('D-14 generator counterparty-bank breadth — banking personas', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const bankingFixtures = Object.entries(manifest.fixtures).filter(
    ([, fx]) => (fx.domain ?? 'banking') === 'banking',
  );

  function readEnv(rel) {
    return JSON.parse(fs.readFileSync(path.join(PKG_DIR, rel), 'utf8'));
  }

  function ibanPrefixOf(iban) {
    return typeof iban === 'string' && iban.length >= 4 ? iban.slice(0, 4) : null;
  }

  function* counterpartyIbans(fx) {
    for (const id of fx.accountIds ?? []) {
      const ben = readEnv(fx.endpoints[`/accounts/${id}/beneficiaries`]);
      for (const b of ben.Data?.Beneficiary ?? []) {
        for (const ca of b.CreditorAccount ?? []) {
          if (ca.SchemeName === 'IBAN') yield ca.Identification;
        }
      }
      const so = readEnv(fx.endpoints[`/accounts/${id}/standing-orders`]);
      for (const s of so.Data?.StandingOrder ?? []) {
        for (const ca of s.CreditorAccount ?? []) {
          if (ca.SchemeName === 'IBAN') yield ca.Identification;
        }
      }
      const sp = readEnv(fx.endpoints[`/accounts/${id}/scheduled-payments`]);
      for (const p of sp.Data?.ScheduledPayment ?? []) {
        for (const ca of p.CreditorAccount ?? []) {
          if (ca.SchemeName === 'IBAN') yield ca.Identification;
        }
      }
    }
  }

  function personaSegment(personaId) {
    const p = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, 'personas', `${personaId}.json`), 'utf8'),
    );
    return p.segment ?? 'Retail';
  }

  const POOL_BANK_NAMES = new Set(POOL.banks.map((b) => b.name));

  function* beneficiaryBankNames(fx) {
    for (const id of fx.accountIds ?? []) {
      const ben = readEnv(fx.endpoints[`/accounts/${id}/beneficiaries`]);
      for (const b of ben.Data?.Beneficiary ?? []) {
        const name = b.CreditorAgent?.Name;
        if (name) yield name;
      }
    }
  }

  for (const [key, fx] of bankingFixtures) {
    const segment = personaSegment(fx.personaId);
    const minPrefixes = segment === 'Retail' ? 3 : 5;
    it(`${key} (${segment}) — counterparty IBANs span ≥${minPrefixes} distinct UAE banks`, () => {
      const prefixes = new Set();
      for (const iban of counterpartyIbans(fx)) {
        const p = ibanPrefixOf(iban);
        if (p) prefixes.add(p);
      }
      expect(
        prefixes.size,
        `${key} counterparty IBANs cover ${prefixes.size} distinct AE prefixes — expected ≥${minPrefixes}`,
      ).toBeGreaterThanOrEqual(minPrefixes);
    });

    it(`${key} (${segment}) — beneficiary CreditorAgent.Name surfaces real UAE bank names from the pool`, () => {
      const names = [...beneficiaryBankNames(fx)];
      expect(names.length, `${key} has zero beneficiary records with CreditorAgent.Name`).toBeGreaterThan(0);
      for (const n of names) {
        expect(POOL_BANK_NAMES.has(n), `${key} CreditorAgent.Name="${n}" not in counterparty pool`).toBe(true);
      }
      // Multi-bank visibility: distinct bank names across all beneficiaries.
      // SME / Corporate hit 3+, Retail 2+ (low-volume personas have only 3
      // beneficiaries on a single current account, so 2 distinct is the
      // realistic floor).
      const minNames = segment === 'Retail' ? 2 : 3;
      expect(
        new Set(names).size,
        `${key} beneficiaries cover ${new Set(names).size} distinct bank names — expected ≥${minNames}`,
      ).toBeGreaterThanOrEqual(minNames);
    });
  }
});
