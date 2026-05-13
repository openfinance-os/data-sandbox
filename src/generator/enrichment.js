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
 * key against the brand-registry sidecar (R4).
 */
function slugify(name) {
  if (!name) return null;
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Phase R4 — deterministic brand-mark URL for a given slug. Matches
 * the path the brand-registry builder writes the placeholder SVG at,
 * so the enrichment record can resolve directly to a logo without a
 * registry lookup. Same value for the same slug across every persona
 * × LFI × seed combination.
 */
function logoUrlFor(slug) {
  if (!slug) return null;
  return `/fixtures/v1/brands/${slug}.svg`;
}

/**
 * Phase R4 — deterministic FNV-1a hash → HSL → hex. Mirrors the
 * algorithm in tools/build-brand-registry.mjs so the colour an
 * enrichment record carries matches the colour painted on the SVG.
 * Drift between the two would make a TPP rendering "primaryColor on
 * a card next to the SVG" look like a bug.
 */
function brandColorFor(slug) {
  if (!slug) return null;
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = ((h >>> 0) % 360);
  return hslToHex(hue, 55, 45);
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 100 - l) / 10000;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = (l / 100) - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    const x = Math.round(v * 255);
    return x.toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
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
  // Phase R3 — MCC noise. The wire-level `MerchantCategoryCode` may
  // carry a misrouted code (mirroring real card-scheme behaviour).
  // The generator stashes the canonical MCC on `_trueMcc` whenever it
  // flips the wire value; we read the corrected ground-truth from
  // there with a fallback to the wire value (no noise → fallback is
  // already the canonical). Taxonomy lookup uses the corrected value
  // so a misrouted POS at petrol-station never gets categorised as a
  // grocery purchase in the enriched view.
  const rawMcc = tx.MerchantDetails?.MerchantCategoryCode ?? null;
  const correctMcc = tx._trueMcc ?? rawMcc;
  const taxonomy = (correctMcc && MCC_TAXONOMY[correctMcc]) || fallbackForShape(tx);
  // Phase R2 — parent-group ownership graph. The makePosTransaction
  // helper tags every POS / ECommerce tx with `_parentGroup` +
  // `_parentGroupAcronym` (strips on export). We surface those here so
  // the enriched-view consumer can show "Marketmark Hypermarket (FHG)"
  // or run group-level rollups. Null when the merchant has no declared
  // parent or for non-merchant tx shapes (salary, transfers, NSFs).
  const slug = slugify(merchantName);
  return {
    merchant: merchantName,
    mcc: correctMcc,
    category: taxonomy.category,
    subcategory: taxonomy.subcategory,
    logoSlug: slug,
    // Phase R4 — direct logo resolution. Same path the brand-registry
    // builder writes the placeholder SVG at, so a TPP can render the
    // logo straight off the enrichment record without a second fetch.
    logoUrl: logoUrlFor(slug),
    primaryColor: brandColorFor(slug),
    parentGroup: tx._parentGroup ?? null,
    parentGroupAcronym: tx._parentGroupAcronym ?? null,
    // Phase R3 — populated only when the wire-level MCC was misrouted.
    // `mccRaw` is the (wrong) code the bank emitted; `mccMisrouted` is
    // the boolean flag; `mccMisroutingReason` is the per-confusion-
    // entry human reason. A TPP's MCC-correction logic can score
    // against `mccRaw → mcc` as the corrected-vs-raw pair.
    mccRaw: tx._mccMisrouted ? rawMcc : null,
    mccMisrouted: Boolean(tx._mccMisrouted),
    mccMisroutingReason: tx._mccMisroutingReason ?? null,
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
