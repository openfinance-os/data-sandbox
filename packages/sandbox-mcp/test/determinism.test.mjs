import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { listPersonas } from '@openfinance-os/sandbox-fixtures';
import { createServer } from '../src/server.mjs';

async function connect() {
  const server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'det-test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server };
}

async function loadJourney(client, persona, lfi) {
  await client.callTool({ name: 'set_session', arguments: { persona, lfi } });
  const r = await client.callTool({ name: 'load_journey', arguments: {} });
  return r.content[0].text;
}

describe('sandbox-mcp determinism (EXP-05)', () => {
  it('byte-identical journey across two server processes for every persona × lfi', async () => {
    const personas = listPersonas();
    const lfis = ['rich', 'median', 'sparse'];
    for (const persona of personas) {
      for (const lfi of lfis) {
        const a = await connect();
        const journeyA = await loadJourney(a.client, persona, lfi);
        await a.client.close();
        await a.server.close();

        const b = await connect();
        const journeyB = await loadJourney(b.client, persona, lfi);
        await b.client.close();
        await b.server.close();

        expect(journeyB).toBe(journeyA);
      }
    }
  });

  it('every endpoint envelope in load_journey carries _watermark and _specSha (EXP-19)', async () => {
    const { client, server } = await connect();
    await client.callTool({
      name: 'set_session',
      arguments: { persona: 'salaried_expat_mid' },
    });
    const r = await client.callTool({ name: 'load_journey', arguments: {} });
    const journey = JSON.parse(r.content[0].text);
    expect(Object.keys(journey.endpoints).length).toBeGreaterThan(0);
    for (const [path, env] of Object.entries(journey.endpoints)) {
      expect(env._watermark, `watermark missing on ${path}`).toMatch(
        /SYNTHETIC — Open Finance Data Sandbox/,
      );
      expect(env._specSha, `_specSha missing on ${path}`).toBe(journey.specSha);
    }
    await client.close();
    await server.close();
  });
});
