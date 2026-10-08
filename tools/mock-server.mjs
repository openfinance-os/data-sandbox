#!/usr/bin/env node
// Portable local HTTP harness. No Service Worker or browser session required.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { loadAllPersonas, loadAllPools } from './load-fixtures.mjs';
import { readSpecProvenance } from './build-shared.mjs';
import { buildBundle } from '../src/generator/index.js';
import { buildRoleBundle } from '../src/generator/multi-lfi.js';
import { envelopesFromBundle } from '../src/core/envelopes.js';
import { REFERENCE_DATE, CORPUS_VERSION } from '../src/core/scenario.js';
import { mockResponse, HARNESS_CASES } from '../src/core/mock.js';
import { expandRecipe } from '../src/persona-builder/expand.js';
import { decodeRecipe, recipeHash } from '../src/persona-builder/recipe.js';
import { createValidators, stripAnnotations } from './schema-validator.mjs';

export function createMockServer() {
  const cache = new Map();
  const personas = loadAllPersonas(),
    pools = loadAllPools(),
    pins = readSpecProvenance();
  const schemas = Object.fromEntries(
    ['banking', 'insurance', 'atm'].map((d) => [
      d,
      createValidators(
        fs.readFileSync(
          `spec/uae-${d === 'banking' ? 'account-information' : d}-openapi.yaml`,
          'utf8',
        ),
        { normalization: d === 'insurance' },
      ),
    ]),
  );
  const send = (res, status, value, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    });
    res.end(JSON.stringify(value));
  };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') return send(res, 204, null);
      if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
      if (url.pathname === '/health')
        return send(res, 200, {
          ok: true,
          corpusVersion: CORPUS_VERSION,
          referenceDate: REFERENCE_DATE,
          specProvenance: pins,
          harnessCases: HARNESS_CASES,
        });
      const match = url.pathname.match(/^\/scenarios\/([^/]+)(\/.*)$/);
      if (!match)
        return send(res, 404, {
          error: 'Use /scenarios/<persona>/<endpoint>?lfi=median&seed=<n>&case=success',
        });
      const [, personaId, endpoint] = match,
        q = url.searchParams;
      let recipe = null;
      const persona =
        personaId === 'custom'
          ? expandRecipe((recipe = decodeRecipe(q.get('recipe'))), pools)
          : personas[personaId];
      if (!persona) return send(res, 404, { error: 'Unknown persona' });
      const harnessCase = q.get('case') ?? 'success',
        role = q.get('role') ?? 'primary';
      const lfi = harnessCase === 'optional-absence' ? 'sparse' : (q.get('lfi') ?? 'median');
      const seed = q.has('seed') ? Number(q.get('seed')) : persona.default_seed;
      if (!Number.isSafeInteger(seed) || !['rich', 'median', 'sparse'].includes(lfi))
        return send(res, 400, { error: 'Invalid seed/profile' });
      const args = { persona, pools, lfi, seed, now: new Date(REFERENCE_DATE) };
      const cacheKey = JSON.stringify({ personaId, role, lfi, seed, recipe });
      let canonical = cache.get(cacheKey);
      if (!canonical) {
        const bundle =
          role === 'primary' ? buildBundle(args) : await buildRoleBundle({ ...args, slot: role });
        if (!bundle) return send(res, 404, { error: 'Unknown role' });
        const ctx = {
          personaId: recipe ? persona.persona_id : personaId,
          lfi,
          seed,
          role,
          recipeHash: recipe ? recipeHash(recipe) : null,
          referenceDate: REFERENCE_DATE,
          specProvenance: pins,
          specVersions: Object.fromEntries(Object.entries(pins).map(([d, p]) => [d, p.version])),
        };
        canonical = envelopesFromBundle(bundle, ctx);
        if (cache.size >= 16) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, canonical);
      }
      const envelope = canonical[endpoint];
      if (!envelope)
        return send(res, 404, {
          error: 'Unknown endpoint; first fetch /accounts or the policy list',
        });
      const query = Object.fromEntries(
        ['since', 'until', 'category', 'currency', 'status', 'cursor']
          .filter((k) => q.has(k))
          .map((k) => [k, q.get(k)]),
      );
      for (const k of ['minAmount', 'maxAmount', 'limit'])
        if (q.has(k)) query[k] = Number(q.get(k));
      query.summary = q.get('summary') === 'true';
      const result = mockResponse(envelope, {
        endpoint,
        scenario: harnessCase,
        now: REFERENCE_DATE,
        query,
      });
      if (result.envelope) {
        const domain =
          endpoint === '/atms'
            ? 'atm'
            : endpoint.includes('-insurance-') || endpoint.startsWith('/insurance-consents')
              ? 'insurance'
              : 'banking';
        const validate = schemas[domain].forEndpoint(endpoint);
        if (!validate(stripAnnotations(result.envelope)))
          throw new Error(`Invalid mock response: ${JSON.stringify(validate.errors)}`);
        if (result.delayMs) await new Promise((r) => setTimeout(r, result.delayMs));
        return send(res, 200, { ...result.envelope, _harness: result.harness });
      }
      const domain =
        endpoint === '/atms'
          ? 'atm'
          : endpoint.includes('-insurance-') || endpoint.startsWith('/insurance-consents')
            ? 'insurance'
            : 'banking';
      const wireError = {
        Errors: [
          {
            Code:
              result.reason === 'missing-permission'
                ? 'AccessToken.InvalidScope'
                : 'Consent.PermanentAccountAccessFailure',
            Message: `Synthetic API Hub harness: ${result.reason}`,
          },
        ],
      };
      const validateError = schemas[domain].forResponse(endpoint, result.status);
      if (validateError) {
        if (!validateError(wireError))
          throw new Error(`Invalid error response: ${JSON.stringify(validateError.errors)}`);
        return send(res, result.status, { ...wireError, _harness: result.harness });
      }
      return send(
        res,
        result.status,
        { _harness: result.harness, error: result.reason },
        result.status === 429 ? { 'Retry-After': '1' } : {},
      );
    } catch (err) {
      send(res, 400, { error: err.message });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMockServer();
  server.listen(Number(process.argv[2] ?? 8788), '127.0.0.1', () =>
    console.log('Synthetic mock: http://127.0.0.1:8788/health'),
  );
}
