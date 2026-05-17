// Opt-in OAuth 2.1 simulation layer for the HTTP transport.
//
// Default deploy at https://data-sandbox.fly.dev/mcp remains anonymous per
// PRD D-13 ("Anonymous — no auth, no API keys, no OAuth. The data is
// synthetic so there is nothing to protect"). This module is wired only
// when --simulate-oauth / MCP_SIMULATE_OAUTH=1 is set, and exists so a TPP
// can demo a full UAE Open Finance consent journey end-to-end against
// synthetic payloads before integrating the real Nebras client.
//
// Exposes the four endpoints an MCP-spec-compliant OAuth client expects:
//
//   GET  /.well-known/oauth-protected-resource    (RFC 9728 metadata)
//   GET  /.well-known/oauth-authorization-server  (RFC 8414 metadata)
//   GET  /authorize?...                           (HTML consent screen)
//   POST /authorize                               (302 → redirect_uri with code)
//   POST /token                                   (PKCE-validated exchange)
//
// Plus a verifyBearer(token) hook the HTTP transport uses to gate /mcp.
//
// In-memory only — auth codes, nonces, and tokens are lost on restart.
// That is the correct posture: the simulation must not retain anything
// across runs.
//
// Security posture (PR-52 review fixes):
//   - Host header is validated against the same allowedHosts list the
//     /mcp DNS-rebinding guard uses; mismatches reject before the issuer
//     URL is ever rendered (defends against metadata-pointing-at-attacker).
//   - Authorization request parameters are bound to a server-side nonce
//     at GET /authorize; POST /authorize ignores the form's redirect_uri,
//     scope, etc. and uses the nonce-bound copy. Prevents open-redirect
//     and code-tampering via modified hidden inputs (RFC 6749 §4.1.3).
//   - code_challenge_method is validated at GET /authorize, not at
//     POST /token, so unsupported methods (e.g. 'plain') redirect with
//     error=invalid_request *before* the auth code is burned (RFC 7636 §4.3).
//   - Token TTL is 1 hour (RFC 6749 best practice); the 90-day "sharing
//     window" in the consent UI is a UX label, not the bearer lifetime.

import { createHash, randomBytes } from 'node:crypto';

const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 min (OAuth spec recommends ≤ 10 min)
const CONSENT_NONCE_TTL_MS = 10 * 60 * 1000; // 10 min — consent screen → submit window
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour — short-lived per RFC 6749 best practice

const SUPPORTED_SCOPES = [
  'accounts:read',
  'balances:read',
  'transactions:read',
  'parties:read',
  'standing-orders:read',
  'direct-debits:read',
  'beneficiaries:read',
  'statements:read',
  'products:read',
  'insurance:read',
];

const DEFAULT_SCOPE = SUPPORTED_SCOPES.join(' ');

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sha256(s) {
  return createHash('sha256').update(s).digest();
}

function newId(bytes = 32) {
  return b64url(randomBytes(bytes));
}

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function redirectWithError(res, redirectUri, error, errorDescription, state) {
  const sep = redirectUri.includes('?') ? '&' : '?';
  let url = `${redirectUri}${sep}error=${encodeURIComponent(error)}` +
            `&error_description=${encodeURIComponent(errorDescription)}`;
  if (state) url += `&state=${encodeURIComponent(state)}`;
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 100_000) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const params = new URLSearchParams(raw);
      const out = {};
      for (const [k, v] of params) out[k] = v;
      resolve(out);
    });
    req.on('error', reject);
  });
}

