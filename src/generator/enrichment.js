// Transaction enrichment — Phase R1.5.
//
// Derives a sidecar enrichment record for every transaction in a bundle.
// The bundle stays as the v2.1 envelope a real UAE core banking system
// would emit (dirty narratives, abbreviated MerchantNames, no logos —
// matches the "raw" view a TPP receives over Open Finance). The
// enrichment sidecar carries what the TPP's enrichment engine would
// produce after cleaning: a normalised merchant name, the v2.1 MCC
// promoted to a friendlier category/subcategory pair, and a logo slug
// (resolved against the brand-registry sidecar in R4 once that lands).
//
// Shipped as a per-(persona, seed) sidecar — NOT per-LFI. The
// enrichment must be computed BEFORE applyLfiProfile() runs, so it
// stays complete even when the Sparse profile redacts MerchantDetails
// out of the wire payload. That's the headline use case: under Sparse
// the TPP recovers the merchant name from the sidecar, not the bank.
//
// Output shape, keyed by TransactionId:
//   {
//     "<TransactionId>": {
//       "merchant": "Marketmark Hypermarket",   // clean / canonical
//       "mcc": "5411",
//       "category": "Food & Drink",
//       "subcategory": "Supermarkets",
//       "logoSlug": "marketmark-hypermarket"    // future R4 join key
//     }
//   }

// Map of MCC → canonical category + subcategory. The MCC is the natural
// pivot — it's the spec-grade field every card scheme already maps. For
// non-MCC-bearing transactions (salary, transfers, NSFs) we fall through
// to a TransactionType + SubTransactionType + Flags rule set below.
const MCC_TAXONOMY = {
  // Banking-product MCC (utility direct-debits)
  '4900': { category: 'Bills', subcategory: 'Utilities' },

  // R1 retail pools
  '5411': { category: 'Food & Drink', subcategory: 'Supermarkets' },
  '5541': { category: 'Transport', subcategory: 'Fuel' },
  '5812': { category: 'Food & Drink', subcategory: 'Restaurants' },
  '5814': { category: 'Food & Drink', subcategory: 'Fast Food' },

  // R1 extended pools
  '4121': { category: 'Transport', subcategory: 'Ride-hailing' },
  '5399': { category: 'Shopping', subcategory: 'Online Marketplace' },
  '5961': { category: 'Shopping', subcategory: 'Online Marketplace' },
  '8011': { category: 'Health', subcategory: 'Clinics & GPs' },
  '5912': { category: 'Health', subcategory: 'Pharmacy' },
  '4111': { category: 'Transport', subcategory: 'Public Transit' },
  '4112': { category: 'Transport', subcategory: 'Public Transit' },
  '9311': { category: 'Government', subcategory: 'Fees & Fines' },
  '9399': { category: 'Government', subcategory: 'Fees & Fines' },
  '7832': { category: 'Entertainment', subcategory: 'Cinema & Events' },
  '7922': { category: 'Entertainment', subcategory: 'Cinema & Events' },
  '5815': { category: 'Subscriptions', subcategory: 'Streaming' },
  '4899': { category: 'Subscriptions', subcategory: 'Streaming' },
  '4511': { category: 'Travel', subcategory: 'Airlines' },
  '7011': { category: 'Travel', subcategory: 'Hotels' },
  '8220': { category: 'Education', subcategory: 'Schools & Tuition' },
  '8299': { category: 'Education', subcategory: 'Schools & Tuition' },
  '4814': { category: 'Bills', subcategory: 'Telco' },
  '6011': { category: 'Cash', subcategory: 'ATM Withdrawal' },
};

