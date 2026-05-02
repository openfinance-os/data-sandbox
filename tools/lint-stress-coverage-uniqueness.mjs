#!/usr/bin/env node
// EXP-25 strict acceptance: every persona in /personas/ must declare at
// least one stress_coverage term that no other persona covers — globally,
// not order-dependently. The existing tests/persona-manifest.test.mjs check
// is order-dependent (asserts each persona at parse-time introduces ≥1
// novel term), so a persona that lands earlier in the alphabetical order
// can sneak through with terms later personas duplicate.
//
// This lint reads /personas/*.yaml, flips the relation to {term → [persona_ids
// covering it]}, and fails if any persona has zero terms covered exclusively
// by it. A new persona that doesn't add a unique stress contribution fails
// the build, matching PRD §4 EXP-25's acceptance text.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const PERSONAS_DIR = path.join(repoRoot, 'personas');

const files = fs
  .readdirSync(PERSONAS_DIR)
  .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'));

const personas = files.map((f) => ({
  file: f,
  manifest: yaml.load(fs.readFileSync(path.join(PERSONAS_DIR, f), 'utf8')),
}));

// term → Set of persona_ids that cover it
const termCoverage = new Map();
for (const { manifest } of personas) {
  const id = manifest.persona_id;
  for (const term of manifest.stress_coverage ?? []) {
    if (!termCoverage.has(term)) termCoverage.set(term, new Set());
    termCoverage.get(term).add(id);
  }
}

const violations = [];
for (const { file, manifest } of personas) {
  const id = manifest.persona_id;
  const terms = manifest.stress_coverage ?? [];
  if (terms.length === 0) {
    violations.push(`${file}: stress_coverage is empty`);
    continue;
  }
  const uniques = terms.filter((t) => termCoverage.get(t).size === 1);
  if (uniques.length === 0) {
    const overlaps = terms.map((t) => {
      const others = [...termCoverage.get(t)].filter((x) => x !== id).sort();
      return `  - ${t} (also: ${others.join(', ')})`;
    });
    violations.push(
      `${file} (${id}): no globally-unique stress term — every term is covered by at least one other persona:\n${overlaps.join('\n')}`
    );
  }
}

if (violations.length > 0) {
  console.error('lint-stress-coverage-uniqueness FAIL — EXP-25 violation(s):\n');
  for (const v of violations) console.error(v + '\n');
  console.error(`Fix: extend the violating persona's stress_coverage with a term`);
  console.error(`that captures what makes it distinct globally — drawn from PRD`);
  console.error(`§15 Appendix F vocabulary, or proposed as a vocabulary addition.`);
  process.exit(1);
}

console.log(
  `lint-stress-coverage-uniqueness OK — ${personas.length} personas, ${termCoverage.size} distinct stress terms, every persona has ≥1 globally-unique term.`
);
