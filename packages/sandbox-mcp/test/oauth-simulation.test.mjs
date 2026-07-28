// OAuth simulation layer for the HTTP transport.
//
// Covers:
//   - simulation off by default (anonymous /mcp still works)
//   - simulation on: /mcp returns 401 + WWW-Authenticate without bearer
//   - simulation on: /.well-known/oauth-protected-resource and
//     /.well-known/oauth-authorization-server return metadata
//   - simulation on: /authorize renders an HTML consent screen and binds
//     all parameters server-side to a nonce (PR-52 Greptile P1 — open
//     redirect / redirect_uri tampering fix)
//   - simulation on: full PKCE flow (authorize → code → token → MCP /mcp call)
//   - simulation on: code is single-use, code_verifier is enforced
//   - simulation on: deny path redirects with error=access_denied
//   - simulation on: unsupported code_challenge_method (plain) is rejected
//     at GET /authorize, before the user even sees the consent screen
//     (PR-52 Greptile P1 — RFC 7636 §4.3 compliance)
//   - simulation on: Host header outside allowedHosts is rejected at every
//     OAuth endpoint (PR-52 Greptile P1 — issuer poisoning fix)
//   - simulation on: token TTL is 1 hour, not 90 days (PR-52 Greptile P2)
//
// All of this is theatre over synthetic data per the README — the goal is
// to demo the consent journey end-to-end, not to gate anything real.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp } from '../src/transports/http.mjs';
import { parseArgs, parseEnvSimulateOauth } from '../src/args.mjs';

