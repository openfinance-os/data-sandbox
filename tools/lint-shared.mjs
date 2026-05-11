// Shared scaffold for repo lints under tools/lint-*.mjs.
//
// Each lint walks a tree under /src, /personas, or /synthetic-identity-pool
// looking for a specific invariant violation. The walk shape, the violation
// counter, and the exit-on-failure print are the same across lints; only the
// file filter and the per-line check differ. This module factors out the
// shared bits so individual lints can stay declarative.
//
// Lints with bespoke domain logic (lint-pii-leak runs the generator, and
// lint-persona-spec-conformance reads the parsed spec) keep their own
// orchestration but can still adopt `LintReporter` for consistent output.

import fs from 'node:fs';
import path from 'node:path';

export { repoRoot } from './load-fixtures.mjs';

/**
 * Recursively yield absolute file paths under `dir` whose basename matches
 * the optional regex. Skips dotfiles and node_modules by default.
 *
 * @param {string} dir            Absolute directory to walk.
 * @param {RegExp} [include]      File-extension/basename filter, e.g. /\.(mjs|js)$/.
 * @returns {Generator<string>}
 */
export function* walk(dir, include) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(full, include);
    } else if (ent.isFile() && (!include || include.test(ent.name))) {
      yield full;
    }
  }
}

/**
 * Aggregator for lint violations. One per lint script.
 *
 * Usage:
 *   const r = new LintReporter('lint-no-glyph-only');
 *   r.add(`glyph-only guidance at ${rel}:${i + 1} - "${value}"`);
 *   r.finish('OK — every guidance string survives glyph stripping.');
 *
 * `finish()` exits with code 1 if any violations were added, otherwise
 * prints the success message and returns.
 */
export class LintReporter {
  constructor(name) {
    this.name = name;
    this.count = 0;
  }

  add(message) {
    console.error(message);
    this.count += 1;
  }

  finish(okMessage) {
    if (this.count > 0) {
      console.error(`${this.name}: ${this.count} violation(s)`);
      process.exit(1);
    }
    console.log(`${this.name} OK${okMessage ? ' — ' + okMessage : ''}`);
  }
}
