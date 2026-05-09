// Multi-LFI footprint surfaces (D-14 + Phase D + Slice 7). Three concerns
// share this module because they share the same deterministic IBAN
// derivation and footprint walk:
//
// 1. `buildCrossLfiSelfBeneficiaries` — injects one self-at-other-LFI
//    beneficiary per declared non-primary footprint slot into the primary
//    bundle (the visible "I sweep operating → savings at another bank"
//    shape). Each carries a real-UAE bank Name + synthetic BIC + a
//    deterministic synthetic IBAN keyed on (persona_id, role, bank).
//
// 2. `buildRoleBundle` — full Phase D: generates separate secondary /
//    tertiary bundles staged at `bundles/<persona>/<role>/<lfi>/seed-<n>/`.
//    Projects the persona to a minimal "role persona" with one account at
//    the role's deterministically-picked bank, then runs `buildBundle()`.
//    The projected account's IBAN matches the `self-to-<role>` beneficiary's
//    IBAN byte-exactly, so the cross-bundle reference loop closes.
//
// 3. `computeCrossLfiLedger` + `derivePrimaryAccountIban` — Slice 7 cross-
//    LFI mirror ledger: 12 monthly self-sweep outflows on the primary
//    bundle's transactions, byte-mirrored as inflows in the corresponding
//    role bundle. Ledger is a pure function of (persona, pool, now) — no
//    dependency on the bundle's `seed` — so the same economic event
//    appears identically in two LFI feeds without any out-of-band id.
//
// All IBANs emitted here are mod-97 valid (`mod97IbanCheck`) and the role
// derivation is independent of `seed` so the cross-bundle identity holds
// regardless of which (lfi, seed) tuple is fetched.

import { makePrng, rngInt } from '../prng.js';
import { mod97IbanCheck } from './identity.js';

// Role → short id-suffix code. Kept to 2 chars so the resulting
// BeneficiaryId stays under the v2.1 spec's 40-char maxLength even on
// the longest persona slug ("sme-ecommerce-marketplace-acct-01" = 33
// chars; "-x2" / "-x3" pushes to 36 — comfortable headroom).
const ROLES = [
  { role: 'secondary', code: 'x2' },
  { role: 'tertiary', code: 'x3' },
];

/**
 * Deterministic cross-LFI self-IBAN derivation. Pure function of
 * (personaId, role, seed) + the candidate bank's iban_prefix.
 *
 * The PRNG is seeded WITHOUT the bundle's main `seed` arg only — this
 * means the same persona's "self at secondary" IBAN is byte-identical
 * across two different (lfi, seed) tuples. That's deliberate: the
 * persona's IBAN at their secondary bank is a property of the persona,
 * not of which LFI is emitting the bundle today.
 *
 * Future full Phase D will call this same function from the secondary-
 * bundle account-generator so the cross-bundle reference holds.
 */
export function deriveCrossLfiSelfIban(personaId, role, bank) {
  const rng = makePrng(personaId, 'cross-lfi-self-iban', role);
  // Mod-97 path (Slice 3): bank.bank_code (3 digits) + 16-digit account
  // = 19-digit BBAN; check digits computed via ISO-13616. Falls back to
  // the legacy 4-char prefix + 19-digit body if a bank predates the
  // bank_code rollout (no current pool entries do — fallback is defensive).
  if (bank.bank_code) {
    let account = '';
    for (let i = 0; i < 16; i++) account += rngInt(rng, 0, 10);
    const bban = bank.bank_code + account;
    const check = mod97IbanCheck('AE', bban);
    return `AE${check}${bban}`;
  }
  let body = '';
  for (let i = 0; i < 19; i++) body += rngInt(rng, 0, 10);
  return `${bank.iban_prefix}${body}`;
}

/**
 * Slice 4 — purpose → footprint-role mapping. Standing-order purposes
 * on personas with `multi_lfi_footprint` whose semantics align with a
 * specific role are routed through a candidate bank from that role's
 * slot, so the rendered CreditorAgent reflects the persona's declared
 * banking reality (e.g. a zakat-distribution standing order points at
 * an Islamic bank, not at a random pool draw).
 *
 * Tables are intentionally narrow and keyword-based — adding a new
 * purpose to a role is a single regex tweak. Purposes that don't match
 * any role keep the random-pool draw (preserves byte-identity for
 * existing fixtures except those with footprint-relevant SOs).
 */
