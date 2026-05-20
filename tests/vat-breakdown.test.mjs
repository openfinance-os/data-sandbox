// Slice 10 — UAE VAT-aware transaction breakdowns. For personas with
// `cash_flow.customer_inflows` / `supplier_outflows` declared, the
// generator now emits monthly B2B inflow/outflow transactions with a
// `_vatBreakdown` underscore-prefixed metadata field. Strict v2.1
// consumers ignore it (additionalProperties: false strips it on validate);
// accounting-system integrations consume it for FTA filing.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../tools/load-fixtures.mjs';
import { vatTreatmentForPool, computeVatBreakdown } from '../src/generator/vat.js';

const PKG_DIR = path.join(repoRoot, 'packages/sandbox-fixtures');
const MANIFEST_PATH = path.join(PKG_DIR, 'manifest.json');
const FIXTURES_BUILT = fs.existsSync(MANIFEST_PATH);

describe('Slice 10 — VAT helper purity + correctness', () => {
  it('vatTreatmentForPool returns standard 5% as the default for unknown pools', () => {
    expect(vatTreatmentForPool('does_not_exist')).toEqual({ rate: 0.05, category: 'standard' });
  });
  it('zero-rated pools (b2b_intl, cloud_suppliers) get 0% rate', () => {
    expect(vatTreatmentForPool('b2b_intl').rate).toBe(0);
    expect(vatTreatmentForPool('b2b_intl').category).toBe('zero-rated');
    expect(vatTreatmentForPool('cloud_suppliers').rate).toBe(0);
  });
  it('exempt pool (insurer_payors) gets exempt category', () => {
    expect(vatTreatmentForPool('insurer_payors')).toEqual({ rate: 0, category: 'exempt' });
  });
  it('computeVatBreakdown net + vat_amount = gross at 5%', () => {
    const b = computeVatBreakdown(105, 'AED', { rate: 0.05, category: 'standard' });
    expect(b.net).toBe('100.00');
    expect(b.vat_amount).toBe('5.00');
    expect(b.vat_rate).toBe(0.05);
    expect(b.vat_category).toBe('standard');
    expect(b.currency).toBe('AED');
  });
  it('zero-rated breakdown has vat_amount 0.00 and net = gross', () => {
    const b = computeVatBreakdown(10000, 'USD', { rate: 0, category: 'zero-rated' });
    expect(b.net).toBe('10000.00');
    expect(b.vat_amount).toBe('0.00');
    expect(b.vat_rate).toBe(0);
    expect(b.vat_category).toBe('zero-rated');
  });
});

if (!FIXTURES_BUILT) {
  describe.skip("Slice 10 — built fixture VAT consistency (run 'npm run build:fixtures')", () => {
    it.skip('fixture package not built', () => {});
  });
} else
  describe('Slice 10 — built fixture VAT consistency', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

    // Personas declaring cash_flow → expected to have B2B transactions with VAT.
    const cashFlowPersonas = [];
    for (const id of Object.keys(manifest.personas)) {
      const info = manifest.personas[id];
      if (info.domain !== 'banking') continue;
      const persona = JSON.parse(
        fs.readFileSync(path.join(PKG_DIR, 'personas', `${id}.json`), 'utf8'),
      );
      if (persona.cash_flow) cashFlowPersonas.push({ id, persona });
    }

    it('at least 5 personas declare cash_flow (the SME + Corporate set)', () => {
      expect(cashFlowPersonas.length).toBeGreaterThanOrEqual(5);
    });

    for (const { id, persona } of cashFlowPersonas) {
      // For each of these, fixture key is rich/median/sparse × seed; pick rich
      // for the assertion since VAT metadata is a record-level keep that
      // survives all profiles (the strip whitelist preserves it).
      const fxKey = `${id}|rich|${persona.default_seed}`;
      const fx = manifest.fixtures[fxKey];
      if (!fx) continue;
      const accountId = fx.accountIds[0];
      if (!accountId) continue;
      const txEnv = JSON.parse(
        fs.readFileSync(
          path.join(PKG_DIR, fx.endpoints[`/accounts/${accountId}/transactions`]),
          'utf8',
        ),
      );
      const vatTxs = (txEnv.Data?.Transaction ?? []).filter((t) => t._vatBreakdown);

      it(`${id} — primary CurrentAccount has at least 12 B2B transactions with _vatBreakdown`, () => {
        expect(vatTxs.length).toBeGreaterThanOrEqual(12);
      });

      it(`${id} — every _vatBreakdown's net + vat_amount === gross Amount.Amount`, () => {
        for (const t of vatTxs) {
          const gross = parseFloat(t.Amount.Amount);
          const net = parseFloat(t._vatBreakdown.net);
          const vat = parseFloat(t._vatBreakdown.vat_amount);
          // Allow 0.01 fils precision tolerance.
          expect(Math.abs(net + vat - gross)).toBeLessThan(0.02);
          expect(t._vatBreakdown.currency).toBe(t.Amount.Currency);
        }
      });

      it(`${id} — every _vatBreakdown carries a known vat_category`, () => {
        const known = new Set(['standard', 'zero-rated', 'exempt']);
        for (const t of vatTxs) {
          expect(known.has(t._vatBreakdown.vat_category)).toBe(true);
        }
      });
    }
  });
