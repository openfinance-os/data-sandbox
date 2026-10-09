// Spec-wide Find box (Cmd+K). Searches across personas, endpoints,
// field names/paths, and enum values. Pure UI module — takes its
// state and helpers as deps so it can live outside src/app.js
// without a circular import.

import { trapFocus } from '../shared/dom.js';
import { t } from '../shared/i18n.js';

// Find-box corpus tags, in render order, paired with their catalog keys.
const CORPUS_TAGS = [
  'find.corpus.fieldNames',
  'find.corpus.fieldPaths',
  'find.corpus.enumValues',
  'find.corpus.personas',
  'find.corpus.stressCoverage',
];

export function createFindBox(deps) {
  const {
    state,
    el,
    humanArchetype,
    rebuildAndRender,
    clearTxState,
    renderNavigator,
    renderPayload,
    openFieldCard,
  } = deps;

  // Active focus-trap teardown for the open overlay (WCAG 2.4.3 / 2.1.2).
  let releaseTrap = null;

  function closeFind() {
    releaseTrap?.();
    releaseTrap = null;
    document.getElementById('find-overlay')?.remove();
  }

  // Build a flat searchable index across personas + spec endpoints + fields.
  function runFind(q) {
    const out = [];
    const lower = q.toLowerCase();
    // Personas — name + archetype + narrative + stress_coverage. Search is
    // scoped to the active domain so insurance personas don't bleed into a
    // banking session.
    for (const [pid, p] of Object.entries(state.activePersonas ?? state.data.personas ?? {})) {
      const hay =
        `${p.name} ${p.archetype} ${p.narrative ?? ''} ${(p.stress_coverage ?? []).join(' ')}`.toLowerCase();
      if (hay.includes(lower)) {
        out.push({
          kind: 'persona',
          id: pid,
          title: p.name,
          meta: `Persona · ${humanArchetype(p.archetype)}${(p.stress_coverage ?? []).length > 0 ? ' · ' + p.stress_coverage.join(', ') : ''}`,
        });
      }
    }
    // Endpoints — match on path
    for (const path of Object.keys(state.spec.endpoints ?? {})) {
      if (path.toLowerCase().includes(lower)) {
        out.push({ kind: 'endpoint', endpoint: path, title: path, meta: 'Endpoint' });
      }
    }
    // Fields — name / path / enum
    for (const [path, e] of Object.entries(state.spec.endpoints ?? {})) {
      for (const f of e.fields ?? []) {
        if (f.type === 'object' || f.type === 'array') continue;
        const enumStr = Array.isArray(f.enum) ? f.enum.join(' ') : '';
        const hay = `${f.name} ${f.path} ${enumStr}`.toLowerCase();
        if (hay.includes(lower)) {
          const enumHit =
            enumStr.toLowerCase().includes(lower) && !f.name.toLowerCase().includes(lower);
          out.push({
            kind: 'field',
            endpoint: path,
            fieldName: f.name,
            title: `${f.name}  ·  ${path}`,
            meta: `${f.status}${f.format ? ' · ' + f.format : ''}${
              enumHit
                ? ` · enum match: ${f.enum
                    .filter((v) => String(v).toLowerCase().includes(lower))
                    .slice(0, 3)
                    .join(', ')}`
                : ''
            }`,
          });
          if (out.length > 200) return out;
        }
      }
    }
    return out;
  }

  function applyFindResult(r) {
    if (r.kind === 'persona') {
      state.personaId = r.id;
      rebuildAndRender();
      return;
    }
    if (r.kind === 'endpoint' || r.kind === 'field') {
      state.endpoint = r.endpoint;
      if (r.endpoint !== '/accounts' && r.endpoint !== '/parties') {
        state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
      } else {
        state.selectedAccountId = null;
      }
      clearTxState();
      renderNavigator();
      renderPayload();
      if (r.kind === 'field') {
        // Defer so the table is in the DOM before we open the field card.
        setTimeout(() => openFieldCard(r.fieldName), 0);
      }
    }
  }

  function openFind() {
    if (document.getElementById('find-overlay')) return;
    const lang = state.lang;
    const overlay = el('div', {
      class: 'find-overlay',
      attrs: {
        id: 'find-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('find.dialogLabel', lang),
      },
    });
    const card = el('div', { class: 'find-card' });
    const input = el('input', {
      class: 'find-input',
      attrs: {
        type: 'search',
        placeholder: t('find.placeholder', lang),
        'aria-label': t('find.inputLabel', lang),
        autocomplete: 'off',
      },
    });
    const corpus = el('div', { class: 'find-corpus' });
    corpus.appendChild(el('span', { class: 'find-corpus-label', text: t('find.searches', lang) }));
    for (const tagKey of CORPUS_TAGS) {
      corpus.appendChild(el('span', { class: 'find-corpus-tag', text: t(tagKey, lang) }));
    }
    const ul = el('ul', { class: 'find-results', attrs: { role: 'listbox' } });
    const hint = el('div', { class: 'find-hint' });
    const left = el('span', { text: t('find.clickToJump', lang) });
    const right = el('span');
    right.appendChild(document.createTextNode(t('find.openWith', lang)));
    right.appendChild(el('kbd', { text: '⌘K' }));
    right.appendChild(document.createTextNode(t('find.closeWith', lang)));
    right.appendChild(el('kbd', { text: 'Esc' }));
    hint.appendChild(left);
    hint.appendChild(right);
    card.appendChild(input);
    card.appendChild(corpus);
    card.appendChild(ul);
    card.appendChild(hint);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeFind();
    });

    let activeIdx = 0;
    let lastResults = [];
    const refresh = () => {
      const q = input.value.trim().toLowerCase();
      lastResults = q.length === 0 ? [] : runFind(q).slice(0, 50);
      renderResults();
    };
    const renderResults = () => {
      ul.replaceChildren();
      if (lastResults.length === 0) {
        const empty = el('li', {
          class: 'find-empty',
          text:
            input.value.trim().length === 0 ? t('find.tryHint', lang) : t('find.noMatches', lang),
        });
        ul.appendChild(empty);
        return;
      }
      lastResults.forEach((r, i) => {
        const li = el('li', {
          class: `find-result${i === activeIdx ? ' is-active' : ''}`,
          attrs: { role: 'option', 'aria-selected': i === activeIdx ? 'true' : 'false' },
        });
        li.appendChild(el('div', { class: 'find-result-title', text: r.title }));
        li.appendChild(el('div', { class: 'find-result-meta', text: r.meta }));
        li.addEventListener('click', () => {
          applyFindResult(r);
          closeFind();
        });
        ul.appendChild(li);
      });
    };
    input.addEventListener('input', () => {
      activeIdx = 0;
      refresh();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, Math.max(lastResults.length - 1, 0));
        renderResults();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        renderResults();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = lastResults[activeIdx];
        if (r) {
          applyFindResult(r);
          closeFind();
        }
      }
    });
    document.body.appendChild(overlay);
    releaseTrap = trapFocus(overlay);
    setTimeout(() => input.focus(), 0);
    refresh();
  }

  return { openFind, closeFind };
}
