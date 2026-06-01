// EXP-13 / EXP-14 / EXP-26 Field card. Right-pane detail view that opens
// when the user clicks any field name in a rendered table — shows the
// nine spec-derived facets (status badge, type, format, enum, example,
// conditional rule, "Real LFIs" guidance, PII flag, deep link to the
// pinned-SHA spec) plus a "Report an issue" link with a pre-filled
// GitHub issue body. Pure UI module; takes state, the DOM helper, and
// the row/field-map / pane-collapse helpers as deps.

import {
  bandForFieldName,
  realLfisGuidance,
  specCitationUrl,
  statusBadge,
} from '../shared/spec-helpers.js';
import { conditionalRule, isPii } from '../shared/field-knowledge.js';
import { statusPill } from '../shared/dom.js';
import { track } from '../analytics.js';

const ISSUE_REPO = 'openfinance-os/data-sandbox';

export function createFieldCard(deps) {
  const { state, el, endpointFieldsByName, rowsForActiveEndpoint, setPaneCollapsed } = deps;

  function openFieldCard(name) {
    const fieldsByName = endpointFieldsByName();
    const f = fieldsByName.get(name);
    if (!f) return;
    track('field_click', { status: f.status, endpoint: state.endpoint });
    const empty = document.getElementById('fc-empty');
    const content = document.getElementById('fc-content');
    empty.hidden = true;
    content.hidden = false;

    const rows = rowsForActiveEndpoint();
    const example = rows.find((r) => r[name] != null)?.[name];
    const band = bandForFieldName(name, state.endpoint, state.spec);
    const guidance = realLfisGuidance(f, band);
    const citation = specCitationUrl(state.spec, f);
    // Concrete conditional-rule prose for fields in the curated lookup;
    // falls back to a generic stub for unmapped fields.
    const ruleProse = conditionalRule(name, f.path);
    const conditionalLine =
      f.status === 'conditional'
        ? (ruleProse ?? 'Triggered by a parent-field value — see the spec link for the exact rule.')
        : (ruleProse ?? '—');

    content.replaceChildren();

    const rowsToRender = [
      ['Name', name],
      ['Path', f.path],
      ['Status', null], // rendered specially
      ['Type', f.type],
      ['Format', f.format ?? '—'],
      ['Enum', Array.isArray(f.enum) ? f.enum.join(', ') : '—'],
      ['Example', formatExample(example)],
      ['Conditional', conditionalLine],
      ['Real LFIs', guidance],
      [
        'PII',
        isPii(name)
          ? 'Yes — under PDPL this field requires explicit data-handling controls.'
          : 'No (per the v1 PII allowlist).',
      ],
      ['Spec', null], // rendered specially as a link
    ];
    for (const [k, v] of rowsToRender) {
      const row = el('div', { class: 'fc-row' });
      row.appendChild(el('span', { class: 'k', text: k }));
      if (k === 'Status') {
        const badge = statusBadge(f.status);
        const ve = el('span', { class: 'v' });
        ve.appendChild(statusPill(f.status));
        ve.appendChild(document.createTextNode(badge.text));
        row.appendChild(ve);
      } else if (k === 'Spec') {
        const ve = el('span', { class: 'v' });
        if (citation) {
          ve.appendChild(
            el('a', {
              text: 'View on Nebras GitHub at pinned SHA →',
              attrs: { href: citation, target: '_blank', rel: 'noopener noreferrer' },
            }),
          );
        } else {
          ve.appendChild(document.createTextNode('—'));
        }
        row.appendChild(ve);
      } else {
        row.appendChild(el('span', { class: 'v', text: v }));
      }
      content.appendChild(row);
    }

    // EXP-26: every field card carries a "Report an issue" link with a pre-
    // filled GitHub issue body. Phase 1 destination is the sandbox's GitHub
    // issue tracker; the placeholder repo URL is replaced at Commons publication
    // time per the implementation plan.
    const reportRow = el('div', { class: 'fc-row fc-report' });
    reportRow.appendChild(el('span', { class: 'k', text: 'Feedback' }));
    const reportV = el('span', { class: 'v' });
    reportV.appendChild(
      el('a', {
        class: 'fc-report-link',
        text: 'Report an issue with this field →',
        attrs: { href: buildIssueUrl(name, f), target: '_blank', rel: 'noopener noreferrer' },
      }),
    );
    reportRow.appendChild(reportV);
    content.appendChild(reportRow);

    document.getElementById('field-detail').classList.add('open');
    setPaneCollapsed('field-detail', false);
  }

  function buildIssueUrl(fieldName, field) {
    const title = `[field-card] ${state.endpoint} — ${fieldName} (${field.status})`;
    const body = [
      '## Field',
      `- **Name:** \`${fieldName}\``,
      `- **Path:** \`${field.path}\``,
      `- **Status:** ${field.status}`,
      `- **Type:** ${field.type}${field.format ? ` (${field.format})` : ''}`,
      field.enum?.length ? `- **Enum:** ${field.enum.join(', ')}` : null,
      '',
      '## Context',
      `- **Persona:** \`${state.personaId}\``,
      `- **LFI profile:** \`${state.lfi}\``,
      `- **Seed:** \`${state.seed}\``,
      `- **Endpoint:** \`${state.endpoint}\``,
      `- **Pinned spec SHA:** \`${state.spec?.pinSha ?? 'unknown'}\``,
      '',
      '## Type',
      '- [ ] Spec-interpretation error',
      '- [ ] Populate-rate band disagreement',
      '- [ ] Guidance unclear',
      '- [ ] Generator bug',
      '- [ ] Other',
      '',
      '## What you saw / expected',
      '<!-- describe -->',
      '',
    ]
      .filter((s) => s != null)
      .join('\n');
    const params = new URLSearchParams();
    params.set('title', title);
    params.set('body', body);
    return `https://github.com/${ISSUE_REPO}/issues/new?${params.toString()}`;
  }

  return { openFieldCard };
}

function formatExample(value) {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
