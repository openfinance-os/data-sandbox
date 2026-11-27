import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, LOAD_JOURNEY_INLINE_LIMIT } from '../src/server.mjs';

let client;
let server;

beforeAll(async () => {
  server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'lj-test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

const textOf = (r) => r.content[0].text;

describe('load_journey size guard', () => {
  it('returns an endpoint index, not the multi-megabyte journey, for a banking persona', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const text = textOf(await client.callTool({ name: 'load_journey', arguments: {} }));
    expect(text.length).toBeLessThanOrEqual(LOAD_JOURNEY_INLINE_LIMIT);
    const index = JSON.parse(text);
    expect(index.truncated).toBe(true);
    expect(index.totalChars).toBeGreaterThan(LOAD_JOURNEY_INLINE_LIMIT);
    expect(index.persona).toBe('salaried_expat_mid');
    expect(index._watermark).toMatch(/SYNTHETIC — Open Finance Data Sandbox/);
    const tx = index.endpoints['/accounts/salaried-expat-mid-acct-01/transactions'];
    expect(tx.items).toBeGreaterThan(100);
    expect(tx.chars).toBeGreaterThan(0);
  });

  it('the index lists exactly the endpoints of the full journey', async () => {
    await client.callTool({ name: 'set_session', arguments: { persona: 'salaried_expat_mid' } });
    const index = JSON.parse(
      textOf(await client.callTool({ name: 'load_journey', arguments: {} })),
    );
    const full = JSON.parse(
      textOf(await client.callTool({ name: 'load_journey', arguments: { full: true } })),
    );
    expect(Object.keys(index.endpoints)).toEqual(Object.keys(full.endpoints));
    expect(full.truncated).toBeUndefined();
  });

  it('returns a small insurance journey whole, without truncation', async () => {
    await client.callTool({
      name: 'set_session',
      arguments: { persona: 'motor_comprehensive_mid' },
    });
    const text = textOf(await client.callTool({ name: 'load_journey', arguments: {} }));
    const journey = JSON.parse(text);
    expect(journey.truncated).toBeUndefined();
    expect(Object.keys(journey.endpoints).length).toBeGreaterThan(0);
  });
});

describe('tool annotations', () => {
  it('marks every tool non-destructive and closed-world, and every read tool read-only', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(27);
    for (const tool of tools) {
      expect(tool.annotations, `${tool.name} has no annotations`).toBeDefined();
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
      const changesSession = ['set_session', 'build_persona'].includes(tool.name);
      expect(tool.annotations.readOnlyHint, tool.name).toBe(!changesSession);
    }
  });
});
