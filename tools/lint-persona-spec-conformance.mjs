#!/usr/bin/env node
// EXP-01 invariant: persona-manifest enum values that map onto spec fields
// (segment / accounts[].type / accounts[].account_type /
// organisation.signatories[].account_role /
// organisation.signatories[].party_type) MUST be drawn from the pinned
// v2.1-errata1 OpenAPI enum. No hand-authored enum values.
//
// Banking enums loaded from spec/uae-account-information-openapi.yaml:
//   - AEBankDataSharing.AEExternalAccountSubTypeCode
//   - AEBankDataSharing.AEExternalAccountTypeCode
//   - AEPartyIdentityAssurance2.PartyCategory
//   - AEExternalPartyTypeCode
//   - AEExternalAccountRoleCode
//
// Insurance enums loaded from spec/uae-insurance-openapi.yaml:
//   - line discriminator (manifest-level, drives the per-line generator)
//   - motor `policy.type` → AEMotorInsuranceQuoteCoverTypes
//   - emirate (banking + insurance) → AEUaeAddress.UAEEmirate
// then walks /personas/*.yaml and fails the build on any persona enum value
// that isn't a member of the corresponding spec enum.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SPEC_PATH = path.join(repoRoot, 'spec/uae-account-information-openapi.yaml');
const INSURANCE_SPEC_PATH = path.join(repoRoot, 'spec/uae-insurance-openapi.yaml');
const PERSONAS_DIR = path.join(repoRoot, 'personas');
const LFI_ROLES_PATH = path.join(repoRoot, 'spec/lfi-roles.yaml');

const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
const schemas = spec?.components?.schemas ?? {};
const insuranceSpec = yaml.load(fs.readFileSync(INSURANCE_SPEC_PATH, 'utf8'));
const insuranceSchemas = insuranceSpec?.components?.schemas ?? {};

const LFI_ROLES = (() => {
  const doc = yaml.load(fs.readFileSync(LFI_ROLES_PATH, 'utf8'));
  return new Set((doc?.roles ?? []).map((r) => r.id));
})();
const LFI_DEFAULTS = new Set(['Rich', 'Median', 'Sparse']);

function enumOf(name) {
  const s = schemas[name];
  if (!s || !Array.isArray(s.enum)) {
    throw new Error(`spec schema ${name} missing or has no enum (${SPEC_PATH})`);
  }
  return new Set(s.enum);
}

function enumOfInsurance(name) {
  const s = insuranceSchemas[name];
  if (!s || !Array.isArray(s.enum)) {
    throw new Error(`insurance spec schema ${name} missing or has no enum (${INSURANCE_SPEC_PATH})`);
  }
  return new Set(s.enum);
}

function inlineEnumAt(schemaName, propPath) {
  // propPath is a dotted path through `properties`. e.g. "PartyCategory".
  let node = schemas[schemaName];
  if (!node) throw new Error(`spec schema ${schemaName} not found`);
  for (const seg of propPath.split('.')) {
    node = node?.properties?.[seg];
    if (!node) throw new Error(`property ${propPath} not found on ${schemaName}`);
  }
  if (!Array.isArray(node.enum)) {
    throw new Error(`property ${schemaName}.${propPath} has no inline enum`);
  }
  return new Set(node.enum);
}

const ACCOUNT_SUBTYPE = enumOf('AEBankDataSharing.AEExternalAccountSubTypeCode');
const ACCOUNT_TYPE = enumOf('AEBankDataSharing.AEExternalAccountTypeCode');
const PARTY_TYPE = enumOf('AEExternalPartyTypeCode');
const ACCOUNT_ROLE = enumOf('AEExternalAccountRoleCode');
const PARTY_CATEGORY = inlineEnumAt('AEPartyIdentityAssurance2', 'PartyCategory');

// Insurance enums. `line` is a manifest-level discriminator (not a spec
// field) — the value drives which per-line generator runs, and must match
// the in-scope lines in tools/domains.config.mjs.
const INSURANCE_LINE = new Set([
  'motor',
  'home',
  'health',
  'life',
  'travel',
  'renters',
  'employment',
]);
const MOTOR_POLICY_TYPE = enumOfInsurance('AEMotorInsuranceQuoteCoverTypes');
const VALID_DOMAIN = new Set(['banking', 'insurance']);

