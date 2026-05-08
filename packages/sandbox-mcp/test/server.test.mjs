import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { manifest } from '@openfinance-os/sandbox-fixtures';
import { createServer } from '../src/server.mjs';

const EXPECTED_TOOLS = [
  'list_personas',
  'set_session',
  'get_session',
  'get_recipe_defaults',
  'build_persona',
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

  it('exposes the documented tools', async () => {
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

  it('get_transactions rejects malformed since/until before touching data', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const r = await client.callTool({
      name: 'get_transactions',
      arguments: { since: 'not-a-date' },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/must be ISO8601/);
  });

  // The tool-result size cap on the consuming MCP client (Claude.ai / Claude Code)
  // is the load-bearing constraint behind the limit + summary affordances. A
  // full transaction list for hnw_multicurrency or corporate_treasury_listed
  // can run 700+ KB pretty-printed and trip the cap; once tripped, downstream
  // tool calls in the same turn fail. These tests pin the wire-level shape we
  // need so an agent can: (a) fall back to summary mode for aggregate questions,
  // (b) page backwards through truncated results.
  function parseEnvelope(text) {
    const jsonStart = text.indexOf('{');
    return JSON.parse(text.slice(jsonStart));
  }

  it('get_transactions caps output to 50 by default and flags truncation for high-volume personas', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'hnw_multicurrency' } });
    const r = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: 'hnw-multicurrency-acct-01' },
    });
    const env = parseEnvelope(textOf(r));
    expect(env._filter.truncated).toBe(true);
    expect(env._filter.limit).toBe(50);
    expect(env._filter.kept).toBe(50);
    expect(env._filter.total).toBeGreaterThan(50);
    expect(env.Data.Transaction).toHaveLength(50);
    expect(env._filter._paginationHint).toMatch(/until=/);
  });

  it('get_transactions with explicit limit truncates to that count and slices the most recent items', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const all = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: 'salaried-expat-mid-acct-01', limit: 500 },
    });
    const allEnv = parseEnvelope(textOf(all));
    const total = allEnv.Data.Transaction.length;

    const ten = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: 'salaried-expat-mid-acct-01', limit: 10 },
    });
    const tenEnv = parseEnvelope(textOf(ten));
    expect(tenEnv.Data.Transaction).toHaveLength(10);
    // ascending order preserved, and the kept slice is the tail (most recent).
    const tailIds = allEnv.Data.Transaction.slice(-10).map((t) => t.TransactionId);
    expect(tenEnv.Data.Transaction.map((t) => t.TransactionId)).toEqual(tailIds);
    expect(tenEnv._filter.truncated).toBe(true);
    expect(tenEnv._filter.total).toBe(total);
  });

  it('get_transactions with summary=true returns aggregates as envelope-root metadata, not inside Data', async () => {
    // Spec conformance: AEReadTransaction.Data has `additionalProperties: false`
    // and `required: [AccountId, Transaction]`. Aggregates therefore live at
    // the envelope root with an underscore prefix (the existing convention
    // for `_filter`, `_watermark`, `_specSha`, …), and `Data.Transaction` is
    // present as an empty array so the required field is satisfied.
    await client.callTool({ name: 'set_session', arguments: { persona: 'hnw_multicurrency' } });
    const r = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: 'hnw-multicurrency-acct-01', summary: true },
    });
    const env = parseEnvelope(textOf(r));
    expect(env.Data.Transaction).toEqual([]);
    expect(env.Data.Summary).toBeUndefined();
    expect(env._summary).toBeDefined();
    expect(env._summary.count).toBeGreaterThan(0);
    expect(env._summary.byDirection.Credit).toMatchObject({
      count: expect.any(Number),
      total: expect.any(Number),
    });
    expect(env._summary.byDirection.Debit).toMatchObject({
      count: expect.any(Number),
      total: expect.any(Number),
    });
    expect(Array.isArray(env._summary.byMonth)).toBe(true);
    expect(env._summary.byMonth.length).toBeGreaterThan(0);
    expect(Array.isArray(env._summary.topCategories)).toBe(true);
    expect(env._filter.mode).toBe('summary');
    // Summary payload should be small enough to never trip a tool-result cap,
    // even for the highest-volume curated persona.
    expect(textOf(r).length).toBeLessThan(20_000);
  });

  it('get_transactions response stays well under typical tool-result caps with default settings', async () => {
    // Worst-case real persona (HNW, multi-account fan-out). With the default
    // limit this needs to comfortably fit in a single tool result.
    await client.callTool({ name: 'set_session', arguments: { persona: 'hnw_multicurrency' } });
    const r = await client.callTool({ name: 'get_transactions', arguments: {} });
    expect(textOf(r).length).toBeLessThan(200_000);
  });

  it('get_transactions with limit=0 returns no rows but still reports total', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const r = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: 'salaried-expat-mid-acct-01', limit: 0 },
    });
    const env = parseEnvelope(textOf(r));
    expect(env.Data.Transaction).toEqual([]);
    expect(env._filter.kept).toBe(0);
    expect(env._filter.truncated).toBe(true);
    expect(env._filter.total).toBeGreaterThan(0);
  });

  it('get_transactions rejects limit above the hard cap', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const r = await client.callTool({
      name: 'get_transactions',
      arguments: { limit: 10_000 },
    });
    expect(r.isError).toBe(true);
  });

  it('get_transactions response stays spec-shaped (Data.AccountId + Data.Transaction array, Links, Meta) in every mode', async () => {
    // EXP-10: every payload must validate against the v2.1 OpenAPI schema.
    // Stripping underscore-prefixed metadata (the codebase convention for
    // _watermark, _filter, _summary, …) must leave a conformant
    // AEReadTransaction envelope — `Data.AccountId` + `Data.Transaction`
    // (array) plus `Links` and `Meta`, with no extra properties under `Data`.
    function strip(node) {
      if (Array.isArray(node)) return node.map(strip);
      if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
          if (k.startsWith('_')) continue;
          out[k] = strip(v);
        }
        return out;
      }
      return node;
    }
    function assertShape(env, label) {
      const stripped = strip(env);
      expect(stripped, label).toHaveProperty('Data');
      expect(stripped, label).toHaveProperty('Links');
      expect(stripped, label).toHaveProperty('Meta');
      expect(stripped.Data, label).toHaveProperty('AccountId');
      expect(stripped.Data, label).toHaveProperty('Transaction');
      expect(Array.isArray(stripped.Data.Transaction), label).toBe(true);
      // No extension fields slipped into Data — they should all sit at the
      // envelope root with an underscore prefix.
      expect(Object.keys(stripped.Data).sort(), label).toEqual(['AccountId', 'Transaction']);
    }

    await client.callTool({ name: 'set_session', arguments: { persona: 'hnw_multicurrency' } });
    const acct = 'hnw-multicurrency-acct-01';

    const truncated = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: acct },
    });
    assertShape(parseEnvelope(textOf(truncated)), 'default-limit-truncated');

    const summary = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: acct, summary: true },
    });
    assertShape(parseEnvelope(textOf(summary)), 'summary-mode');

    const explicit = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: acct, limit: 5 },
    });
    assertShape(parseEnvelope(textOf(explicit)), 'explicit-small-limit');
  });
});