const PURPOSE_TO_ROLE_RULES = [
  { pattern: /zakat|sadaqah|islamic|murabaha|mudaraba|sharia/i, role: 'islamic_deposit' },
  { pattern: /lc_payment|trade_finance|fx_settlement|wire_corridor/i, role: 'trade_finance' },
  { pattern: /pos_terminal|aggregator|acquir|merchant_settlement/i, role: 'acquiring' },
  { pattern: /escrow|trust_account|rera_holding|khda_holding/i, role: 'escrow' },
  { pattern: /founder_(secondary_)?(loan|card)|digital_card_repayment|saas_subscriptions/i, role: 'digital_challenger' },
];

/**
 * Given a standing-order / direct-debit purpose string, return the
 * matching footprint role id, or null. Pure function.
 */
export function purposeToRole(purpose) {
  if (!purpose) return null;
  for (const rule of PURPOSE_TO_ROLE_RULES) {
    if (rule.pattern.test(purpose)) return rule.role;
  }
  return null;
}

/**
 * Given a persona, a purpose, and the counterparty-bank pool: if the
 * purpose maps to a role AND the persona declares that role in its
 * footprint AND the role's plausible_lfi_candidates yields at least
 * one bank present in the pool, return that bank. Otherwise return
 * null — caller falls back to random pool draw.
 *
 * Determinism: keyed on (persona_id, purpose) so the same SO on the
 * same persona always picks the same bank, independent of `seed`.
 */
export function pickFootprintBankForPurpose(persona, purpose, counterpartyBanksPool) {
  const role = purposeToRole(purpose);
  if (!role) return null;
  const fp = persona.multi_lfi_footprint;
  if (!fp) return null;
  const slot = ['primary', 'secondary', 'tertiary']
    .map((s) => fp[s])
    .find((v) => v?.role === role);
  if (!slot) return null;
  const candidates = (slot.plausible_lfi_candidates ?? [])
    .map((name) => counterpartyBanksPool.banks.find((b) => b.name === name))
    .filter(Boolean);
  if (candidates.length === 0) return null;
  // Pick the first matching candidate deterministically — keyed on
  // (persona_id, purpose) so the choice is stable across (lfi, seed).
  const rng = makePrng(persona.persona_id, 'footprint-bank-for-purpose', purpose);
  const idx = rngInt(rng, 0, candidates.length);
  return candidates[idx];
}

/**
 * Pick the bank for a given role's self-link deterministically. Draws
 * from the slot's plausible_lfi_candidates and matches against the
 * counterparty-bank pool (so the BIC + iban_prefix are real). If no
 * candidate matches, returns null and the role is silently skipped —
 * a manifest with malformed candidate names won't crash the build.
 */
function pickRoleBank(personaId, role, slot, counterpartyBanksPool) {
  const candidates = slot?.plausible_lfi_candidates ?? [];
  if (candidates.length === 0) return null;
  // Filter to candidates that exist in the counterparty-bank pool.
  // Some role categories list acquirers / PSPs that aren't deposit-
  // taking banks and therefore don't appear in
  // `counterparty_banks_uae_real`. Those candidates are silently
  // dropped — the surviving subset still represents the persona's
  // banking reality.
  const inPool = candidates
    .map((name) => counterpartyBanksPool.banks.find((b) => b.name === name))
    .filter(Boolean);
  if (inPool.length === 0) return null;
  const rng = makePrng(personaId, 'cross-lfi-role-bank', role);
  const idx = rngInt(rng, 0, inPool.length);
  return inPool[idx];
}

/**
 * For a persona with multi_lfi_footprint, return a list of
 * synthetic-self beneficiary records to append to the primary
 * bundle's beneficiary list. Returns [] for personas without the
 * footprint declared.
 *
 * The host account for these beneficiaries is the persona's first
 * CurrentAccount (operating account) — the realistic site for an
 * SME owner's outbound self-transfer.
 */
/**
 * Slice 5 — full Phase D role-bundle generation.
 *
 * For each non-primary footprint slot, project a minimal "role persona"
 * with a single account at the role's deterministically-picked bank,
 * then run the standard buildBundle() pipeline so the result is a
 * spec-validated v2.1 envelope set. The projected persona's account
 * pre-pins the bank + IBAN via accounts.js's _bankOverride / _ibanOverride
 * hooks, so the IBAN BYTE-MATCHES the cross-LFI self-IBAN already
 * surfaced as a `self-to-<role>` beneficiary in the primary bundle —
 * closing the cross-bundle reference loop. A TPP / accounting system
 * fetching both bundles can reconcile them by IBAN identity.
 *
 * Stage layout (D-11 forward-compat): primary stays at the historical
 * `bundles/<persona>/<lfi>/seed-<n>/` URL contract; secondary/tertiary
 * land at the new `bundles/<persona>/<role>/<lfi>/seed-<n>/` slot. No
 * existing fixture URL changes.
 *
 * Account-type heuristic: islamic_deposit + escrow → Savings; everything
 * else → CurrentAccount. The currency follows the primary bundle's
 * default (AED) unless the role implies USD (trade_finance).
 */