// Raw HTTP request with a controllable Host header. Undici / node-fetch
// override `Host` (it's a Fetch-spec "forbidden header"), so we drop down
// to node:http to actually exercise the Host-allowlist guard.
function rawRequest({ host, port, method = 'GET', path = '/', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// GET /authorize → parse nonce out of the rendered HTML form. We need
// this because PR-52 fixed open-redirect by binding all authorization
// params server-side; the POST form only carries `nonce` + `decision`.
function extractNonce(html) {
  const m = html.match(/name="nonce" value="([^"]+)"/);
  return m ? m[1] : null;
}

async function startConsent(origin, params) {
  const url = new URL(`${origin}/authorize`);
  url.searchParams.set('response_type', 'code');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const html = await res.text();
  return { res, nonce: extractNonce(html), html };
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
    expect(parseArgs(['--no-simulate-oauth'], { MCP_SIMULATE_OAUTH: '1' }).simulateOauth).toBe(
      false,
    );
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
  afterAll(async () => {
    await server.close();
  });

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
      port: 0,
      host: '127.0.0.1',
      log: () => {},
      simulateOauth: true,
    });
  });
  afterAll(async () => {
    await server.close();
  });

  function origin() {
    return server.url.replace(/\/mcp$/, '');
  }

  it('returns 401 + WWW-Authenticate on /mcp without a bearer', async () => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
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

  // PR-52 Greptile P1 — issuer is locked to the resolved listen address;
  // a forged Host header gets rejected with 400 instead of returning a
  // metadata document pointing at the attacker. fetch() can't override
  // Host (Fetch-spec "forbidden header"), so we use raw node:http here.
  it('rejects OAuth endpoints when Host header is not in allowedHosts', async () => {
    const u = new URL(server.url);
    const res = await rawRequest({
      host: u.hostname,
      port: u.port,
      path: '/.well-known/oauth-authorization-server',
      headers: { Host: 'evil.example' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toMatch(/Host header evil.example/);
  });

  it('accepts OAuth endpoints with the bound localhost Host header', async () => {
    const u = new URL(server.url);
    const res = await rawRequest({
      host: u.hostname,
      port: u.port,
      path: '/.well-known/oauth-authorization-server',
      headers: { Host: `${u.hostname}:${u.port}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Issuer is locked to the resolved listen address, not derived from
    // the request Host — that's the static-issuer fix.
    expect(body.issuer).toBe(`http://${u.hostname}:${u.port}`);
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
    expect(body).toContain('Share with Claude');
    expect(body).toContain('cc-connector-test');
    expect(body).toContain('SYNTHETIC');
    expect(body).toContain('Bank Data Sharing');
    // PR-52 — the form now only carries the nonce, not the raw redirect_uri.
    expect(extractNonce(body)).toBeTruthy();
  });

  it('rejects /authorize without response_type=code (no redirect_uri → 400)', async () => {
    const url = new URL(`${origin()}/authorize`);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('client_id', 'x');
    // No redirect_uri set; we expect a hard 400 because there is no URL
    // to redirect the error to.
    const res = await fetch(url);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  // PR-52 Greptile P1 — RFC 7636 §4.3. An unsupported code_challenge_method
  // must be rejected at the *authorization* endpoint, redirected back to
  // redirect_uri with error=invalid_request — not silently accepted only
  // to fail at /token after the auth code is already burned.
  it('rejects unsupported code_challenge_method at GET /authorize (redirects with error)', async () => {
    const url = new URL(`${origin()}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'cc-test');
    url.searchParams.set('redirect_uri', 'http://localhost:53117/callback');
    url.searchParams.set('scope', 'accounts:read');
    url.searchParams.set('state', 's1');
    url.searchParams.set('code_challenge', 'some-challenge');
    url.searchParams.set('code_challenge_method', 'plain');
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/^http:\/\/localhost:53117\/callback\?/);
    expect(location).toMatch(/error=invalid_request/);
    expect(location).toMatch(/code_challenge_method/);
    expect(location).toMatch(/state=s1/);
  });

  it('rejects unsupported code_challenge_method without redirect_uri (hard 400)', async () => {
    const url = new URL(`${origin()}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'cc-test');
    url.searchParams.set('code_challenge', 'c');
    url.searchParams.set('code_challenge_method', 'plain');
    const res = await fetch(url);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('rejects code_challenge without code_challenge_method', async () => {
    const url = new URL(`${origin()}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'cc-test');
    url.searchParams.set('redirect_uri', 'http://localhost:53117/callback');
    url.searchParams.set('code_challenge', 'some-challenge');
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/error=invalid_request/);
  });

  // PR-52 Greptile P1 (round 3) — the reverse case: code_challenge_method
  // present, code_challenge absent. Earlier versions of the consent form
  // would coerce the empty challenge to null and silently bypass PKCE at
  // /token. Must be rejected at GET /authorize.
  it('rejects code_challenge_method without code_challenge (silent-PKCE-bypass fix)', async () => {
    const url = new URL(`${origin()}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', 'cc-test');
    url.searchParams.set('redirect_uri', 'http://localhost:53117/callback');
    url.searchParams.set('code_challenge_method', 'S256');
    // no code_challenge
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/error=invalid_request/);
    expect(location).toMatch(/code_challenge_method%20requires%20code_challenge/);
  });

  // Belt-and-braces: even if a malformed entry somehow ended up in the
  // store with codeChallengeMethod set but codeChallenge empty, /token
  // would never produce a bearer for it — because GET /authorize is now
  // the only path into the store and rejects this shape outright. We
  // assert the live flow can't reach that state from any input.
  it('cannot reach POST /token from a code_challenge_method-only authz request', async () => {
    const u = new URL(`${origin()}/authorize`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', 'x');
    u.searchParams.set('redirect_uri', 'http://localhost:53117/callback');
    u.searchParams.set('code_challenge_method', 'S256');
    const res = await fetch(u, { redirect: 'manual' });
    // GET /authorize returns a 302 with error (not 200 HTML), so there is
    // no nonce in the response. Sanity-check that's the case.
    expect(res.status).toBe(302);
    const html = await res.text();
    expect(extractNonce(html)).toBeNull();
  });

  it('full PKCE flow: authorize → code → token → /mcp call', async () => {
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'http://localhost:53117/callback';

    // 1. GET /authorize to obtain the nonce
    const { nonce } = await startConsent(origin(), {
      client_id: 'cc-connector-test',
      redirect_uri: redirectUri,
      scope: 'accounts:read balances:read transactions:read',
      state: 'state-xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(nonce).toBeTruthy();

    // 2. POST /authorize approve (only nonce + decision)
    const approveRes = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nonce, decision: 'approve' }).toString(),
      redirect: 'manual',
    });
    expect(approveRes.status).toBe(302);
    const location = approveRes.headers.get('location');
    expect(location).toMatch(/^http:\/\/localhost:53117\/callback\?/);
    expect(location).toMatch(/state=state-xyz/);
    const callbackUrl = new URL(location);
    const code = callbackUrl.searchParams.get('code');
    expect(code).toBeTruthy();

    // 3. POST /token with code_verifier
    const tokenRes = await fetch(`${origin()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = await tokenRes.json();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.scope).toContain('accounts:read');
    // PR-52 Greptile P2 — token TTL is 1 hour, not 90 days.
    expect(tokens.expires_in).toBeLessThanOrEqual(60 * 60);
    expect(tokens.expires_in).toBeGreaterThan(0);

    // 4. Authenticated /mcp call works
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
    const { nonce } = await startConsent(origin(), {
      client_id: 'cc-connector-test',
      redirect_uri: redirectUri,
      scope: 'accounts:read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const approve = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nonce, decision: 'approve' }).toString(),
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

  // PR-52 Greptile P1 — the consent nonce is also single-use, so submitting
  // the same form twice can't produce two auth codes.
  it('consent nonce is single-use', async () => {
    const { challenge } = pkcePair();
    const { nonce } = await startConsent(origin(), {
      client_id: 'cc-test',
      redirect_uri: 'http://localhost:53117/callback',
      scope: 'accounts:read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const form = new URLSearchParams({ nonce, decision: 'approve' });

    const first = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(first.status).toBe(302);

    const second = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(second.status).toBe(400);
  });

  // PR-52 Greptile P1 — POST /authorize *cannot* be coerced into redirecting
  // to a URI different from what was bound at GET. The form has no
  // redirect_uri input; any extra field on the body is ignored.
  it('POST /authorize ignores any redirect_uri in the form body (binding fix)', async () => {
    const { nonce } = await startConsent(origin(), {
      client_id: 'cc-test',
      redirect_uri: 'http://localhost:53117/callback',
      scope: 'accounts:read',
      state: 's',
    });
    const res = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        nonce,
        decision: 'approve',
        // Attacker-supplied redirect_uri in the form body must be ignored.
        redirect_uri: 'https://phishing.example/steal',
      }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toMatch(/^http:\/\/localhost:53117\/callback\?/);
    expect(location).not.toMatch(/phishing/);
  });

  it('rejects bad code_verifier', async () => {
    const { challenge } = pkcePair();
    const redirectUri = 'http://localhost:53117/callback';
    const { nonce } = await startConsent(origin(), {
      client_id: 'cc-connector-test',
      redirect_uri: redirectUri,
      scope: 'accounts:read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const approve = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nonce, decision: 'approve' }).toString(),
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
    const { nonce } = await startConsent(origin(), {
      client_id: 'cc-connector-test',
      redirect_uri: 'http://localhost:53117/callback',
      scope: 'accounts:read',
      state: 's',
    });
    const res = await fetch(`${origin()}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ nonce, decision: 'deny' }).toString(),
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

  // ── E-03(g): RFC 7591 stub Dynamic Client Registration ────────────────────

  it('advertises registration_endpoint in the RFC 8414 metadata', async () => {
    const res = await fetch(`${origin()}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registration_endpoint).toBe(`${body.issuer}/register`);
  });

  it('POST /register echoes back a synthetic client_id (RFC 7591 stub)', async () => {
    const res = await fetch(`${origin()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.client_id).toMatch(/^sandbox-/);
    expect(body.client_id_issued_at).toBeGreaterThan(0);
    expect(body.client_name).toBe('Claude');
    expect(body.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(body.token_endpoint_auth_method).toBe('none'); // public client — no secret
    expect(body.client_secret).toBeUndefined();
    expect(body.grant_types).toEqual(['authorization_code']);
    expect(body.response_types).toEqual(['code']);
  });

  it('POST /register with an empty body still registers (all-default metadata)', async () => {
    const res = await fetch(`${origin()}/register`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client_id).toMatch(/^sandbox-/);
    expect(body.redirect_uris).toEqual([]);
  });

  it('POST /register rejects malformed JSON with invalid_client_metadata', async () => {
    const res = await fetch(`${origin()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_client_metadata');
  });

  // ── E-03(f): CORS wildcard must not blanket the OAuth endpoints ──────────

  it('does not apply Access-Control-Allow-Origin: * to the OAuth endpoints', async () => {
    const oauthPaths = [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-authorization-server',
    ];
    for (const p of oauthPaths) {
      const res = await fetch(`${origin()}${p}`, { headers: { Origin: 'https://evil.example' } });
      expect(res.status, p).toBe(200);
      expect(res.headers.get('access-control-allow-origin'), p).toBeNull();
    }
    // /register (POST) — no CORS either.
    const reg = await fetch(`${origin()}/register`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(reg.headers.get('access-control-allow-origin')).toBeNull();
    // /mcp keeps the wildcard (anonymous synthetic data, browser clients).
    const mcp = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Origin: 'https://claude.ai',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(mcp.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('HTTP transport — public URL issuer (E-03g)', () => {
  let server;
  beforeAll(async () => {
    server = await startHttp({
      port: 0,
      host: '127.0.0.1',
      log: () => {},
      simulateOauth: true,
      publicUrl: 'https://mcp.example.org',
      // The public host must be reachable through the Host allowlist; the
      // test talks to 127.0.0.1 so both are in play.
    });
  });
  afterAll(async () => {
    await server.close();
  });

  it('surfaces the validated public origin on the handle', () => {
    expect(server.publicUrl).toBe('https://mcp.example.org');
    expect(server.allowedHosts).toContain('mcp.example.org');
  });

  it('uses the public https origin as the OAuth issuer instead of http://host:port', async () => {
    const u = new URL(server.url);
    const res = await fetch(`${u.origin}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issuer).toBe('https://mcp.example.org');
    expect(body.authorization_endpoint).toBe('https://mcp.example.org/authorize');
    expect(body.token_endpoint).toBe('https://mcp.example.org/token');
    expect(body.registration_endpoint).toBe('https://mcp.example.org/register');
  });
});
