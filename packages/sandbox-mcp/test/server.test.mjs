import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { manifest } from '@openfinance-os/sandbox-fixtures';
import { createServer } from '../src/server.mjs';

const EXPECTED_TOOLS = [
  'list_personas',
  'set_session',
  'get_session',
  'get_party',
  'get_accounts',
  'get_balances',
  'get_transactions',
  'get_standing_orders',
  'get_direct_debits',
  'get_scheduled_payments',
  'get_beneficiaries',
  'get_product',
  'get_statements',
  'load_journey',
];

const WATERMARK_RE = /SYNTHETIC — Open Finance Data Sandbox/;

async function connect() {
  const server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'sandbox-mcp-test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server };
}

function textOf(result) {
  return result.content.map((c) => c.text ?? '').join('\n');
}

describe('sandbox-mcp server', () => {
  let client;
  let server;

  beforeEach(async () => {
    ({ client, server } = await connect());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('exposes the documented 14 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('list_personas returns 12 banking personas (insurance excluded)', async () => {
    const r = await client.callTool({ name: 'list_personas', arguments: {} });
    const payload = JSON.parse(textOf(r));
    expect(payload.count).toBe(12);
    expect(payload.personas.map((p) => p.id)).not.toContain('motor_comprehensive_mid');
  });

  it('set_session pins a persona and get_session echoes it', async () => {
    await client.callTool({
      name: 'set_session',
      arguments: { persona: 'salaried_expat_mid' },
    });
    const r = await client.callTool({ name: 'get_session', arguments: {} });
    const session = JSON.parse(textOf(r));
    expect(session).toMatchObject({
      persona: 'salaried_expat_mid',
      lfi: 'median',
      seed: 4729,
    });
  });

  it('get_session before set_session reports no active session', async () => {
    const r = await client.callTool({ name: 'get_session', arguments: {} });
    expect(textOf(r)).toMatch(/no active session/);
  });

  it('get_accounts returns a v2.1 envelope with watermark and spec pin', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const r = await client.callTool({ name: 'get_accounts', arguments: {} });
    const text = textOf(r);
    expect(text).toMatch(WATERMARK_RE);
    // The JSON envelope is embedded after the header. Parse just the JSON tail.
    const jsonStart = text.indexOf('{');
    const env = JSON.parse(text.slice(jsonStart));
    expect(env.Data.Account).toBeInstanceOf(Array);
    expect(env._specSha).toBe(manifest.specSha);
    expect(env._specVersion).toBe(manifest.specVersion);
    expect(env._watermark).toMatch(WATERMARK_RE);
  });

  it('get_transactions filters by since/until without mutating the generator', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const unfiltered = await client.callTool({ name: 'get_transactions', arguments: {} });
    const filtered = await client.callTool({
      name: 'get_transactions',
      arguments: { since: '2099-01-01' }, // far future → kept = 0
    });
    expect(textOf(filtered)).toMatch(/"kept": 0/);
    expect(textOf(unfiltered)).not.toMatch(/"kept": 0/);
  });

  it('get_balances fans out across every account when accountId is omitted', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const r = await client.callTool({ name: 'get_balances', arguments: {} });
    const text = textOf(r);
    // Each account section is delimited by a `---` separator.
    const sections = text.split('\n\n---\n\n');
    expect(sections.length).toBeGreaterThanOrEqual(2);
    for (const s of sections) {
      expect(s).toMatch(WATERMARK_RE);
    }
  });

  it('rejects an unknown accountId with a helpful error', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const r = await client.callTool({
      name: 'get_balances',
      arguments: { accountId: 'definitely-not-real' },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/unknown accountId/);
  });

  it('exposes spec:// and persona:// resources', async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('spec://uae-account-information-v2.1');
    expect(uris).toContain('persona://salaried_expat_mid');
  });

  it('exposes the documented prompts', async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toContain('pick-a-persona');
    expect(names).toContain('monthly-summary');
  });
});
