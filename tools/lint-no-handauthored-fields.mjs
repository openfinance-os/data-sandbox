#!/usr/bin/env node
// EXP-01 invariant: no hand-authored field-status tables in the codebase.
// Status badges flow from dist/SPEC.json (parsed from spec/...yaml) only.
//
// Heuristic: scan src/ for object literals that map field names to literal
// "mandatory"/"optional"/"conditional" strings — that's the shape a
// hand-authored status table would take. The OPTIONAL_FIELD_BANDS table in
// src/generator/lfi-profile.js is *populate-rate band*, not status, and is
// allowed by an explicit allowlist; status badges remain spec-driven.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const ALLOWLIST = new Set([
  // status enum constants in spec-helpers are allowed.
  'src/shared/spec-helpers.js',
]);

const STATUS_LITERAL_RE = /['"](mandatory|optional|conditional)['"]/i;

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile() && /\.(mjs|js|html)$/.test(ent.name)) yield full;
  }
}

let bad = 0;
for (const file of walk(path.join(repoRoot, 'src'))) {
  const rel = path.relative(repoRoot, file);
  if (ALLOWLIST.has(rel)) continue;
  const text = fs.readFileSync(file, 'utf8');

  // Look for an object literal whose keys are spec field names and whose
  // values include status-literal strings on adjacent lines. We use a simple
  // pair-finder: at least 3 consecutive lines, each `<FieldName>: 'mandatory'`-
  // shaped, would be a hand-authored table.
  const lines = text.split('\n');
  let consec = 0;
  let firstBadLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const looksLikeStatusEntry =
      /^\s*[A-Z][A-Za-z0-9.]+\s*:\s*['"](mandatory|optional|conditional)['"]/.test(ln) ||
      /^\s*['"][A-Z][A-Za-z0-9.]+['"]\s*:\s*['"](mandatory|optional|conditional)['"]/.test(ln);
    if (looksLikeStatusEntry) {
      if (consec === 0) firstBadLine = i + 1;
      consec += 1;
      if (consec >= 3) {
        console.error(`hand-authored field status table at ${rel}:${firstBadLine} — EXP-01 violation. Status must come from dist/SPEC.json.`);
        bad += 1;
        break;
      }
    } else {
      consec = 0;
      firstBadLine = -1;
    }
  }

  // Catch single occurrences of suspicious patterns where someone writes
  // `someField.status = 'mandatory'` directly.
  for (let i = 0; i < lines.length; i++) {
    if (/\.status\s*=\s*['"](mandatory|optional|conditional)['"]/i.test(lines[i])) {
      console.error(`hand-authored status assignment at ${rel}:${i + 1} — EXP-01 violation.`);
      bad += 1;
    }
  }

  void STATUS_LITERAL_RE; // retained for future widening
}

if (bad > 0) {
  console.error(`lint-no-handauthored-fields: ${bad} violation(s)`);
  process.exit(1);
}
console.log('lint-no-handauthored-fields OK');
