// Release-candidate preview envelopes (PRD D-01 amendment, 28 November 2026).
//
// A preview corpus carries the same synthetic scenario as the stable v2.1
// corpus, re-shaped to a release candidate's wire contract. The re-shaping is
// driven entirely by the preview's parsed SPEC JSON (EXP-01): each leaf value
// is checked against the field the release candidate declares at that path:
// a number becomes a decimal string where the candidate declares a string,
// and a property the stable spec declares but the candidate drops is removed. Facts the
// candidate newly requires come from the domain generator and must be
// declared fields. No field name is written here; a change in the next
// candidate flows from its YAML through tools/parse-spec.mjs.
//
// Pure and deterministic (EXP-05): the input envelope is never mutated, and
// the same envelope and SPEC always give byte-identical output.

/** Map an emitted endpoint (`/accounts/<id>/transactions`) to its spec template. */
export function templateFor(endpoint, inScopePaths) {
  if (inScopePaths.includes(endpoint)) return endpoint;
  for (const template of inScopePaths) {
    const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    if (pattern.test(endpoint)) return template;
  }
  return null;
}

/** Index one endpoint's parsed fields by dotted path (`Data.Transaction[].X`). */
export function fieldIndex(endpointSpec) {
  return new Map((endpointSpec?.fields ?? []).map((f) => [f.path, f]));
}

/**
 * A finite number as a plain decimal string, never in exponent notation and
 * with at most 10 fractional digits (trailing zeros dropped).
 */
export function decimalString(value) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

function reshape(node, pathParts, ctx) {
  const { fields, stableFields, changes, removed } = ctx;
  if (Array.isArray(node)) {
    const parent = pathParts.slice(0, -1);
    const itemPath = [...parent, `${pathParts[pathParts.length - 1]}[]`];
    return node.map((item) => reshape(item, itemPath, ctx));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('_')) {
        out[key] = value;
        continue;
      }
      const childPath = [...pathParts, key];
      // A property the stable spec declares but the candidate no longer
      // does is dropped (e.g. a field it replaced with a new one). Anything
      // else passes through untouched.
      const p = childPath.join('.');
      if (!fields.has(p) && stableFields.has(p)) {
        removed.add(p);
        continue;
      }
      out[key] = reshape(value, childPath, ctx);
    }
    return out;
  }
  const path = pathParts.join('.');
  const field = fields.get(path);
  if (field?.type === 'string' && typeof node === 'number' && Number.isFinite(node)) {
    changes.add(path);
    return decimalString(node);
  }
  return node;
}

function addAt(envelope, at, values, fields, added) {
  let node = envelope;
  for (const key of at) {
    if (!node[key] || typeof node[key] !== 'object') throw new Error(`preview: no ${at.join('.')}`);
    node[key] = Array.isArray(node[key]) ? node[key] : { ...node[key] };
    node = node[key];
  }
  for (const [key, value] of Object.entries(values)) {
    const path = [...at, key].join('.');
    if (!fields.has(path)) throw new Error(`preview: ${path} is not declared by the candidate`);
    if (node[key] === undefined) {
      node[key] = value;
      added.add(path);
    }
  }
}

/**
 * Re-shape one stable envelope to the preview's wire contract.
 *
 * @param {object} envelope  A v2.1 envelope from envelopesFromBundle.
 * @param {string} endpoint  The emitted endpoint key.
 * @param {object} previewSpec  Parsed preview SPEC JSON (dist/SPEC.preview.*.json).
 * @param {object} options
 * @param {object} options.stableSpec  Parsed stable SPEC JSON for the same domain.
 * @param {object} [options.provenance]  The preview domain's provenance entry.
 * @param {{ at: string[], values: object }[]} [options.additions]  Facts the
 *   candidate newly requires, from the domain generator; each must be a
 *   declared field.
 * @returns {{ envelope: object, changedPaths: string[], removedPaths: string[], addedPaths: string[] }}
 */
export function toPreviewEnvelope(
  envelope,
  endpoint,
  previewSpec,
  { stableSpec, provenance = {}, additions = [] },
) {
  const template = templateFor(endpoint, previewSpec.inScopePaths ?? []);
  if (!template) throw new Error(`preview: no ${previewSpec.baseline} template for ${endpoint}`);
  const ctx = {
    fields: fieldIndex(previewSpec.endpoints[template]),
    stableFields: fieldIndex(stableSpec?.endpoints?.[template]),
    changes: new Set(),
    removed: new Set(),
  };
  if (!stableSpec) throw new Error('preview: stableSpec is required');
  const added = new Set();
  const reshaped = reshape(envelope, [], ctx);
  for (const { at, values } of additions) addAt(reshaped, at, values, ctx.fields, added);
  return {
    envelope: {
      ...reshaped,
      _specVersion: previewSpec.specVersion,
      _specSha: provenance.commit ?? previewSpec.pinSha,
      _retrievedAt: provenance.retrievedAt ?? previewSpec.retrievedAt,
      _baselineStatus: 'preview',
      _preview: `UAE Open Finance ${previewSpec.specVersion} release candidate. Preview only: the stable baseline is v2.1, and release candidates must not be the basis of a production implementation.`,
    },
    changedPaths: [...ctx.changes].sort(),
    removedPaths: [...ctx.removed].sort(),
    addedPaths: [...added].sort(),
  };
}

/**
 * Paths the candidate requires (within a present parent) that the stable
 * spec left optional or conditional, from the two parsed specs.
 */
export function newlyMandatoryPaths(previewEndpointSpec, stableEndpointSpec) {
  const before = new Map((stableEndpointSpec?.fields ?? []).map((f) => [f.path, f.status]));
  return (previewEndpointSpec?.fields ?? [])
    .filter(
      (f) => f.status === 'mandatory' && before.has(f.path) && before.get(f.path) !== 'mandatory',
    )
    .map((f) => f.path);
}

/**
 * Restore newly mandatory fields that an LFI profile redacted, from the
 * same scenario's Rich envelope (which redacts nothing). Mandatory fields
 * are never redacted (invariant 5): under the candidate these fields are
 * mandatory, so a Sparse or Median preview must still carry them. Arrays
 * are matched by position; redaction removes fields, never items.
 *
 * @returns {string[]} the paths restored.
 */
export function restoreMandatory(envelope, richEnvelope, paths) {
  const restored = new Set();
  const visit = (node, twin, parts, prefix) => {
    if (node == null || twin == null || typeof node !== 'object') return;
    const [head, ...rest] = parts;
    if (head.endsWith('[]')) {
      const key = head.slice(0, -2);
      const items = node[key];
      const twins = twin[key];
      if (!Array.isArray(items) || !Array.isArray(twins) || items.length !== twins.length) return;
      items.forEach((item, i) => visit(item, twins[i], rest, `${prefix}${head}.`));
      return;
    }
    if (rest.length === 0) {
      if (node[head] === undefined && twin[head] !== undefined) {
        node[head] = structuredClone(twin[head]);
        restored.add(`${prefix}${head}`);
      }
      return;
    }
    visit(node[head], twin[head], rest, `${prefix}${head}.`);
  };
  for (const path of paths) visit(envelope, richEnvelope, path.split('.'), '');
  return [...restored].sort();
}
