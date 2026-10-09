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
import { t } from '../shared/i18n.js';
import { track } from '../analytics.js';

const ISSUE_REPO = 'openfinance-os/data-sandbox';

// EXP-13 / D-10 — status value → catalog key. The lowercase `status` field
// still drives all logic; only the human-readable value rendered next to the
// pill is localised.
const STATUS_TEXT_KEY = {
  mandatory: 'status.mandatory',
  optional: 'status.optional',
  conditional: 'status.conditional',
};

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

    // D-10 tranche 2 — row labels come from the i18n catalog (the first
    // tuple entry is the catalog key; 'fieldCard.status' / 'fieldCard.spec'
    // rows render specially). Values stay English pending the tranche-3
    // field-knowledge translation pass.
    const rowsToRender = [
      ['fieldCard.name', name],
      ['fieldCard.path', f.path],
      ['fieldCard.status', null], // rendered specially
      ['fieldCard.type', f.type],
      ['fieldCard.format', f.format ?? '—'],
      ['fieldCard.enum', Array.isArray(f.enum) ? f.enum.join(', ') : '—'],
      ['fieldCard.example', formatExample(example)],
      ['fieldCard.conditional', conditionalLine],
      ['fieldCard.realLfis', guidance],
      [
        'fieldCard.pii',
        isPii(name)
          ? 'Yes — under PDPL this field requires explicit data-handling controls.'
          : 'No (per the v1 PII allowlist).',
      ],
      ['fieldCard.spec', null], // rendered specially as a link
    ];
    for (const [key, v] of rowsToRender) {
      const row = el('div', { class: 'fc-row' });
      row.appendChild(el('span', { class: 'k', text: t(key, state.lang) }));
      if (key === 'fieldCard.status') {
        const badge = statusBadge(f.status);
        const ve = el('span', { class: 'v' });
        ve.appendChild(statusPill(f.status));
        const statusKey = STATUS_TEXT_KEY[f.status];
        ve.appendChild(document.createTextNode(statusKey ? t(statusKey, state.lang) : badge.text));
        row.appendChild(ve);
      } else if (key === 'fieldCard.spec') {
        const ve = el('span', { class: 'v' });
        if (citation) {
          ve.appendChild(
            el('a', {
              text: t('fieldCard.specLink', state.lang),
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
    reportRow.appendChild(el('span', { class: 'k', text: t('fieldCard.feedback', state.lang) }));
    const reportV = el('span', { class: 'v' });
    reportV.appendChild(
      el('a', {
        class: 'fc-report-link',
        text: t('fieldCard.reportLink', state.lang),
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
