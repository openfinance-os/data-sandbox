#!/usr/bin/env node
// Stage the built sandbox into _site/ — the directory shape Cloudflare
// Pages / Netlify / GitHub Pages all expect for static deploys. Copies
// src/ + dist/ + writes a top-level redirect into the app entry.
//
// Run after `npm run build:spec` and `node tools/build-data.mjs` so dist/
// already contains SPEC.json + data.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const out = path.join(repoRoot, '_site');

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function cprf(src, dst) {
  fs.cpSync(src, dst, { recursive: true });
}

rmrf(out);
fs.mkdirSync(out, { recursive: true });

cprf(path.join(repoRoot, 'src'), path.join(out, 'src'));
cprf(path.join(repoRoot, 'dist'), path.join(out, 'dist'));

// Top-level redirect into the app entry so the bare URL works.
const indexHtml = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Open Finance Data Sandbox</title>
<meta http-equiv="refresh" content="0; url=src/index.html"/>
<link rel="canonical" href="src/index.html"/>
</head><body><p>Redirecting to <a href="src/index.html">the sandbox</a>…</p></body></html>
`;
fs.writeFileSync(path.join(out, 'index.html'), indexHtml);

// .nojekyll so GitHub Pages skips Jekyll. Harmless on Cloudflare/Netlify.
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// Optional Cloudflare Pages headers — long-cache for hashed assets,
// short-cache for HTML so deploys propagate quickly.
const headers = `/dist/*
  Cache-Control: public, max-age=600, must-revalidate

/src/*.js
  Cache-Control: public, max-age=600, must-revalidate

/src/*.html
  Cache-Control: public, max-age=60, must-revalidate
`;
fs.writeFileSync(path.join(out, '_headers'), headers);

const totalBytes = walkSize(out);
console.log(`staged → ${path.relative(repoRoot, out)} (${(totalBytes / 1024).toFixed(1)} KB)`);

function walkSize(dir) {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) total += walkSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}
