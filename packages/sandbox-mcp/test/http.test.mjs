import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp } from '../src/transports/http.mjs';

describe('sandbox-mcp HTTP transport (D-13)', () => {
  let server;

  beforeAll(async () => {
    server = await startHttp({ port: 0, host: '127.0.0.1' });
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

  it('listens, registers a session, and lists 14 tools', async () => {
    const { client } = await newClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_personas');
    expect(tools.length).toBe(14);
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

  it('serves a healthy /health endpoint with permissive CORS', async () => {
    const url = new URL(server.url);
    url.pathname = '/health';
    const res = await fetch(url, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body.ok).toBe(true);
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
