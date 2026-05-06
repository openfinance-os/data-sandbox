import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp } from '../src/transports/http.mjs';

async function rawHttp({ port, host = '127.0.0.1', method = 'POST', path = '/mcp', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'hardening', version: '0.0.0' },
  },
});

describe('HTTP hardening (D-13 production readiness)', () => {
  let handle;
  const captured = [];

  beforeEach(async () => {
    captured.length = 0;
    handle = await startHttp({
      port: 0,
      host: '127.0.0.1',
      idleTtlMs: 50,
      maxSessions: 2,
      sweepIntervalMs: 10_000_000, // disabled — tests drive sweep() manually
      log: (line) => captured.push(line),
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  async function newClient() {
    const transport = new StreamableHTTPClientTransport(new URL(handle.url));
    const client = new Client({ name: 'hardening-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    return { client, transport };
  }

  it('idle sessions are evicted by sweep() after idleTtlMs', async () => {
    const { client } = await newClient();
    expect(handle.sessions.size).toBe(1);

    // Force every session to look stale.
    for (const entry of handle.sessions.values()) entry.lastActivity = Date.now() - 60_000;
    handle.sweep();

    expect(handle.sessions.size).toBe(0);
    expect(captured.some((l) => l.includes('session-evict') && l.includes('reason=idle'))).toBe(true);

    // The previously-open client now refers to a dead session; closing should
    // not throw — the SDK's transport tears its own state down regardless.
    await client.close().catch(() => {});
  });

  it('opening more than maxSessions evicts the oldest by lastActivity', async () => {
    const a = await newClient();
    const b = await newClient();
    expect(handle.sessions.size).toBe(2);

    // Make `a` the oldest by hand so the eviction is deterministic.
    let oldestId;
    let earliest = Infinity;
    for (const [id, entry] of handle.sessions) {
      if (entry.lastActivity < earliest) {
        earliest = entry.lastActivity;
        oldestId = id;
      }
    }
    handle.sessions.get(oldestId).lastActivity = 0;

    const c = await newClient();
    expect(handle.sessions.size).toBe(2);
    expect(handle.sessions.has(oldestId)).toBe(false);
    expect(captured.some((l) => l.includes('session-evict') && l.includes('reason=cap'))).toBe(true);

    await Promise.all([a.client, b.client, c.client].map((cl) => cl.close().catch(() => {})));
  });

  it('rejects an unrecognised Host header (DNS rebinding protection)', async () => {
    const res = await rawHttp({
      port: handle.port,
      headers: {
        Host: 'evil.example.com',
        Accept: 'application/json, text/event-stream',
      },
      body: INIT_BODY,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // SDK responds with a JSON-RPC-shaped error mentioning the rejection.
    expect(/(rebinding|host|forbidden|invalid)/i.test(res.body)).toBe(true);
  });

  it('accepts requests with the bound host on the bound port', async () => {
    const res = await rawHttp({
      port: handle.port,
      headers: {
        Host: `127.0.0.1:${handle.port}`,
        Accept: 'application/json, text/event-stream',
      },
      body: INIT_BODY,
    });
    expect(res.status).toBe(200);
  });

  it('logs every request with method, path, status, duration, session id', async () => {
    captured.length = 0;
    const { client } = await newClient();
    await client.callTool({ name: 'list_personas', arguments: {} });
    await client.close().catch(() => {});

    const requestLines = captured.filter((l) => /\b(POST|GET|DELETE)\b/.test(l));
    expect(requestLines.length).toBeGreaterThanOrEqual(1);
    for (const line of requestLines) {
      expect(line).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp
      expect(line).toMatch(/\b(POST|GET|DELETE)\b/);
      expect(line).toMatch(/\/mcp/);
      expect(line).toMatch(/\b\d{3}\b/); // status
      expect(line).toMatch(/\d+ms/);
      expect(line).toMatch(/session=/);
    }
  });

  it('close() drains every active session', async () => {
    await newClient();
    await newClient();
    expect(handle.sessions.size).toBe(2);
    await handle.close();
    expect(handle.sessions.size).toBe(0);
    // Subsequent close() is a no-op (afterEach calls it again).
    handle = await startHttp({
      port: 0,
      host: '127.0.0.1',
      log: () => {},
    });
  });
});
