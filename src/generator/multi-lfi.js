// Phase D-lite — surface a persona's multi-LFI footprint inside the primary
// bundle's beneficiary list (D-14, deferred-Phase-D outline).
//
// Full Phase D (separate primary + secondary + tertiary bundle generation
// with cross-bundle deterministic IBAN matching, role-keyed stage layout,
// Service-Worker extension, npm/PyPI package shape, MCP tool surface) is
// intentionally deferred — touching the bundle URL contract risks D-11
// forward-compat. Instead, this module makes the multi-bank reality
// visible WITHIN the existing single-bundle shape by injecting one
// self-at-other-LFI beneficiary per declared non-primary footprint slot.
//
// Each injected beneficiary:
//   - CreditorAccount.Name      = the persona's own signatory name
//                                 (i.e., a transfer to themselves at
//                                 another bank — the realistic shape of
//                                 SME owners who sweep operating →
//                                 savings or operating → digital-
//                                 challenger card)
//   - CreditorAgent.Name        = a deterministic pick from the slot's
//                                 plausible_lfi_candidates (NG5/D-14
//                                 allow-site)
//   - CreditorAgent.Identification = that bank's synthetic BIC
//   - CreditorAccount.Identification = a deterministic synthetic IBAN
//                                 keyed on (persona_id, role, seed) +
//                                 the candidate bank's iban_prefix
//   - Reference                 = "self-to-<role>" so the relationship
//                                 is clear in rendered fixtures
//
// IBAN derivation is pure: same (persona_id, role, seed) → same IBAN
// every build. When a future full-Phase-D slice generates a separate
// secondary bundle, that bundle's account[0].IBAN must match the IBAN
// emitted here — so the cross-bundle reference holds without needing
// any additional plumbing.

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
    // Drop multi_lfi_footprint so cross-LFI self-beneficiary injection
    // doesn't recurse into the role bundle.
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
        { SchemeName: 'IBAN', Identification: iban, Name: identity.fullName },
      ],
    });
  }
  return out;
}
