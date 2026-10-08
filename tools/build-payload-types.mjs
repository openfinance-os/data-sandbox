// Types are derived from the schemas, including branch-specific properties.
import fs from 'node:fs';
import { createValidators } from './schema-validator.mjs';
import yaml from 'js-yaml';
const safe = (s) => s.replace(/[^A-Za-z0-9_]/g, '_');
function type(s) {
  if (!s) return 'unknown';
  if (s.$ref) return safe(s.$ref.split('/').at(-1));
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (s.oneOf || s.anyOf) return '(' + (s.oneOf ?? s.anyOf).map(type).join(' | ') + ')';
  if (s.allOf) return '(' + s.allOf.map(type).join(' & ') + ')';
  if (s.type === 'array') return `Array<${type(s.items)}>`;
  if (s.properties || s.type === 'object') {
    const props = Object.entries(s.properties ?? {})
      .map(([k, v]) => `${JSON.stringify(k)}${s.required?.includes(k) ? '' : '?'}: ${type(v)};`)
      .join(' ');
    return `{ ${props}${s.additionalProperties === false ? '' : ' [key: string]: unknown;'} }`;
  }
  const value =
    { string: 'string', number: 'number', integer: 'number', boolean: 'boolean' }[s.type] ??
    'unknown';
  return s.nullable ? `${value} | null` : value;
}
for (const d of ['banking', 'insurance', 'atm']) {
  const raw = fs.readFileSync(
    `spec/uae-${d === 'banking' ? 'account-information' : d}-openapi.yaml`,
    'utf8',
  );
  const { spec } = createValidators(raw, { normalization: d === 'insurance' });
  if (d === 'insurance') {
    const literal = yaml.load(raw);
    const patch = Object.entries(spec.components.schemas)
      .filter(([name, s]) => JSON.stringify(s) !== JSON.stringify(literal.components.schemas[name]))
      .map(([name, value]) => ({ op: 'replace', path: `/components/schemas/${name}`, value }));
    fs.writeFileSync(
      'docs/insurance-quote-normalization.patch.json',
      JSON.stringify(patch, null, 2),
    );
    fs.writeFileSync(
      'packages/sandbox-fixtures/schemas/insurance.normalized.json',
      JSON.stringify(spec, null, 2),
    );
  }
  const result =
    '// Generated from reviewed pinned schemas. Insurance quote compositions use the documented hash-scoped normalization.\n' +
    Object.entries(spec.components.schemas)
      .map(([name, schema]) => `export type ${safe(name)} = ${type(schema)};`)
      .join('\n') +
    '\n';
  fs.writeFileSync(`packages/sandbox-fixtures/payloads.${d}.d.ts`, result);
}
