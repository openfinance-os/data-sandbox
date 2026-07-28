// Streamable-HTTP transport — what the Claude marketplace listing connects to.
//
// Anonymous (D-13): no auth, no API key, no OAuth. The data is fully synthetic
// so there is nothing to protect, and that matches PRD §6.4 ("the sandbox runs
// anonymously").
//
// Production hardening:
//   • Session TTL — idle sessions are evicted after MCP_SESSION_IDLE_TTL_MS
//     (default 30 min). Caps memory growth on a public anonymous endpoint.
//   • Session cap — at most MCP_MAX_SESSIONS concurrent sessions (default
//     1024). When full, the oldest-by-last-activity is evicted (LRU).
//   • DNS rebinding protection — Host header is validated against
//     allowedHosts. The browser-localhost-with-malicious-DNS attack vector
//     is the main reason; defence-in-depth for hosted instances too.
//   • Structured request logging — `[ts] METHOD /path status duration session`
//     to stderr (stdio mode uses stdout; mustn't collide).
//   • Graceful close — stops the listener, closes every active session
//     transport + server, clears the sweep timer.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { manifest } from '@openfinance-os/sandbox-fixtures';
import { createServer } from '../server.mjs';
import { createOAuthSimulation } from './oauth-simulation.mjs';

const MCP_PATH = '/mcp';
const HEALTH_PATH = '/health';
const SESSION_HEADER = 'mcp-session-id';

const MAX_BODY_BYTES = 1_000_000; // 1 MB — JSON-RPC messages are tiny
const DEFAULT_IDLE_TTL_MS = Number(process.env.MCP_SESSION_IDLE_TTL_MS) || 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = Number(process.env.MCP_MAX_SESSIONS) || 1024;
const SWEEP_INTERVAL_MS = 60 * 1000;

// Per-IP token bucket on POST /mcp (public-endpoint hardening). Generous
// defaults — an interactive MCP session issues a handful of tool calls per
// user turn; only scripted hammering trips this. Tunable via env for the
// Fly deploy, and via createHttpHandler options for tests.
const DEFAULT_RATE_BURST = Number(process.env.MCP_RATE_LIMIT_BURST) || 60;
const DEFAULT_RATE_RPS = Number(process.env.MCP_RATE_LIMIT_RPS) || 10;

const _here = path.dirname(fileURLToPath(import.meta.url));
const _pkg = JSON.parse(readFileSync(path.join(_here, '..', '..', 'package.json'), 'utf8'));
const STARTED_AT = Date.now();

// Tool count for /health — counted once from a throwaway (never-connected)
// server instance so the reported number can't drift from the registry.
let _toolCount = null;
function getToolCount() {
  if (_toolCount == null) {
    try {
      const s = createServer();
      _toolCount = Object.keys(s._registeredTools ?? {}).length || null;
    } catch {
      _toolCount = null;
    }
  }
  return _toolCount;
}

// CORS `*` is correct for the anonymous /mcp endpoint (browser-side MCP
// clients) and harmless on /health — but it must NOT blanket the OAuth
// simulation endpoints: wildcarting an authorization server's /authorize,
// /token, and /register invites cross-origin token harvesting patterns.
// Scope it to /mcp + /health only.
function corsEligible(pathname) {
  return pathname === MCP_PATH || pathname === HEALTH_PATH;
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Mcp-Session-Id, Last-Event-ID, Authorization',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (total === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function shortId(id) {
  if (!id) return '-';
  return id.slice(0, 8);
}

function defaultLogger(line) {
  process.stderr.write(`${line}\n`);
}

function buildAllowedHosts({ host, port, extraAllowedHosts }) {
  const set = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (host && host !== '0.0.0.0' && host !== '::') {
    set.add(`${host}:${port}`);
  }
  for (const h of extraAllowedHosts ?? []) {
    set.add(h);
    // Allow either bare hostname or host:port; be lenient.
  }
  return [...set];
}

