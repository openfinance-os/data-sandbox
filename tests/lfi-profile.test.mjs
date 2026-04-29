// EXP-04 acceptance: same (persona, seed) under Rich/Median/Sparse produces
// three bundles where (a) all mandatory fields have identical values,
// (b) Sparse populates only Universal-band optional fields, (c) Rich populates
// every populate-band field. This Phase 0 test covers the small allowlist of
// optional fields the Phase 0 LFI filter touches; Phase 1 widens it.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { loadPersona, loadAllPools } from '../tools/load-fixtures.mjs';

describe('LFI profile mechanics — EXP-04 / §8.3', () => {
  const persona = loadPersona('salaried_expat_mid');
  const pools = loadAllPools();
  const SEED = 4729;
  const rich = buildBundle({ persona, lfi: 'rich', seed: SEED, pools });
  const median = buildBundle({ persona, lfi: 'median', seed: SEED, pools });
  const sparse = buildBundle({ persona, lfi: 'sparse', seed: SEED, pools });

  it('mandatory account fields are identical across profiles', () => {
    for (let i = 0; i < rich.accounts.length; i++) {
      // Mandatory: AccountId, Status, Currency, AccountType, AccountSubType
      expect(median.accounts[i].AccountId).toBe(rich.accounts[i].AccountId);
      expect(sparse.accounts[i].AccountId).toBe(rich.accounts[i].AccountId);
      expect(median.accounts[i].Status).toBe(rich.accounts[i].Status);
      expect(sparse.accounts[i].Status).toBe(rich.accounts[i].Status);
      expect(median.accounts[i].Currency).toBe(rich.accounts[i].Currency);
      expect(sparse.accounts[i].Currency).toBe(rich.accounts[i].Currency);
      expect(median.accounts[i].AccountType).toBe(rich.accounts[i].AccountType);
      expect(sparse.accounts[i].AccountType).toBe(rich.accounts[i].AccountType);
      expect(median.accounts[i].AccountSubType).toBe(rich.accounts[i].AccountSubType);
      expect(sparse.accounts[i].AccountSubType).toBe(rich.accounts[i].AccountSubType);
    }
  });

  it('mandatory transaction fields are identical across profiles', () => {
    expect(rich.transactions.length).toBe(median.transactions.length);
    expect(rich.transactions.length).toBe(sparse.transactions.length);
    for (let i = 0; i < rich.transactions.length; i++) {
      expect(median.transactions[i].TransactionId).toBe(rich.transactions[i].TransactionId);
      expect(sparse.transactions[i].TransactionId).toBe(rich.transactions[i].TransactionId);
      expect(median.transactions[i].CreditDebitIndicator).toBe(rich.transactions[i].CreditDebitIndicator);
      expect(sparse.transactions[i].CreditDebitIndicator).toBe(rich.transactions[i].CreditDebitIndicator);
      expect(median.transactions[i].Amount.Amount).toBe(rich.transactions[i].Amount.Amount);
      expect(sparse.transactions[i].Amount.Amount).toBe(rich.transactions[i].Amount.Amount);
      expect(median.transactions[i].BookingDateTime).toBe(rich.transactions[i].BookingDateTime);
      expect(sparse.transactions[i].BookingDateTime).toBe(rich.transactions[i].BookingDateTime);
    }
  });

  it('Rich populates more optional fields than Median, which populates more than Sparse', () => {
    const optionalCount = (b) =>
      b.transactions.filter((t) => t.MerchantDetails?.MerchantCategoryCode != null).length;
    expect(optionalCount(rich)).toBeGreaterThanOrEqual(optionalCount(median));
    expect(optionalCount(median)).toBeGreaterThanOrEqual(optionalCount(sparse));
    // Sparse should drop MerchantCategoryCode entirely (it's a Variable-band field).
    expect(optionalCount(sparse)).toBe(0);
  });

  it('Sparse drops the Payroll Flags marker — Flags is Common-band, only Universal is kept under Sparse', () => {
    // This locks the §8.3 contract: Sparse populates only Universal optional fields.
    // Flags is Common, so under Sparse it should be absent.
    const sparsePayroll = sparse.transactions.filter(
      (t) => Array.isArray(t.Flags) && t.Flags.includes('Payroll')
    );
    expect(sparsePayroll.length).toBe(0);
    // Under Rich, every salary should retain its Payroll Flag.
    const richPayroll = rich.transactions.filter(
      (t) => Array.isArray(t.Flags) && t.Flags.includes('Payroll')
    );
    expect(richPayroll.length).toBeGreaterThan(0);
  });

  it('Sparse keeps the CreditLine block only on the credit-card balance — Variable-band is dropped under Sparse', () => {
    const sparseHasCreditLine = sparse.balances.some((b) => Array.isArray(b.CreditLine));
    expect(sparseHasCreditLine).toBe(false);
    const richHasCreditLine = rich.balances.some((b) => Array.isArray(b.CreditLine));
    expect(richHasCreditLine).toBe(true);
  });
});
