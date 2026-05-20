// Insurance domain smoke test (vitest-level). Counterpart to the Playwright
// e2e smoke (`tests/e2e/smoke.spec.mjs`) — runs in `npm run ci` without
// needing a browser, and asserts that buildBundle() succeeds for every
// insurance persona × line × LFI combination, with the minimal shape
// invariants the rest of the pipeline depends on.
//
// EXP-10 spec validation (`tests/spec-validation.insurance.test.mjs`) and
// rendered-fixture validation cover the strict AJV pass; this suite is
// meant to fail fast and loud if the orchestrator itself stops returning
// a coherent bundle for any line.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { loadPersonasByDomain, loadAllPools, personaDomains } from '../tools/load-fixtures.mjs';

const LINES = ['motor', 'home', 'health', 'life', 'travel', 'renters', 'employment'];
const LFIS = ['Rich', 'Median', 'Sparse'];

// Single-line insurance personas only. Multi-domain personas
// (domains:[banking,insurance]) declare `insurance.lines:[]` and are
// exercised by tests/multi-domain-bundle.test.mjs — they would fail
// the line + domain assertions below because buildBundle returns a
// composite bundle, not the single-line shape this suite expects.
const personas = Object.values(loadPersonasByDomain('insurance')).filter(
  (p) => personaDomains(p).length === 1,
);
const pools = loadAllPools();

describe('insurance domain smoke', () => {
  it('every in-scope insurance line has at least one persona', () => {
    const linesWithPersonas = new Set(personas.map((p) => p.line ?? 'motor'));
    for (const line of LINES) {
      expect(linesWithPersonas, `line=${line} has no persona`).toContain(line);
    }
  });

  for (const persona of personas) {
    const line = persona.line ?? 'motor';
    describe(`${persona.persona_id} (line=${line})`, () => {
      for (const lfi of LFIS) {
        it(`buildBundle resolves under lfi=${lfi}`, () => {
          const bundle = buildBundle({
            persona,
            lfi,
            seed: persona.default_seed,
            pools,
          });
          expect(bundle).toBeTruthy();
          expect(bundle.domain).toBe('insurance');
          expect(bundle.line).toBe(line);
          expect(bundle.persona).toBe(persona.persona_id);
          // Every insurance bundle carries exactly one consent record
          // (Insurance Consents is emitted automatically per persona).
          expect(Array.isArray(bundle.consents)).toBe(true);
          expect(bundle.consents.length).toBe(1);
        });
      }

      it('is deterministic across two cold runs (EXP-05)', () => {
        const args = {
          persona,
          lfi: 'Median',
          seed: persona.default_seed,
          pools,
        };
        const a = JSON.stringify(buildBundle(args));
        const b = JSON.stringify(buildBundle(args));
        expect(a).toBe(b);
      });
    });
  }
});
