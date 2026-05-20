import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { recipeHash, RECIPE_DEFAULTS } from '@openfinance-os/sandbox-fixtures';
import { createServer } from '../src/server.mjs';

async function connect() {
  const server = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'custom-test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server };
}

function textOf(result) {
  return result.content.map((c) => c.text ?? '').join('\n');
}

describe('custom persona builder (build_persona)', () => {
  let client;
  let server;

  beforeEach(async () => {
    ({ client, server } = await connect());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('get_recipe_defaults exposes RECIPE_DEFAULTS verbatim', async () => {
    const r = await client.callTool({ name: 'get_recipe_defaults', arguments: {} });
    const got = JSON.parse(textOf(r));
    expect(got).toEqual(RECIPE_DEFAULTS);
  });

  it('build_persona pins a custom session whose persona id matches recipeHash', async () => {
    const recipe = { income_band: 'affluent', spend_intensity: 'high', distress: 'occasional' };
    const r = await client.callTool({
      name: 'build_persona',
      arguments: { recipe, lfi: 'rich', seed: 42 },
    });
    const text = textOf(r);
    expect(text).toMatch(/custom session set/);
    const merged = { ...RECIPE_DEFAULTS, ...recipe };
    const expectedHash = recipeHash(merged);
    expect(text).toContain(`recipeHash: ${expectedHash}`);
    expect(text).toContain(`custom_${expectedHash}`);

    const session = JSON.parse(
      textOf(await client.callTool({ name: 'get_session', arguments: {} })),
    );
    expect(session.kind).toBe('custom');
    expect(session.persona).toBe(`custom_${expectedHash}`);
    expect(session.lfi).toBe('rich');
    expect(session.seed).toBe(42);
  });

  it('granular get_* tools route through the in-memory custom journey, with watermark', async () => {
    await client.callTool({
      name: 'build_persona',
      arguments: { recipe: { income_band: 'mid' }, seed: 7 },
    });
    const accountsText = textOf(await client.callTool({ name: 'get_accounts', arguments: {} }));
    expect(accountsText).toMatch(/SYNTHETIC — Open Finance Data Sandbox/);
    const env = JSON.parse(accountsText.slice(accountsText.indexOf('{')));
    expect(env.Data.Account.length).toBeGreaterThanOrEqual(1);
    expect(env._persona).toMatch(/^custom_/);
    expect(env._lfi).toBe('median');
    expect(env._seed).toBe(7);

    const balancesText = textOf(await client.callTool({ name: 'get_balances', arguments: {} }));
    expect(balancesText).toMatch(/SYNTHETIC — Open Finance Data Sandbox/);
  });

  it('build_persona is deterministic — same recipe + lfi + seed → byte-identical journey', async () => {
    const args = { recipe: { income_band: 'hnw', fx_activity: true }, lfi: 'median', seed: 99 };

    await client.callTool({ name: 'build_persona', arguments: args });
    const journeyA = textOf(await client.callTool({ name: 'load_journey', arguments: {} }));

    const second = await connect();
    await second.client.callTool({ name: 'build_persona', arguments: args });
    const journeyB = textOf(await second.client.callTool({ name: 'load_journey', arguments: {} }));
    await second.client.close();
    await second.server.close();

    // Both journeys are anchored to manifest.nowAnchor so they are byte-
    // identical end-to-end — _retrievedAt and the watermark substring both
    // match without any wall-clock stripping.
    expect(journeyB).toBe(journeyA);
  });

  it('rejects an unknown pool reference with a validation error', async () => {
    const r = await client.callTool({
      name: 'build_persona',
      arguments: { recipe: { name_pool: 'definitely-not-real-pool' } },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/recipe validation failed/);
  });

  it('get_session echoes the merged recipe for a custom session', async () => {
    const recipe = { income_band: 'affluent', spend_intensity: 'high' };
    await client.callTool({
      name: 'build_persona',
      arguments: { recipe, lfi: 'rich', seed: 42 },
    });
    const session = JSON.parse(
      textOf(await client.callTool({ name: 'get_session', arguments: {} })),
    );
    expect(session.kind).toBe('custom');
    expect(session.recipe).toMatchObject({
      ...RECIPE_DEFAULTS,
      income_band: 'affluent',
      spend_intensity: 'high',
    });
    // The verbose journey is still omitted from the echo.
    expect(session).not.toHaveProperty('journey');
  });

  it('exposes the recipe://schema resource', async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('recipe://schema');
    const r = await client.readResource({ uri: 'recipe://schema' });
    const schema = JSON.parse(r.contents[0].text);
    expect(schema).toEqual(RECIPE_DEFAULTS);
  });

  // ── Pool discovery + recipe codec ──────────────────────────────────────────

  it('list_pool_values with no args returns kinds + totals', async () => {
    const r = await client.callTool({ name: 'list_pool_values', arguments: {} });
    const payload = JSON.parse(textOf(r));
    expect(payload.kinds.names).toContain('expat_indian');
    expect(payload.kinds.employers).toBeInstanceOf(Array);
    expect(payload.totals.names).toBe(payload.kinds.names.length);
    // Every documented kind is present.
    expect(Object.keys(payload.kinds).sort()).toEqual(
      [
        'counterparties',
        'counterparty_banks',
        'employers',
        'ibans',
        'merchants',
        'names',
        'organisations',
      ].sort(),
    );
  });

  it('list_pool_values with a known pool returns a capped sample with count + truncated flag', async () => {
    const r = await client.callTool({
      name: 'list_pool_values',
      arguments: { pool: 'expat_indian', limit: 5 },
    });
    const payload = JSON.parse(textOf(r));
    expect(payload.pool).toBe('expat_indian');
    expect(payload.kind).toBe('names');
    expect(payload.limit).toBe(5);
    expect(payload.sample.length).toBeLessThanOrEqual(5);
    expect(typeof payload.count).toBe('number');
    expect(payload.count).toBeGreaterThan(0);
    if (payload.count > 5) expect(payload.truncated).toBe(true);
    // Names buckets carry sibling array fields (given_names + surnames) — the
    // payload should expose them so the consumer doesn't lose half the data.
    expect(payload.siblings).toBeInstanceOf(Array);
    expect(payload.siblings.length).toBeGreaterThanOrEqual(1);
  });

  it('list_pool_values rejects unknown pool with a "did you mean" suggestion', async () => {
    const r = await client.callTool({
      name: 'list_pool_values',
      arguments: { pool: 'expat_india' },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Did you mean: expat_indian/);
  });

  it('encode_recipe + decode_recipe round-trip a recipe to a stable canonical form', async () => {
    const recipe = { income_band: 'affluent', spend_intensity: 'high' };
    const encR = await client.callTool({
      name: 'encode_recipe',
      arguments: { recipe },
    });
    const enc = JSON.parse(textOf(encR));
    expect(typeof enc.encoded).toBe('string');
    expect(enc.encoded.length).toBeGreaterThan(0);
    expect(enc.recipeHash).toBe(recipeHash({ ...RECIPE_DEFAULTS, ...recipe }));
    expect(enc.canonical.income_band).toBe('affluent');
    expect(enc.canonical.spend_intensity).toBe('high');

    // Encoding twice is deterministic.
    const enc2 = JSON.parse(
      textOf(await client.callTool({ name: 'encode_recipe', arguments: { recipe } })),
    );
    expect(enc2.encoded).toBe(enc.encoded);

    // decode → re-encode is byte-identical (canonical form is stable).
    const decR = await client.callTool({
      name: 'decode_recipe',
      arguments: { encoded: enc.encoded },
    });
    const dec = JSON.parse(textOf(decR));
    expect(dec.valid).toBe(true);
    expect(dec.recipeHash).toBe(enc.recipeHash);
    const reEnc = JSON.parse(
      textOf(await client.callTool({ name: 'encode_recipe', arguments: { recipe: dec.recipe } })),
    );
    expect(reEnc.encoded).toBe(enc.encoded);
  });

  it('decode_recipe of empty string returns RECIPE_DEFAULTS with valid: true', async () => {
    const r = await client.callTool({ name: 'decode_recipe', arguments: { encoded: '' } });
    const payload = JSON.parse(textOf(r));
    expect(payload.valid).toBe(true);
    expect(payload.recipe).toMatchObject(RECIPE_DEFAULTS);
  });

  it('encode → decode → build_persona produces the same recipeHash as build_persona on the original', async () => {
    const recipe = { income_band: 'hnw', fx_activity: true };
    const enc = JSON.parse(
      textOf(await client.callTool({ name: 'encode_recipe', arguments: { recipe } })),
    );
    const dec = JSON.parse(
      textOf(await client.callTool({ name: 'decode_recipe', arguments: { encoded: enc.encoded } })),
    );
    const builtA = textOf(
      await client.callTool({ name: 'build_persona', arguments: { recipe, seed: 11 } }),
    );
    const builtB = textOf(
      await client.callTool({
        name: 'build_persona',
        arguments: { recipe: dec.recipe, seed: 11 },
      }),
    );
    const hashA = builtA.match(/recipeHash: (\w+)/)[1];
    const hashB = builtB.match(/recipeHash: (\w+)/)[1];
    expect(hashB).toBe(hashA);
  });
});
