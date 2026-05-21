// Shared field-tree renderer — used by the insurance and ATM domain UIs to
// render an arbitrary JSON record as a labelled <dl> tree, attaching a status
// badge / format / enum chip to every leaf whose field name matches a parsed
// spec record. Extracted from src/ui/insurance.js so the ATM domain can
// reuse the same rendering without duplicating the recursion + badge logic.
//
// Field-name matching mirrors the banking renderer's endpointFieldsByName():
// collisions on common names (Amount, Currency) resolve to the first
// registered field, which is acceptable for the read view.

import { statusBadge } from '../shared/spec-helpers.js';

export function renderFieldTree(value, fieldsByName, el) {
  if (value == null) {
    return el('span', { class: 'value-empty', text: '—' });
  }
  if (typeof value !== 'object') {
    return el('span', { class: 'value-leaf', text: String(value) });
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return el('span', { class: 'value-empty', text: '[]' });
    const ol = el('ol', { class: 'field-tree-array' });
    value.forEach((item, i) => {
      const li = el('li', { class: 'field-tree-array-row' });
      li.appendChild(el('span', { class: 'array-index', text: `[${i}]` }));
      li.appendChild(renderFieldTree(item, fieldsByName, el));
      ol.appendChild(li);
    });
    return ol;
  }
  const dl = el('dl', { class: 'field-tree' });
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('_')) continue;
    const meta = fieldsByName.get(k);
    const dt = el('dt', { class: 'field-tree-label' });
    if (meta) {
      const badge = statusBadge(meta.status);
      dt.appendChild(
        el('span', {
          class: `pill ${badge.shape}`,
          attrs: {
            'aria-label': badge.text,
            title: `${badge.text}${meta.format ? ` · format: ${meta.format}` : ''}`,
          },
          text: badge.label,
        }),
      );
    }
    dt.appendChild(el('span', { class: 'field-name', text: k }));
    if (meta?.format) {
      dt.appendChild(el('span', { class: 'field-format', text: meta.format }));
    }
    if (meta?.enum && Array.isArray(meta.enum) && meta.enum.length <= 6) {
      dt.appendChild(el('span', { class: 'field-enum', text: `[${meta.enum.join(' | ')}]` }));
    }
    const dd = el('dd', { class: 'field-tree-value' });
    dd.appendChild(renderFieldTree(v, fieldsByName, el));
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  return dl;
}
