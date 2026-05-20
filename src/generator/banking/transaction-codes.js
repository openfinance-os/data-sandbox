// ISO 20022 BankTransactionCode + UAE ProprietaryBankTransactionCode mapping.
//
// The v2.1 banking spec marks BankTransactionCode (Domain/Family/SubFamily)
// and ProprietaryBankTransactionCode as conditional-mandatory: when one is
// absent the other becomes mandatory (spec/uae-account-information-openapi.yaml
// line 2669 and 2900). The sandbox now emits BOTH on every transaction so a
// credit-team consumer can filter the three return shapes (DD Return / Cheque
// Return / Refund / Reversal) unambiguously, and can break statements down
// by ISO 20022 Domain/Family/SubFamily.
//
// Mapping table is keyed on the existing internal (TransactionType,
// SubTransactionType) taxonomy already established by the make* helpers in
// transactions.js + refunds.js. Three private markers refine the dispatch:
//   - tx._isPayroll      salary credits → BTC SALA, ProprietaryCode WPS-CR
//   - tx._isNsfReturn    failed direct debits → BTC DRTR, Proprietary DDA-RTN
//   - tx._isChequeReturn bounced cheques → BTC RCHQ, Proprietary CHQ-RTN
// The markers strip on export per the underscore-prefix convention.

const ISSUER = 'CBUAE';

function btc(Domain, DomainCode, Family, FamilyCode, SubFamily, SubFamilyCode) {
  return { Domain, DomainCode, Family, FamilyCode, SubFamily, SubFamilyCode };
}

function proprietary(Code) {
  return { Code, Issuer: ISSUER };
}

// Domain shorthand (only "Payments" applies to bank-account transactions).
const PMNT = ['Payments', 'PMNT'];

