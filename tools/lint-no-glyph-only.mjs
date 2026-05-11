#!/usr/bin/env node
// EXP-23 (g): no field-card guidance string conveys meaning by glyph alone.
// Scans hand-authored guidance prose under src/, personas/, and the pool dir
// for entries that consist only of a glyph or whose meaning would collapse
// if the leading glyph were stripped.

import fs from 'node:fs';
import path from 'node:path';
import { LintReporter, repoRoot, walk } from './lint-shared.mjs';

// Glyphs we treat as decorative-only (PRD §5.3 examples + a few common kin).
const DECORATIVE_GLYPHS = ['✓', '✗', '⚠', '⚡', '⭐', '★', '✨', '❌', '✅', '⚑'];

const reporter = new LintReporter('lint-no-glyph-only');
const SCAN_DIRS = ['src', 'personas', 'synthetic-identity-pool'];
const FILE_RE = /\.(js|mjs|html|md|yaml|yml)$/;

for (const dir of SCAN_DIRS) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs, FILE_RE)) {
    const rel = path.relative(repoRoot, file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^[\s-]*(?:guidance|real_lfis|note)\s*:\s*['"]?([^'"\n]+)['"]?/i.exec(lines[i]);
      if (!m) continue;
      const value = m[1].trim();
      let stripped = value;
      for (const g of DECORATIVE_GLYPHS) stripped = stripped.split(g).join('');
      if (stripped.replace(/\s+/g, '').length === 0) {
        reporter.add(`glyph-only guidance at ${rel}:${i + 1} - "${value}"`);
      }
    }
  }
}

reporter.finish();