function consentScreenHtml({ nonce, clientId, redirectUri, scope }) {
  const scopes = (scope || DEFAULT_SCOPE).split(/\s+/).filter(Boolean);
  const hasBanking = scopes.some((s) => s.startsWith('accounts') || s.startsWith('balances') || s.startsWith('transactions') || s.startsWith('parties') || s.startsWith('standing-orders') || s.startsWith('direct-debits') || s.startsWith('beneficiaries') || s.startsWith('statements') || s.startsWith('products'));
  const hasInsurance = scopes.some((s) => s.startsWith('insurance'));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Share with Claude · UAE Open Finance Authority</title>
<style>
  :root {
    --bg:#fafaf7; --bg-soft:#f3f1eb; --bg-card:#fff; --text:#1d1d1b; --text-muted:#5a5a55;
    --border:#d9d5cb; --border-strong:#b3afa3; --accent:#2d5d4f; --accent-soft:#d5e6df;
    --mandatory-bg:#1d4a3e; --mandatory-fg:#fff; --warn-bg:#fff8e1; --warn-border:#d8b95b;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:14px;line-height:1.5}
  .shell{max-width:520px;margin:48px auto 64px;padding:0 18px}
  .stripe{height:4px;background:var(--warn-border)}
  .banner{background:var(--warn-bg);border-bottom:1px solid var(--warn-border);padding:8px 16px;font-size:12px}
  .card{background:var(--bg-card);border:1px solid var(--border-strong);border-radius:8px;padding:28px 26px;box-shadow:0 1px 0 rgba(0,0,0,0.02)}
  h1{font-size:20px;margin:0 0 4px;font-weight:600;letter-spacing:-0.01em}
  .sub{color:var(--text-muted);font-size:13px;margin-bottom:22px}
  code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12px;background:var(--bg-soft);padding:1px 5px;border-radius:3px;border:1px solid var(--border)}
  .scope{display:flex;gap:10px;padding:12px 0;border-top:1px solid var(--border)}
  .scope:first-of-type{border-top:none}
  .scope .tick{width:18px;height:18px;flex:0 0 18px;border-radius:3px;background:var(--mandatory-bg);color:var(--mandatory-fg);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;margin-top:1px}
  .scope.off .tick{background:transparent;border:1px solid var(--border-strong);color:transparent}
  .scope strong{display:block;font-size:13px}
  .scope .body{font-size:12px;color:var(--text-muted);line-height:1.45}
  .footnote{font-size:11.5px;color:var(--text-muted);margin-top:14px;padding-top:12px;border-top:1px dashed var(--border)}
  .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
  button{font:inherit;cursor:pointer;padding:9px 18px;border-radius:4px;border:1px solid var(--border-strong);background:transparent;color:var(--text);font-weight:600;font-size:13px}
  button.approve{background:var(--accent);border-color:var(--accent);color:#fff}
  button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .meta{font-size:11px;color:var(--text-muted);margin-top:18px;font-family:ui-monospace,"SF Mono",Menlo,monospace;word-break:break-all}
</style></head>
<body>
<div class="stripe"></div>
<div class="banner"><strong>SYNTHETIC.</strong> No real customer data. No real institution. This is a simulation of the UAE Open Finance consent journey.</div>
<main class="shell">
  <div class="card">
    <h1>Share with Claude</h1>
    <p class="sub"><strong>${htmlEscape(clientId)}</strong> will be able to read what you tick below. You can stop sharing at any time.</p>

    ${hasBanking ? `<div class="scope"><span class="tick">✓</span><div><strong>Bank Data Sharing</strong><span class="body">${htmlEscape(scopes.filter(s=>!s.startsWith('insurance')).join(' · '))}</span></div></div>` : ''}
    ${hasInsurance ? `<div class="scope"><span class="tick">✓</span><div><strong>Insurance Data Sharing</strong><span class="body">motor · home · health · life · travel · renters · employment renewals and payment details</span></div></div>` : ''}
    <div class="scope off"><span class="tick">✓</span><div><strong>Service Initiation — payments</strong><span class="body">Not requested · v1 read-only</span></div></div>

    <p class="footnote">
      Sharing window <strong>90 days</strong> · Revoke any time at <em>portal.openfinance.ae · My Consents</em>.
      Data is <strong>SYNTHETIC</strong>.
    </p>

    <form method="POST" action="/authorize" autocomplete="off">
      <input type="hidden" name="nonce" value="${htmlEscape(nonce)}"/>
      <div class="actions">
        <button name="decision" value="deny" type="submit">Deny</button>
        <button name="decision" value="approve" type="submit" class="approve">Approve all (1 tap)</button>
      </div>
    </form>

    <p class="meta">
      client_id: ${htmlEscape(clientId)}<br/>
      redirect_uri: ${htmlEscape(redirectUri)}
    </p>
  </div>
</main>
</body></html>`;
}

export function createOAuthSimulation({ issuer, resource, allowedHosts } = {}) {
  // Server-side state — all in-memory. Sweeps cull expired entries.
  const consentRequests = new Map(); // nonce → { clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, expiresAt }
  const authCodes = new Map();       // code → { clientId, redirectUri, scope, codeChallenge, codeChallengeMethod, expiresAt }
  const tokens = new Map();          // token → { scope, clientId, expiresAt }

  const allowedHostSet = allowedHosts ? new Set(allowedHosts) : null;

  function sweep() {
    const now = Date.now();
    for (const [k, e] of consentRequests) if (e.expiresAt < now) consentRequests.delete(k);
    for (const [c, e] of authCodes) if (e.expiresAt < now) authCodes.delete(c);
    for (const [t, e] of tokens) if (e.expiresAt < now) tokens.delete(t);
  }

  function verifyBearer(token) {
    if (!token) return null;
    sweep();
    const entry = tokens.get(token);
    if (!entry) return null;
    return { scope: entry.scope, clientId: entry.clientId };
  }

  // Validate the Host header against the same allowlist /mcp uses, so an
  // attacker can't request /.well-known/* with a poisoned Host and receive
  // a metadata document pointing at their own endpoints. When no allowlist
  // is configured (allowedHosts === null), we accept any Host — the caller
  // owns the risk in that mode.
  function hostIsAllowed(req) {
    if (!allowedHostSet || allowedHostSet.size === 0) return true;
    const host = req.headers.host;
    return host ? allowedHostSet.has(host) : false;
  }

  function effectiveIssuer(req) {
    if (issuer) return issuer;
    const proto = req.headers['x-forwarded-proto']?.split(',')[0]?.trim() || 'http';
    const host = req.headers.host || 'localhost';
    return `${proto}://${host}`;
  }

  function effectiveResource(req) {
    if (resource) return resource;
    return `${effectiveIssuer(req)}/mcp`;
  }

  // GET /authorize parameter validation. Returns { ok: true, params } or
  // { ok: false, error, errorDescription }.
  function validateAuthzParams(q) {
    const responseType = q.get('response_type');
    if (responseType !== 'code') {
      return { ok: false, error: 'unsupported_response_type', errorDescription: 'only response_type=code is supported' };
    }
    const codeChallenge = q.get('code_challenge') || null;
    const codeChallengeMethod = q.get('code_challenge_method') || null;
    // RFC 7636 §4.3: if challenge is present but method is unsupported (or
    // implicitly defaults to 'plain'), reject at the authorization endpoint
    // with invalid_request — don't burn an auth code at the token endpoint.
    if (codeChallenge) {
      if (!codeChallengeMethod) {
        return { ok: false, error: 'invalid_request', errorDescription: 'code_challenge_method is required when code_challenge is present (only S256 is supported)' };
      }
      if (codeChallengeMethod !== 'S256') {
        return { ok: false, error: 'invalid_request', errorDescription: `unsupported code_challenge_method "${codeChallengeMethod}" — only S256 is supported` };
      }
    } else if (codeChallengeMethod) {
      return { ok: false, error: 'invalid_request', errorDescription: 'code_challenge_method requires code_challenge' };
    }
    return {
      ok: true,
      params: {
        clientId: q.get('client_id') || 'unknown-client',
        redirectUri: q.get('redirect_uri') || '',
        scope: q.get('scope') || DEFAULT_SCOPE,
        state: q.get('state') || null,
        codeChallenge,
        codeChallengeMethod,
      },
    };
  }

  async function handle(req, res, parsedUrl) {
    const p = parsedUrl.pathname;

    // Defence-in-depth Host validation. The OAuth handler runs before the
    // /mcp DNS-rebinding guard, so without this check an attacker could
    // poison the issuer URL in the discovery documents.
    if (
      p === '/.well-known/oauth-protected-resource' ||
      p === '/.well-known/oauth-authorization-server' ||
      p === '/authorize' ||
      p === '/token'
    ) {
      if (!hostIsAllowed(req)) {
        sendJson(res, 400, {
          error: 'invalid_request',
          error_description: `Host header ${req.headers.host} not in allowedHosts`,
        });
        return true;
      }
    }

    if (req.method === 'GET' && p === '/.well-known/oauth-protected-resource') {
      sendJson(res, 200, {
        resource: effectiveResource(req),
        authorization_servers: [effectiveIssuer(req)],
        scopes_supported: SUPPORTED_SCOPES,
        bearer_methods_supported: ['header'],
        resource_documentation: 'https://github.com/openfinance-os/data-sandbox/blob/main/CLAUDE_PERSONAL_BANKING.md',
      });
      return true;
    }

    if (req.method === 'GET' && p === '/.well-known/oauth-authorization-server') {
      const iss = effectiveIssuer(req);
      sendJson(res, 200, {
        issuer: iss,
        authorization_endpoint: `${iss}/authorize`,
        token_endpoint: `${iss}/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: SUPPORTED_SCOPES,
        token_endpoint_auth_methods_supported: ['none'], // public client (PKCE)
      });
      return true;
    }

    if (req.method === 'GET' && p === '/authorize') {
      const q = parsedUrl.searchParams;
      const validation = validateAuthzParams(q);
      // redirect_uri is required for *any* OAuth response — return 400 if
      // it's missing or invalid (we cannot redirect errors without a URI).
      const redirectUri = q.get('redirect_uri') || '';
      if (!redirectUri) {
        sendJson(res, 400, { error: 'invalid_request', error_description: 'redirect_uri is required' });
        return true;
      }
      if (!validation.ok) {
        redirectWithError(res, redirectUri, validation.error, validation.errorDescription, q.get('state'));
        return true;
      }

      // Bind the authorization request server-side. The form only carries a
      // nonce — POST /authorize will never trust client-supplied values for
      // redirect_uri / scope / etc.
      const nonce = newId(24);
      consentRequests.set(nonce, { ...validation.params, expiresAt: Date.now() + CONSENT_NONCE_TTL_MS });

      sendHtml(res, 200, consentScreenHtml({
        nonce,
        clientId: validation.params.clientId,
        redirectUri: validation.params.redirectUri,
        scope: validation.params.scope,
      }));
      return true;
    }

    if (req.method === 'POST' && p === '/authorize') {
      const form = await readFormBody(req);
      const { nonce, decision } = form;
      sweep();
      const consent = nonce ? consentRequests.get(nonce) : null;
      if (!consent) {
        sendJson(res, 400, { error: 'invalid_request', error_description: 'unknown, expired, or missing consent nonce — re-request authorization' });
        return true;
      }
      // Single-use: the nonce is burned no matter the decision.
      consentRequests.delete(nonce);

      const { clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod } = consent;
      const sep = redirectUri.includes('?') ? '&' : '?';

      if (decision !== 'approve') {
        const denyUrl = `${redirectUri}${sep}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ''}`;
        res.statusCode = 302;
        res.setHeader('Location', denyUrl);
        res.end();
        return true;
      }

      const code = newId(24);
      authCodes.set(code, {
        clientId,
        redirectUri,
        scope,
        codeChallenge,
        codeChallengeMethod,
        expiresAt: Date.now() + AUTH_CODE_TTL_MS,
      });
      const back = `${redirectUri}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
      res.statusCode = 302;
      res.setHeader('Location', back);
      res.end();
      return true;
    }

    if (req.method === 'POST' && p === '/token') {
      const form = await readFormBody(req);
      const { grant_type: grantType, code, redirect_uri: redirectUri, code_verifier: codeVerifier } = form;
      if (grantType !== 'authorization_code') {
        sendJson(res, 400, { error: 'unsupported_grant_type' });
        return true;
      }
      sweep();
      const entry = code ? authCodes.get(code) : null;
      if (!entry) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'unknown or expired authorization code' });
        return true;
      }
      // Single-use: burn the code now whatever happens next.
      authCodes.delete(code);

      // The redirect_uri must match what was bound at GET /authorize — the
      // server-side value, not anything the client posts. Belt and braces
      // against tampering between GET and POST.
      if (entry.redirectUri !== redirectUri) {
        sendJson(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        return true;
      }
      if (entry.codeChallenge) {
        if (!codeVerifier) {
          sendJson(res, 400, { error: 'invalid_grant', error_description: 'code_verifier required' });
          return true;
        }
        // codeChallengeMethod is guaranteed to be 'S256' here because GET
        // /authorize already rejected anything else — but assert for safety.
        if (entry.codeChallengeMethod !== 'S256') {
          sendJson(res, 400, { error: 'invalid_grant', error_description: 'unexpected code_challenge_method on stored entry' });
          return true;
        }
        const expect = b64url(sha256(codeVerifier));
        if (expect !== entry.codeChallenge) {
          sendJson(res, 400, { error: 'invalid_grant', error_description: 'code_verifier does not match code_challenge' });
          return true;
        }
      }

      const token = newId(32);
      tokens.set(token, {
        scope: entry.scope,
        clientId: entry.clientId,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      });

      sendJson(res, 200, {
        access_token: token,
        token_type: 'Bearer',
        expires_in: Math.floor(TOKEN_TTL_MS / 1000),
        scope: entry.scope,
      }, {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      });
      return true;
    }

    return false;
  }

  function challengeHeader(req) {
    const iss = effectiveIssuer(req);
    return `Bearer realm="open-finance-sandbox", authorization_uri="${iss}/authorize", resource_metadata="${iss}/.well-known/oauth-protected-resource", scope="${DEFAULT_SCOPE}"`;
  }

  return {
    handle,
    verifyBearer,
    challengeHeader,
    sweep,
    _stores: { consentRequests, authCodes, tokens },
  };
}

export const __test = { b64url, sha256, SUPPORTED_SCOPES };