export function createHttpHandler({
  idleTtlMs = DEFAULT_IDLE_TTL_MS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  sweepIntervalMs = SWEEP_INTERVAL_MS,
  allowedHosts,
  allowedOrigins,
  enableDnsRebindingProtection = true,
  oauthSimulation = null,
  rateLimitBurst = DEFAULT_RATE_BURST,
  rateLimitRps = DEFAULT_RATE_RPS,
  log = defaultLogger,
} = {}) {
  // sessionId → { transport, server, lastActivity }
  const sessions = new Map();

  // ip → { tokens, last } token buckets for POST /mcp. Refill is continuous
  // (rateLimitRps tokens/second up to rateLimitBurst). rateLimitBurst <= 0
  // disables rate limiting entirely.
  const rateBuckets = new Map();

  function clientIp(req) {
    // On Fly the edge proxy terminates TLS; the client address arrives in
    // Fly-Client-IP / X-Forwarded-For. Spoofing XFF only lets an attacker
    // spread their own load across buckets — acceptable for a limiter.
    const fly = req.headers['fly-client-ip'];
    if (fly) return String(fly);
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return req.socket?.remoteAddress ?? 'unknown';
  }

  function rateLimitAllows(req) {
    if (!(rateLimitBurst > 0)) return true;
    const ip = clientIp(req);
    const now = Date.now();
    let bucket = rateBuckets.get(ip);
    if (!bucket) {
      bucket = { tokens: rateLimitBurst, last: now };
      rateBuckets.set(ip, bucket);
    }
    bucket.tokens = Math.min(
      rateLimitBurst,
      bucket.tokens + ((now - bucket.last) / 1000) * rateLimitRps,
    );
    bucket.last = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  function touch(sessionId) {
    const entry = sessions.get(sessionId);
    if (entry) entry.lastActivity = Date.now();
  }

  function evictOldestIfFull() {
    if (sessions.size < maxSessions) return;
    let oldestId = null;
    let oldestTs = Infinity;
    for (const [id, entry] of sessions) {
      if (entry.lastActivity < oldestTs) {
        oldestTs = entry.lastActivity;
        oldestId = id;
      }
    }
    if (oldestId) {
      log(`session-evict ${shortId(oldestId)} reason=cap`);
      // Fire-and-forget teardown; never let a close() rejection surface as
      // an unhandled rejection on the eviction path.
      destroySession(oldestId).catch((err) => {
        log(`session-evict ${shortId(oldestId)} destroy-error: ${err?.message ?? err}`);
      });
    }
  }

  async function destroySession(sessionId) {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    sessions.delete(sessionId);
    try {
      await entry.transport.close();
    } catch {}
    try {
      await entry.server.close();
    } catch {}
  }

  function sweep() {
    const cutoff = Date.now() - idleTtlMs;
    for (const [id, entry] of sessions) {
      if (entry.lastActivity < cutoff) {
        log(`session-evict ${shortId(id)} reason=idle`);
        destroySession(id).catch((err) => {
          log(`session-evict ${shortId(id)} destroy-error: ${err?.message ?? err}`);
        });
      }
    }
    // Cull idle rate-limit buckets too — a full bucket carries no state worth
    // keeping, and per-IP entries must not grow unboundedly.
    const bucketCutoff = Date.now() - idleTtlMs;
    for (const [ip, bucket] of rateBuckets) {
      if (bucket.last < bucketCutoff) rateBuckets.delete(ip);
    }
  }
  const sweepTimer = setInterval(sweep, sweepIntervalMs);
  sweepTimer.unref();

  async function handle(req, res) {
    const url = new URL(req.url, 'http://placeholder');
    const path = url.pathname;

    // CORS wildcard only on /mcp + /health — never on the OAuth endpoints
    // (see corsEligible).
    if (corsEligible(path)) applyCors(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (path === HEALTH_PATH && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version: _pkg.version,
        specVersion: manifest.specVersion ?? null,
        specSha: manifest.specSha ?? null,
        personaCount: Object.keys(manifest.personas ?? {}).length,
        toolCount: getToolCount(),
        uptimeMs: Date.now() - STARTED_AT,
        sessions: sessions.size,
      });
      return;
    }

    // OAuth simulation endpoints (opt-in; off by default per PRD D-13).
    // The simulation owns /.well-known/oauth-protected-resource,
    // /.well-known/oauth-authorization-server, /authorize, and /token. It
    // returns true if it handled the request.
    if (oauthSimulation) {
      const handled = await oauthSimulation.handle(req, res, url);
      if (handled) return;
    }

    if (path !== MCP_PATH) {
      sendJson(res, 404, { error: 'not found', tryEndpoint: MCP_PATH });
      return;
    }

    // Bearer gate — synthetic data is anonymous-by-default; the gate is
    // only present when oauthSimulation is configured.
    if (oauthSimulation && req.method !== 'OPTIONS') {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const verified = oauthSimulation.verifyBearer(token);
      if (!verified) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', oauthSimulation.challengeHeader(req));
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'unauthorized',
            error_description: 'bearer token required — start the OAuth flow at /authorize',
          }),
        );
        return;
      }
    }

    const sessionId = req.headers[SESSION_HEADER];

    if (req.method === 'POST') {
      // Per-IP token bucket — public-endpoint abuse guard (custom-persona
      // generation is the most expensive call behind this path).
      if (!rateLimitAllows(req)) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', '1');
        res.end(
          JSON.stringify(
            jsonRpcError(null, -32000, 'rate limit exceeded — slow down and retry shortly'),
          ),
        );
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, jsonRpcError(null, -32700, `parse error: ${err.message}`));
        return;
      }

      let entry = sessionId ? sessions.get(sessionId) : null;

      if (!entry && isInitializeRequest(body)) {
        evictOldestIfFull();
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableDnsRebindingProtection,
          allowedHosts,
          allowedOrigins,
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server, lastActivity: Date.now() });
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
          },
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (!entry) {
        sendJson(
          res,
          400,
          jsonRpcError(
            body?.id,
            -32000,
            'no active session — initialize first or supply a known Mcp-Session-Id header',
          ),
        );
        return;
      }

      touch(sessionId);
      await entry.transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const entry = sessionId ? sessions.get(sessionId) : null;
      if (!entry) {
        sendJson(res, 400, { error: 'no active session for that Mcp-Session-Id' });
        return;
      }
      touch(sessionId);
      await entry.transport.handleRequest(req, res);
      return;
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    res.end();
  }

  async function dispatch(req, res) {
    const start = Date.now();
    const sessionId = req.headers[SESSION_HEADER];
    try {
      await handle(req, res);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal error', message: err?.message ?? String(err) });
      } else {
        res.end();
      }
    } finally {
      const duration = Date.now() - start;
      const path = (req.url || '').split('?')[0];
      log(
        `${new Date().toISOString()} ${req.method} ${path} ${res.statusCode} ${duration}ms session=${shortId(sessionId)}`,
      );
    }
  }

  async function closeAll() {
    clearInterval(sweepTimer);
    const ids = [...sessions.keys()];
    await Promise.all(ids.map((id) => destroySession(id)));
  }

  return { dispatch, sessions, closeAll, sweep };
}

