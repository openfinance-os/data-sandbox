import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp } from '../src/transports/http.mjs';

const MACHINES = ['56835e24b20608', '7841e0ea462d58'];
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-11-25',
};
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'routing-test', version: '0.0.0' },
  },
};

const handles = [];
const clients = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

async function start(flyMachineId, options = {}) {
  const handle = await startHttp({
    port: 0,
    host: '127.0.0.1',
    flyMachineId,
    log: () => {},
    ...options,
  });
  handles.push(handle);
  return handle;
}

async function request(handle, { sessionId, method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(handle.url, {
    method,
    headers: { ...HEADERS, ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
  const text = await response.text();
  return { response, text };
}

// Two independent HTTP handlers, each with its own session map. Every session
// request deliberately enters through the wrong Machine. The proxy emulator
// replays the original bytes/headers only when the server instructs it to.
async function cluster() {
  const servers = await Promise.all(MACHINES.map((id) => start(id)));
  const replays = [];
  let next = 0;
  const proxyFetch = async (url, init) => {
    const original = new Request(url, init);
    const sessionId = original.headers.get('Mcp-Session-Id');
    const owner = sessionId?.split('.')[1];
    const ingress = owner ? 1 - MACHINES.indexOf(owner) : next++ % servers.length;
    const send = (index, extra = {}) => {
      const copy = original.clone();
      const headers = new Headers(copy.headers);
      for (const [key, value] of Object.entries(extra)) headers.set(key, value);
      return fetch(servers[index].url, {
        method: copy.method,
        headers,
        body: copy.body,
        duplex: 'half',
        signal: copy.signal,
        redirect: 'manual',
      });
    };
    let response = await send(ingress);
    const replay = response.headers.get('Fly-Replay');
    if (replay) {
      expect(response.status).toBe(307);
      expect(replay).toBe(`instance=${owner};timeout=5s;fallback=force_self`);
      expect(servers[ingress].sessions.has(sessionId)).toBe(false);
      replays.push({ method: original.method, sessionId });
      await response.arrayBuffer();
      response = await send(MACHINES.indexOf(owner), {
        'fly-replay-src': `instance=${MACHINES[ingress]};region=fra;t=1`,
      });
      expect(response.headers.get('Fly-Replay')).toBeNull();
    }
    return response;
  };
  const connect = async () => {
    const transport = new StreamableHTTPClientTransport(new URL('http://proxy.test/mcp'), {
      fetch: proxyFetch,
    });
    const client = new Client({ name: 'routing-test', version: '0.0.0' }, { capabilities: {} });
    clients.push(client);
    await client.connect(transport);
    return { client, transport };
  };
  return { servers, replays, proxyFetch, connect };
}

describe('Fly multi-instance session routing', () => {
  it('preserves isolated state through cross-machine initialization notifications and tool calls', async () => {
    const { servers, replays, connect } = await cluster();
    const a = await connect();
    const b = await connect();
    expect(a.transport.sessionId).toMatch(new RegExp(`^fly\\.${MACHINES[0]}\\.`));
    expect(b.transport.sessionId).toMatch(new RegExp(`^fly\\.${MACHINES[1]}\\.`));
    expect(servers.map((s) => s.sessions.size)).toEqual([1, 1]);
    await a.client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    await b.client.callTool({ name: 'set_session', arguments: { persona: 'hnw_multicurrency' } });
    for (const [connection, persona] of [
      [a, 'salaried_expat_mid'],
      [b, 'hnw_multicurrency'],
    ]) {
      const result = await connection.client.callTool({ name: 'get_session', arguments: {} });
      expect(JSON.parse(result.content[0].text).persona).toBe(persona);
      expect((await connection.client.listTools()).tools).toHaveLength(51);
    }
    expect(replays.filter((r) => r.method === 'POST').length).toBeGreaterThanOrEqual(8);
    await a.transport.terminateSession();
    await b.transport.terminateSession();
    expect(replays.filter((r) => r.method === 'DELETE')).toHaveLength(2);
    expect(servers.map((s) => s.sessions.size)).toEqual([0, 0]);
  });

  it('routes GET event streams to the owner and ends deleted sessions with 404', async () => {
    const { servers, proxyFetch, replays } = await cluster();
    const { response } = await request(servers[0], { body: INIT });
    const sessionId = response.headers.get('Mcp-Session-Id');
    const abort = new AbortController();
    const stream = await proxyFetch('http://proxy.test/mcp', {
      method: 'GET',
      headers: { ...HEADERS, 'Mcp-Session-Id': sessionId },
      signal: abort.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    abort.abort();
    await stream.body.cancel().catch(() => {});
    expect(replays.some((r) => r.method === 'GET')).toBe(true);
    const deleted = await proxyFetch('http://proxy.test/mcp', {
      method: 'DELETE',
      headers: { ...HEADERS, 'Mcp-Session-Id': sessionId },
    });
    expect(deleted.status).toBe(200);
    await deleted.text();
    for (const method of ['GET', 'DELETE', 'POST']) {
      const stale = await proxyFetch('http://proxy.test/mcp', {
        method,
        headers: { ...HEADERS, 'Mcp-Session-Id': sessionId },
        ...(method === 'POST' ? { body: JSON.stringify(INIT) } : {}),
      });
      expect(stale.status).toBe(404);
      await stale.text();
    }
    expect(servers.map((s) => s.sessions.size)).toEqual([0, 0]);
  });

  it('returns 404 after TTL expiry or an owner restart without recreating an initialize session', async () => {
    const owner = await start(MACHINES[0]);
    const { response } = await request(owner, { body: INIT });
    const sessionId = response.headers.get('Mcp-Session-Id');
    for (const entry of owner.sessions.values()) entry.lastActivity = 0;
    owner.sweep();
    expect(owner.sessions.size).toBe(0);
    const restarted = await start(MACHINES[0]);
    for (const server of [owner, restarted]) {
      const result = await request(server, { sessionId, body: INIT });
      expect(result.response.status).toBe(404);
      expect(result.response.headers.get('Fly-Replay')).toBeNull();
      expect(server.sessions.size).toBe(0);
    }
  });

  it('rejects malformed, legacy and local-owner unknown IDs without replaying or creating sessions', async () => {
    const handle = await start(MACHINES[0]);
    for (const sessionId of [
      randomUUID(),
      `fly.${MACHINES[0]}.${randomUUID()}`,
      `fly.${MACHINES[1]}.not-a-uuid`,
      `fly.${MACHINES[1]};app=other.${randomUUID()}`,
      `fly.${'a'.repeat(33)}.${randomUUID()}`,
      `fly.${MACHINES[1]}.${randomUUID()},duplicate`,
    ]) {
      const { response } = await request(handle, { sessionId, body: INIT });
      expect(response.status).toBe(404);
      expect(response.headers.get('Fly-Replay')).toBeNull();
    }
    expect(handle.sessions.size).toBe(0);
  });

  it('does not loop on failed replay, wrong-target replay, or non-Fly deployments', async () => {
    const fly = await start(MACHINES[0]);
    const local = await start(null);
    const sessionId = `fly.${MACHINES[1]}.${randomUUID()}`;
    for (const headers of [
      { 'fly-replay-failed': 'reason=no_candidate' },
      { 'fly-replay-src': 'instance=abcdef12' },
    ]) {
      const { response } = await request(fly, { sessionId, body: INIT, headers });
      expect(response.status).toBe(404);
      expect(response.headers.get('Fly-Replay')).toBeNull();
    }
    const { response } = await request(local, { sessionId, body: INIT });
    expect(response.status).toBe(404);
    expect(response.headers.get('Fly-Replay')).toBeNull();
    const init = await request(local, { body: INIT });
    expect(init.response.status).toBe(200);
    expect(init.response.headers.get('Mcp-Session-Id')).toMatch(/^[a-f0-9-]{36}$/);
    for (const method of ['GET', 'DELETE', 'POST']) {
      const missing = await request(fly, {
        method,
        body: method === 'POST' ? { jsonrpc: '2.0', id: 2, method: 'tools/list' } : undefined,
      });
      expect(missing.response.status).toBe(400);
    }
  });

  it('keeps Host, Origin, rate and body validation ahead of replay', async () => {
    const handle = await start(MACHINES[0], {
      allowedOrigins: ['https://allowed.test'],
      rateLimitBurst: 3,
      rateLimitRps: 0.001,
    });
    const sessionId = `fly.${MACHINES[1]}.${randomUUID()}`;
    // Undici deliberately rewrites Host; use raw HTTP to exercise rebinding.
    const badHost = await new Promise((resolve, reject) => {
      const req = http.request(
        handle.url,
        {
          method: 'POST',
          headers: { ...HEADERS, Host: 'evil.test', 'Mcp-Session-Id': sessionId },
        },
        (res) => {
          res.resume();
          res.on('end', () =>
            resolve({ status: res.statusCode, replay: res.headers['fly-replay'] }),
          );
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(INIT));
    });
    expect(badHost).toEqual({ status: 403, replay: undefined });
    for (const headers of [{ Origin: 'https://evil.test' }]) {
      const { response } = await request(handle, { sessionId, body: INIT, headers });
      expect(response.status).toBe(403);
      expect(response.headers.get('Fly-Replay')).toBeNull();
    }
    const unsupported = await request(handle, { sessionId, method: 'PUT', body: INIT });
    expect(unsupported.response.status).toBe(405);
    expect(unsupported.response.headers.get('Fly-Replay')).toBeNull();
    for (let i = 0; i < 4; i++) {
      const { response } = await request(handle, { sessionId, body: INIT });
      expect(response.status).toBe(i < 3 ? 307 : 429);
      if (i === 3) expect(response.headers.get('Fly-Replay')).toBeNull();
    }
  });

  it('rejects declared and chunked oversized requests without replay', async () => {
    const handle = await start(MACHINES[0]);
    const sessionId = `fly.${MACHINES[1]}.${randomUUID()}`;
    const declared = await request(handle, { sessionId, body: { padding: 'x'.repeat(1_000_001) } });
    expect(declared.response.status).toBe(413);
    expect(declared.response.headers.get('Fly-Replay')).toBeNull();
    const raw = (method, oversized) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          handle.url,
          {
            method,
            headers: { ...HEADERS, 'Mcp-Session-Id': sessionId, 'Transfer-Encoding': 'chunked' },
          },
          (res) => {
            res.resume();
            res.on('end', () =>
              resolve({ status: res.statusCode, replay: res.headers['fly-replay'] }),
            );
          },
        );
        req.on('error', reject);
        req.end(oversized ? 'x'.repeat(1_000_001) : '{}');
      });
    expect(await raw('POST', true)).toEqual({ status: 413, replay: undefined });
    for (const method of ['GET', 'DELETE']) {
      expect(await raw(method, false)).toEqual({ status: 400, replay: undefined });
    }
  });

  it('keeps sessions on the same Machine distinguishable in logs without exposing full IDs', async () => {
    const lines = [];
    const handle = await start(MACHINES[0], { log: (line) => lines.push(line) });
    const labels = [];
    for (let i = 0; i < 2; i++) {
      const { response } = await request(handle, { body: INIT });
      const sessionId = response.headers.get('Mcp-Session-Id');
      await request(handle, { sessionId, method: 'DELETE' });
      const label = `${MACHINES[0]}:${sessionId.split('.')[2].slice(0, 8)}`;
      labels.push(label);
      expect(lines.some((line) => line.includes(`session=${label}`))).toBe(true);
      expect(lines.some((line) => line.includes(sessionId))).toBe(false);
    }
    expect(labels[0]).not.toBe(labels[1]);
  });

  it('validates Machine configuration before binding a listener', async () => {
    for (const flyMachineId of ['bad;app=other', '', 'a'.repeat(33)]) {
      await expect(startHttp({ port: 0, flyMachineId })).rejects.toThrow(/FLY_MACHINE_ID/);
    }
  });
});