export function projectPersonaForRole(persona, slotKey, bank) {
  const ROLE_TO_ACCOUNT_TYPE = {
    operating: 'CurrentAccount',
    trade_finance: 'CurrentAccount',
    acquiring: 'CurrentAccount',
    islamic_deposit: 'Savings',
    escrow: 'CurrentAccount',
    digital_challenger: 'CurrentAccount',
  };
  const slot = persona.multi_lfi_footprint?.[slotKey];
  if (!slot) return null;
  const accountType = ROLE_TO_ACCOUNT_TYPE[slot.role] ?? 'CurrentAccount';
  // Currency: trade_finance slots typically denominate in USD; everything
  // else stays AED.
  const currency = slot.role === 'trade_finance' ? 'USD' : 'AED';
  // The cross-LFI self-IBAN keys on the slot KEY (secondary / tertiary),
  // matching how buildCrossLfiSelfBeneficiaries derives the primary
  // bundle's self-to-<slotKey> beneficiary IBAN — that's how the cross-
  // bundle reference loop closes.
  const iban = deriveCrossLfiSelfIban(persona.persona_id, slotKey, bank);
  return {
    ...persona,
    // The projected persona keeps the same persona_id so PartyId etc.
    // resolve consistently across primary and role bundles. The account
    // index restarts at 1 so the AccountId fits in the 40-char maxLength.
    accounts: [
      {
        type: accountType,
        currency,
        age_months: 36,
        _bankOverride: bank,
        _ibanOverride: iban,
      },
    ],
    // No fixed commitments / cash-flow at the role bundle — the role-LFI
    // sees only its slice of the persona's banking life. The primary
    // bundle remains the source-of-truth for SOs, DDs, full transaction
    // history.
    fixed_commitments: [],
    cash_flow: undefined,
    // Role bundle has no merchant retail spend either — those land at the
    // operating LFI.
    spend_profile: {
      groceries_aed_per_month_band: [0, 0],
      fuel_aed_per_month_band: [0, 0],
      dining_per_month_count_band: [0, 0],
    },
    cash_deposit_activity: false,
    fx_activity: slot.role === 'trade_finance',
    // Tag for downstream code that wants to know this is a role projection.
    _projectedRoleSlot: slotKey,
    _projectedRole: slot.role,
    // Hold a reference back to the source persona so the cross-LFI
    // ledger compute (Slice 7) can read the original footprint without
    // re-injecting cross-LFI self-beneficiaries into the role bundle.
    _sourcePersona: persona,
    // Drop multi_lfi_footprint so cross-LFI self-beneficiary injection
    // (which checks persona.multi_lfi_footprint) doesn't recurse into
    // the role bundle.
    multi_lfi_footprint: null,
  };
}

/**
 * Pure-function wrapper around buildBundle that emits a role-bundle
 * (secondary/tertiary). Returns null if the role isn't declared OR no
 * candidate bank is in the counterparty pool.
 *
 * NOTE: dynamically imports buildBundle to avoid the circular import
 * src/generator/index.js → multi-lfi.js → index.js.
 */
export async function buildRoleBundle({ persona, slot: slotKey, lfi, seed, pools, now }) {
  const slot = persona.multi_lfi_footprint?.[slotKey];
  if (!slot) return null;
  // Resolve the indexed-pools structure to the active counterparty-bank
  // pool. build-fixture-package.mjs passes the full indexedPools object.
  const counterpartyBanksPool =
    pools.counterpartyBanks ??
    pools.counterpartyBanksByCategory?.['counterparty_banks_uae_real'];
  if (!counterpartyBanksPool) return null;
  const bank = pickRoleBank(persona.persona_id, slotKey, slot, counterpartyBanksPool);
  if (!bank) return null;
  const projected = projectPersonaForRole(persona, slotKey, bank);
  if (!projected) return null;
  const { buildBundle } = await import('./index.js');
  return buildBundle({ persona: projected, lfi, seed, pools, now });
}

