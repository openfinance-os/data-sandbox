#!/usr/bin/env node
// EXP-01 invariant: no hand-authored field-status tables in the codebase.
// Status badges flow from dist/SPEC.json (parsed from spec/...yaml) only.
//
// Heuristic: scan src/ for object literals that map field names to literal
// "mandatory"/"optional"/"conditional" strings — that's the shape a
// hand-authored status table would take. The OPTIONAL_FIELD_BANDS table in
// src/generator/banking/lfi-profile.js is *populate-rate band*, not status, and is
// allowed by an explicit allowlist; status badges remain spec-driven.

import fs from 'node:fs';
import path from 'node:path';
import { LintReporter, repoRoot, walk } from './lint-shared.mjs';

const ALLOWLIST = new Set([
  // status enum constants in spec-helpers are allowed.
  'src/shared/spec-helpers.js',
]);

const reporter = new LintReporter('lint-no-handauthored-fields');

for (const file of walk(path.join(repoRoot, 'src'), /\.(mjs|js|html)$/)) {
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
        reporter.add(
          `hand-authored field status table at ${rel}:${firstBadLine} — EXP-01 violation. Status must come from dist/SPEC.json.`,
        );
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
      reporter.add(`hand-authored status assignment at ${rel}:${i + 1} — EXP-01 violation.`);
    }
  }
}

reporter.finish();
