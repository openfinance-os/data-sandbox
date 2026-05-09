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
