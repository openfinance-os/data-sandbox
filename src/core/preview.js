// Release-candidate preview envelopes (PRD D-01 amendment, 28 November 2026).
//
// A preview corpus carries the same synthetic scenario as the stable v2.1
// corpus, re-shaped to a release candidate's wire contract. The re-shaping is
// driven entirely by the preview's parsed SPEC JSON (EXP-01): each leaf value
// is checked against the field the release candidate declares at that path,
// and a number becomes a decimal string where the candidate declares a
// string. No field name is written here; a change in the next candidate
// flows from its YAML through tools/parse-spec.mjs.
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

function reshape(node, pathParts, fields, changes) {
  if (Array.isArray(node)) {
    const parent = pathParts.slice(0, -1);
    const itemPath = [...parent, `${pathParts[pathParts.length - 1]}[]`];
    return node.map((item) => reshape(item, itemPath, fields, changes));
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = key.startsWith('_') ? value : reshape(value, [...pathParts, key], fields, changes);
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

/**
 * Re-shape one stable envelope to the preview's wire contract.
 *
 * @param {object} envelope  A v2.1 envelope from envelopesFromBundle.
 * @param {string} endpoint  The emitted endpoint key.
 * @param {object} previewSpec  Parsed preview SPEC JSON (dist/SPEC.preview.*.json).
 * @param {object} [provenance]  The preview domain's provenance entry.
 * @returns {{ envelope: object, changedPaths: string[] }}
 */
export function toPreviewEnvelope(envelope, endpoint, previewSpec, provenance = {}) {
  const template = templateFor(endpoint, previewSpec.inScopePaths ?? []);
  if (!template) throw new Error(`preview: no ${previewSpec.baseline} template for ${endpoint}`);
  const fields = fieldIndex(previewSpec.endpoints[template]);
  const changes = new Set();
  const reshaped = reshape(envelope, [], fields, changes);
  return {
    envelope: {
      ...reshaped,
      _specVersion: previewSpec.specVersion,
      _specSha: provenance.commit ?? previewSpec.pinSha,
      _retrievedAt: provenance.retrievedAt ?? previewSpec.retrievedAt,
      _baselineStatus: 'preview',
      _preview: `UAE Open Finance ${previewSpec.specVersion} release candidate. Preview only: the stable baseline is v2.1, and release candidates must not be the basis of a production implementation.`,
    },
    changedPaths: [...changes].sort(),
  };
}
