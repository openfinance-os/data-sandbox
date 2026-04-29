#!/usr/bin/env node
// Mirror the JS fixture package's data tree into the Python package's
// importable data dir. Run after `npm run build:fixtures`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SRC = path.join(repoRoot, 'packages/sandbox-fixtures');
const DST = path.join(repoRoot, 'packages/sandbox-fixtures-py/src/openfinance_os_sandbox_fixtures/data');

if (!fs.existsSync(SRC)) {
  console.error(`source not built: ${SRC}. Run \`npm run build:fixtures\` first.`);
  process.exit(1);
}

if (fs.existsSync(DST)) fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(DST, { recursive: true });

for (const child of ['manifest.json', 'spec.json', 'personas', 'bundles']) {
  const s = path.join(SRC, child);
  const d = path.join(DST, child);
  if (!fs.existsSync(s)) continue;
  fs.cpSync(s, d, { recursive: true });
}

const stat = walkSize(DST);
console.log(`mirrored fixture package into Python data dir → ${path.relative(repoRoot, DST)} (${(stat.bytes / 1024).toFixed(1)} KB across ${stat.files} files)`);

function walkSize(dir) {
  let bytes = 0; let files = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const s = walkSize(p); bytes += s.bytes; files += s.files;
    } else {
      bytes += fs.statSync(p).size; files += 1;
    }
  }
  return { bytes, files };
}