// Validate --public-url / MCP_PUBLIC_URL. Must be an https:// origin (the
// hosted OAuth issuer must never be advertised over plaintext). Returns the
// normalised origin (no trailing slash, no path) or throws.
export function normalizePublicUrl(publicUrl) {
  if (!publicUrl) return null;
  let parsed;
  try {
    parsed = new URL(publicUrl);
  } catch {
    throw new Error(`invalid --public-url / MCP_PUBLIC_URL: ${publicUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `--public-url / MCP_PUBLIC_URL must be https:// (got ${parsed.protocol}//) — the OAuth issuer for a public deployment must not be plaintext`,
    );
  }
  return parsed.origin;
}

export async function startHttp({
  port = 8787,
  host = '127.0.0.1',
  idleTtlMs,
  maxSessions,
  sweepIntervalMs,
  allowedHosts: extraAllowedHosts,
  allowedOrigins,
  enableDnsRebindingProtection = true,
  simulateOauth = false,
  publicUrl,
  rateLimitBurst,
  rateLimitRps,
  log,
} = {}) {
  // Validate before binding the port so a bad config fails fast.
  const publicOrigin = normalizePublicUrl(publicUrl);

  const earlyServer = http.createServer();
  await new Promise((resolve, reject) => {
    earlyServer.once('error', reject);
    earlyServer.listen(port, host, () => {
      earlyServer.removeListener('error', reject);
      resolve();
    });
  });

  const addr = earlyServer.address();
  const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;
  const resolvedHost = typeof addr === 'object' && addr ? addr.address : host;

  // Build the Host allowlist with the *resolved* port so port:0 works in tests.
  // When a public URL is configured, its host is allowed too — the edge proxy
  // forwards requests with that Host header.
  const publicHosts = [];
  if (publicOrigin) {
    const u = new URL(publicOrigin);
    publicHosts.push(u.host);
    if (!u.port) publicHosts.push(`${u.hostname}:443`);
  }
  const allowedHosts = buildAllowedHosts({
    host: resolvedHost,
    port: resolvedPort,
    extraAllowedHosts: [...(extraAllowedHosts ?? []), ...publicHosts],
  });
  const oauthSimulation = simulateOauth
    ? createOAuthSimulation({
        // Static issuer so discovery documents can never be poisoned by a
        // forged Host header (PR-52 Greptile P1). When --public-url /
        // MCP_PUBLIC_URL is set (hosted deploys behind a TLS-terminating
        // proxy, e.g. Fly), the validated https:// origin is the issuer;
        // otherwise the resolved listen address. Defence-in-depth: the
        // simulation also validates Host against `allowedHosts`
        // independently of the /mcp guard.
        issuer: publicOrigin ?? `http://${resolvedHost}:${resolvedPort}`,
        allowedHosts,
      })
    : null;
  const handler = createHttpHandler({
    idleTtlMs,
    maxSessions,
    sweepIntervalMs,
    allowedHosts,
    allowedOrigins,
    enableDnsRebindingProtection,
    oauthSimulation,
    rateLimitBurst,
    rateLimitRps,
    log,
  });
  const server = earlyServer;
  server.on('request', (req, res) => handler.dispatch(req, res));

  return {
    server,
    sessions: handler.sessions,
    sweep: handler.sweep,
    port: resolvedPort,
    host: resolvedHost,
    url: `http://${resolvedHost}:${resolvedPort}${MCP_PATH}`,
    publicUrl: publicOrigin,
    allowedHosts,
    oauthSimulation,
    async close() {
      await handler.closeAll();
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
