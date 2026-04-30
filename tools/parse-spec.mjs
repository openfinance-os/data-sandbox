#!/usr/bin/env node
// Phase 0 spec parser — EXP-01.
// Reads the vendored UAE OF v2.1 OpenAPI YAML(s) and emits flat, frontend-friendly
// SPEC.<domain>.json files keyed by endpoint path. Every field carries its
// mandatory/optional status derived from the spec's `required` arrays.
// Hand-authored field tables are forbidden by tools/lint-no-handauthored-fields.mjs;
// this is the only allowed source of field metadata.
//
// Phase 2.0: domain config moved to tools/domains.config.mjs. Banking output
// remains byte-identical to Phase 1 (regression-protected by tests/replay.test.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { DOMAINS } from './domains.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/** Resolve a $ref like "#/components/schemas/X" to the referenced node. */
function resolveRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  const segments = ref.slice(2).split('/');
  let node = spec;
  for (const seg of segments) {
    if (node == null) return null;
    node = node[seg];
  }
  return node;
}

/**
 * Walk a schema node, recursively flattening into a list of fields.
 * @param {object} spec - Full OpenAPI document (for $ref resolution).
 * @param {object} schema - The schema node to walk.
 * @param {string[]} pathParts - Dotted path stack (e.g. ["Data","Account","Status"]).
 * @param {boolean} parentRequired - Whether the parent marked this field required.
 * @param {Set<string>} seen - Cycle guard (set of $ref strings already on the stack).
 * @param {object[]} out - Accumulator for emitted field records.
 */
function walkSchema(spec, schema, pathParts, parentRequired, seen, out, depth = 0) {
  if (!schema || depth > 32) return;

  // Resolve a top-level $ref by following it once.
  if (schema.$ref) {
    if (seen.has(schema.$ref)) {
      // Cycle — emit a placeholder so the consumer knows there's recursion.
      out.push({
        path: pathParts.join('.'),
        name: pathParts[pathParts.length - 1] ?? '',
        type: 'object',
        status: parentRequired ? 'mandatory' : 'optional',
        recursiveRef: schema.$ref,
      });
      return;
    }
    const resolved = resolveRef(spec, schema.$ref);
    if (!resolved) return;
    const nextSeen = new Set(seen);
    nextSeen.add(schema.$ref);
    walkSchema(spec, resolved, pathParts, parentRequired, nextSeen, out, depth + 1);
    return;
  }

  // Combinators: allOf merges; oneOf/anyOf record alternatives but flatten the first.
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      walkSchema(spec, sub, pathParts, parentRequired, seen, out, depth + 1);
    }
    return;
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const variants = schema.oneOf || schema.anyOf;
    if (variants.length > 0) {
      walkSchema(spec, variants[0], pathParts, parentRequired, seen, out, depth + 1);
    }
    return;
  }

  if (schema.type === 'array' && schema.items) {
    // Emit the array node itself.
    if (pathParts.length > 0) {
      out.push({
        path: pathParts.join('.'),
        name: pathParts[pathParts.length - 1],
        type: 'array',
        status: parentRequired ? 'mandatory' : 'optional',
        description: schema.description ?? undefined,
      });
    }
    // Walk array items as `[]`-suffixed children.
    const itemsPath = [...pathParts.slice(0, -1), `${pathParts[pathParts.length - 1]}[]`];
    walkSchema(spec, schema.items, itemsPath, false, seen, out, depth + 1);
    return;
  }

  if (schema.type === 'object' || schema.properties) {
    // Emit the object node itself if it has a name.
    if (pathParts.length > 0) {
      out.push({
        path: pathParts.join('.'),
        name: pathParts[pathParts.length - 1],
        type: 'object',
        status: parentRequired ? 'mandatory' : 'optional',
        description: schema.description ?? undefined,
      });
    }
    const requiredSet = new Set(schema.required ?? []);
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(props)) {
      const isRequired = requiredSet.has(key);
      walkSchema(
        spec,
        child,
        [...pathParts, key],
        isRequired,
        seen,
        out,
        depth + 1
      );
    }
    return;
  }

  // Leaf scalar.
  if (pathParts.length > 0) {
    out.push({
      path: pathParts.join('.'),
      name: pathParts[pathParts.length - 1],
      type: schema.type ?? 'unknown',
      format: schema.format,
      enum: schema.enum,
      pattern: schema.pattern,
      minLength: schema.minLength,
      maxLength: schema.maxLength,
      status: parentRequired ? 'mandatory' : 'optional',
      description: schema.description ?? undefined,
    });
  }
}

/**
 * For an in-scope path, find the schema for the GET 200 response and walk it.
 */
function extractEndpointFields(spec, pathStr) {
  const pathItem = spec.paths?.[pathStr];
  if (!pathItem || !pathItem.get) return null;
  const response200 = pathItem.get.responses?.['200'];
  if (!response200) return null;

  // Resolve response ref if present.
  let resp = response200;
  if (resp.$ref) {
    resp = resolveRef(spec, resp.$ref);
    if (!resp) return null;
  }

  const schema = resp.content?.['application/json']?.schema;
  if (!schema) return null;

  const fields = [];
  walkSchema(spec, schema, [], true, new Set(), fields);

  return {
    method: 'GET',
    summary: pathItem.get.summary ?? '',
    operationId: pathItem.get.operationId ?? '',
    schemaRef: schema.$ref ?? null,
    fields,
  };
}

