// EXP-24 acceptance partial: total page weight <= 250 KB gzipped on a cold
// load. We measure the cold-load asset set the browser actually fetches:
//   - src/index.html
//   - every <link rel="stylesheet"> / <link rel="preload" as="fetch"> in it
//   - the entry script + every JS module statically reachable from it
//
// The set is discovered automatically — adding a new static import anywhere
// in the module graph counts against the budget on the next run, and the
// list cannot drift from what the browser actually loads. Modules that are
// only imported dynamically (persona-builder UI on first dialog open) are
// out of scope by design — they don't block first paint.
//
// Lighthouse-CI in tests/e2e/lighthouse covers the runtime perf budget
// (Performance >= 90, TTI < 3s) — that needs a headless Chrome, so it lives
// in the e2e workflow rather than this Vitest run.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { repoRoot } from '../tools/load-fixtures.mjs';

const BUDGET_KB = 250;
const INDEX_HTML = 'src/index.html';

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf).length;
}

// Resolve a `href`/`src` attribute on src/index.html to a repo-relative
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

function discoverAssets() {
  const html = fs.readFileSync(path.join(repoRoot, INDEX_HTML), 'utf8');
  const assets = new Set([INDEX_HTML]);

  // <link rel="stylesheet">, <link rel="preload">, <link rel="modulepreload">
  // — every href contributes to first-paint network cost.
  const linkRe = /<link\s+[^>]*?href="([^"]+)"[^>]*>/g;
  let m;
  while ((m = linkRe.exec(html))) assets.add(resolveHref(m[1]));

  // Entry-script discovery — and from there, transitive static imports.
  const scriptRe = /<script\s+[^>]*?src="([^"]+)"[^>]*>/g;
  const queue = [];
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
      if (!assets.has(dep)) {
        assets.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...assets];
}

describe('bundle-weight budget — EXP-24', () => {
  it(`total gzipped weight is under ${BUDGET_KB} KB`, () => {
    const assets = discoverAssets();
    const sizes = assets.map((rel) => {
      const abs = path.join(repoRoot, rel);
      const size = gzipSize(abs);
      return { rel, size };
    });
    const total = sizes.reduce((acc, x) => acc + x.size, 0);
    const totalKb = total / 1024;
    if (totalKb >= BUDGET_KB) {
      console.error(`asset breakdown (${assets.length} files, gzipped):`);
      for (const s of sizes.sort((a, b) => b.size - a.size).slice(0, 10)) {
        console.error(`  ${(s.size / 1024).toFixed(1)} KB  ${s.rel}`);
      }
    }
    expect(totalKb).toBeLessThan(BUDGET_KB);
  });
});