// Lookup helper — returns { bank, proprietary } for the matching combo, or
// the catch-all "OTHR" mapping when nothing else fits. Catch-all is still
// spec-valid (BTC SubFamily="Other Payment" / SubFamilyCode="OTHR").
export function lookupCodes(tx) {
  const tt = tx?.TransactionType;
  const st = tx?.SubTransactionType;
  const isCredit = tx?.CreditDebitIndicator === 'Credit';

  // ── Returns / reversals first — narrower shape, must win over generic ──
  if (tx?._isChequeReturn) {
    return {
      bank: btc(...PMNT, 'Issued Cheques', 'ICHQ', 'Returned Cheque', 'RCHQ'),
      proprietary: proprietary('CHQ-RTN'),
    };
  }
  if (tx?._isNsfReturn) {
    return {
      bank: btc(...PMNT, 'Received Direct Debits', 'RDDT', 'Direct Debit Return', 'DRTR'),
      proprietary: proprietary('DDA-RTN'),
    };
  }

  // ── Salary credits — payroll always-present marker ──
  if (tx?._isPayroll) {
    return {
      bank: btc(...PMNT, 'Received Credit Transfers', 'RCDT', 'Salary Payment', 'SALA'),
      proprietary: proprietary('WPS-CR'),
    };
  }

  // ── Cheque ── (non-return cheque debits — issued cheque presented & paid)
  if (tt === 'Cheque') {
    return {
      bank: btc(...PMNT, 'Issued Cheques', 'ICHQ', 'Customer Cheque', 'CCHQ'),
      proprietary: proprietary('CHQ-PRS'),
    };
  }

  // ── Card-rail purchases (POS, ECommerce) ──
  if (tt === 'POS' || tt === 'ECommerce') {
    return {
      bank: btc(...PMNT, 'Customer Card Transactions', 'CCRD', 'POS (Payment) Debit', 'POSD'),
      proprietary: proprietary(tt === 'ECommerce' ? 'ECM-DR' : 'POS-DR'),
    };
  }

  // ── ATM cash withdrawal ──
  if (tt === 'ATM') {
    return {
      bank: btc(...PMNT, 'Customer Card Transactions', 'CCRD', 'ATM Debit', 'ATMD'),
      proprietary: proprietary('ATM-DR'),
    };
  }

  // ── Refund / reversal (from refunds.js) ──
  if (st === 'Refund') {
    return {
      bank: btc(...PMNT, 'Received Credit Transfers', 'RCDT', 'Returned Credit Transfer', 'RRTN'),
      proprietary: proprietary('REF-PRT'),
    };
  }
  if (st === 'Reversal') {
    // Reversal NOT already routed via _isNsfReturn / _isChequeReturn above
    // is a card-rail authorisation reversal — issued direct.
    return {
      bank: btc(
        ...PMNT,
        'Issued Credit Transfers',
        'ICDT',
        'Reversal Due to Payment Cancellation Request',
        'RPCR',
      ),
      proprietary: proprietary('REV'),
    };
  }

  // ── Bill payments (direct debits + government bill payments) ──
  if (tt === 'BillPayments') {
    if (st === 'Fee') {
      return {
        bank: btc(...PMNT, 'Miscellaneous Credit Operations', 'MCOP', 'Fees', 'FEES'),
        proprietary: proprietary('NSF-FEE'),
      };
    }
    // Repayments — gov bill payment or direct-debit-shaped recurring bill.
    return {
      bank: btc(...PMNT, 'Received Direct Debits', 'RDDT', 'Periodic Direct Debit Payment', 'PMDD'),
      proprietary: proprietary('DDA-DR'),
    };
  }

  // ── Teller (cash deposit at branch) ──
  if (tt === 'Teller') {
    return {
      bank: btc(...PMNT, 'Received Credit Transfers', 'RCDT', 'Cash Deposit', 'CDPT'),
      proprietary: proprietary('CSH-DEP'),
    };
  }

  // ── International transfer ──
  if (tt === 'InternationalTransfer') {
    return {
      bank: btc(...PMNT, 'Issued Credit Transfers', 'ICDT', 'Cross-Border Credit Transfer', 'XBCT'),
      proprietary: proprietary(isCredit ? 'IBT-CR' : 'IBT-DR'),
    };
  }

  // ── Local bank transfer (incl. salary fallback, standing orders, B2B) ──
  if (tt === 'LocalBankTransfer') {
    // Standing-order debit (rent, repeat transfers)
    if (st === 'Repayments') {
      return {
        bank: btc(...PMNT, 'Issued Credit Transfers', 'ICDT', 'Standing Order', 'STDO'),
        proprietary: proprietary('SO-DR'),
      };
    }
    // Outbound transfer
    if (!isCredit) {
      return {
        bank: btc(...PMNT, 'Issued Credit Transfers', 'ICDT', 'Domestic Credit Transfer', 'DMCT'),
        proprietary: proprietary('LBT-DR'),
      };
    }
    // Inbound transfer (non-payroll — payroll branch handled above)
    return {
      bank: btc(...PMNT, 'Received Credit Transfers', 'RCDT', 'Domestic Credit Transfer', 'DMCT'),
      proprietary: proprietary('LBT-CR'),
    };
  }

  // ── SameBankTransfer (intra-bank) ──
  if (tt === 'SameBankTransfer') {
    return {
      bank: btc(
        ...PMNT,
        isCredit ? 'Received Credit Transfers' : 'Issued Credit Transfers',
        isCredit ? 'RCDT' : 'ICDT',
        'Intra-Bank Transfer',
        'INTC',
      ),
      proprietary: proprietary(isCredit ? 'SBT-CR' : 'SBT-DR'),
    };
  }

  // ── Fallback — generic "Other" payment. Still spec-valid (PMNT/MCOP/OTHR)
  return {
    bank: btc(...PMNT, 'Miscellaneous Credit Operations', 'MCOP', 'Other Payment', 'OTHR'),
    proprietary: proprietary('OTHR'),
  };
}

/**
 * Attach BankTransactionCode + ProprietaryBankTransactionCode to a tx in
 * place. Returns the same tx for chaining (the make* helpers in
 * transactions.js / refunds.js wrap their return value with this call).
 */
export function attachBankTransactionCode(tx) {
  if (!tx || typeof tx !== 'object') return tx;
  const codes = lookupCodes(tx);
  tx.BankTransactionCode = codes.bank;
  tx.ProprietaryBankTransactionCode = codes.proprietary;
  return tx;
}
