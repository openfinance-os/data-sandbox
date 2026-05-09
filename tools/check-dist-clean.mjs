#!/usr/bin/env node
import { execSync } from 'node:child_process';

let changed;
try {
  changed = execSync('git diff --name-only -- dist/', { encoding: 'utf8' }).trim();
} catch (err) {
  console.error('check-dist-clean: failed to invoke git:', err.message);
  process.exit(2);
}

if (!changed) {
  console.log('check-dist-clean OK — dist/ matches the committed artifacts.');
  process.exit(0);
}

console.error('check-dist-clean FAILED — dist/ is out of sync with sources:');
for (const path of changed.split('\n')) console.error(`  ${path}`);
console.error('');
console.error('Run: npm run build:spec && npm run build:data');
console.error('then commit the regenerated files under dist/.');
process.exit(1);