/** Strip undefined leaves so the JSON output is compact. */
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

/**
 * Build a `Schema name -> line number` index by scanning the YAML text for
 * top-level component-schema headers indented exactly 4 spaces. Phase 1
 * minimum -- gives the UI line anchors for GitHub spec citations.
 */
function buildSchemaLineIndex(yamlText) {
  const lines = yamlText.split('\n');
  const idx = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^    ([A-Za-z_][A-Za-z0-9_.]*):\s*$/.exec(lines[i]);
    if (m) idx[m[1]] = i + 1;
  }
  return idx;
}

/**
 * Parse one domain's spec YAML and emit its dist/SPEC.<domain>.json.
 * Pure function: reads from the paths in `config`, writes to `config.outPath`.
 * Returns a manifest entry suitable for inclusion in dist/domains.json.
 */
export function parseDomain(config) {
  const specPath = path.join(repoRoot, config.specPath);
  const pinPath = path.join(repoRoot, config.pinPath);
  const retrievedPath = path.join(repoRoot, config.retrievedPath);
  const outPath = path.join(repoRoot, config.outPath);

  if (!fs.existsSync(specPath)) {
    console.error(`[${config.id}] spec not vendored at ${specPath}`);
    process.exit(1);
  }

  const yamlText = fs.readFileSync(specPath, 'utf8');
  const spec = yaml.load(yamlText);
  const schemaLines = buildSchemaLineIndex(yamlText);

  const pinSha = fs.existsSync(pinPath) ? fs.readFileSync(pinPath, 'utf8').trim() : 'unknown';
  const retrievedAt = fs.existsSync(retrievedPath)
    ? fs.readFileSync(retrievedPath, 'utf8').trim()
    : 'unknown';

  // LFI populate-rate band overrides — optional. If the domain config doesn't
  // specify a bandsPath, all fields default to band 'Unknown' (Sparse drops
  // them; Median drops them; Rich keeps them only if non-Unknown — i.e. they
  // get dropped under all profiles, which is the conservative pre-calibration
  // default for a new domain).
  let bandOverrides = {};
  if (config.bandsPath) {
    const bandsPath = path.join(repoRoot, config.bandsPath);
    if (!fs.existsSync(bandsPath)) {
      console.error(`[${config.id}] bands file not found at ${bandsPath}`);
      process.exit(1);
    }
    const bandsDoc = yaml.load(fs.readFileSync(bandsPath, 'utf8')) ?? {};
    bandOverrides = bandsDoc.overrides ?? {};
  }

  const endpoints = {};
  const missing = [];
  for (const p of config.inScopePaths) {
    const e = extractEndpointFields(spec, p);
    if (e) endpoints[p] = e;
    else missing.push(p);
  }

  if (missing.length > 0) {
    console.error(`[${config.id}] endpoints missing from spec:`, missing);
    process.exit(1);
  }

  const out = stripUndefined({
    specVersion: spec.info?.version ?? 'unknown',
    openapiVersion: spec.openapi ?? 'unknown',
    pinSha,
    retrievedAt,
    upstreamRepo: config.upstreamRepo,
    upstreamPath: config.upstreamPath,
    inScopePaths: config.inScopePaths,
    schemaLines,
    bandOverrides,
    endpoints,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  const totalFields = Object.values(endpoints).reduce((n, e) => n + e.fields.length, 0);
  const mandatory = Object.values(endpoints).flatMap((e) =>
    e.fields.filter((f) => f.status === 'mandatory')
  ).length;
  console.log(
    `[${config.id}] parsed ${Object.keys(endpoints).length} endpoints, ${totalFields} fields (${mandatory} mandatory) → ${path.relative(repoRoot, outPath)}`
  );

  return {
    id: config.id,
    label: config.label,
    status: config.status,
    pinSha,
    retrievedAt,
    specVersion: out.specVersion,
    openapiVersion: out.openapiVersion,
    parsedJsonUrl: '/' + path.relative(repoRoot, outPath).split(path.sep).join('/'),
    defaultEndpoint: config.defaultEndpoint,
    endpoints: config.inScopePaths,
  };
}

function main() {
  const manifestEntries = DOMAINS.map(parseDomain);

  const domainsManifestPath = path.join(repoRoot, 'dist/domains.json');
  const manifest = {
    domains: manifestEntries,
  };
  fs.mkdirSync(path.dirname(domainsManifestPath), { recursive: true });
  fs.writeFileSync(domainsManifestPath, JSON.stringify(manifest, null, 2));
  console.log(
    `wrote domains manifest (${manifestEntries.length} domain${manifestEntries.length === 1 ? '' : 's'}) → ${path.relative(repoRoot, domainsManifestPath)}`
  );
}

main();
