#!/usr/bin/env node
// NG5 / D-14 invariant: real UAE LFI / institution names are restricted to
// the two sites where no operational claim binds to them. Forbidden anywhere
// a populate-rate, product mix, categorisation rule, or other operational
// claim could attach to a name.
//
//   ALLOWED sites (per D-14):
//     - synthetic-identity-pool/counterparty-banks/*.yaml
//         (banks named here are third-party counterparties to the persona's
//          transactions / standing orders / beneficiaries — descriptive of
//          the persona's relationships, not of any LFI's data quality.)
//     - personas/*.yaml under multi_lfi_footprint.{primary,secondary,
//       tertiary}.plausible_lfi_candidates  (legacy D-14 shape)
//     - personas/*.yaml under multi_lfi_footprint.slots[].plausible_lfi_candidates
//       (Phase 2.2+ shape — N-slot array)
//         (a candidate set with no populate-rate binding.)
//
//   FORBIDDEN sites (everything else under personas/, synthetic-identity-pool/,
//                    src/):
//     - persona narratives, accounts blocks, organisation blocks,
//       cash_flow blocks, etc.
//     - lfi_profile field anywhere
//     - any UI label, any source code, any other YAML pool.
//
// The denylist below is the post-2024 set of CBUAE-licensed banks. Add
// to it as the ecosystem evolves. Synthetic substitutes are silently
// allowed everywhere.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { LintReporter, repoRoot, walk } from './lint-shared.mjs';

const DENYLIST = [
  // Tier-1 conventional
  'Emirates NBD', 'ENBD',
  'First Abu Dhabi Bank', 'FAB',
  'Abu Dhabi Commercial Bank', 'ADCB',
  'Mashreq',
  'Commercial Bank of Dubai', 'CBD',
  // Tier-1 Islamic
  'Dubai Islamic Bank', 'DIB',
  'Abu Dhabi Islamic Bank', 'ADIB',
  'Emirates Islamic',
  'Sharjah Islamic Bank', 'SIB',
  // Tier-2 conventional / Islamic
  'National Bank of Fujairah', 'NBF',
  'RAKBANK', 'RAK Bank',
  'United Arab Bank', 'UAB',
  'Bank of Sharjah',
  'Invest Bank',
  'Commercial Bank International', 'CBI',
  'National Bank of Umm Al Quwain', 'NBQ',
  'Al Masraf',
  'Ajman Bank',
  'Al Hilal Bank',
  // Digital-only (separately CBUAE-licensed)
  'Wio Bank', 'Wio',
  'Zand Bank', 'Zand',
  'Al Maryah Community Bank', 'Mbank',
  // Digital sub-brands (channels of parent's licence; still NG5-relevant)
  'Liv', 'Mashreq Neo', 'NEOBiz', 'Hayyak',
  // Foreign branches active in UAE SME / corporate
  'HSBC',
  'Standard Chartered',
  'Citibank',
  'BNP Paribas',
  'Deutsche Bank',
  'Crédit Agricole', 'Credit Agricole',
  'ICBC',
  'Bank of China',
  'MUFG',
  'Mizuho',
  'Habib Bank',
  'Bank of Baroda',
  'Arab Bank',
  'Doha Bank',
  'Banque Misr',
  'SNB Group', 'Samba',
  // Acquiring / payment-rail
  'Network International',
  'Magnati',
  'NEOPay',
  // Historical / merged entities — still flag as leak risk
  'Noor Bank',
];

const SCAN_DIRS = ['personas', 'synthetic-identity-pool', 'src'];
const ALLOWED_EXT = /\.(yaml|yml|json|md|js|mjs|html|css)$/;

// ALLOWED-by-D-14 sites are matched as path prefixes (POSIX form).
const ALLOWED_PATH_PREFIXES = [
  'synthetic-identity-pool/counterparty-banks/',
];

