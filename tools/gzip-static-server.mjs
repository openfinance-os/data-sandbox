#!/usr/bin/env node
// Tiny static file server with gzip and cache-control — mimics what the
// OF-OS Commons CDN does in production so Lighthouse-CI runs against
// realistic numbers instead of the python-http.server defaults (no gzip,
// no caching, no http/2 multiplexing).
//
// Usage: node tools/gzip-static-server.mjs [port]   (defaults to 8000)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const port = parseInt(process.argv[2] ?? '8000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
};

const GZIP_TYPES = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.yaml',
]);

function safeJoin(rel) {
  const resolved = path.resolve(repoRoot, '.' + rel);
  if (!resolved.startsWith(repoRoot)) return null;
  return resolved;
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let target = safeJoin(urlPath);
  if (!target) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }
  if (!fs.existsSync(target)) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(target).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const data = fs.readFileSync(target);

  const acceptsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');
  if (acceptsGzip && GZIP_TYPES.has(ext)) {
    const gz = zlib.gzipSync(data);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(gz);
  } else {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`gzip-static-server listening on http://127.0.0.1:${port}/  (root: ${repoRoot})`);
});
