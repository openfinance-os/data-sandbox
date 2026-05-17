#!/usr/bin/env node
// Guard against committed build outputs drifting from what the build tools
// emit. Scans tracked files under:
//   - dist/                       (build:spec + build:data + build:avatars)
//   - packages/sandbox-fixtures/  (build:fixtures — only the 5 root files
//                                  index.{mjs,cjs,d.ts}, package.json,
//                                  README.md are tracked; bundles/ +
//                                  personas/ + lib/ trees are gitignored)
//
// Must run *after* the corresponding builds in the ci chain — otherwise the
// check trivially passes against a stale committed state.
import { execFileSync } from 'node:child_process';

const ROOTS = ['dist/', 'packages/sandbox-fixtures/'];

let changed;
try {
  changed = execFileSync('git', ['diff', '--name-only', '--', ...ROOTS], { encoding: 'utf8' }).trim();
} catch (err) {
  console.error('check-dist-clean: failed to invoke git:', err.message);
  process.exit(2);
}

if (!changed) {
  console.log(`check-dist-clean OK — ${ROOTS.join(' + ')} match the committed artifacts.`);
  process.exit(0);
}

console.error('check-dist-clean FAILED — generated outputs are out of sync with sources:');
for (const path of changed.split('\n')) console.error(`  ${path}`);
console.error('');
console.error('Run: npm run build:spec && npm run build:data && npm run build:avatars && npm run build:fixtures');
console.error('then commit the regenerated files.');
process.exit(1);
