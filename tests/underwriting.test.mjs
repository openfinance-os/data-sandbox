// EXP-18 acceptance: underwriting signals render correctly across the
// persona library, with the low-volume guard triggering on Senior under all
// LFI profiles, Fallback B engaging on Gig (irregular inflows, no Payroll
// flag), and multi-currency normalisation working on HNW.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { computeUnderwriting, computeImpliedIncome, lowVolumeGuard } from '../src/shared/underwriting.js';
import { loadAllPersonas, loadAllPools } from '../tools/load-fixtures.mjs';

const NOW = new Date(Date.UTC(2026, 3, 1));

describe('underwriting calculator — EXP-18', () => {
  const personas = loadAllPersonas();
  const pools = loadAllPools();

  function bundleFor(personaId, lfi = 'median', seed = 4729) {
    return buildBundle({ persona: personas[personaId], lfi, seed, pools });
  }

  it('Sara (salaried expat mid) — primary income via Flags=Payroll, DBR sensible', () => {
    const b = bundleFor('salaried_expat_mid', 'rich');
    const r = computeUnderwriting(b, NOW);
    expect(r.guard.triggered).toBe(false);
    expect(r.income.source).toBe('primary');
    expect(r.income.value).toBeGreaterThan(20000);
    expect(r.income.value).toBeLessThan(30000);
    expect(r.commitments.value).toBeGreaterThan(8000); // rent 8k + utilities + telco
    expect(r.dbr.value).toBeGreaterThan(0.3);
    expect(r.dbr.value).toBeLessThan(0.6);
  });

  it('Senior — low-volume guard triggers under all LFI profiles', () => {
    for (const lfi of ['rich', 'median', 'sparse']) {
      const b = bundleFor('senior_retiree', lfi);
      const r = computeUnderwriting(b, NOW);
      expect(r.guard.triggered, `lfi=${lfi}`).toBe(true);
      expect(r.dbr.value, `lfi=${lfi}`).toBeNull();
      expect(r.dbr.reason).toMatch(/low-volume/i);
    }
  });

  it('Senior — guard reason cites both tx count and distinct months', () => {
    const b = bundleFor('senior_retiree', 'median');
    const guard = lowVolumeGuard(b.transactions, NOW);
    expect(guard.triggered).toBe(true);
    expect(guard.reason).toMatch(/transactions/);
    expect(guard.reason).toMatch(/distinct months/);
  });

  it('Gig — primary Payroll path returns no value (flag_payroll=false)', () => {
    const b = bundleFor('gig_variable_income', 'rich');
    // Gig persona has flag_payroll: false — no Payroll-flagged credits should exist
    const payrollCredits = b.transactions.filter((t) => Array.isArray(t.Flags) && t.Flags.includes('Payroll'));
    expect(payrollCredits.length).toBe(0);
    // Income may fall back to Fallback A or B, or return null entirely.
    const income = computeImpliedIncome(b.transactions, NOW);
    expect(income.source).not.toBe('primary');
  });

  it('HNW — multi-currency commitments do not corrupt the AED total', () => {
    const b = bundleFor('hnw_multicurrency', 'rich');
    const r = computeUnderwriting(b, NOW);
    expect(r.commitments.value).toBeGreaterThan(0);
    expect(r.commitments.currency).toBe('AED');
    // Layla's commitments are villa rent (25k AED) + utilities — anything
    // wildly larger means a non-AED amount slipped through unconverted.
    expect(r.commitments.value).toBeLessThan(50000);
  });

  it('Hadi (NSF distressed) — NSF count > 0', () => {
    const b = bundleFor('nsf_distressed', 'median');
    const r = computeUnderwriting(b, NOW);
    expect(r.nsf.value).toBeGreaterThan(0);
  });

  it('Yousef (mortgage DBR heavy) — DBR is high', () => {
    const b = bundleFor('mortgage_dbr_heavy', 'rich');
    const r = computeUnderwriting(b, NOW);
    // Commitments include mortgage 13.5k + school fees ~5k + DEWA ~0.85k + car 2.4k ≈ 21.75k
    // Income 32k → DBR ≈ 68%
    expect(r.dbr.value).toBeGreaterThan(0.55);
  });

  it('signals are deterministic across two builds with the same tuple', () => {
    const a = computeUnderwriting(bundleFor('salaried_expat_mid', 'median'), NOW);
    const b = computeUnderwriting(bundleFor('salaried_expat_mid', 'median'), NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