/**
 * Slice 7 — primary-side anchor IBAN for cross-LFI mirror transactions.
 *
 * For personas with `multi_lfi_footprint`, the primary bundle's first
 * CurrentAccount IBAN is overridden to a deterministic synthetic value
 * keyed on (persona_id, accountIndex). The IBAN uses bank_code "999"
 * (synthetic / anonymous, doesn't bind to any named pool bank — NG5-safe)
 * with mod-97 check digits computed over AE + 999 + 16-digit account.
 *
 * Why deterministic: cross-LFI mirror transactions in role bundles
 * carry DebtorAccount.Identification = primary's IBAN. To make that
 * pointer valid without re-running the primary buildBundle, both
 * sides compute this IBAN from the same persona + index inputs.
 *
 * Anonymity: AE99 + bank_code 999 means the IBAN is visibly a sandbox
 * synthetic — no leak of "primary banks at any specific pool bank."
 * The Servicer field on the primary's account stays at the
 * existing synthetic SYNAEAA BIC.
 */
export function derivePrimaryAccountIban(personaId, accountIndex) {
  const rng = makePrng(personaId, 'primary-account-iban', String(accountIndex));
  let account = '';
  for (let i = 0; i < 16; i++) account += rngInt(rng, 0, 10);
  const bban = '999' + account;
  const check = mod97IbanCheck('AE', bban);
  return `AE${check}${bban}`;
}

/**
 * Slice 7 — cross-LFI mirror ledger.
 *
 * Returns deterministic paired transactions for personas with
 * `multi_lfi_footprint`. For each declared non-primary slot, emits
 * 12 monthly self-sweep events (one per month in the trailing 12-month
 * window). Each event has a primary-side outflow and a role-side
 * inflow with byte-matching:
 *   - Amount.Amount + Amount.Currency
 *   - TransactionDateTime + BookingDateTime + ValueDateTime
 *   - Reference / TransactionInformation
 *   - cross-pointers via CreditorAccount.Identification (on primary)
 *     and DebtorAccount.Identification (on role) — both are mod-97
 *     valid IBANs whose identity proves "same persona, two banks."
 *
 * The TransactionId per side is keyed on slotKey + monthIndex so an
 * accounting integration can match by id alone if it wants, without
 * fuzzy date-window joins.
 *
 * Returns: { primary: [...], secondary: [...], tertiary: [...] }
 *   - primary[i]:   _accountId = persona's first CurrentAccount AccountId,
 *                   CreditDebitIndicator='Debit', shape = outflow.
 *   - secondary[i]: _accountId = role-bundle's account[0] AccountId
 *                   (same slug pattern: <persona-slug>-acct-01),
 *                   CreditDebitIndicator='Credit', shape = inflow.
 *
 * Pure function — no rng dependency on bundle seed; same persona +
 * footprint → byte-identical ledger. EXP-05 across bundles is preserved.
 */
const ROLE_AMOUNT_BANDS_AED = {
  operating: [3000, 8000],          // unused for primary→primary; here for completeness
  islamic_deposit: [4000, 12000],   // monthly term-deposit top-up
  digital_challenger: [800, 3500],  // founder card top-up / sweep
  trade_finance: [15000, 60000],    // FX-corridor working capital sweep
  acquiring: [5000, 18000],         // acquirer-float sweep into operating
  escrow: [10000, 40000],           // escrow funding / release
};

