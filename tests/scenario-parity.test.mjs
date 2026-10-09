import { it, expect } from 'vitest';
import fs from 'node:fs';
import { buildBundle } from '../src/generator/index.js';
import { envelopesFromBundle } from '../src/core/envelopes.js';
import { loadAllPersonas, loadAllPools } from '../tools/load-fixtures.mjs';
import { REFERENCE_DATE } from '../src/core/scenario.js';
import { createMockServer } from '../tools/mock-server.mjs';
import { createServer } from '../packages/sandbox-mcp/src/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { encodeRecipe } from '../src/persona-builder/recipe.js';
it('runtime generation matches packaged canonical envelopes across domains', () => {
  const manifest = JSON.parse(fs.readFileSync('packages/sandbox-fixtures/manifest.json', 'utf8'));
  const personas = loadAllPersonas(),
    pools = loadAllPools();
  for (const personaId of [
    'salaried_expat_mid',
    'health_family_comprehensive',
    'retail_multi_banker',
    'atm_directory',
  ]) {
    const persona = personas[personaId],
      seed = persona.default_seed,
      lfi = 'median';
    const bundle = buildBundle({ persona, pools, seed, lfi });
    const envelopes = envelopesFromBundle(bundle, {
      personaId,
      seed,
      lfi,
      referenceDate: REFERENCE_DATE,
      specVersions: manifest.specVersions,
      specProvenance: manifest.specProvenance,
    });
    const fx = manifest.fixtures[`${personaId}|${lfi}|${seed}`];
    for (const [endpoint, rel] of Object.entries(fx.endpoints)) {
      if (endpoint.includes('{')) continue;
      expect(envelopes[endpoint], `${personaId} ${endpoint}`).toEqual(
        JSON.parse(fs.readFileSync(`packages/sandbox-fixtures/${rel}`, 'utf8')),
      );
    }
  }
});
it('custom recipes preserve identical envelopes through the real HTTP and MCP adapters', async () => {
  const http = createMockServer();
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const server = createServer(),
    client = new Client({ name: 'scenario-parity', version: '1' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  try {
    const recipe = { products: ['CurrentAccount', 'CreditCard'], distress: 'frequent' };
    const set = await client.callTool({
      name: 'build_persona',
      arguments: { recipe, lfi: 'rich', seed: 19 },
    });
    expect(set.isError).not.toBe(true);
    const result = await client.callTool({ name: 'get_accounts', arguments: {} });
    const text = result.content.map((c) => c.text ?? '').join('\n');
    const mcp = JSON.parse(text.slice(text.indexOf('{')));
    const res = await fetch(
      `http://127.0.0.1:${http.address().port}/scenarios/custom/accounts?lfi=rich&seed=19&recipe=${encodeRecipe(recipe)}`,
    );
    expect(res.status).toBe(200);
    const { _harness, ...mock } = await res.json();
    expect(_harness.simulated).toBe(true);
    expect(mock).toEqual(mcp);
  } finally {
    await client.close();
    await server.close();
    await new Promise((r) => http.close(r));
  }
});