// Fallback taxonomy keyed on (TransactionType, SubTransactionType) — covers
// every non-MCC-bearing transaction shape the banking generator emits
// (salary, fixed commitments, B2B, FX, NSF, cross-LFI ledger, cash deposits).
function fallbackForShape(tx) {
  const tt = tx.TransactionType;
  const st = tx.SubTransactionType;
  const flags = Array.isArray(tx.Flags) ? tx.Flags : [];

  if (flags.includes('Payroll')) return { category: 'Income', subcategory: 'Payroll' };
  if (flags.includes('StandingOrder')) {
    // Subcategory hint comes from the narrative (RENT/SCHOOL/MORTGAGE/…).
    return { category: 'Bills', subcategory: standingOrderHint(tx) };
  }
  if (flags.includes('DirectDebit')) {
    return { category: 'Bills', subcategory: directDebitHint(tx) };
  }

  if (tt === 'Teller' && st === 'Deposit') return { category: 'Cash', subcategory: 'Branch Deposit' };
  if (tt === 'InternationalTransfer' && st === 'MoneyTransfer') {
    return { category: 'Transfer', subcategory: 'International' };
  }
  if (tt === 'LocalBankTransfer' && st === 'MoneyTransfer') {
    // Cross-LFI mirror ledger sweeps and B2B inflows both land here. Discriminate
    // via the TransactionId stem (XLFI marker) or TransactionReference (INV*).
    if (typeof tx.TransactionId === 'string' && tx.TransactionId.includes('-xlfi-')) {
      return { category: 'Transfer', subcategory: 'Internal Sweep' };
    }
    if (typeof tx.TransactionReference === 'string' && tx.TransactionReference.includes('INV')) {
      return { category: 'Business Income', subcategory: 'Customer Invoice' };
    }
    return { category: 'Transfer', subcategory: 'Local' };
  }
  if (tt === 'BillPayments' && st === 'Reversal') return { category: 'Bills', subcategory: 'Bounced' };
  if (tt === 'BillPayments' && st === 'Fee') return { category: 'Fees', subcategory: 'NSF Charge' };

  return { category: 'Other', subcategory: 'Uncategorised' };
}

function standingOrderHint(tx) {
  const info = String(tx.TransactionInformation ?? '');
  if (/RENT/.test(info)) return 'Rent';
  if (/MORTGAGE|HOME LOAN/.test(info)) return 'Mortgage';
  if (/SCHOOL/.test(info)) return 'School Fees';
  return 'Recurring';
}

function directDebitHint(tx) {
  const info = String(tx.TransactionInformation ?? '');
  if (/DEWA|UTIL|POWER|WATER/.test(info)) return 'Utilities';
  if (/TELCO|MOBILE|FIBER/.test(info)) return 'Telco';
  if (/INSUR/.test(info)) return 'Insurance';
  if (/LOAN|FINANCE/.test(info)) return 'Loan Repayment';
  return 'Recurring';
}

/**
 * Normalise a merchant name into a stable URL-safe slug. Used as the join
 * key against the future brand-registry sidecar (R4).
 */
function slugify(name) {
  if (!name) return null;
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Build the enrichment record for a single transaction. Returns null if
 * the transaction has no TransactionId (defensive — every spec-valid
 * AETransaction carries one, but guard anyway so a malformed record
 * doesn't poison the sidecar).
 */
function enrichOne(tx) {
  if (!tx || typeof tx.TransactionId !== 'string') return null;
  const merchantName = tx.MerchantDetails?.MerchantName ?? null;
  const mcc = tx.MerchantDetails?.MerchantCategoryCode ?? null;
  const taxonomy = (mcc && MCC_TAXONOMY[mcc]) || fallbackForShape(tx);
  // Phase R2 — parent-group ownership graph. The makePosTransaction
  // helper tags every POS / ECommerce tx with `_parentGroup` +
  // `_parentGroupAcronym` (strips on export). We surface those here so
  // the enriched-view consumer can show "Marketmark Hypermarket (FHG)"
  // or run group-level rollups. Null when the merchant has no declared
  // parent or for non-merchant tx shapes (salary, transfers, NSFs).
  return {
    merchant: merchantName,
    mcc,
    category: taxonomy.category,
    subcategory: taxonomy.subcategory,
    logoSlug: slugify(merchantName),
    parentGroup: tx._parentGroup ?? null,
    parentGroupAcronym: tx._parentGroupAcronym ?? null,
  };
}

/**
 * Walk every transaction in the bundle and return an object keyed by
 * TransactionId. Pure function — same bundle in → same enrichment out
 * (EXP-05 sidecar determinism). The caller (generator/index.js) wires
 * this BEFORE applyLfiProfile() so the enrichment is complete regardless
 * of how aggressive the active LFI profile is.
 */
export function buildEnrichment(transactions) {
  const out = {};
  if (!Array.isArray(transactions)) return out;
  for (const tx of transactions) {
    const rec = enrichOne(tx);
    if (rec) out[tx.TransactionId] = rec;
  }
  return out;
}

/**
 * Build the enrichment record for a single transaction (exported for the
 * UI render-time join — given a raw tx, return the enrichment overlay).
 * Returns null when the tx has no resolvable taxonomy. Internal callers
 * should prefer buildEnrichment() — this single-shot variant exists so
 * the UI can fall back to live derivation when the sidecar fetch fails.
 */
export function enrichTransaction(tx) {
  return enrichOne(tx);
}
