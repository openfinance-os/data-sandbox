// OAS 3.0 -> draft 7 adaptation. Object closure is always preserved.
import crypto from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

export function stripAnnotations(node) {
  if (Array.isArray(node)) return node.map(stripAnnotations);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => [key, stripAnnotations(value)]),
  );
}

export function resolveRef(spec, node) {
  if (!node?.$ref) return node;
  if (!node.$ref.startsWith('#/')) throw new Error(`External schema reference: ${node.$ref}`);
  const resolved = node.$ref
    .slice(2)
    .split('/')
    .reduce((v, k) => v?.[k], spec);
  if (!resolved) throw new Error(`Unresolved schema reference: ${node.$ref}`);
  return resolveRef(spec, resolved);
}

function adapt(node) {
  if (Array.isArray(node)) return node.forEach(adapt);
  if (!node || typeof node !== 'object') return;
  if (node.$ref?.startsWith('#/components/schemas/'))
    node.$ref = node.$ref.replace('#/components/schemas/', '#/definitions/');
  if (node.nullable === true && typeof node.type === 'string') node.type = [node.type, 'null'];
  delete node.nullable;
  for (const suffix of ['Minimum', 'Maximum']) {
    const key = `exclusive${suffix}`,
      bound = suffix.toLowerCase();
    if (node[key] === true && typeof node[bound] === 'number') {
      node[key] = node[bound];
      delete node[bound];
    } else if (node[key] === false) delete node[key];
  }
  Object.values(node).forEach(adapt);
}

export const INSURANCE_NORMALIZATION_HASH =
  '1191bba351eefd29aff91f461ba8bda2d8bb2e554adba4d4f89718d9987a1818';

// Only the reviewed byte-identical source is eligible. Flatten the 22 named
// quote status branches and declare their union on the two closed wrappers.
// Branch-specific required fields, enums and unknown-field rejection remain.
export function normalizeInsuranceQuotes(spec, hash) {
  if (hash !== INSURANCE_NORMALIZATION_HASH)
    throw new Error('Unreviewed insurance schema normalization');
  const schemas = spec.components.schemas;
  for (const prefix of ['AEInsurance', 'AEHealthInsurance']) {
    const wrapper = schemas[`${prefix}QuoteReadResponseProperties`];
    if (!wrapper?.oneOf || wrapper.properties || wrapper.additionalProperties !== false)
      throw new Error('Reviewed quote wrapper has changed');
    const union = {};
    for (const { $ref } of wrapper.oneOf) {
      const branch = resolveRef(spec, { $ref });
      if (branch.allOf) {
        if (
          branch.allOf.length !== 1 ||
          branch.allOf[0].$ref !== `#/components/schemas/${prefix}QuoteProperties`
        )
          throw new Error('Reviewed quote composition has changed');
        const base = resolveRef(spec, branch.allOf[0]);
        if (base.additionalProperties !== false) throw new Error('Quote base closure changed');
        branch.properties = { ...structuredClone(base.properties), ...branch.properties };
        branch.required = [...new Set([...(base.required ?? []), ...(branch.required ?? [])])];
        branch.additionalProperties = false;
        delete branch.allOf;
      }
      for (const key of Object.keys(branch.properties)) union[key] = {};
    }
    wrapper.properties = union;
  }
}

export function createValidators(raw, { normalization = false } = {}) {
  const spec = yaml.load(raw);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  if (normalization) normalizeInsuranceQuotes(spec, hash);
  const definitions = structuredClone(spec.components.schemas);
  adapt(definitions);
  const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addFormat('decimal', { type: 'string', validate: (v) => /^-?\d+(\.\d+)?$/.test(v) });
  const endpoints = [];
  for (const [endpoint, item] of Object.entries(spec.paths)) {
    if (!item.get?.responses?.['200']) continue;
    const response = resolveRef(spec, item.get.responses['200']);
    const schema = response.content?.['application/json']?.schema;
    if (!schema) throw new Error(`GET ${endpoint} has no JSON response schema`);
    const target = structuredClone(schema);
    adapt(target);
    const regex = new RegExp(
      '^' +
        endpoint
          .split('/')
          .map((p) => (p.startsWith('{') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
          .join('/') +
        '$',
    );
    // Compile errors are fatal: no endpoint is silently left unchecked.
    endpoints.push({ endpoint, regex, validate: ajv.compile({ definitions, ...target }) });
  }
  return {
    spec,
    hash,
    normalized: normalization,
    endpoints,
    forSchema(name) {
      if (!definitions[name]) throw new Error(`No named schema: ${name}`);
      return ajv.compile({ definitions, $ref: `#/definitions/${name}` });
    },
    forResponse(endpoint, status) {
      const found = endpoints.find((v) => v.regex.test(endpoint));
      if (!found) throw new Error(`No schema mapping for ${endpoint}`);
      const response = resolveRef(spec, spec.paths[found.endpoint].get.responses[String(status)]);
      const rawSchema = response?.content?.['application/json']?.schema;
      if (!rawSchema) return null;
      const target = structuredClone(rawSchema);
      adapt(target);
      return ajv.compile({ definitions, ...target });
    },
    forEndpoint(endpoint) {
      const found = endpoints.find((v) => v.regex.test(endpoint));
      if (!found) throw new Error(`No schema mapping for ${endpoint}`);
      return found.validate;
    },
  };
}
