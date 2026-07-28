// T-08a — underscore-strip contract (APP_IMPROVEMENT_PLAN.md §3 T-08a).
//
// The generator uses `_`-prefixed keys for internal metadata (`_accountId`,
// `_crossLfiPairId`, `_meta`, `_enrichment`, …). The export layer
// (src/ui/export.js `strip()`) must remove every one of them from rendered
// envelopes EXCEPT a documented allowlist:
//
//   - envelope top level: the EXP-19 watermark family stamped by wrap()/
//     wrapInsurance()/wrapAtm() (`_watermark`, `_persona`, `_lfi`, `_seed`,
//     `_domain`, `_specVersion`, `_specSha`, `_retrievedAt`).
//   - record level: RECORD_LEVEL_METADATA_KEEP (consumer-facing sandbox
//     metadata; currently `_vatBreakdown`), which spec-validation tests
//     pre-strip before AJV so v2.1 `additionalProperties: false` holds.
//
// Any other `_`-key reaching an envelope is a leak of generator internals
// into the wire payload — this suite fails on the first one it finds,
// across a representative persona sample covering all three domains,
// multi-domain merging, N-slot footprints, and refund enrichment.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildBundle } from '../src/generator/index.js';
import { envelopesFromBundle } from '../src/ui/export.js';
import { loadPersona, loadAllPools, repoRoot } from '../tools/load-fixtures.mjs';

// Envelope-level watermark family — stamped by wrap()/wrapInsurance()/
// wrapAtm() in src/ui/export.js (EXP-19 / §6.5).
const ENVELOPE_METADATA_KEYS = new Set([
  '_watermark',
  '_persona',
  '_lfi',
  '_seed',
  '_domain',
  '_specVersion',
  '_specSha',
  '_retrievedAt',
]);

// Read RECORD_LEVEL_METADATA_KEEP straight out of src/ui/export.js so this
// contract can never silently diverge from the implementation's allowlist.
function readRecordLevelKeep() {
  const src = fs.readFileSync(path.join(repoRoot, 'src/ui/export.js'), 'utf8');
  const m = src.match(/RECORD_LEVEL_METADATA_KEEP\s*=\s*new Set\(\[([^\]]*)\]\)/);
  if (!m) throw new Error('RECORD_LEVEL_METADATA_KEEP not found in src/ui/export.js');
  const keys = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
  return new Set(keys);
}
const RECORD_LEVEL_KEEP = readRecordLevelKeep();

// Representative sample: retail banking, SME with legacy-triad footprint,
// Phase 2.2 N-slot multi-domain flagship, a single-line insurance persona,
// a refunds-enabled SME, and the ATM infrastructure persona.
const SAMPLE_PERSONA_IDS = [
  'salaried_expat_mid',
  'sme_rak_trading_emirati',
  'retail_multi_banker',
  'motor_comprehensive_mid',
  'sme_ecommerce_marketplace',
  'atm_directory',
];
const LFI_PROFILES = ['rich', 'median', 'sparse'];

const pools = loadAllPools();

function collectUnderscoreViolations(envelopes) {
  const violations = [];
  for (const [endpoint, env] of Object.entries(envelopes)) {
    // Top level: watermark family only.
    for (const k of Object.keys(env)) {
      if (k.startsWith('_') && !ENVELOPE_METADATA_KEYS.has(k)) {
        violations.push(`${endpoint} → (top-level) ${k}`);
      }
    }
    // Below top level: only the record-level keep set may survive.
    for (const [k, v] of Object.entries(env)) {
      if (k.startsWith('_')) continue; // already checked
      walk(v, `${endpoint} → ${k}`, violations);
    }
  }
  return violations;
}

function walk(node, at, violations) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${at}[${i}]`, violations));
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('_') && !RECORD_LEVEL_KEEP.has(k)) {
      violations.push(`${at}.${k}`);
    }
    walk(v, `${at}.${k}`, violations);
  }
}

describe('T-08a — no generator-internal `_` keys reach rendered envelopes', () => {
  it('sanity — the record-level allowlist read from export.js contains _vatBreakdown', () => {
    expect(RECORD_LEVEL_KEEP.has('_vatBreakdown')).toBe(true);
  });

  for (const pid of SAMPLE_PERSONA_IDS) {
    const persona = loadPersona(pid);
    for (const lfi of LFI_PROFILES) {
      it(`${pid} × ${lfi} × seed-${persona.default_seed}`, () => {
        const seed = persona.default_seed;
        const bundle = buildBundle({ persona, lfi, seed, pools });
        const envelopes = envelopesFromBundle(bundle, {
          personaId: persona.persona_id,
          lfi,
          seed,
          retrievedAt: '2026-04-01T00:00:00Z',
        });
        expect(Object.keys(envelopes).length).toBeGreaterThan(0);
        const violations = collectUnderscoreViolations(envelopes);
        expect(violations, violations.slice(0, 20).join('\n')).toEqual([]);
      });
    }
  }
});
