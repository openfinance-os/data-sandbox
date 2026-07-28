#!/usr/bin/env node
// Post-deploy smoke test for the hosted MCP endpoint.
//
// Usage: node packages/sandbox-mcp/scripts/smoke.mjs <base-url>
// e.g.   node packages/sandbox-mcp/scripts/smoke.mjs https://data-sandbox.fly.dev
//
// Asserts:
//   1. GET /health → { ok: true }
//   2. POST /mcp initialize + tools/list returns at least the documented
//      tool floor (EXPECTED_TOOL_COUNT)
//
// Exits non-zero on any failure so deploy-mcp.yml can gate on it. Catches
// the case where Fly says "deployed" but the container is crash-looping.
//
// EXPECTED_TOOL_COUNT is a FLOOR, not an exact count — adding a tool to the
// server must not break the deploy gate. The exact list lives in
// EXPECTED_TOOLS in packages/sandbox-mcp/test/server.test.mjs (the source of
// truth for what tools/list should return); bump this floor when that list
// grows.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const EXPECTED_TOOL_COUNT = 51;
const baseUrl = (process.argv[2] || '').replace(/\/+$/, '');
if (!baseUrl) {
  console.error('usage: smoke.mjs <base-url>');
  process.exit(2);
}

function fail(msg) {
  console.error(`smoke FAIL: ${msg}`);
  process.exit(1);
}

const t0 = Date.now();

// 1. /health
let health;
try {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) fail(`/health → HTTP ${res.status}`);
  health = await res.json();
} catch (err) {
  fail(`/health unreachable: ${err?.message ?? err}`);
}
if (!health?.ok) fail(`/health did not return ok:true (got ${JSON.stringify(health)})`);
console.log(`✓ /health ok (sessions=${health.sessions ?? '?'})`);

// 2. MCP initialize + tools/list via the official client transport
const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
const client = new Client({ name: 'sandbox-mcp-smoke', version: '0.0.0' }, { capabilities: {} });
try {
  await client.connect(transport);
} catch (err) {
  fail(`MCP initialize failed: ${err?.message ?? err}`);
}
console.log('✓ MCP initialize');

let tools;
try {
  ({ tools } = await client.listTools());
} catch (err) {
  fail(`tools/list failed: ${err?.message ?? err}`);
}
if (!Array.isArray(tools)) fail(`tools/list returned non-array`);
if (tools.length < EXPECTED_TOOL_COUNT) {
  fail(`tools/list returned ${tools.length} tools, expected at least ${EXPECTED_TOOL_COUNT}`);
}
const sample = ['list_personas', 'set_session', 'build_persona', 'get_accounts', 'get_atms'];
for (const name of sample) {
  if (!tools.find((t) => t.name === name)) fail(`tool "${name}" missing from tools/list`);
}
console.log(`✓ tools/list returned ${tools.length} tools`);

await client.close().catch(() => {});

console.log(`smoke OK (${Date.now() - t0}ms)`);
