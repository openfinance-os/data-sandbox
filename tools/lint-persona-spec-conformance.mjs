#!/usr/bin/env node
// EXP-01 invariant: persona-manifest enum values that map onto spec fields
// (segment / accounts[].type / accounts[].account_type /
// organisation.signatories[].account_role /
// organisation.signatories[].party_type) MUST be drawn from the pinned
// v2.1-errata1 OpenAPI enum. No hand-authored enum values.
//
// Loads spec/uae-account-information-openapi.yaml, extracts the enums:
//   - AEBankDataSharing.AEExternalAccountSubTypeCode
//   - AEBankDataSharing.AEExternalAccountTypeCode
//   - AEPartyIdentityAssurance2.PartyCategory
//   - AEExternalPartyTypeCode
//   - AEExternalAccountRoleCode
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
const PERSONAS_DIR = path.join(repoRoot, 'personas');
const LFI_ROLES_PATH = path.join(repoRoot, 'spec/lfi-roles.yaml');

const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
const schemas = spec?.components?.schemas ?? {};

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

for (const file of listManifests()) {
  const m = yaml.load(fs.readFileSync(file, 'utf8'));
  if (!m || m.domain !== 'banking') continue;

  // segment ⊆ AccountType ∩ PartyCategory (the spec's two enums are identical
  // here — Retail|SME|Corporate — and the persona's segment drives both).
  if (m.segment != null) {
    checkEnum(file, 'segment', m.segment, ACCOUNT_TYPE);
    checkEnum(file, 'segment', m.segment, PARTY_CATEGORY);
  }

  if (Array.isArray(m.accounts)) {
    for (let i = 0; i < m.accounts.length; i++) {
      const a = m.accounts[i] ?? {};
      checkEnum(file, `accounts[${i}].type`, a.type, ACCOUNT_SUBTYPE);
      checkEnum(file, `accounts[${i}].account_type`, a.account_type, ACCOUNT_TYPE);
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

  // multi_lfi_footprint (D-14): role drawn from spec/lfi-roles.yaml,
  // lfi_default drawn from {Rich,Median,Sparse}. plausible_lfi_candidates
  // is a free string list (named UAE banks allowed per D-14).
  const footprint = m?.multi_lfi_footprint;
  if (footprint && typeof footprint === 'object') {
    for (const slot of ['primary', 'secondary', 'tertiary']) {
      const v = footprint[slot];
      if (v == null) continue;
      checkEnum(file, `multi_lfi_footprint.${slot}.role`, v.role, LFI_ROLES);
      checkEnum(file, `multi_lfi_footprint.${slot}.lfi_default`, v.lfi_default, LFI_DEFAULTS);
      if (v.plausible_lfi_candidates != null && !Array.isArray(v.plausible_lfi_candidates)) {
        bad(file, `multi_lfi_footprint.${slot}.plausible_lfi_candidates must be an array of strings`);
      }
    }
  }
}

if (violations > 0) {
  console.error(`lint-persona-spec-conformance: ${violations} violation(s)`);
  process.exit(1);
}
console.log('lint-persona-spec-conformance OK');