function isAllowedPath(rel) {
  const posix = rel.split(path.sep).join('/');
  return ALLOWED_PATH_PREFIXES.some((p) => posix.startsWith(p));
}

function buildDenyRegex() {
  const escaped = DENYLIST.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Sort longest-first so "Emirates NBD" matches before "ENBD" wouldn't
  // cause overlap problems on shared prefixes.
  escaped.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}
const DENY_RE = buildDenyRegex();

// Scan a persona manifest at its YAML object level, not as raw text.
// Allowed at: multi_lfi_footprint.{primary,secondary,tertiary}.plausible_lfi_candidates[].
// Forbidden anywhere else in the manifest.
function scanPersonaManifest(file, rel) {
  const text = fs.readFileSync(file, 'utf8');
  const doc = yaml.load(text);
  const violations = [];

  function walkNode(node, pathSegs) {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walkNode(v, [...pathSegs, String(i)]));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const next = [...pathSegs, k];
        if (isCandidateArrayPath(next) && Array.isArray(v)) {
          // Allowed site: skip without scanning.
          continue;
        }
        walkNode(v, next);
      }
      return;
    }
    if (typeof node === 'string') {
      const matches = [...node.matchAll(DENY_RE)];
      for (const m of matches) {
        violations.push({ path: pathSegs.join('.'), term: m[0] });
      }
    }
  }

  function isCandidateArrayPath(segs) {
    // Accept two shapes:
    //   Legacy (D-14):
    //     multi_lfi_footprint.{primary|secondary|tertiary}.plausible_lfi_candidates
    //   Phase 2.2+:
    //     multi_lfi_footprint.slots.<idx>.plausible_lfi_candidates
    if (segs.length < 3) return false;
    const last = segs[segs.length - 1];
    if (last !== 'plausible_lfi_candidates') return false;
    // Legacy: ...multi_lfi_footprint.<slot>.plausible_lfi_candidates
    if (segs.length >= 3) {
      const slot = segs[segs.length - 2];
      const head = segs[segs.length - 3];
      if (
        ['primary', 'secondary', 'tertiary'].includes(slot) &&
        head === 'multi_lfi_footprint'
      ) return true;
    }
    // New: ...multi_lfi_footprint.slots.<idx>.plausible_lfi_candidates
    if (segs.length >= 4) {
      const idx = segs[segs.length - 2];
      const slotsKey = segs[segs.length - 3];
      const head = segs[segs.length - 4];
      if (
        /^\d+$/.test(idx) &&
        slotsKey === 'slots' &&
        head === 'multi_lfi_footprint'
      ) return true;
    }
    return false;
  }

  walkNode(doc, []);
  return violations.map((v) => ({ rel, ...v }));
}

const reporter = new LintReporter('lint-no-institution-leak');

function reportTextScan(rel, text) {
  // Reset stateful regex
  DENY_RE.lastIndex = 0;
  const matches = [...text.matchAll(DENY_RE)];
  for (const m of matches) {
    const idx = m.index ?? 0;
    const line = text.slice(0, idx).split('\n').length;
    reporter.add(`institution-leak at ${rel}:${line} — matches "${m[0]}"`);
  }
}

for (const dir of SCAN_DIRS) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs, ALLOWED_EXT)) {
    const rel = path.relative(repoRoot, file);
    if (isAllowedPath(rel)) continue;

    // Persona manifests get a structural scan that excludes the
    // plausible_lfi_candidates allow-site; everything else is a flat
    // text scan.
    const isPersonaManifest =
      rel.startsWith(`personas${path.sep}`) &&
      rel.endsWith('.yaml') &&
      !path.basename(rel).startsWith('_');

    if (isPersonaManifest) {
      const vs = scanPersonaManifest(file, rel);
      for (const v of vs) {
        reporter.add(`institution-leak at ${rel} (${v.path}) — matches "${v.term}"`);
      }
    } else {
      const text = fs.readFileSync(file, 'utf8');
      reportTextScan(rel, text);
    }
  }
}

reporter.finish();