export function computeCrossLfiLedger({ persona, primaryAccountId, primaryIban, counterpartyBanksPool, now }) {
  const out = { primary: [], secondary: [], tertiary: [] };
  if (!persona.multi_lfi_footprint) return out;

  for (const slotKey of ['secondary', 'tertiary']) {
    const slot = persona.multi_lfi_footprint[slotKey];
    if (!slot) continue;
    const slotBank = pickRoleBank(persona.persona_id, slotKey, slot, counterpartyBanksPool);
    if (!slotBank) continue;
    const roleIban = deriveCrossLfiSelfIban(persona.persona_id, slotKey, slotBank);
    const roleAccountId = `${persona.persona_id.replace(/_/g, '-')}-acct-01`;
    const band = ROLE_AMOUNT_BANDS_AED[slot.role] ?? [3000, 9000];
    const ccy = slot.role === 'trade_finance' ? 'USD' : 'AED';

    for (let m = 0; m < 12; m++) {
      // Deterministic per (persona, slot, month). NOT seeded on the
      // bundle's `seed` — the cross-LFI ledger is a property of the
      // persona, not of one (lfi, seed) tuple. EXP-05 holds.
      const rng = makePrng(persona.persona_id, `cross-lfi-ledger-${slotKey}`, String(m));
      const amount = rngInt(rng, band[0], band[1] + 1);
      const monthAnchor = new Date(now.getTime());
      monthAnchor.setUTCDate(1);
      monthAnchor.setUTCMonth(monthAnchor.getUTCMonth() - (11 - m));
      // 28th at 11:00 UTC — mirrors the standing-order convention.
      monthAnchor.setUTCDate(28);
      monthAnchor.setUTCHours(11, 0, 0, 0);
      const isoNoMs = monthAnchor.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const reference = `XLFI-${slotKey.slice(0, 3).toUpperCase()}-${String(m + 1).padStart(2, '0')}`;
      const txIdBase = `${persona.persona_id.replace(/_/g, '-')}-xlfi-${slotKey === 'secondary' ? 's2' : 's3'}-${String(m + 1).padStart(2, '0')}`;

      out.primary.push({
        _accountId: primaryAccountId,
        _crossLfiPairId: `${slotKey}-${m}`,
        TransactionId: `${txIdBase}-out`,
        TransactionReference: reference,
        CreditDebitIndicator: 'Debit',
        Status: 'Booked',
        BookingDateTime: isoNoMs,
        TransactionDateTime: isoNoMs,
        ValueDateTime: isoNoMs,
        TransactionInformation: `XLFI SWEEP TO ${slotKey.toUpperCase()} ${reference}`,
        Amount: { Amount: amount.toFixed(2), Currency: ccy },
        TransactionType: 'LocalBankTransfer',
        SubTransactionType: 'MoneyTransfer',
        CreditorAgent: {
          SchemeName: 'BICFI',
          Identification: slotBank.bic,
          Name: slotBank.name,
        },
        CreditorAccount: [
          { SchemeName: 'IBAN', Identification: roleIban, Name: persona.name },
        ],
      });

      out[slotKey].push({
        _accountId: roleAccountId,
        _crossLfiPairId: `${slotKey}-${m}`,
        TransactionId: `${txIdBase}-in`,
        TransactionReference: reference,
        CreditDebitIndicator: 'Credit',
        Status: 'Booked',
        BookingDateTime: isoNoMs,
        TransactionDateTime: isoNoMs,
        ValueDateTime: isoNoMs,
        TransactionInformation: `XLFI SWEEP FROM PRIMARY ${reference}`,
        Amount: { Amount: amount.toFixed(2), Currency: ccy },
        TransactionType: 'LocalBankTransfer',
        SubTransactionType: 'MoneyTransfer',
        DebtorAgent: {
          SchemeName: 'BICFI',
          Identification: 'SYNAEAA', // anonymous primary servicer
          Name: 'Sandbox Synthetic LFI',
        },
        DebtorAccount: { SchemeName: 'IBAN', Identification: primaryIban, Name: persona.name },
      });
    }
  }
  return out;
}

export function buildCrossLfiSelfBeneficiaries({ persona, accounts, identity, pools }) {
  const footprint = persona.multi_lfi_footprint;
  if (!footprint) return [];
  const operating = accounts.find((a) => a._meta?.kind === 'CurrentAccount');
  if (!operating) return [];

  const out = [];
  for (const { role, code } of ROLES) {
    const slot = footprint[role];
    if (!slot) continue;
    const bank = pickRoleBank(persona.persona_id, role, slot, pools.counterpartyBanks);
    if (!bank) continue;
    const iban = deriveCrossLfiSelfIban(persona.persona_id, role, bank);
    out.push({
      _accountId: operating.AccountId,
      _crossLfiRole: role,                  // stripped before envelope finalisation
      BeneficiaryId: `${operating.AccountId}-${code}`,
      BeneficiaryType: 'Activated',
      AddedViaOF: false,
      Reference: `self-to-${role}`,
      AccountHolderName: identity.fullName,
      CreditorAgent: {
        SchemeName: 'BICFI',
        Identification: bank.bic ?? iban.slice(0, 8),
        Name: bank.name,
        PostalAddress: { AddressLine: ['Synthetic Branch'], Country: 'AE' },
      },
      CreditorAccount: [
        // AECashAccount5_0 (used by AEBeneficiary.CreditorAccount) doesn't
        // permit Name. Beneficiary's account-holder name lives at the
        // AEBeneficiary.AccountHolderName level — set above.
        { SchemeName: 'IBAN', Identification: iban },
      ],
    });
  }
  return out;
}
