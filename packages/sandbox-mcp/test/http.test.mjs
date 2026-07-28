import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { manifest } from '@openfinance-os/sandbox-fixtures';
import { startHttp, normalizePublicUrl } from '../src/transports/http.mjs';

describe('sandbox-mcp HTTP transport (D-13)', () => {
  let server;

  beforeAll(async () => {
    server = await startHttp({ port: 0, host: '127.0.0.1', log: () => {} });
  });

  afterAll(async () => {
    await server.close();
  });

  async function newClient() {
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    const client = new Client({ name: 'http-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    return { client, transport };
  }

  it('listens, registers a session, and lists the documented tools (including discovery + spec helpers)', async () => {
    const { client } = await newClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_personas');
    expect(names).toContain('build_persona');
    expect(names).toContain('get_recipe_defaults');
    expect(names).toContain('get_motor_policies');
    expect(names).toContain('get_motor_quote');
    expect(names).toContain('list_endpoints');
    expect(names).toContain('field_status');
    expect(names).toContain('list_pool_values');
    expect(names).toContain('encode_recipe');
    expect(names).toContain('decode_recipe');
    expect(names).toContain('lfi_profiles');
    expect(names).toContain('get_atms');
    // 16 banking + 4 motor-insurance + 24 non-motor-insurance (4 each × 6 lines)
    // + 1 atm + 6 discovery/spec helpers = 51.
    expect(tools.length).toBe(51);
    await client.close();
  });

  it('two concurrent HTTP sessions keep their pinned personas isolated', async () => {
    const a = await newClient();
    const b = await newClient();

    await a.client.callTool({
      name: 'set_session',
      arguments: { persona: 'salaried_expat_mid' },
    });
    await b.client.callTool({
      name: 'set_session',
      arguments: { persona: 'hnw_multicurrency' },
    });

    const aSession = JSON.parse(
      (await a.client.callTool({ name: 'get_session', arguments: {} })).content[0].text,
    );
    const bSession = JSON.parse(
      (await b.client.callTool({ name: 'get_session', arguments: {} })).content[0].text,
    );

    expect(aSession.persona).toBe('salaried_expat_mid');
    expect(bSession.persona).toBe('hnw_multicurrency');

    await a.client.close();
    await b.client.close();
  });

  it('serves a healthy /health endpoint with permissive CORS and deploy-verification depth', async () => {
    const url = new URL(server.url);
    url.pathname = '/health';
    const res = await fetch(url, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body.ok).toBe(true);
    // E-03(d): a deploy must be verifiable from /health alone.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(body.version).toBe(pkg.version);
    expect(body.specVersion).toBe(manifest.specVersion);
    expect(body.specSha).toBe(manifest.specSha);
    expect(body.personaCount).toBe(Object.keys(manifest.personas).length);
    expect(body.toolCount).toBeGreaterThanOrEqual(51);
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof body.sessions).toBe('number');
  });

  it('responds to a CORS preflight with the documented headers', async () => {
    const res = await fetch(server.url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://claude.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, mcp-session-id',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
    expect(res.headers.get('access-control-expose-headers') ?? '').toMatch(/Mcp-Session-Id/i);
  });

  it('returns the v2.1 envelope with watermark when fetching get_accounts', async () => {
    const { client } = await newClient();
    await client.callTool({
      name: 'set_session',
      arguments: { persona: 'salaried_expat_mid' },
    });
    const r = await client.callTool({ name: 'get_accounts', arguments: {} });
    const text = r.content.map((c) => c.text ?? '').join('\n');
    expect(text).toMatch(/SYNTHETIC — Open Finance Data Sandbox/);
    const env = JSON.parse(text.slice(text.indexOf('{')));
    expect(env.Data.Account).toBeInstanceOf(Array);
    expect(env._watermark).toMatch(/SYNTHETIC/);
    await client.close();
  });
});

describe('public-endpoint hardening (E-03f/g)', () => {
  it('normalizePublicUrl accepts https origins and rejects everything else', () => {
    expect(normalizePublicUrl('https://data-sandbox.fly.dev')).toBe('https://data-sandbox.fly.dev');
    expect(normalizePublicUrl('https://mcp.example.org/mcp')).toBe('https://mcp.example.org');
    expect(normalizePublicUrl(null)).toBeNull();
    expect(normalizePublicUrl(undefined)).toBeNull();
    expect(() => normalizePublicUrl('http://mcp.example.org')).toThrow(/https/);
    expect(() => normalizePublicUrl('not a url')).toThrow(/invalid/);
  });

  it('startHttp rejects a non-https --public-url before binding', async () => {
    await expect(
      startHttp({ port: 0, host: '127.0.0.1', publicUrl: 'http://plain.example', log: () => {} }),
    ).rejects.toThrow(/https/);
  });

  it('per-IP token bucket returns 429 on POST /mcp once the burst is exhausted', async () => {
    const server = await startHttp({
      port: 0,
      host: '127.0.0.1',
      rateLimitBurst: 3,
      rateLimitRps: 0.001, // effectively no refill within the test window
      log: () => {},
    });
    try {
      const post = () =>
        fetch(server.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'rate-test', version: '0.0.0' },
            },
          }),
        });
      const statuses = [];
      for (let i = 0; i < 5; i++) {
        const res = await post();
        statuses.push(res.status);
        // Drain the body so the connection is reusable.
        await res.text().catch(() => {});
      }
      expect(statuses.slice(0, 3).every((s) => s === 200)).toBe(true);
      expect(statuses[3]).toBe(429);
      expect(statuses[4]).toBe(429);
    } finally {
      await server.close();
    }
  });

  it('GET /health is not rate-limited (only POST /mcp is)', async () => {
    const server = await startHttp({
      port: 0,
      host: '127.0.0.1',
      rateLimitBurst: 1,
      rateLimitRps: 0.001,
      log: () => {},
    });
    try {
      const url = new URL(server.url);
      url.pathname = '/health';
      for (let i = 0; i < 5; i++) {
        const res = await fetch(url);
        expect(res.status).toBe(200);
        await res.text().catch(() => {});
      }
    } finally {
      await server.close();
    }
  });
});
