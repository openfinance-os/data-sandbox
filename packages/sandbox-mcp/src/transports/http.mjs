// Streamable-HTTP transport — what the Claude marketplace listing connects to.
//
// Anonymous (D-13): no auth, no API key, no OAuth. The data is fully synthetic
// so there is nothing to protect, and that matches PRD §6.4 ("the sandbox runs
// anonymously"). CORS is wide-open for the same reason.
//
// One Node process serves many concurrent MCP sessions; each session gets a
// fresh `createServer()` (and therefore its own per-instance session store)
// keyed by the Mcp-Session-Id header.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../server.mjs';

const MCP_PATH = '/mcp';
const HEALTH_PATH = '/health';
const SESSION_HEADER = 'mcp-session-id';

const MAX_BODY_BYTES = 1_000_000; // 1 MB — JSON-RPC messages are tiny

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

export function createHttpHandler() {
  // sessionId → { transport, server }
  const sessions = new Map();

  async function handle(req, res) {
    applyCors(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://placeholder');
    const path = url.pathname;

    if (path === HEALTH_PATH && req.method === 'GET') {
      sendJson(res, 200, { ok: true, sessions: sessions.size });
      return;
    }

    if (path !== MCP_PATH) {
      sendJson(res, 404, { error: 'not found', tryEndpoint: MCP_PATH });
      return;
    }

    const sessionId = req.headers[SESSION_HEADER];
    let entry = sessionId ? sessions.get(sessionId) : null;

    if (req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, jsonRpcError(null, -32700, `parse error: ${err.message}`));
        return;
      }

      if (!entry && isInitializeRequest(body)) {
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server });
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
          },
        });
        await server.connect(transport);
        entry = { transport, server };
        await entry.transport.handleRequest(req, res, body);
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

      await entry.transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      if (!entry) {
        sendJson(res, 400, { error: 'no active session for that Mcp-Session-Id' });
        return;
      }
      await entry.transport.handleRequest(req, res);
      return;
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    res.end();
  }

  async function dispatch(req, res) {
    try {
      await handle(req, res);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal error', message: err?.message ?? String(err) });
      } else {
        res.end();
      }
    }
  }

  return { dispatch, sessions };
}

export async function startHttp({ port = 8787, host = '127.0.0.1' } = {}) {
  const { dispatch, sessions } = createHttpHandler();
  const server = http.createServer((req, res) => {
    dispatch(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;
  const resolvedHost = typeof addr === 'object' && addr ? addr.address : host;

  return {
    server,
    sessions,
    port: resolvedPort,
    host: resolvedHost,
    url: `http://${resolvedHost}:${resolvedPort}${MCP_PATH}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
