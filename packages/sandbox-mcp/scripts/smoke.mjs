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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { manifest, loadFixture } from '@openfinance-os/sandbox-fixtures';
import { createValidators, stripAnnotations } from '@openfinance-os/sandbox-fixtures/validation';

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
if (process.env.EXPECTED_REVISION && health.revision !== process.env.EXPECTED_REVISION)
  fail('Deployed revision differs from the validated release');
if (
  !health.corpusVersion ||
  !health.referenceDate ||
  !health.specProvenance?.atm ||
  !health.toolCatalogueHash
)
  fail('Missing release provenance');
if (
  health.corpusVersion !== manifest.corpusVersion ||
  health.referenceDate !== manifest.nowAnchor ||
  JSON.stringify(health.specProvenance) !== JSON.stringify(manifest.specProvenance)
)
  fail('Health provenance differs from the reviewed corpus');
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
const catalogueHash = createHash('sha256')
  .update(
    tools
      .map((t) => t.name)
      .sort()
      .join('\n'),
  )
  .digest('hex');
if (catalogueHash !== health.toolCatalogueHash) fail('Health tool catalogue identity differs');

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) fail(`${name}: ${JSON.stringify(r.content).slice(0, 160)}`);
  const text = r.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return text;
};
for (const [persona, role, tool, endpoint, domain] of [
  ['salaried_expat_mid', 'primary', 'get_accounts', '/accounts', 'banking'],
  [
    'motor_comprehensive_mid',
    'primary',
    'get_motor_policies',
    '/motor-insurance-policies',
    'insurance',
  ],
  ['sme_rak_trading_emirati', 'secondary', 'get_accounts', '/accounts', 'banking'],
  ['atm_directory', 'primary', 'get_atms', '/atms', 'atm'],
]) {
  await call('set_session', { persona, lfi_role: role });
  const value = await call(tool, tool === 'get_atms' ? { limit: 500 } : {});
  if (!value.includes('SYNTHETIC') || !value.includes('Data'))
    fail(`No real synthetic response from ${tool}`);
  const payload = JSON.parse(value.slice(value.indexOf('{')));
  const expected = loadFixture({ persona, lfi: 'median', lfi_role: role, endpoint });
  const digest = (v) =>
    createHash('sha256')
      .update(JSON.stringify(stripAnnotations(v)))
      .digest('hex');
  if (digest(payload) !== digest(expected))
    fail(`Released fixture hash differs for ${persona} ${endpoint}`);
  const raw = readFileSync(
    new URL(
      import.meta.resolve(
        `@openfinance-os/sandbox-fixtures/schemas/uae-${domain === 'banking' ? 'account-information' : domain}-openapi.yaml`,
      ),
    ),
    'utf8',
  );
  const validate = createValidators(raw, { normalization: domain === 'insurance' }).forEndpoint(
    endpoint,
  );
  if (!validate(stripAnnotations(payload)))
    fail(`Invalid live wire payload: ${JSON.stringify(validate.errors)}`);
  console.log(`✓ ${persona} ${role} ${tool}`);
}

await client.close().catch(() => {});

console.log(`smoke OK (${Date.now() - t0}ms)`);
