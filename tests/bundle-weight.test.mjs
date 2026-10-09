// EXP-24 acceptance partial: total page weight <= 250 KB gzipped on a cold
// load of the index page, plus per-page regression budgets for the other
// static entry points. We measure the cold-load asset set the browser
// actually fetches:
//   - the page HTML
//   - every <link rel="stylesheet"> / <link rel="preload" as="fetch"> /
//     <link rel="modulepreload"> in it
//   - every script entry + every JS module statically reachable from any of
//     the above
//
// The set is discovered automatically — adding a new static import anywhere
// in the module graph counts against the budget on the next run, and the
// list cannot drift from what the browser actually loads. Modules that are
// only imported dynamically (persona-builder UI on first dialog open, the
// insurance/ATM generator pipelines behind src/generator/lazy.js) are out of
// scope by design — they don't block first paint.
//
// T-01 fix: link-seeded assets (the modulepreload list) are enqueued for
// traversal unconditionally and deduped via a separate `visited` set. The
// previous traversal skipped any dependency already seeded into `assets` by a
// modulepreload tag, silently under-counting the real graph by ~62 KB gz.
//
// Lighthouse-CI in tests/e2e/lighthouse covers the runtime perf budget
// (Performance >= 90, TTI < 3s) — that needs a headless Chrome, so it lives
// in the e2e workflow rather than this Vitest run.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { repoRoot } from '../tools/load-fixtures.mjs';

// Per-page budgets (KB gzipped). index.html carries the hard EXP-24 budget.
// The other three are regression stops set ~10% above their measured true
// weight at the time the fixed traversal landed (2026-07: connect 83.3,
// integrate 31.4, embed 107.9) so they can't creep further — tightening them
// toward real budgets is planned work (APP_IMPROVEMENT_PLAN.md T-01/C-P6;
// connect shrinks with the C-02 decomposition).
const PAGE_BUDGETS_KB = {
  'src/index.html': 250,
  'src/connect.html': 92,
  'src/integrate.html': 35,
  'src/embed.html': 119,
};

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf).length;
}

// Resolve a `href`/`src` attribute on a page under src/ to a repo-relative
// path. Module/preload paths are written relative to /src/, so they live
// under src/; preload-fetch paths use `../dist/...` for the build artefacts.
function resolveHref(href) {
  if (href.startsWith('../')) return href.slice(3);
  return path.posix.join('src', href);
}

// Static-import scanner. Catches `import ... from 'X'`, `import 'X'`, and
// `export ... from 'X'`. Skips dynamic `import('X')` (those are by definition
// off the cold-load critical path). Returns repo-relative paths.
function staticImportsFromModule(modulePath) {
  const src = fs.readFileSync(path.join(repoRoot, modulePath), 'utf8');
  const moduleDir = path.posix.dirname(modulePath);
  const out = new Set();
  const re = /(?:^|\s)(?:import|export)\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue; // bare specifier (none today, but be safe)
    const resolved = path.posix.normalize(path.posix.join(moduleDir, spec));
    out.add(resolved);
  }
  return [...out];
}

function discoverAssets(pageHtml) {
  const html = fs.readFileSync(path.join(repoRoot, pageHtml), 'utf8');
  const assets = new Set([pageHtml]);
  // Every link-seeded asset AND every script entry goes on the traversal
  // queue — membership in `assets` must never suppress traversal (that was
  // the T-01 under-count). `visited` alone dedupes the walk.
  const queue = [];

  // <link rel="stylesheet">, <link rel="preload">, <link rel="modulepreload">
  // — every href contributes to first-paint network cost. Data URIs are
  // inlined in the HTML weight already, so skip them as separate assets.
  const linkRe = /<link\s+[^>]*?href="([^"]+)"[^>]*>/g;
  let m;
  while ((m = linkRe.exec(html))) {
    if (m[1].startsWith('data:')) continue;
    const rel = resolveHref(m[1]);
    assets.add(rel);
    queue.push(rel);
  }

  // Entry-script discovery — and from there, transitive static imports.
  const scriptRe = /<script\s+[^>]*?src="([^"]+)"[^>]*>/g;
  while ((m = scriptRe.exec(html))) {
    const entry = resolveHref(m[1]);
    assets.add(entry);
    queue.push(entry);
  }

  const visited = new Set();
  while (queue.length > 0) {
    const next = queue.shift();
    if (visited.has(next)) continue;
    visited.add(next);
    if (!next.endsWith('.js') && !next.endsWith('.mjs')) continue;
    for (const dep of staticImportsFromModule(next)) {
      assets.add(dep);
      queue.push(dep);
    }
  }
  return [...assets];
}

describe('bundle-weight budget — EXP-24', () => {
  for (const [page, budgetKb] of Object.entries(PAGE_BUDGETS_KB)) {
    it(`${page} cold-load gzipped weight is under ${budgetKb} KB`, () => {
      const assets = discoverAssets(page);
      const sizes = assets.map((rel) => {
        const abs = path.join(repoRoot, rel);
        const size = gzipSize(abs);
        return { rel, size };
      });
      const total = sizes.reduce((acc, x) => acc + x.size, 0);
      const totalKb = total / 1024;
      if (totalKb >= budgetKb) {
        console.error(`${page} asset breakdown (${assets.length} files, gzipped):`);
        for (const s of sizes.sort((a, b) => b.size - a.size).slice(0, 10)) {
          console.error(`  ${(s.size / 1024).toFixed(1)} KB  ${s.rel}`);
        }
      }
      expect(totalKb).toBeLessThan(budgetKb);
    });
  }

  it('index traversal walks modulepreload-seeded modules (T-01 regression guard)', () => {
    // generator/banking/index.js is both modulepreload-seeded in index.html
    // AND has transitive deps (accounts/transactions/...). If the traversal
    // ever re-grows the "skip already-seeded assets" bug, those deps vanish
    // from the discovered set.
    const assets = new Set(discoverAssets('src/index.html'));
    expect(assets.has('src/generator/banking/index.js')).toBe(true);
    expect(assets.has('src/generator/transactions.js')).toBe(true);
    expect(assets.has('src/generator/multi-lfi.js')).toBe(true);
    // And the lazy split must hold: no insurance/ATM pipeline on the index
    // cold path (C-P1).
    for (const rel of assets) {
      expect(rel, `insurance/atm generator module on the cold path: ${rel}`).not.toMatch(
        /generator\/(insurance|atm)\//,
      );
    }
  });
});
