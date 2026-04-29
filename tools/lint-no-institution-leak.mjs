#!/usr/bin/env node
// NG5 invariant: no real UAE LFI / institution names anywhere in personas/,
// synthetic-identity-pool/, or src/. Institution-specific operational detail
// is forbidden — including just the name.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// A best-effort denylist of common UAE LFI brand stems. Case-insensitive,
// word-boundary matched. Add to this list as the ecosystem evolves.
const DENYLIST = [
  'Emirates NBD',
  'ENBD',
  'First Abu Dhabi Bank',
  'FAB',
  'Abu Dhabi Commercial Bank',
  'ADCB',
  'Mashreq',
  'Dubai Islamic Bank',
  'DIB',
  'Abu Dhabi Islamic Bank',
  'ADIB',
  'RAKBANK',
  'RAK Bank',
  'Commercial Bank of Dubai',
  'CBD',
  'HSBC UAE',
  'Standard Chartered UAE',
  'Citibank UAE',
  'Emirates Islamic',
  'Liv',
  'Wio',
  'Mashreq Neo',
  'NBF',
  'National Bank of Fujairah',
  'BoB',
  'Bank of Baroda',
  'Habib Bank',
  'United Arab Bank',
  'UAB',
  'Sharjah Islamic Bank',
  'SIB',
  'Ajman Bank',
  'Al Hilal Bank',
  'Noor Bank',
  // Synthetic substitutes are explicitly safe — only the real names above are denied.
];

const SCAN_DIRS = ['personas', 'synthetic-identity-pool', 'src'];
const ALLOWED_EXT = /\.(yaml|yml|json|md|js|mjs|html|css)$/;

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile() && ALLOWED_EXT.test(ent.name)) yield full;
  }
}

let bad = 0;
for (const dir of SCAN_DIRS) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = path.relative(repoRoot, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const term of DENYLIST) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) {
        const idx = text.search(re);
        const line = text.slice(0, idx).split('\n').length;
        console.error(`institution-leak at ${rel}:${line} — matches "${term}"`);
        bad += 1;
      }
    }
  }
}

if (bad > 0) {
  console.error(`lint-no-institution-leak: ${bad} violation(s)`);
  process.exit(1);
}
console.log('lint-no-institution-leak OK');