let violations = 0;

function bad(file, msg) {
  console.error(`lint-persona-spec-conformance: ${path.relative(repoRoot, file)} — ${msg}`);
  violations += 1;
}

function checkEnum(file, fieldLabel, value, allowed) {
  if (value == null) return;
  if (!allowed.has(value)) {
    bad(
      file,
      `${fieldLabel}=${JSON.stringify(value)} is not in v2.1-errata1 spec enum {${[...allowed].join('|')}}`
    );
  }
}

function listManifests() {
  return fs
    .readdirSync(PERSONAS_DIR)
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'))
    .map((f) => path.join(PERSONAS_DIR, f));
}

function resolveDomainsForLint(m) {
  if (Array.isArray(m.domains) && m.domains.length > 0) return m.domains;
  return [m.domain ?? 'banking'];
}

for (const file of listManifests()) {
  const m = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!m) continue;

  // Every persona must declare a recognised domain (or domains[]).
  const personaDomains = resolveDomainsForLint(m);
  for (const d of personaDomains) {
    checkEnum(file, `domains[${d}]`, d, VALID_DOMAIN);
  }
  const isInsurance = personaDomains.includes('insurance');
  const isBanking = personaDomains.includes('banking');

  if (isInsurance) {
    // line is a manifest-level discriminator (defaults to 'motor' for
    // back-compat per personas/_schema.insurance.yaml). Validate when
    // present.
    if (m.line != null) {
      checkEnum(file, 'line', m.line, INSURANCE_LINE);
    }
    // Motor TypeOfPolicy is the only insurance enum that lives directly
    // in the persona manifest (other lines hide their type behind the
    // `line` discriminator). The spec enum is the source of truth.
    const effectiveLine = m.line ?? 'motor';
    if (effectiveLine === 'motor' && m.policy?.type != null) {
      checkEnum(file, 'policy.type', m.policy.type, MOTOR_POLICY_TYPE);
    }
  }

  // Banking-side checks run for any persona that declares the banking
  // domain — single-domain `domain: banking` or multi-domain
  // `domains: [banking, ...]`.
  if (!isBanking) continue;

  // segment ⊆ AccountType ∩ PartyCategory (the spec's two enums are identical
  // here — Retail|SME|Corporate — and the persona's segment drives both).
  if (m.segment != null) {
    checkEnum(file, 'segment', m.segment, ACCOUNT_TYPE);
    checkEnum(file, 'segment', m.segment, PARTY_CATEGORY);
  }

  // Resolve declared slot keys so we can validate accounts[].at_slot
  // against them. Empty set means the persona has no footprint slots,
  // in which case any at_slot value is a violation (orphan tag).
  const declaredSlotKeys = new Set();
  const fpRaw = m?.multi_lfi_footprint;
  if (fpRaw && typeof fpRaw === 'object') {
    if (Array.isArray(fpRaw.slots)) {
      for (const s of fpRaw.slots) {
        if (s?.key) declaredSlotKeys.add(s.key);
      }
    } else {
      for (const k of ['primary', 'secondary', 'tertiary']) {
        if (fpRaw[k] != null) declaredSlotKeys.add(k);
      }
    }
  }

  if (Array.isArray(m.accounts)) {
    let taggedCount = 0;
    for (let i = 0; i < m.accounts.length; i++) {
      const a = m.accounts[i] ?? {};
      checkEnum(file, `accounts[${i}].type`, a.type, ACCOUNT_SUBTYPE);
      checkEnum(file, `accounts[${i}].account_type`, a.account_type, ACCOUNT_TYPE);
      if (a.at_slot != null) {
        taggedCount += 1;
        if (typeof a.at_slot !== 'string') {
          bad(file, `accounts[${i}].at_slot must be a string`);
        } else if (declaredSlotKeys.size === 0) {
          bad(
            file,
            `accounts[${i}].at_slot=${JSON.stringify(a.at_slot)} but persona declares no multi_lfi_footprint slots — drop the tag or add a footprint`,
          );
        } else if (!declaredSlotKeys.has(a.at_slot)) {
          bad(
            file,
            `accounts[${i}].at_slot=${JSON.stringify(a.at_slot)} doesn't match any declared footprint slot key (have: {${[...declaredSlotKeys].join('|')}})`,
          );
        }
      }
    }
    // Enforce all-or-nothing: if any account is tagged, all must be —
    // mixed states silently misroute accounts to the wrong slot.
    if (taggedCount > 0 && taggedCount < m.accounts.length) {
      bad(
        file,
        `accounts mix tagged + untagged at_slot — when using at_slot, every account must carry a tag (have ${taggedCount}/${m.accounts.length} tagged)`,
      );
    }
  }

  const sigs = m?.organisation?.signatories;
  if (Array.isArray(sigs)) {
    for (let i = 0; i < sigs.length; i++) {
      const s = sigs[i] ?? {};
      checkEnum(file, `organisation.signatories[${i}].account_role`, s.account_role, ACCOUNT_ROLE);
      checkEnum(file, `organisation.signatories[${i}].party_type`, s.party_type, PARTY_TYPE);
    }
  }

  // multi_lfi_footprint (D-14 + Phase 2.2): role drawn from
  // spec/lfi-roles.yaml, lfi_default drawn from {Rich,Median,Sparse}.
  // plausible_lfi_candidates is a free string list (named UAE banks
  // allowed per D-14). Accepts two shapes — the legacy
  // {primary, secondary, tertiary} triad and the Phase 2.2 slots[]
  // array — and lints each slot uniformly.
  const footprint = m?.multi_lfi_footprint;
  if (footprint && typeof footprint === 'object') {
    const declaredRoles = new Set();
    const slotEntries = [];
    if (Array.isArray(footprint.slots)) {
      footprint.slots.forEach((v, i) => {
        if (v != null) slotEntries.push({ label: `slots[${i}]`, slot: v });
      });
    } else {
      for (const label of ['primary', 'secondary', 'tertiary']) {
        const v = footprint[label];
        if (v != null) slotEntries.push({ label, slot: v });
      }
    }
    for (const { label, slot: v } of slotEntries) {
      checkEnum(file, `multi_lfi_footprint.${label}.role`, v.role, LFI_ROLES);
      checkEnum(file, `multi_lfi_footprint.${label}.lfi_default`, v.lfi_default, LFI_DEFAULTS);
      if (v.plausible_lfi_candidates != null && !Array.isArray(v.plausible_lfi_candidates)) {
        bad(file, `multi_lfi_footprint.${label}.plausible_lfi_candidates must be an array of strings`);
      }
      if (v.role) declaredRoles.add(v.role);
    }

    // Manifest-level consistency: a declared role must be plausible
    // given the rest of the persona. Catches silent inconsistencies
    // (e.g. a `trade_finance` slot on a persona without FX activity,
    // an `acquiring` slot on a persona with no merchant inflows).
    if (declaredRoles.has('trade_finance')) {
      const hasFx = m.fx_activity === true;
      const hasNonAedAccount = (m.accounts ?? []).some(
        (a) => a.currency && a.currency !== 'AED',
      );
      if (!hasFx && !hasNonAedAccount) {
        bad(
          file,
          'multi_lfi_footprint declares a `trade_finance` role but the persona has neither fx_activity:true nor a non-AED account — the trade-finance slot should be paired with a cross-border/FX footprint',
        );
      }
    }
    if (declaredRoles.has('acquiring')) {
      const hasMerchantInflows = m.cash_flow?.customer_inflows?.counterparty_pool;
      if (!hasMerchantInflows) {
        bad(
          file,
          'multi_lfi_footprint declares an `acquiring` role but the persona has no cash_flow.customer_inflows — acquiring slots only make sense for merchant-side personas with card-receipt / aggregator inflows',
        );
      }
    }
    if (declaredRoles.has('escrow')) {
      // Escrow personas should declare ≥2 accounts so the no-mingling
      // rule is even visible — otherwise the slot is decorative.
      if ((m.accounts ?? []).length < 2) {
        bad(
          file,
          'multi_lfi_footprint declares an `escrow` role but the persona has fewer than 2 accounts — escrow slots imply a structurally separate trust account from the operating account',
        );
      }
    }
  }
}

if (violations > 0) {
  console.error(`lint-persona-spec-conformance: ${violations} violation(s)`);
  process.exit(1);
}
console.log('lint-persona-spec-conformance OK');
