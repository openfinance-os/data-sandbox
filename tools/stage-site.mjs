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

// Stage the worked TPP example so the integration guide's link resolves
// at the deployed origin and a TPP can preview the journey live.
const examplesSrc = path.join(repoRoot, 'examples');
if (fs.existsSync(examplesSrc)) {
  cprf(examplesSrc, path.join(out, 'examples'));
}

// EXP-28 — publish the fixture package as raw HTTPS-fetchable JSON under
// /fixtures/v1/ so TPP integrations not on Node/Python (Swift, Kotlin,
// Postman, Flutter, .NET, plain curl) can consume the same dataset the
// npm/PyPI packages ship. Path slot `/v1/` is the major-version boundary
// (PRD §13 D-11). Within v1, evolution is additive only.
const fixtureSrc = path.join(repoRoot, 'packages/sandbox-fixtures');
if (fs.existsSync(path.join(fixtureSrc, 'manifest.json'))) {
  const fixtureDst = path.join(out, 'fixtures/v1');
  fs.mkdirSync(fixtureDst, { recursive: true });
  cprf(path.join(fixtureSrc, 'bundles'), path.join(fixtureDst, 'bundles'));
  cprf(path.join(fixtureSrc, 'personas'), path.join(fixtureDst, 'personas'));
  fs.copyFileSync(path.join(fixtureSrc, 'manifest.json'), path.join(fixtureDst, 'manifest.json'));
  fs.copyFileSync(path.join(fixtureSrc, 'spec.json'), path.join(fixtureDst, 'spec.json'));

  // Discovery doc — a TPP-friendly summary so consumers don't have to walk
  // the full manifest just to learn the shape (which personas, which LFIs,
  // which endpoints exist). Mirrors what loadJourney() returns.
  const m = JSON.parse(fs.readFileSync(path.join(fixtureDst, 'manifest.json'), 'utf8'));
  const personaIds = Object.keys(m.personas);
  const sampleKey = personaIds.length ? `${personaIds[0]}|median|${m.personas[personaIds[0]].default_seed}` : null;
  const allEndpoints = sampleKey && m.fixtures[sampleKey] ? Object.keys(m.fixtures[sampleKey].endpoints) : [];
  // Show only canonical v2.1 endpoint paths (templated `{AccountId}` and
  // bundle-level paths). Persona-specific resolved paths exist in the
  // manifest for callers that need them, but they're noise in discovery.
  const endpoints = allEndpoints.filter((e) => !/^\/accounts\/[^{][^/]*(\/|$)/.test(e));
  const index = {
    schema: 'openfinance-os/data-sandbox/fixtures/v1',
    version: m.version,
    specVersion: m.specVersion,
    specSha: m.specSha,
    generatedAt: m.generatedAt,
    nowAnchor: m.nowAnchor,
    personas: personaIds.map((id) => ({ id, ...m.personas[id] })),
    lfiProfiles: ['rich', 'median', 'sparse'],
    endpoints,
    pathContract: '/fixtures/v1/bundles/<persona>/<lfi>/seed-<n>/<endpoint>.json',
    pin: 'manifest.json.version',
    pinNote: 'For high-stakes consumption pin via the npm/PyPI package (immutable). Raw URLs are latest-only within the /v1/ major slot.',
  };
  fs.writeFileSync(path.join(fixtureDst, 'index.json'), JSON.stringify(index, null, 2));
} else {
  console.warn('[stage-site] fixtures not built — /fixtures/v1/ will be missing. Run `npm run build:fixtures` first.');
}

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
// short-cache for HTML so deploys propagate quickly. /fixtures/v1/* is
// CORS-permissive (EXP-28) so TPP demos hosted on a different origin can
// fetch them from the browser.
const headers = `/dist/*
  Cache-Control: public, max-age=600, must-revalidate

/src/*.js
  Cache-Control: public, max-age=600, must-revalidate

/src/*.html
  Cache-Control: public, max-age=60, must-revalidate

/fixtures/v1/*
  Cache-Control: public, max-age=600, must-revalidate
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD, OPTIONS
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
