// OAuth simulation layer for the HTTP transport.
//
// Covers:
//   - simulation off by default (anonymous /mcp still works)
//   - simulation on: /mcp returns 401 + WWW-Authenticate without bearer
//   - simulation on: /.well-known/oauth-protected-resource and
//     /.well-known/oauth-authorization-server return metadata
//   - simulation on: /authorize renders an HTML consent screen
//   - simulation on: full PKCE flow (authorize → code → token → MCP /mcp call)
//   - simulation on: code is single-use, code_verifier is enforced
//   - simulation on: deny path redirects with error=access_denied
//
// All of this is theatre over synthetic data per the README — the goal is
// to demo the consent journey end-to-end, not to gate anything real.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp } from '../src/transports/http.mjs';
import { parseArgs, parseEnvSimulateOauth } from '../src/args.mjs';

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

describe('parseArgs — --simulate-oauth', () => {
  it('defaults to off', () => {
    expect(parseArgs([], {}).simulateOauth).toBe(false);
  });
  it('flag enables it', () => {
    expect(parseArgs(['--simulate-oauth'], {}).simulateOauth).toBe(true);
  });
  it('MCP_SIMULATE_OAUTH=1 enables it', () => {
    expect(parseArgs([], { MCP_SIMULATE_OAUTH: '1' }).simulateOauth).toBe(true);
    expect(parseArgs([], { MCP_SIMULATE_OAUTH: 'true' }).simulateOauth).toBe(true);
    expect(parseArgs([], { MCP_SIMULATE_OAUTH: 'yes' }).simulateOauth).toBe(true);
  });
  it('--no-simulate-oauth overrides env', () => {
    expect(
      parseArgs(['--no-simulate-oauth'], { MCP_SIMULATE_OAUTH: '1' }).simulateOauth,
    ).toBe(false);
  });
  it('parseEnvSimulateOauth ignores empties and falsy', () => {
    expect(parseEnvSimulateOauth({})).toBe(false);
    expect(parseEnvSimulateOauth({ MCP_SIMULATE_OAUTH: '' })).toBe(false);
    expect(parseEnvSimulateOauth({ MCP_SIMULATE_OAUTH: '0' })).toBe(false);
    expect(parseEnvSimulateOauth({ MCP_SIMULATE_OAUTH: 'no' })).toBe(false);
  });
});

describe('HTTP transport — anonymous (simulateOauth: false)', () => {
  let server;
  beforeAll(async () => {
    server = await startHttp({ port: 0, host: '127.0.0.1', log: () => {} });
  });
  afterAll(async () => { await server.close(); });

  it('does not advertise OAuth metadata', async () => {
    const u = new URL(server.url);
    u.pathname = '/.well-known/oauth-protected-resource';
    const res = await fetch(u);
    expect(res.status).toBe(404);
  });

  it('serves /mcp without an Authorization header', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  });
});

describe('HTTP transport — OAuth simulation (simulateOauth: true)', () => {
  let server;
  beforeAll(async () => {
    server = await startHttp({
      port: 0, host: '127.0.0.1', log: () => {}, simulateOauth: true,
    });
  });
  afterAll(async () => { await server.close(); });

  function origin() { return server.url.replace(/\/mcp$/, ''); }

  it('returns 401 + WWW-Authenticate on /mcp without a bearer', async () => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate');
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toMatch(/realm="open-finance-sandbox"/);
    expect(challenge).toMatch(/authorization_uri=/);
    expect(challenge).toMatch(/resource_metadata=/);
  });

  it('serves /.well-known/oauth-protected-resource (RFC 9728)', async () => {
    const res = await fetch(`${origin()}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toMatch(/\/mcp$/);
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.scopes_supported).toContain('accounts:read');
    expect(body.bearer_methods_supported).toContain('header');
  });

  it('serves /.well-known/oauth-authorization-server (RFC 8414)', async () => {
    const res = await fetch(`${origin()}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBeTruthy();
    expect(body.authorization_endpoint).toMatch(/\/authorize$/);
    expect(body.token_endpoint).toMatch(/\/token$/);
    expect(body.response_types_supported).toContain('code');
    expect(body.code_challenge_methods_supported).toContain('S256');
  });

  it('renders the HTML consent screen on GET /authorize', async () => {
    const url = new URL(`${origin()}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'cc-connector-test');
    url.searchParams.set('redirect_uri', 'http://localhost:53117/callback');
    url.searchParams.set('scope', 'accounts:read balances:read');
    url.searchParams.set('state', 'state-xyz');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('Authorize Claude');
    expect(body).toContain('cc-connector-test');
    expect(body).toContain('SYNTHETIC');
    expect(body).toContain('Bank Data Sharing');
  });

  it('rejects /authorize without response_type=code', async () => {
    const url = new URL(`${origin()}/authorize`);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('client_id', 'x');
    url.searchParams.set('redirect_uri', 'http://localhost/cb');
    const res = await fetch(url);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_response_type');
  });

  it('full PKCE flow: authorize → code → token → /mcp call', async () => {
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'http://localhost:53117/callback';

    // 1. POST /authorize approve
    const form = new URLSearchParams({
      client_id: 'cc-connector-test',
      redirect_uri: redirectUri,
      scope: 'accounts:read balances:read transactions:read',
      state: 'state-xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      decision: 'approve',
    });
    const approveRes = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(approveRes.status).toBe(302);
    const location = approveRes.headers.get('location');
    expect(location).toMatch(/^http:\/\/localhost:53117\/callback\?/);
    expect(location).toMatch(/state=state-xyz/);
    const callbackUrl = new URL(location);
    const code = callbackUrl.searchParams.get('code');
    expect(code).toBeTruthy();

    // 2. POST /token with code_verifier
    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const tokenRes = await fetch(`${origin()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString(),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = await tokenRes.json();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.scope).toContain('accounts:read');

    // 3. Authenticated /mcp call works
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    });
    const client = new Client({ name: 'oauth-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_personas');
    await client.close();
  });

  it('auth code is single-use', async () => {
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'http://localhost:53117/callback';
    const form = new URLSearchParams({
      client_id: 'cc-connector-test',
      redirect_uri: redirectUri,
      scope: 'accounts:read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      decision: 'approve',
    });
    const approve = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });
    const code = new URL(approve.headers.get('location')).searchParams.get('code');

    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const first = await fetch(`${origin()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString(),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${origin()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString(),
    });
    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects bad code_verifier', async () => {
    const { challenge } = pkcePair();
    const redirectUri = 'http://localhost:53117/callback';
    const approve = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'cc-connector-test',
        redirect_uri: redirectUri,
        scope: 'accounts:read',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        decision: 'approve',
      }).toString(),
      redirect: 'manual',
    });
    const code = new URL(approve.headers.get('location')).searchParams.get('code');

    const tokenRes = await fetch(`${origin()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: 'not-the-right-verifier',
      }).toString(),
    });
    expect(tokenRes.status).toBe(400);
    const body = await tokenRes.json();
    expect(body.error).toBe('invalid_grant');
    expect(body.error_description).toMatch(/code_verifier/);
  });

  it('deny path redirects with error=access_denied', async () => {
    const res = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'cc-connector-test',
        redirect_uri: 'http://localhost:53117/callback',
        scope: 'accounts:read',
        state: 's',
        decision: 'deny',
      }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/error=access_denied/);
    expect(location).toMatch(/state=s/);
  });

  it('invalid bearer is rejected with 401', async () => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer not-a-real-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer /);
  });
});
