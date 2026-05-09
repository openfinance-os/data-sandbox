// Synthetic identity drawer — EXP-07.
// All names, IBANs, employer names, and merchant names in generated bundles
// originate here, drawing from /synthetic-identity-pool/. tools/lint-pii-leak.mjs
// asserts that nothing else in the codebase emits identity strings.

import { rngPick, rngInt } from '../prng.js';

/**
 * Fabricate a fictional name from (givenNames, surnames) using rng.
 */
export function drawName(rng, namePool) {
  const given = rngPick(rng, namePool.given_names);
  const surname = rngPick(rng, namePool.surnames);
  return { given, surname, full: `${given} ${surname}` };
}

/**
 * ISO-13616 IBAN check-digit computation. Given a 2-letter country code and
 * the BBAN portion (digits only, NO check digits), returns the 2-digit check
 * string such that the assembled IBAN is mod-97 valid.
 *
 *   IBAN = country(2) + check(2) + bban
 *   To compute check:
 *     1. Append country letters (converted A=10..Z=35) and "00" to the BBAN.
 *     2. The mod-97 of that integer is `r`.
 *     3. The check is `98 - r`, zero-padded to 2 digits.
 *
 * The intermediate value is too big for JS Number, so we compute it as
 * left-to-right modular reduction over the digit string.
 */
export function mod97IbanCheck(country, bban) {
  // Expand letters in BBAN + country to their 2-digit codes (A=10..Z=35),
  // append "00" placeholder for the check, then run a uniform digit-by-
  // digit modular reduction.
  const expand = (s) =>
    s
      .split('')
      .map((c) => {
        if (c >= '0' && c <= '9') return c;
        if (c >= 'A' && c <= 'Z') return String(c.charCodeAt(0) - 'A'.charCodeAt(0) + 10);
        if (c >= 'a' && c <= 'z') return String(c.charCodeAt(0) - 'a'.charCodeAt(0) + 10);
        throw new Error(`mod97IbanCheck: invalid char "${c}"`);
      })
      .join('');
  const concat = expand(bban) + expand(country) + '00';
  let r = 0;
  for (const ch of concat) {
    r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97;
  }
  const check = 98 - r;
  return check.toString().padStart(2, '0');
}

/**
 * Build a deterministic ISO-13616 mod-97-valid synthetic UAE IBAN of length
 * 23 (AE + 2 check + 3 bank code + 16 account). Body digits are deterministic
 * from rng, so the same (persona, seed) always yields the same IBAN.
 *
 * Two call signatures, both supported:
 *   drawIban(rng, ibanPool, bank)   — bank is an object from a counterparty-
 *                                     bank pool with `bank_code` (3 digits).
 *                                     This path produces mod-97-valid IBANs.
 *   drawIban(rng, ibanPool, prefix) — legacy. `prefix` is an 'AE' + 2-digit
 *                                     string. Body is 19 random digits.
 *                                     Produces structurally-shaped IBANs that
 *                                     are NOT guaranteed mod-97 valid (kept
 *                                     for back-compat with code paths that
 *                                     don't have a bank object yet).
 *
 * Counterparty-bank pool entries gained `bank_code` per Slice 3 (D-14
 * follow-up); persona-self IBANs and counterparty IBANs both flow through
 * the mod-97 path. Fallback prefix-options on the IBAN pool stays available
 * for any future bank-less draw.
 */
export function drawIban(rng, ibanPool, bankOrPrefix) {
  if (bankOrPrefix && typeof bankOrPrefix === 'object' && bankOrPrefix.bank_code) {
    // Mod-97 path. 3-digit bank_code + 16-digit account = 19-digit BBAN.
    let account = '';
    for (let i = 0; i < 16; i++) account += rngInt(rng, 0, 10);
    const bban = bankOrPrefix.bank_code + account;
    const check = mod97IbanCheck('AE', bban);
    return `AE${check}${bban}`;
  }
  // Legacy path. `bankOrPrefix` is a 4-char "AE<2 digits>" prefix string.
  const chosenPrefix = bankOrPrefix ?? rngPick(rng, ibanPool.prefix_options);
  let body = '';
  for (let i = 0; i < 19; i++) body += rngInt(rng, 0, 10);
  return `${chosenPrefix}${body}`;
}

/**
 * Boolean validator — returns true iff the given IBAN string passes the
 * mod-97 check. Used by tests to assert spec-grade IBAN structure.
 */
export function isValidMod97Iban(iban) {
  if (typeof iban !== 'string' || iban.length < 5) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let expanded = '';
  for (const ch of moved) {
    if (ch >= '0' && ch <= '9') expanded += ch;
    else if (ch >= 'A' && ch <= 'Z') expanded += String(ch.charCodeAt(0) - 'A'.charCodeAt(0) + 10);
    else if (ch >= 'a' && ch <= 'z') expanded += String(ch.charCodeAt(0) - 'a'.charCodeAt(0) + 10);
    else return false;
  }
  let r = 0;
  for (const ch of expanded) {
    r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97;
  }
  return r === 1;
}

export function drawEmployer(rng, employerPool) {
  return rngPick(rng, employerPool.employers);
}

export function drawMerchant(rng, merchantPool) {
  return rngPick(rng, merchantPool.merchants);
}

export function drawCounterpartyBank(rng, bankPool) {
  return rngPick(rng, bankPool.banks);
}

export function drawOrganisationName(rng, organisationPool) {
  return rngPick(rng, organisationPool.organisations);
}

export function drawCounterparty(rng, counterpartyPool) {
  return rngPick(rng, counterpartyPool.counterparties);
}
