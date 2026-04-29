// Phase 0 sandbox UI — wires the three-pane layout to the deterministic
// generator and the parsed SPEC.json. The browser fetches both as static
// JSON (no build chain). State lives in a single object updated by select-
// box and persona-card events; every change re-renders the active panes.

import { buildBundle } from './generator/index.js';
import {
  coverage,
  coverageByBand,
  coverageForEndpoint,
  leafFields,
  statusBadge,
  specCitationUrl,
  realLfisGuidance,
  bandForFieldName,
} from './shared/spec-helpers.js';
import { decodeFromUrl, encodeEmbed, encodePermalink } from './url.js';
import {
  envelopesFromBundle,
  csvForResource,
  downloadJson,
  downloadCsv,
  downloadTarball,
} from './ui/export.js';
import { conditionalRule, isPii, whyEmpty } from './shared/field-knowledge.js';
import { computeUnderwriting, UNDERWRITING_FOOTNOTE } from './shared/underwriting.js';

// All 12 v1 endpoints (Appendix C). Three are bundle-level (no AccountId
// scope): /accounts and /parties. The others are per-account.
// EXP-18 Underwriting Scenario panel sits as a virtual bundle-level entry —
// not a wire endpoint, just a derived view over the live bundle. The
// Persona Overview is a second virtual bundle-level entry — the natural
// landing for "who is this person?" before drilling into wire endpoints.
const UNDERWRITING_PSEUDO = '/(underwriting)';
const OVERVIEW_PSEUDO = '/(overview)';
const ENDPOINTS = [
  { path: OVERVIEW_PSEUDO, scope: 'bundle' },
  { path: '/accounts', scope: 'bundle' },
  { path: '/accounts/{AccountId}', scope: 'account' },
  { path: '/accounts/{AccountId}/balances', scope: 'account' },
  { path: '/accounts/{AccountId}/transactions', scope: 'account' },
  { path: '/accounts/{AccountId}/standing-orders', scope: 'account' },
  { path: '/accounts/{AccountId}/direct-debits', scope: 'account' },
  { path: '/accounts/{AccountId}/beneficiaries', scope: 'account' },
  { path: '/accounts/{AccountId}/scheduled-payments', scope: 'account' },
  { path: '/accounts/{AccountId}/product', scope: 'account' },
  { path: '/accounts/{AccountId}/parties', scope: 'account' },
  { path: '/parties', scope: 'bundle' },
  { path: '/accounts/{AccountId}/statements', scope: 'account' },
  { path: UNDERWRITING_PSEUDO, scope: 'bundle' },
];
const ACCOUNT_SCOPED_PATHS = ENDPOINTS.filter((e) => e.scope === 'account').map((e) => e.path);
const BUNDLE_SCOPED_PATHS = ENDPOINTS.filter((e) => e.scope === 'bundle').map((e) => e.path);

const state = {
  spec: null,
  data: null,
  personaId: null,
  lfi: 'median',
  seed: 4729,
  endpoint: '/accounts',
  view: 'rendered',                     // 'rendered' | 'raw'  (orthogonal to compareMode)
  bundle: null,
  selectedAccountId: null,
  // EXP-11: filter / sort state for the /transactions view.
  txFilter: emptyTxFilter(),
  txSort: { column: null, dir: 'asc' },
  // EXP-12: bidirectional links — `txHighlight` is a set of TransactionId
  // values to render with the highlight class; `crossLink` is the banner
  // shown above a filtered transactions view that lets the user jump back.
  txHighlight: new Set(),
  crossLink: null,
  // Date-humanise toggle on /transactions — shows "27 Apr 2025 · 11:00 GST"
  // instead of "2025-04-27T07:00:00Z" when on. Resets on persona/lfi change.
  humanDates: false,
  // Active stress-coverage filter on the persona library — null when no
  // filter; otherwise a single term-slug from Appendix F vocabulary.
  stressFilter: null,
  // Active JTBD preset filter on the persona library — null or a key from
  // JTBD_PRESETS. Composes with stressFilter (both must match if both are
  // set, but UI activates only one at a time).
  jtbdFilter: null,
  // EXP-16 Compare-LFIs — when state.compareMode is true, renderPayload
  // builds two bundles (state.lfi vs state.compareWith) and renders them
  // side-by-side with diff highlighting. Decoupled from state.view so
  // representation (rendered/raw) and cardinality (one/two LFIs) stay
  // orthogonal.
  compareMode: false,
  compareWith: 'sparse',
  // Inline-expand the field metadata under each column header in the
  // rendered view. EXP-14 hover/click is the on-demand path; this is the
  // "I want to read everything at once" path for first-time visits.
  expandFields: false,
  // Coachmark cascade state — first-load orientation for cold visitors.
  // null = inactive, 0..N = active step. Per EXP-22 we cannot persist
  // dismissal across reloads, so coachmarks fire only when the URL has
  // no query params (cold landing) and never re-fire once dismissed in
  // this tab session.
  coachStep: null,
  coachDismissed: false,
};

function isDateField(name) {
  return /(?:Date|DateTime)$/.test(name);
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
  timeZone: 'Asia/Dubai', timeZoneName: 'short', hour12: false,
});

function humaniseDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return DATE_FORMATTER.format(d);
}

function emptyTxFilter() {
  return {
    search: '',
    type: '',
    subType: '',
    debitCredit: '',
    dateFrom: '',
    dateTo: '',
    amountFrom: '',
    amountTo: '',
    mcc: '',
  };
}

async function init() {
  const [specRes, dataRes] = await Promise.all([
    fetch('../dist/SPEC.json'),
    fetch('../dist/data.json'),
  ]);
  state.spec = await specRes.json();
  state.data = await dataRes.json();

  // Cold landing = URL with no query params (visitor arriving from the
  // Commons feed for the first time). Drives the first-load coachmark
  // cascade since EXP-22 forbids storage-based "first-visit" detection.
  const isColdLanding = window.location.search === '';

  const url = decodeFromUrl(window.location.href);
  state.personaId = url.personaId && state.data.personas[url.personaId]
    ? url.personaId
    : Object.keys(state.data.personas)[0];
  state.lfi = url.lfi;
  state.seed = url.seed;

  document.getElementById('footer-sha').textContent = (state.spec.pinSha || 'unknown').slice(0, 7);
  // specVersion already starts with "v" — don't double-prefix.
  const v = String(state.spec.specVersion || '');
  const versionLabel = v.startsWith('v') ? v : `v${v}`;
  const pin = document.getElementById('version-pin');
  pin.textContent = `${versionLabel} @ ${(state.spec.pinSha || '').slice(0, 7)}`;
  pin.title = `Pinned spec SHA ${state.spec.pinSha}\nRetrieved ${state.spec.retrievedAt}\nUpstream: ${state.spec.upstreamRepo}/${state.spec.upstreamPath}`;

  buildJtbdRail();
  buildPersonaList();
  syncControls();
  attachEventHandlers();
  rebuildAndRender();

  if (isColdLanding) {
    // Defer one frame so the topbar / persona list / payload are in the
    // DOM before we measure target rectangles.
    setTimeout(() => startCoachmarks(), 60);
  }
}

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v == null) continue;
      node.setAttribute(k, String(v));
    }
  }
  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = String(v);
  }
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

// JTBD presets — map a job-to-be-done bucket (per PRD §3) to the
// stress_coverage terms a persona must include to qualify. One-tap
// filters for Aisha (AML), Faisal (affordability/DBR), Layla (FX),
// Daniel/Maryam (low-volume edge cases), Hamid (Sharia/multi-product).
const JTBD_PRESETS = Object.freeze({
  affordability: { label: 'Affordability',  terms: ['salary_payroll_flag', 'high_dbr', 'mortgage_long_dated', 'credit_line_block', 'gig_irregular_inflow'] },
  aml:           { label: 'AML',            terms: ['cash_dominant_flows', 'multi_party_accounts', 'joint_custodian'] },
  thinFile:      { label: 'Thin file',      terms: ['thin_file_short_tenure'] },
  fx:            { label: 'FX',             terms: ['fx_currency_exchange', 'multi_currency_accounts'] },
  distress:      { label: 'NSF / distress', terms: ['nsf_distress', 'low_volume_inference'] },
  sharia:        { label: 'Sharia',         terms: ['sharia_compliant_product'] },
});

// "Best for" — per-stress-term human one-liner driving the persona-card
// summary. Derived from PRD §3.2 JTBD wording so the library answers
// "which persona answers my job?" without reading every narrative.
const STRESS_BEST_FOR = Object.freeze({
  salary_payroll_flag:       'Baseline affordability case (Flags=Payroll income marker)',
  credit_line_block:         'Credit-line / card commitment shape',
  multi_currency_accounts:   'Multi-currency / FX edge cases',
  fx_currency_exchange:      'CurrencyExchange handling',
  multi_party_accounts:      'Multi-party / custodianship accounts',
  joint_custodian:           'Joint + custodian-for-minor account roles',
  high_dbr:                  'DBR-stretched affordability stress test',
  mortgage_long_dated:       'Long-dated mortgage commitments',
  nsf_distress:              'NSF / behavioural distress signal detection',
  thin_file_short_tenure:    'Thin-file / short-tenure underwriting',
  sharia_compliant_product:  'Sharia-compliant product handling',
  cash_dominant_flows:       'AML rule design — sparse merchant detail',
  gig_irregular_inflow:      'Income verification for gig / variable patterns',
  low_volume_inference:      'Low-volume / pension cadence (formula breaks here)',
});

function bestForLine(persona) {
  const terms = persona.stress_coverage ?? [];
  const lines = [];
  for (const t of terms) {
    const v = STRESS_BEST_FOR[t];
    if (v && !lines.includes(v)) lines.push(v);
  }
  return lines.join(' · ');
}

function buildJtbdRail() {
  const rail = document.getElementById('jtbd-rail');
  if (!rail) return;
  rail.replaceChildren();
  for (const [key, preset] of Object.entries(JTBD_PRESETS)) {
    const active = state.jtbdFilter === key;
    const chip = el('button', {
      class: 'jtbd-chip',
      attrs: {
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        title: `Show personas covering ${preset.label.toLowerCase()} JTBDs (${preset.terms.join(', ')})`,
      },
      text: preset.label,
      onClick: () => {
        state.jtbdFilter = state.jtbdFilter === key ? null : key;
        // JTBD preset replaces any single-term stress filter — keeps the
        // persona list state legible (one filter active at a time).
        if (state.jtbdFilter) state.stressFilter = null;
        buildJtbdRail();
        buildPersonaList();
      },
    });
    rail.appendChild(chip);
  }
}

function personaMatchesActiveFilter(persona) {
  const terms = persona.stress_coverage ?? [];
  if (state.stressFilter && !terms.includes(state.stressFilter)) return false;
  if (state.jtbdFilter) {
    const allow = JTBD_PRESETS[state.jtbdFilter]?.terms ?? [];
    if (!terms.some((t) => allow.includes(t))) return false;
  }
  return true;
}

function buildPersonaList() {
  const list = document.getElementById('persona-list');
  list.replaceChildren();
  const select = document.getElementById('persona-select');
  select.replaceChildren();

  // Render stress-filter bar state.
  const filterBar = document.getElementById('stress-filter-bar');
  const filterTerm = document.getElementById('stress-filter-term');
  if (state.stressFilter) {
    filterBar.classList.remove('is-empty');
    filterTerm.textContent = humanStressTerm(state.stressFilter);
    filterTerm.title = `Stress-coverage term: ${state.stressFilter}`;
    document.getElementById('stress-filter-clear').onclick = () => {
      state.stressFilter = null;
      buildPersonaList();
    };
  } else {
    filterBar.classList.add('is-empty');
  }

  let visibleCount = 0;
  for (const [id, p] of Object.entries(state.data.personas)) {
    if (!personaMatchesActiveFilter(p)) continue;
    visibleCount += 1;

    const card = el(
      'div',
      {
        class: 'persona-card',
        attrs: { role: 'listitem' },
        dataset: { personaId: id },
        onClick: (e) => {
          if (e.target.classList.contains('stress-chip')) return; // chip handles its own click
          state.personaId = id;
          // Persona-switch defaults the payload pane to the overview —
          // story-level orientation before drilling into wire endpoints.
          state.endpoint = OVERVIEW_PSEUDO;
          state.selectedAccountId = null;
          rebuildAndRender();
        },
      },
      el('div', { class: 'persona-name', text: p.name }),
      el('div', { class: 'persona-archetype', text: humanArchetype(p.archetype) }),
    );
    const bestFor = bestForLine(p);
    if (bestFor) {
      card.appendChild(el('div', { class: 'persona-best', text: bestFor }));
    }
    if (p.narrative) {
      card.appendChild(el('div', { class: 'persona-narrative', text: p.narrative.trim() }));
    }
    if (Array.isArray(p.stress_coverage) && p.stress_coverage.length > 0) {
      const chips = el('div', { class: 'persona-stress', attrs: { 'aria-label': 'Stress coverage' } });
      for (const term of p.stress_coverage) {
        const isActive = term === state.stressFilter;
        const chip = el('span', {
          class: `stress-chip${isActive ? ' stress-active' : ''}`,
          text: humanStressTerm(term),
          attrs: {
            role: 'button',
            tabindex: '0',
            title: isActive
              ? `Filter active: ${term} — click to clear`
              : `Click to show only personas covering: ${term}`,
          },
        });
        const onChipActivate = (ev) => {
          ev.stopPropagation();
          state.stressFilter = state.stressFilter === term ? null : term;
          buildPersonaList();
        };
        chip.addEventListener('click', onChipActivate);
        chip.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onChipActivate(ev); }
        });
        chips.appendChild(chip);
      }
      card.appendChild(chips);
    }
    list.appendChild(card);

    const opt = el('option', { text: p.name, attrs: { value: id } });
    select.appendChild(opt);
  }

  if (visibleCount === 0) {
    list.appendChild(el('div', {
      class: 'persona-empty',
      text: 'No personas cover this stress term yet. Clear the filter to see the full library.',
    }));
  }
  // Re-sync the active card's visual state after a re-render.
  for (const card of document.querySelectorAll('.persona-card')) {
    card.classList.toggle('active', card.dataset.personaId === state.personaId);
  }
}

// Convert snake_case archetype slug to a human label.
function humanArchetype(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Stress-coverage terms come from PRD Appendix F controlled vocabulary.
// Render as concise human labels with the slug retained as a tooltip.
function humanStressTerm(t) {
  return t
    .replace(/_/g, ' ')
    .replace(/\bdbr\b/i, 'DBR')
    .replace(/\bfx\b/i, 'FX')
    .replace(/\bnsf\b/i, 'NSF')
    .replace(/\bpep\b/i, 'PEP')
    .replace(/\bkyc\b/i, 'KYC')
    .replace(/\buae\b/i, 'UAE');
}

const LFI_CAPTIONS = Object.freeze({
  rich:   'Rich. Every populate-band optional field set — best-case ecosystem.',
  median: 'Median. Universal=1.0, Common=0.7, Variable=0.4, Rare=0.1 (v1 calibration).',
  sparse: 'Sparse. Mandatory + Universal-band only — every other optional field dropped.',
});

function syncControls() {
  document.getElementById('persona-select').value = state.personaId;
  // Hidden legacy <select> kept for any URL-encoded form handlers and as a
  // single readable accessor; the visible control is the segmented buttons.
  const legacy = document.getElementById('lfi-select');
  if (legacy) legacy.value = state.lfi;
  for (const btn of document.querySelectorAll('#lfi-seg button[data-lfi]')) {
    btn.setAttribute('aria-checked', btn.dataset.lfi === state.lfi ? 'true' : 'false');
  }
  for (const btn of document.querySelectorAll('#lfi-seg-compare button[data-cmp-lfi]')) {
    btn.setAttribute('aria-checked', btn.dataset.cmpLfi === state.compareWith ? 'true' : 'false');
  }
  const compareBtn = document.getElementById('compare-toggle');
  if (compareBtn) compareBtn.setAttribute('aria-pressed', state.compareMode ? 'true' : 'false');
  const compareRow = document.getElementById('lfi-compare-row');
  if (compareRow) compareRow.hidden = !state.compareMode;
  const caption = document.getElementById('lfi-caption');
  if (caption) caption.textContent = LFI_CAPTIONS[state.lfi] ?? '';
  document.getElementById('seed-input').value = String(state.seed);
  const expand = document.getElementById('toggle-expand-all');
  if (expand) expand.checked = !!state.expandFields;
  for (const card of document.querySelectorAll('.persona-card')) {
    card.classList.toggle('active', card.dataset.personaId === state.personaId);
  }
}

function attachEventHandlers() {
  document.getElementById('persona-select').addEventListener('change', (e) => {
    state.personaId = e.target.value;
    state.endpoint = OVERVIEW_PSEUDO;
    state.selectedAccountId = null;
    rebuildAndRender();
  });
  // LFI segmented control — replaces the v1 dropdown with a visible lever.
  for (const btn of document.querySelectorAll('#lfi-seg button[data-lfi]')) {
    btn.addEventListener('click', () => {
      state.lfi = btn.dataset.lfi;
      rebuildAndRender();
    });
  }
  // Compare toggle — adds a partner LFI row that drives EXP-16 side-by-side.
  document.getElementById('compare-toggle')?.addEventListener('click', () => {
    state.compareMode = !state.compareMode;
    if (state.compareMode && state.compareWith === state.lfi) {
      // Sensible default partner — anything other than the active LFI.
      state.compareWith = state.lfi === 'sparse' ? 'rich' : 'sparse';
    }
    syncControls();
    renderPayload();
  });
  document.getElementById('compare-close')?.addEventListener('click', () => {
    state.compareMode = false;
    syncControls();
    renderPayload();
  });
  document.getElementById('compare-swap')?.addEventListener('click', () => {
    const tmp = state.lfi;
    state.lfi = state.compareWith;
    state.compareWith = tmp;
    rebuildAndRender();
  });
  for (const btn of document.querySelectorAll('#lfi-seg-compare button[data-cmp-lfi]')) {
    btn.addEventListener('click', () => {
      state.compareWith = btn.dataset.cmpLfi;
      syncControls();
      renderPayload();
    });
  }
  document.getElementById('seed-input').addEventListener('change', (e) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n)) {
      state.seed = n;
      rebuildAndRender();
    }
  });
  document.getElementById('view-rendered').addEventListener('click', () => {
    state.view = 'rendered';
    renderPayload();
  });
  document.getElementById('view-raw').addEventListener('click', () => {
    state.view = 'raw';
    renderPayload();
  });
  document.getElementById('toggle-expand-all')?.addEventListener('change', (e) => {
    state.expandFields = !!e.target.checked;
    renderPayload();
  });
  document.getElementById('export-json').addEventListener('click', exportActiveJson);
  document.getElementById('export-csv').addEventListener('click', exportActiveCsv);
  document.getElementById('export-tar').addEventListener('click', exportTarball);
  document.getElementById('export-embed')?.addEventListener('click', copyEmbedSnippet);
  document.getElementById('tour-btn').addEventListener('click', () => startTour());
  document.getElementById('find-btn').addEventListener('click', openFind);
  // ⌘K / Ctrl+K opens the find box from anywhere in the app.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openFind();
    } else if (e.key === 'Escape') {
      if (document.getElementById('find-overlay')) closeFind();
      else if (state.coachStep != null) dismissCoachmarks();
    }
  });
}

// ---- Spec-wide find box -----------------------------------------------------------------

function openFind() {
  if (document.getElementById('find-overlay')) return;
  const overlay = el('div', {
    class: 'find-overlay',
    attrs: { id: 'find-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Find' },
  });
  const card = el('div', { class: 'find-card' });
  const input = el('input', {
    class: 'find-input',
    attrs: { type: 'search', placeholder: 'Search fields, enums, persona narratives…', 'aria-label': 'Find input', autocomplete: 'off' },
  });
  const ul = el('ul', { class: 'find-results', attrs: { role: 'listbox' } });
  const hint = el('div', { class: 'find-hint' });
  const left = el('span', { text: 'Click any result to jump' });
  const right = el('span');
  right.appendChild(document.createTextNode('Open with '));
  right.appendChild(el('kbd', { text: '⌘K' }));
  right.appendChild(document.createTextNode(' · close with '));
  right.appendChild(el('kbd', { text: 'Esc' }));
  hint.appendChild(left);
  hint.appendChild(right);
  card.appendChild(input);
  card.appendChild(ul);
  card.appendChild(hint);
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFind(); });

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
        text: input.value.trim().length === 0
          ? 'Try: TransactionType · Payroll · MerchantCategoryCode · Sara · multi_currency · expat'
          : 'No matches.',
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
      li.addEventListener('click', () => { applyFindResult(r); closeFind(); });
      ul.appendChild(li);
    });
  };
  input.addEventListener('input', () => { activeIdx = 0; refresh(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, Math.max(lastResults.length - 1, 0)); renderResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderResults(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const r = lastResults[activeIdx];
      if (r) { applyFindResult(r); closeFind(); }
    }
  });
  document.body.appendChild(overlay);
  setTimeout(() => input.focus(), 0);
  refresh();
}

function closeFind() {
  document.getElementById('find-overlay')?.remove();
}

// Build a flat searchable index across personas + spec endpoints + fields.
function runFind(q) {
  const out = [];
  const lower = q.toLowerCase();
  // Personas — name + archetype + narrative + stress_coverage
  for (const [pid, p] of Object.entries(state.data.personas ?? {})) {
    const hay = `${p.name} ${p.archetype} ${p.narrative ?? ''} ${(p.stress_coverage ?? []).join(' ')}`.toLowerCase();
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
        const enumHit = enumStr.toLowerCase().includes(lower) && !f.name.toLowerCase().includes(lower);
        out.push({
          kind: 'field',
          endpoint: path,
          fieldName: f.name,
          title: `${f.name}  ·  ${path}`,
          meta: `${f.status}${f.format ? ' · ' + f.format : ''}${enumHit ? ` · enum match: ${f.enum.filter((v) => String(v).toLowerCase().includes(lower)).slice(0, 3).join(', ')}` : ''}`,
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

// ---- Tell-me-a-story walkthrough — §5.4 ----------------------------------------------------

const TOUR_STEPS = [
  {
    title: "Meet Sara",
    body: "Sara is a salaried expat in Dubai. She has two accounts: a current account where her AED 25k salary lands on the 25th, and a credit card. The persona library on the left lets you swap her for nine other UAE archetypes — gig worker, SME, HNW multi-currency, joint family, and more.",
    setup: () => setPersona('salaried_expat_mid', 'median'),
  },
  {
    title: "Watch the salary marker",
    body: "Open the transactions endpoint on Sara's current account. Notice the monthly salary credit — it carries Flags=Payroll. That's the v2.1 spec-clean way to identify income; everything else (fallbacks, recurrence-clustering) is a workaround for LFIs that don't populate it.",
    setup: () => {
      state.endpoint = '/accounts/{AccountId}/transactions';
      state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
      state.txFilter = emptyTxFilter();
      state.txFilter.search = 'Salary';
    },
  },
  {
    title: "See the rent commitment",
    body: "Switch to /standing-orders for the same account. Sara has a rent standing order that hits the 27th of every month — two days after her salary. Click that row and the sandbox jumps to the matching transactions in /transactions, with the cross-link banner offering you a way back.",
    setup: () => {
      state.endpoint = '/accounts/{AccountId}/standing-orders';
      state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
      state.txFilter = emptyTxFilter();
      state.txHighlight = new Set();
      state.crossLink = null;
    },
  },
  {
    title: "Read the field card",
    body: "Click any field name in the rendered table to open the field card. Every field carries: a status badge (Mandatory / Optional / Conditional, derived live from the OpenAPI spec — never hand-authored), type and format, enum values, an example from the persona, a 'Real LFIs' guidance note, and a deep link to the field on the upstream Nebras GitHub at the pinned SHA.",
    setup: () => {
      // No state change — just nudge the user.
    },
  },
  {
    title: "Sparse vs Median",
    body: "Switch the LFI profile (top bar) to Sparse. Watch the coverage meter drop and watch optional fields like MerchantDetails / Flags / ValueDateTime / Nickname disappear. That's the Phase-1 minimum your downstream UI and decisioning logic needs to handle. Switch back to Median, then to Rich, and pick a different persona to finish — the URL updates as you go, so you can paste it into a slide deck.",
    setup: () => {},
  },
];

function startTour() {
  state.tourStep = 0;
  renderTourStep();
}

function renderTourStep() {
  const step = TOUR_STEPS[state.tourStep];
  if (!step) {
    closeTour();
    return;
  }
  if (typeof step.setup === 'function') {
    step.setup();
  }
  renderNavigator();
  renderPayload();
  renderCoverage();

  // Remove any existing overlay before mounting a fresh one.
  document.getElementById('tour-overlay')?.remove();

  const overlay = el('div', { class: 'tour-overlay', attrs: { id: 'tour-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' } });
  const card = el('div', { class: 'tour-card' });
  card.appendChild(el('div', { class: 'tour-step-num', text: `Step ${state.tourStep + 1} of ${TOUR_STEPS.length}` }));
  card.appendChild(el('h3', { text: step.title, attrs: { id: 'tour-title' } }));
  card.appendChild(el('p', { text: step.body }));
  const actions = el('div', { class: 'tour-actions' });
  actions.appendChild(el('button', { class: 'tour-skip', text: 'Skip', onClick: closeTour }));
  const right = el('div', { attrs: { style: 'display:flex;gap:6px' } });
  if (state.tourStep > 0) {
    right.appendChild(el('button', { text: 'Back', onClick: () => { state.tourStep--; renderTourStep(); } }));
  }
  const isLast = state.tourStep === TOUR_STEPS.length - 1;
  right.appendChild(el('button', {
    class: 'tour-primary',
    text: isLast ? 'Finish' : 'Next →',
    onClick: () => {
      if (isLast) closeTour();
      else { state.tourStep++; renderTourStep(); }
    },
  }));
  actions.appendChild(right);
  card.appendChild(actions);
  overlay.appendChild(card);
  // Click-outside dismisses.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTour(); });
  document.body.appendChild(overlay);
  // Move focus into the card for keyboard users.
  card.querySelector('button.tour-primary')?.focus();
}

function closeTour() {
  state.tourStep = null;
  document.getElementById('tour-overlay')?.remove();
}

function setPersona(personaId, lfi) {
  state.personaId = personaId;
  if (lfi) state.lfi = lfi;
  rebuildAndRender();
}

function exportContext() {
  return {
    personaId: state.personaId,
    lfi: state.lfi,
    seed: state.seed,
    specVersion: state.spec?.specVersion,
    specSha: state.spec?.pinSha,
    retrievedAt: new Date().toISOString(),
  };
}

function activeEnvelopeKey() {
  if (state.endpoint === '/accounts' || state.endpoint === '/parties') return state.endpoint;
  if (state.selectedAccountId) {
    const tail = state.endpoint.replace('{AccountId}', state.selectedAccountId);
    return tail;
  }
  return state.endpoint;
}

function exportActiveJson() {
  if (!state.bundle) return;
  const ctx = exportContext();
  const envelopes = envelopesFromBundle(state.bundle, ctx);
  const key = activeEnvelopeKey();
  const env = envelopes[key] ?? envelopes[state.endpoint];
  if (!env) return;
  const fname = `${state.personaId}-${state.lfi}-seed${state.seed}-${key.replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '') || 'root'}.json`;
  downloadJson(env, fname);
}

function exportActiveCsv() {
  if (!state.bundle) return;
  const ctx = exportContext();
  // Pick the best-fit resource for the active endpoint.
  const resourceForEndpoint = {
    '/accounts': ['accounts', 'Account'],
    '/accounts/{AccountId}': ['accounts', 'Account'],
    '/accounts/{AccountId}/balances': ['balances', 'Balance'],
    '/accounts/{AccountId}/transactions': ['transactions', 'Transaction'],
    '/accounts/{AccountId}/standing-orders': ['standingOrders', 'StandingOrder'],
    '/accounts/{AccountId}/direct-debits': ['directDebits', 'DirectDebit'],
    '/accounts/{AccountId}/beneficiaries': ['beneficiaries', 'Beneficiary'],
    '/accounts/{AccountId}/scheduled-payments': ['scheduledPayments', 'ScheduledPayment'],
    '/accounts/{AccountId}/product': ['product', 'Product'],
    '/accounts/{AccountId}/parties': ['parties', 'Party'],
    '/parties': ['callingUserParty', 'Party'],
    '/accounts/{AccountId}/statements': ['statements', 'Statements'],
  };
  const [bundleKey, resourceLabel] = resourceForEndpoint[state.endpoint] ?? ['accounts', 'Account'];
  let rows = state.bundle[bundleKey] ?? [];
  if (state.selectedAccountId && Array.isArray(rows)) {
    rows = rows.filter((r) => !r._accountId || r._accountId === state.selectedAccountId);
  }
  if (!Array.isArray(rows)) rows = [rows];
  const csv = csvForResource(rows, ctx);
  const fname = `${state.personaId}-${state.lfi}-seed${state.seed}-${resourceLabel}.csv`;
  downloadCsv(csv, fname);
}

function exportTarball() {
  if (!state.bundle) return;
  const ctx = exportContext();
  downloadTarball(state.bundle, ctx, `${state.personaId}-${state.lfi}-seed${state.seed}.tar`);
}

function rebuildAndRender() {
  // 120ms fade — visually confirms "the data just changed" when the user
  // switches persona / LFI / seed. Ignored when prefers-reduced-motion is set
  // (the CSS rule kills the transition).
  const body = document.getElementById('payload-body');
  body?.classList.add('is-fading');

  const persona = state.data.personas[state.personaId];
  state.bundle = buildBundle({
    persona,
    lfi: state.lfi,
    seed: state.seed,
    pools: state.data.pools,
    now: new Date(state.data.buildInfo.nowIso),
  });
  state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
  state.txFilter = emptyTxFilter();
  state.txSort = { column: null, dir: 'asc' };
  state.txHighlight = new Set();
  state.crossLink = null;
  syncControls();
  renderNavigator();
  renderPayload();
  renderCoverage();
  pushPermalink();

  setTimeout(() => body?.classList.remove('is-fading'), 30);
}

function pushPermalink() {
  // Phase 0: keep the current pathname; only update the query string. Phase 1
  // will switch to the §6.8 permalink shape (/commons/[slug]/p/<id>?...) once
  // the Commons publication path is live.
  const params = new URLSearchParams();
  params.set('persona', state.personaId);
  params.set('lfi', state.lfi);
  params.set('seed', String(state.seed));
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', next);
}

function renderCoverage() {
  const cov = coverage(state.bundle);
  const byBand = coverageByBand(state.bundle);
  document.getElementById('coverage-pct').textContent = `${cov.pct}%`;

  const host = document.getElementById('coverage-bands');
  if (!host) return;
  host.replaceChildren();
  // 4-cell strips per §7.3 band — Universal first (always-on), then Common,
  // Variable, Rare. Each cell = 25% of the band's populated/total ratio.
  // A band with no probes (Rare today) renders as is-empty so its semantic
  // slot stays visible, signalling "no curated probes for this band yet".
  const order = ['Universal', 'Common', 'Variable', 'Rare'];
  for (const band of order) {
    const b = byBand[band];
    const cells = 4;
    const filled = b.total > 0 ? Math.round((b.populated / b.total) * cells) : 0;
    const wrap = el('span', {
      class: `coverage-band${b.total === 0 ? ' is-empty' : ''}`,
      attrs: {
        'data-band': band,
        title: b.total === 0
          ? `${band} band: no curated probes yet (Phase 1 starter — widens as the spec parser feeds bands directly).`
          : `${band} band — ${b.populated} of ${b.total} populated (${b.pct}%). ${MEDIAN_HINT[band] ?? ''}`,
      },
    });
    wrap.appendChild(el('span', { class: 'band-label', text: band[0] }));
    const cellRow = el('span', { class: 'band-cells' });
    for (let i = 0; i < cells; i += 1) {
      cellRow.appendChild(el('span', { class: `band-cell${i < filled ? ' is-on' : ''}` }));
    }
    wrap.appendChild(cellRow);
    host.appendChild(wrap);
  }
}

const MEDIAN_HINT = Object.freeze({
  Universal: 'Median expectation: every LFI populates.',
  Common:    'Median expectation: ~70% of LFIs populate.',
  Variable:  'Median expectation: ~40% of LFIs populate.',
  Rare:      'Median expectation: ~10% of LFIs populate (premium-product only).',
});

function renderNavigator() {
  const nav = document.getElementById('nav-tree');
  nav.replaceChildren();

  // Bundle-scoped endpoints get their own header section at the top.
  const bundleSection = el('div', { class: 'nav-account is-bundle' });
  bundleSection.appendChild(el('div', { class: 'nav-account-header', text: 'Bundle' }));
  for (const ep of BUNDLE_SCOPED_PATHS) {
    const isActive = state.endpoint === ep;
    bundleSection.appendChild(
      navButton({
        endpoint: ep,
        accountId: null,
        active: isActive,
        onSelect: () => {
          state.endpoint = ep;
          state.selectedAccountId = null;
          clearTxState();
          renderNavigator();
          renderPayload();
        },
      })
    );
  }
  nav.appendChild(bundleSection);

  // One section per account, listing the per-account endpoints.
  for (const acc of state.bundle.accounts) {
    const wrap = el('div', { class: 'nav-account' });
    wrap.appendChild(
      el('div', {
        class: 'nav-account-header',
        text: `${acc.AccountSubType} · ${acc.AccountIdentifiers?.[0]?.Identification?.slice(0, 12) ?? acc.AccountId}…`,
      })
    );
    for (const ep of ACCOUNT_SCOPED_PATHS) {
      const isActive = state.endpoint === ep && state.selectedAccountId === acc.AccountId;
      wrap.appendChild(
        navButton({
          endpoint: ep,
          accountId: acc.AccountId,
          active: isActive,
          onSelect: () => {
            state.endpoint = ep;
            state.selectedAccountId = acc.AccountId;
            clearTxState();
            renderNavigator();
            renderPayload();
          },
        })
      );
    }
    nav.appendChild(wrap);
  }
}

// Build a navigator button with an inline coverage sub-meter (EXP-15 second
// half). For bundle-scoped endpoints the sub-meter is omitted; for per-account
// endpoints it shows the populate-rate of optional fields under that scope.
function navButton({ endpoint, accountId, active, onSelect }) {
  const isVirtual = endpoint === UNDERWRITING_PSEUDO || endpoint === OVERVIEW_PSEUDO;
  const btn = el('button', {
    class: `nav-endpoint${active ? ' active' : ''}${isVirtual ? ' nav-virtual' : ''}`,
    attrs: { 'aria-current': active ? 'true' : null },
    dataset: { endpoint, accountId: accountId ?? '' },
    onClick: onSelect,
  });
  // Pseudo-endpoints (overview, underwriting summary) get friendlier labels
  // so they read clearly as derived views rather than spec wire endpoints.
  let label = endpoint;
  if (endpoint === UNDERWRITING_PSEUDO) label = '◇ Underwriting summary';
  else if (endpoint === OVERVIEW_PSEUDO) label = '◇ Persona overview';
  btn.appendChild(el('span', { class: 'nav-endpoint-label', text: label }));
  if (accountId) {
    const cov = coverageForEndpoint(state.bundle, endpoint, accountId);
    if (cov.total > 0) {
      // Coverage-band drives the gradient applied via CSS — amber → green
      // so a 30% sub-meter reads as warmer than a 90% one.
      const band = cov.pct < 25 ? 'low' : cov.pct < 66 ? 'medium' : 'high';
      btn.dataset.coverageBand = band;
      const meter = el('span', { class: 'nav-submeter', attrs: { 'aria-label': `Coverage ${cov.pct}%` } });
      const fill = el('span', { class: 'nav-submeter-fill' });
      fill.style.width = `${cov.pct}%`;
      meter.appendChild(fill);
      btn.appendChild(meter);
      btn.appendChild(el('span', { class: 'nav-submeter-pct', text: `${cov.pct}%` }));
    }
  }
  return btn;
}

function clearTxState() {
  state.txFilter = emptyTxFilter();
  state.txSort = { column: null, dir: 'asc' };
  state.txHighlight = new Set();
  state.crossLink = null;
}

function rowsForActiveEndpoint() {
  const acc = state.bundle.accounts.find((a) => a.AccountId === state.selectedAccountId);
  switch (state.endpoint) {
    case '/accounts':
      return state.bundle.accounts;
    case '/parties':
      return state.bundle.callingUserParty ? [state.bundle.callingUserParty] : [];
    case '/accounts/{AccountId}':
      return acc ? [acc] : [];
    case '/accounts/{AccountId}/balances':
      return acc ? state.bundle.balances.filter((b) => b._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/transactions':
      return acc ? state.bundle.transactions.filter((t) => t._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/standing-orders':
      return acc ? state.bundle.standingOrders.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/direct-debits':
      return acc ? state.bundle.directDebits.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/beneficiaries':
      return acc ? state.bundle.beneficiaries.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/scheduled-payments':
      return acc ? state.bundle.scheduledPayments.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/product':
      return acc ? state.bundle.product.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/parties':
      return acc ? state.bundle.parties.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/statements':
      return acc ? state.bundle.statements.filter((x) => x._accountId === acc.AccountId) : [];
    default:
      return [];
  }
}

function endpointFieldsByName() {
  const fields = leafFields(state.spec, state.endpoint);
  const out = new Map();
  for (const f of fields) out.set(f.name, f);
  return out;
}

function renderPayload() {
  document.getElementById('endpoint-label').textContent = labelForEndpoint(state.endpoint);
  const body = document.getElementById('payload-body');
  body.replaceChildren();

  // EXP-18 Underwriting Scenario panel — a derived view, not a spec endpoint.
  if (state.endpoint === UNDERWRITING_PSEUDO) {
    renderUnderwritingPanel(body);
    return;
  }
  // Persona overview — the natural landing on persona-switch.
  if (state.endpoint === OVERVIEW_PSEUDO) {
    renderPersonaOverview(body);
    return;
  }

  const allRows = rowsForActiveEndpoint();
  const fieldsByName = endpointFieldsByName();

  document.getElementById('view-rendered').classList.toggle('active', state.view === 'rendered');
  document.getElementById('view-raw').classList.toggle('active', state.view === 'raw');
  document.getElementById('view-rendered').setAttribute('aria-selected', state.view === 'rendered');
  document.getElementById('view-raw').setAttribute('aria-selected', state.view === 'raw');

  // Compare-LFIs is a parallel rendering mode driven by state.compareMode
  // (orthogonal to state.view: representation × cardinality). Either
  // branch can be re-entered without losing the other axis.
  if (state.compareMode) {
    renderCompareView(body);
    return;
  }

  // Filter + sort apply only to the /transactions view.
  const isTransactions = state.endpoint === '/accounts/{AccountId}/transactions';

  if (state.view === 'raw') {
    const rowsToRender = isTransactions ? applyFilter(allRows) : allRows;
    const pre = el('pre', {
      class: 'payload-raw',
      text: JSON.stringify(rowsToRender.map(stripInternal), null, 2),
    });
    body.appendChild(pre);
    return;
  }

  if (allRows.length === 0) {
    const wrap = el('div', { class: 'payload-rendered' },
      el('p', { text: 'No records.', attrs: { style: 'color:var(--text-muted)' } })
    );
    body.appendChild(wrap);
    return;
  }

  if (isTransactions) {
    body.appendChild(renderTxFilterBar(allRows));
    if (state.crossLink) body.appendChild(renderCrossLinkBanner());
    const nsfCount = allRows.filter((t) => t.Status === 'Rejected').length;
    if (nsfCount > 0) {
      body.appendChild(el('div', {
        class: 'distress-summary',
        attrs: { role: 'status' },
        text: `${nsfCount} rejected debit${nsfCount === 1 ? '' : 's'} in the trailing 12 months — highlighted below.`,
      }));
    }
    // Monthly summary — Sara's anchor JTBD ("12 months of transactions").
    // Aggregates from the unfiltered set so the user sees the underlying
    // shape, regardless of any active row filter.
    body.appendChild(renderMonthlySummary(allRows));
  }
  // /product gets a v1.5 hint when the spec defines additional optional
  // blocks the Phase 1 generator doesn't populate (Charges, FinanceRates,
  // RewardsBenefits, AssetBacked).
  if (state.endpoint === '/accounts/{AccountId}/product') {
    body.appendChild(el('div', {
      class: 'product-hint',
      text: 'v2.1 defines additional optional blocks for /product (Charges, FinanceRates, DepositRates, AssetBacked, RewardsBenefits) that the Phase 1 generator does not populate. v1.5 widens the generator to cover them — track via the field card spec links.',
    }));
  }

  let rows = isTransactions ? applyFilter(allRows) : allRows;
  if (isTransactions) rows = applySort(rows);

  if (rows.length === 0) {
    body.appendChild(el('p', {
      text: 'No transactions match the active filter.',
      attrs: { style: 'color:var(--text-muted);padding:8px 12px' },
    }));
    return;
  }

  const visible = rows.slice(0, 100);
  const allKeys = new Set();
  for (const r of visible) for (const k of Object.keys(stripInternal(r))) allKeys.add(k);

  // Sticky leftmost column is most useful on /transactions (the only really
  // wide table). Apply selectively rather than to every endpoint.
  const stickyColClass = isTransactions ? ' has-sticky-col' : '';
  const wrap = el('div', { class: `payload-rendered${stickyColClass}` });
  const table = el('table');
  const headRow = el('tr');
  for (const k of allKeys) {
    const th = el('th');
    const f = fieldsByName.get(k);
    if (f) th.dataset.status = f.status; // drives the status-stripe colour
    if (isTransactions) {
      th.classList.add('sortable');
      if (state.txSort.column === k) th.classList.add(`sort-${state.txSort.dir}`);
      th.addEventListener('click', () => toggleSort(k));
    }
    if (f) {
      const badge = statusBadge(f.status);
      th.appendChild(
        el('span', { class: `pill ${badge.shape}`, text: badge.label, attrs: { 'aria-label': badge.text } })
      );
    }
    const fieldBtn = el('button', {
      class: 'field-name',
      text: k,
      onClick: (e) => { e.stopPropagation(); openFieldCard(k); },
    });
    // Hover preview — fast affordance per EXP-14 (within ~100 ms). Click
    // still pins the full card in the right pane.
    attachHoverPreview(fieldBtn, k);
    th.appendChild(fieldBtn);
    if (isPii(k)) {
      th.appendChild(
        el('span', { class: 'pii-badge', text: 'PII', attrs: { title: 'Contains PII — PDPL handling controls required (see field card).', 'aria-label': 'Personal data — PDPL applies' } })
      );
    }
    headRow.appendChild(th);
  }
  table.appendChild(el('thead', {}, headRow));
  const persona = state.data.personas[state.personaId];
  const tbody = el('tbody');
  // Expand-all — inline field metadata row directly under the headers.
  // Surfaces status / type / Real-LFIs guidance without click-then-read.
  if (state.expandFields) {
    const fieldRow = el('tr', { class: 'field-row' });
    for (const k of allKeys) {
      const f = fieldsByName.get(k);
      const td = el('td');
      if (f) {
        const band = bandForFieldName(k, state.endpoint);
        const meta = `${f.type}${f.format ? ' · ' + f.format : ''}${f.enum ? ' · enum' : ''}`;
        td.appendChild(el('span', { class: 'fr-meta', text: meta }));
        td.appendChild(el('span', { class: 'fr-guidance', text: realLfisGuidance(f, band) }));
      } else {
        td.textContent = '—';
      }
      fieldRow.appendChild(td);
    }
    tbody.appendChild(fieldRow);
  }
  for (const r of visible) {
    const stripped = stripInternal(r);
    const isHighlight = isTransactions && r.TransactionId && state.txHighlight.has(r.TransactionId);
    // NSF / distressed rows — Status=Rejected gets a visual marker so AML
    // and underwriting workflows can scan for them.
    const isRejected = r.Status === 'Rejected';
    const trClasses = [
      isHighlight && 'tx-highlight',
      isRejected && 'tx-rejected',
    ].filter(Boolean).join(' ') || null;
    const tr = el('tr', { class: trClasses });
    for (const k of allKeys) {
      const v = stripped[k];
      const isEmpty = v == null;
      const f = fieldsByName.get(k);
      let text;
      if (isEmpty) {
        text = '—';
      } else if (state.humanDates && isDateField(k) && typeof v === 'string') {
        text = humaniseDate(v);
      } else if (typeof v === 'object') {
        text = JSON.stringify(v);
      } else {
        text = String(v);
      }
      const td = el('td', { text });
      // "Why is this empty?" tooltip — for optional/conditional blanks.
      if (isEmpty && f && f.status !== 'mandatory') {
        td.classList.add('cell-absent');
        td.title = whyEmpty({
          field: f,
          lfi: state.lfi,
          persona,
          band: bandForFieldName(k, state.endpoint),
        });
      }
      tr.appendChild(td);
    }
    const jumpFrom = jumpFromForActiveEndpoint();
    if (jumpFrom && r) {
      tr.style.cursor = 'pointer';
      tr.title = `Jump to /transactions filtered by ${jumpFrom.label(r)}`;
      tr.addEventListener('click', () => crossLinkToTransactions(r, jumpFrom));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  if (rows.length > visible.length) {
    wrap.appendChild(
      el('p', {
        text: `…${rows.length - visible.length} more rows. Use Raw JSON to see the full set.`,
        attrs: { style: 'color:var(--text-muted);margin-top:8px' },
      })
    );
  }

  if (isTransactions) {
    wrap.appendChild(el('p', {
      class: 'tx-filter-summary',
      text: `${rows.length} of ${allRows.length} transactions${rows.length > visible.length ? ` (showing first ${visible.length})` : ''}.`,
    }));
  }

  body.appendChild(wrap);
}

// ---- EXP-11 transactions filter ----------------------------------------------------------

function renderTxFilterBar(_allRows) {
  const f = state.txFilter;
  const bar = el('div', { class: 'tx-filter-bar', attrs: { role: 'search' } });
  bar.appendChild(filterInput('search', 'search', f.search, 'Search TransactionInformation…'));
  bar.appendChild(filterSelect('type', f.type, [
    ['', 'TransactionType: any'],
    ['POS', 'POS'],
    ['ECommerce', 'ECommerce'],
    ['ATM', 'ATM'],
    ['BillPayments', 'BillPayments'],
    ['LocalBankTransfer', 'LocalBankTransfer'],
    ['SameBankTransfer', 'SameBankTransfer'],
    ['InternationalTransfer', 'InternationalTransfer'],
    ['Teller', 'Teller'],
    ['Cheque', 'Cheque'],
    ['Other', 'Other'],
  ]));
  bar.appendChild(filterSelect('subType', f.subType, [
    ['', 'SubTransactionType: any'],
    ['Purchase', 'Purchase'],
    ['Reversal', 'Reversal'],
    ['Refund', 'Refund'],
    ['Withdrawal', 'Withdrawal'],
    ['Deposit', 'Deposit'],
    ['MoneyTransfer', 'MoneyTransfer'],
    ['Repayments', 'Repayments'],
    ['Fee', 'Fee'],
    ['Interest', 'Interest'],
  ]));
  bar.appendChild(filterSelect('debitCredit', f.debitCredit, [
    ['', 'Debit/Credit: any'],
    ['Debit', 'Debit only'],
    ['Credit', 'Credit only'],
  ]));
  bar.appendChild(filterInput('dateFrom', 'date', f.dateFrom, '', 'From'));
  bar.appendChild(filterInput('dateTo', 'date', f.dateTo, '', 'To'));
  bar.appendChild(filterInput('amountFrom', 'number', f.amountFrom, 'AED ≥'));
  bar.appendChild(filterInput('amountTo', 'number', f.amountTo, 'AED ≤'));
  bar.appendChild(filterInput('mcc', 'text', f.mcc, 'MCC'));
  // Date humanise toggle — flips ISO datetimes to human format.
  const humanLabel = el('label', { class: 'filter-toggle' });
  const humanCheckbox = el('input', { attrs: { type: 'checkbox' } });
  humanCheckbox.checked = !!state.humanDates;
  humanCheckbox.addEventListener('change', (e) => {
    state.humanDates = e.target.checked;
    renderPayload();
  });
  humanLabel.appendChild(humanCheckbox);
  humanLabel.appendChild(document.createTextNode(' Humanise dates'));
  bar.appendChild(humanLabel);

  const clear = el('button', {
    class: 'filter-clear',
    text: 'Clear filters',
    onClick: () => { state.txFilter = emptyTxFilter(); renderPayload(); },
  });
  bar.appendChild(clear);
  return bar;
}

function filterInput(name, type, value, placeholder, ariaLabel) {
  const input = el('input', {
    attrs: { type, name, value: value ?? '', placeholder: placeholder || '', 'aria-label': ariaLabel ?? placeholder ?? name },
  });
  input.addEventListener('input', (e) => {
    state.txFilter[name] = e.target.value;
    renderPayload();
    setTimeout(() => document.querySelector(`.tx-filter-bar [name="${name}"]`)?.focus(), 0);
  });
  return input;
}

function filterSelect(name, value, options) {
  const select = el('select', { attrs: { name, 'aria-label': name } });
  for (const [v, label] of options) {
    const opt = el('option', { text: label, attrs: { value: v } });
    if (v === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', (e) => {
    state.txFilter[name] = e.target.value;
    renderPayload();
  });
  return select;
}

function applyFilter(rows) {
  const f = state.txFilter;
  return rows.filter((r) => {
    if (f.search) {
      const hay = String(r.TransactionInformation ?? '').toLowerCase();
      if (!hay.includes(f.search.toLowerCase())) return false;
    }
    if (f.type && r.TransactionType !== f.type) return false;
    if (f.subType && r.SubTransactionType !== f.subType) return false;
    if (f.debitCredit && r.CreditDebitIndicator !== f.debitCredit) return false;
    if (f.dateFrom && r.BookingDateTime?.slice(0, 10) < f.dateFrom) return false;
    if (f.dateTo && r.BookingDateTime?.slice(0, 10) > f.dateTo) return false;
    const amt = parseFloat(r.Amount?.Amount ?? '0');
    if (f.amountFrom !== '' && amt < parseFloat(f.amountFrom)) return false;
    if (f.amountTo !== '' && amt > parseFloat(f.amountTo)) return false;
    if (f.mcc && r.MerchantDetails?.MerchantCategoryCode !== f.mcc) return false;
    return true;
  });
}

function applySort(rows) {
  const { column, dir } = state.txSort;
  if (!column) return rows;
  const sign = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = readSortValue(a, column);
    const bv = readSortValue(b, column);
    if (av == null && bv == null) return 0;
    if (av == null) return -sign;
    if (bv == null) return sign;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}

function readSortValue(row, column) {
  const v = row[column];
  if (v == null) return null;
  if (column === 'Amount' && v.Amount) return parseFloat(v.Amount);
  return v;
}

function toggleSort(column) {
  if (state.txSort.column === column) {
    state.txSort.dir = state.txSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.txSort = { column, dir: 'asc' };
  }
  renderPayload();
}

// ---- EXP-16 Compare-LFIs view -----------------------------------------------------------

function renderCompareView(body) {
  const persona = state.data.personas[state.personaId];
  const now = new Date(state.data.buildInfo.nowIso);
  // Compare-mode renders the active LFI (state.lfi) against a partner
  // (state.compareWith). Lever placement is in the topbar; the in-pane
  // affordance is just a thin context line + diff legend.
  const leftLfi = state.lfi;
  const rightLfi = state.compareWith;
  const leftBundle = buildBundle({ persona, lfi: leftLfi, seed: state.seed, pools: state.data.pools, now });
  const rightBundle = buildBundle({ persona, lfi: rightLfi, seed: state.seed, pools: state.data.pools, now });

  const leftRows = compareRowsFor(leftBundle);
  const rightRows = compareRowsFor(rightBundle);
  const stats = compareStats(leftRows, rightRows);
  body.appendChild(el('div', {
    class: 'compare-summary',
    text: `${stats.totalCellsLeft} populated cells on ${leftLfi} · ${stats.totalCellsRight} on ${rightLfi} · ${stats.diffCount} fields differ across ${Math.max(leftRows.length, rightRows.length)} rows. Cells highlighted: green = present only on this side, amber = changed, red = missing.`,
  }));

  // Union of column keys across both sides so each half renders the same
  // columns. That's how a "missing" cell on Sparse gets a column to live in
  // — without it, dropped fields disappear from Sparse's table entirely
  // and the diff classification can't fire.
  const allKeys = new Set();
  for (const r of [...leftRows, ...rightRows]) {
    for (const k of Object.keys(stripInternal(r))) allKeys.add(k);
  }

  const compareWrap = el('div', { class: 'compare-pane' });
  compareWrap.appendChild(renderCompareHalf(leftBundle, leftRows, rightRows, leftLfi, allKeys));
  compareWrap.appendChild(renderCompareHalf(rightBundle, rightRows, leftRows, rightLfi, allKeys));
  body.appendChild(compareWrap);
}

function compareRowsFor(bundle) {
  const acc = bundle.accounts.find((a) => a.AccountId === state.selectedAccountId) ?? bundle.accounts[0];
  switch (state.endpoint) {
    case '/accounts': return bundle.accounts;
    case '/parties': return bundle.callingUserParty ? [bundle.callingUserParty] : [];
    case '/accounts/{AccountId}': return acc ? [acc] : [];
    case '/accounts/{AccountId}/balances':
      return acc ? bundle.balances.filter((b) => b._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/transactions':
      return acc ? bundle.transactions.filter((t) => t._accountId === acc.AccountId).slice(0, 60) : [];
    case '/accounts/{AccountId}/standing-orders':
      return acc ? bundle.standingOrders.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/direct-debits':
      return acc ? bundle.directDebits.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/beneficiaries':
      return acc ? bundle.beneficiaries.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/scheduled-payments':
      return acc ? bundle.scheduledPayments.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/product':
      return acc ? bundle.product.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/parties':
      return acc ? bundle.parties.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/statements':
      return acc ? bundle.statements.filter((x) => x._accountId === acc.AccountId) : [];
    default: return [];
  }
}

function rowKey(row) {
  return row.TransactionId || row.AccountId || row.StandingOrderId || row.DirectDebitId
    || row.BeneficiaryId || row.ScheduledPaymentId || row.ProductId || row.PartyId
    || row.StatementId || row._accountId || JSON.stringify(row).slice(0, 64);
}

function compareStats(leftRows, rightRows) {
  const leftByKey = new Map(leftRows.map((r) => [rowKey(r), r]));
  const rightByKey = new Map(rightRows.map((r) => [rowKey(r), r]));
  let totalCellsLeft = 0;
  let totalCellsRight = 0;
  let diffCount = 0;
  for (const r of leftRows) {
    for (const v of Object.values(stripInternal(r))) if (v != null) totalCellsLeft += 1;
  }
  for (const r of rightRows) {
    for (const v of Object.values(stripInternal(r))) if (v != null) totalCellsRight += 1;
  }
  for (const [key, l] of leftByKey) {
    const r = rightByKey.get(key);
    if (!r) continue;
    const sl = stripInternal(l);
    const sr = stripInternal(r);
    const allKeys = new Set([...Object.keys(sl), ...Object.keys(sr)]);
    for (const k of allKeys) {
      if (JSON.stringify(sl[k]) !== JSON.stringify(sr[k])) diffCount += 1;
    }
  }
  return { totalCellsLeft, totalCellsRight, diffCount };
}

function renderCompareHalf(bundle, ownRows, otherRows, lfi, allKeys) {
  const half = el('div', { class: 'compare-half' });
  half.appendChild(el('div', {
    class: 'compare-half-header',
    text: `${lfi.toUpperCase()} · ${ownRows.length} row${ownRows.length === 1 ? '' : 's'}`,
  }));
  const inner = el('div', { class: 'payload-body', attrs: { tabindex: '0' } });
  if (ownRows.length === 0) {
    inner.appendChild(el('p', { text: 'No records.', attrs: { style: 'color:var(--text-muted);padding:8px' } }));
    half.appendChild(inner);
    void bundle;
    return half;
  }
  const fieldsByName = new Map((leafFields(state.spec, state.endpoint) ?? []).map((f) => [f.name, f]));
  const otherByKey = new Map(otherRows.map((r) => [rowKey(r), r]));

  const wrap = el('div', { class: 'payload-rendered' });
  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const k of allKeys) {
    const th = el('th');
    const f = fieldsByName.get(k);
    if (f) th.dataset.status = f.status;
    if (f) {
      const badge = statusBadge(f.status);
      th.appendChild(el('span', { class: `pill ${badge.shape}`, text: badge.label, attrs: { 'aria-label': badge.text } }));
    }
    th.appendChild(el('span', { class: 'field-name', text: k }));
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const r of ownRows) {
    const stripped = stripInternal(r);
    const otherRow = otherByKey.get(rowKey(r));
    const otherStripped = otherRow ? stripInternal(otherRow) : null;
    const tr = el('tr');
    for (const k of allKeys) {
      const v = stripped[k];
      const ov = otherStripped ? otherStripped[k] : undefined;
      const td = el('td');
      td.textContent = v == null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      if (otherStripped) {
        const here = v != null;
        const there = ov != null;
        if (here && !there) td.classList.add('diff-only-here');
        else if (!here && there) td.classList.add('diff-missing');
        else if (here && there && JSON.stringify(v) !== JSON.stringify(ov)) td.classList.add('diff-changed');
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  inner.appendChild(wrap);
  half.appendChild(inner);
  return half;
}

// ---- Monthly summary on /transactions ---------------------------------------------------

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  month: 'short', year: 'numeric', timeZone: 'Asia/Dubai',
});

function renderMonthlySummary(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const d = new Date(r.BookingDateTime);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key, label: MONTH_FORMATTER.format(d),
        creditCount: 0, creditSum: 0,
        debitCount: 0, debitSum: 0,
        nsfCount: 0,
        currency: r.Amount?.Currency ?? '',
      });
    }
    const b = buckets.get(key);
    const amt = parseFloat(r.Amount?.Amount ?? '0');
    if (r.Status === 'Rejected') {
      b.nsfCount += 1;
      continue; // rejected debits don't move balance, exclude from credit/debit sums
    }
    if (r.CreditDebitIndicator === 'Credit') {
      b.creditCount += 1; b.creditSum += amt;
    } else {
      b.debitCount += 1; b.debitSum += amt;
    }
  }
  const ordered = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  const totalCredits = ordered.reduce((acc, m) => acc + m.creditSum, 0);
  const totalDebits = ordered.reduce((acc, m) => acc + m.debitSum, 0);
  const net = totalCredits - totalDebits;

  const det = el('details', { class: 'tx-monthly', attrs: { open: 'open' } });
  const summary = el('summary');
  summary.appendChild(el('span', { text: 'Monthly summary' }));
  summary.appendChild(el('span', {
    class: 'roll-badge',
    text: `${ordered.length} months · credits ${formatAmount(totalCredits)} · debits ${formatAmount(totalDebits)} · net ${formatAmount(net)} ${ordered[0]?.currency ?? ''}`.trim(),
  }));
  det.appendChild(summary);

  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of ['Month', 'Credits', 'Σ credits', 'Debits', 'Σ debits', 'Net', 'NSF']) {
    headRow.appendChild(el('th', { text: h }));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const m of ordered) {
    const tr = el('tr', { class: m.nsfCount > 0 ? 'has-nsf' : null });
    tr.appendChild(el('td', { text: m.label }));
    tr.appendChild(el('td', { text: String(m.creditCount) }));
    tr.appendChild(el('td', { text: formatAmount(m.creditSum) }));
    tr.appendChild(el('td', { text: String(m.debitCount) }));
    tr.appendChild(el('td', { text: formatAmount(m.debitSum) }));
    tr.appendChild(el('td', { text: formatAmount(m.creditSum - m.debitSum) }));
    tr.appendChild(el('td', { text: m.nsfCount > 0 ? String(m.nsfCount) : '—' }));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  det.appendChild(table);
  return det;
}

function formatAmount(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ---- Persona overview landing — story-level orientation -----------------------------------

function labelForEndpoint(ep) {
  if (ep === UNDERWRITING_PSEUDO) return 'Underwriting summary';
  if (ep === OVERVIEW_PSEUDO) return 'Persona overview';
  return ep;
}

function renderPersonaOverview(body) {
  const persona = state.data.personas[state.personaId];
  if (!persona) return;

  const wrap = el('div', { class: 'persona-overview' });
  wrap.appendChild(el('div', { class: 'po-archetype', text: humanArchetype(persona.archetype) }));
  wrap.appendChild(el('h2', { text: persona.name }));
  if (persona.narrative) {
    wrap.appendChild(el('div', { class: 'po-narrative', text: persona.narrative.trim() }));
  }

  const grid = el('div', { class: 'po-grid' });

  // Account roster — drawn from the live bundle so it matches what the
  // wire endpoints will show.
  const accCard = el('div', { class: 'po-card' });
  accCard.appendChild(el('div', { class: 'po-card-title', text: 'Accounts' }));
  const accList = el('ul');
  for (const a of state.bundle.accounts ?? []) {
    const id = a.AccountIdentifiers?.[0]?.Identification?.slice(0, 16) ?? a.AccountId;
    accList.appendChild(el('li', { text: `${a.AccountSubType} · ${a.Currency} · ${id}…` }));
  }
  accCard.appendChild(accList);
  grid.appendChild(accCard);

  // Income — straight from the persona manifest.
  if (persona.income) {
    const inc = el('div', { class: 'po-card' });
    inc.appendChild(el('div', { class: 'po-card-title', text: 'Income' }));
    const amt = persona.income.monthly_amount_aed
      ? `AED ${persona.income.monthly_amount_aed.toLocaleString()} / mo`
      : 'Variable';
    inc.appendChild(el('div', { class: 'po-card-value', text: amt }));
    const detail = [
      persona.income.flag_payroll ? 'Carries Flags=Payroll' : 'No Payroll flag',
      persona.income.pay_day ? `Pay-day ${persona.income.pay_day}th` : null,
      persona.income.variability ? `${persona.income.variability} variability` : null,
    ].filter(Boolean).join(' · ');
    if (detail) inc.appendChild(el('div', { attrs: { style: 'color:var(--text-muted);font-size:11px' }, text: detail }));
    grid.appendChild(inc);
  }

  // Fixed commitments — quick scan; full detail lives on /standing-orders
  // and /direct-debits.
  if (Array.isArray(persona.fixed_commitments) && persona.fixed_commitments.length > 0) {
    const fc = el('div', { class: 'po-card' });
    fc.appendChild(el('div', { class: 'po-card-title', text: `Fixed commitments (${persona.fixed_commitments.length})` }));
    const fcList = el('ul');
    for (const c of persona.fixed_commitments) {
      const amt = c.amount_aed
        ? `AED ${c.amount_aed.toLocaleString()}`
        : Array.isArray(c.amount_aed_band) ? `AED ${c.amount_aed_band[0]}–${c.amount_aed_band[1]}` : '—';
      fcList.appendChild(el('li', { text: `${c.kind === 'standing_order' ? 'SO' : 'DD'} · ${c.purpose} · ${amt} · ${c.schedule}` }));
    }
    fc.appendChild(fcList);
    grid.appendChild(fc);
  }

  // What this persona stresses — drives "why is this in the library?".
  if (Array.isArray(persona.stress_coverage) && persona.stress_coverage.length > 0) {
    const sc = el('div', { class: 'po-card' });
    sc.appendChild(el('div', { class: 'po-card-title', text: 'Stress coverage' }));
    const value = el('div', { class: 'po-card-value persona-best', text: bestForLine(persona) });
    sc.appendChild(value);
    grid.appendChild(sc);
  }

  // Quick flags row.
  const flags = el('div', { class: 'po-card' });
  flags.appendChild(el('div', { class: 'po-card-title', text: 'Profile flags' }));
  const flagList = [
    persona.fx_activity ? 'FX-active' : 'No FX',
    persona.cash_deposit_activity ? 'Cash-heavy' : 'No cash deposits',
    persona.distress_signals?.nsf_events_per_year_band
      ? `NSF events / yr: ${persona.distress_signals.nsf_events_per_year_band[0]}–${persona.distress_signals.nsf_events_per_year_band[1]}`
      : null,
  ].filter(Boolean);
  flags.appendChild(el('div', { attrs: { style: 'font-size:12px;line-height:1.5' }, text: flagList.join(' · ') }));
  grid.appendChild(flags);

  wrap.appendChild(grid);

  // Where to look first — direct jumps to wire endpoints. Deep-link the
  // Daniel/Maryam/Omar 5-minute walkthrough into a single click.
  const jumps = el('div', { class: 'po-jumps', attrs: { role: 'group', 'aria-label': 'Where to look first' } });
  const firstAcc = state.bundle.accounts?.[0]?.AccountId ?? null;
  const jumpDefs = [
    { label: 'Transactions →', endpoint: '/accounts/{AccountId}/transactions', acc: firstAcc },
    { label: 'Standing Orders →', endpoint: '/accounts/{AccountId}/standing-orders', acc: firstAcc },
    { label: 'Direct Debits →', endpoint: '/accounts/{AccountId}/direct-debits', acc: firstAcc },
    { label: 'Underwriting summary →', endpoint: UNDERWRITING_PSEUDO, acc: null },
  ];
  for (const j of jumpDefs) {
    const btn = el('button', {
      class: 'po-jump',
      text: j.label,
      attrs: { type: 'button' },
      onClick: () => {
        state.endpoint = j.endpoint;
        state.selectedAccountId = j.acc;
        clearTxState();
        renderNavigator();
        renderPayload();
      },
    });
    jumps.appendChild(btn);
  }
  wrap.appendChild(jumps);

  body.appendChild(wrap);
}

// ---- EXP-18 Underwriting Scenario panel -------------------------------------------------

function renderUnderwritingPanel(body) {
  const now = new Date(state.data.buildInfo.nowIso);
  const result = computeUnderwriting(state.bundle, now);

  const wrap = el('div', { class: 'uw-panel' });
  wrap.appendChild(el('h2', { class: 'uw-title', text: 'Underwriting Scenario — illustrative signals' }));
  wrap.appendChild(el('p', {
    class: 'uw-disclaimer',
    text: UNDERWRITING_FOOTNOTE,
  }));

  if (result.guard.triggered) {
    wrap.appendChild(el('div', {
      class: 'uw-guard',
      attrs: { role: 'status' },
      text: `Low-volume guard triggered. ${result.guard.reason} Off-the-shelf affordability formulas don't generalise to this segment — DBR is suppressed below.`,
    }));
  }

  const grid = el('div', { class: 'uw-grid' });
  grid.appendChild(renderUwSignal({
    title: 'Implied monthly net income',
    value: result.income.value != null ? `${formatAmount(result.income.value)} ${result.income.currency}` : '—',
    sub: result.income.sourceLabel,
    contributors: result.income.contributors,
    formula:
      'Trailing-12-month average of credits where Flags=Payroll. ' +
      'Fallback A: largest recurring credit on the same calendar day each month (≥3 occurrences). ' +
      'Fallback B: monthly average of credits from the top recurring counterparty (≥6 inflows). ' +
      'Final fallback: "—" with persona-specific guidance.',
    contributorRender: renderTxContributor,
  }));
  grid.appendChild(renderUwSignal({
    title: 'Total fixed commitments (monthly)',
    value: `${formatAmount(result.commitments.value)} ${result.commitments.currency}`,
    sub: `${result.commitments.contributors.length} active commitments — standing orders + direct debits, normalised to monthly via the resource's Frequency, multi-currency converted to AED at the pinned snapshot rate.`,
    contributors: result.commitments.contributors,
    formula:
      'Σ (NextPaymentAmount on active StandingOrders) + Σ (PreviousPaymentAmount on active DirectDebits, normalised by Frequency).',
    contributorRender: renderCommitmentContributor,
  }));
  grid.appendChild(renderUwSignal({
    title: 'Implied DBR',
    value: result.dbr.value != null ? result.dbr.label : '—',
    sub: result.dbr.value != null
      ? 'Commitments ÷ income, expressed as percentage. Treat values >50% as a stretch indicator; >100% means the persona is structurally unable to meet commitments from inferred income.'
      : (result.dbr.reason ?? 'Undefined.'),
    contributors: [],
    formula: 'Implied DBR = Total fixed commitments / Implied monthly net income.',
  }));
  grid.appendChild(renderUwSignal({
    title: 'NSF / distress event count',
    value: String(result.nsf.value),
    sub: result.nsf.value > 0
      ? `${result.nsf.value} rejected debit${result.nsf.value === 1 ? '' : 's'} in the trailing 12 months — see /transactions for the rows.`
      : 'No rejected debits in the trailing 12 months.',
    contributors: result.nsf.contributors,
    formula: 'Count of transactions in trailing 12 months where Status=Rejected. Phase 1.5 minimum — Phase 2 widens to "debit posted on a day where ClosingBooked balance for that account became negative".',
    contributorRender: renderTxContributor,
  }));
  wrap.appendChild(grid);
  body.appendChild(wrap);
}

function renderUwSignal({ title, value, sub, contributors, formula, contributorRender }) {
  const card = el('div', { class: 'uw-card' });
  const header = el('div', { class: 'uw-card-header' });
  header.appendChild(el('div', { class: 'uw-card-title', text: title }));
  header.appendChild(el('div', { class: 'uw-card-value', text: value }));
  card.appendChild(header);
  card.appendChild(el('div', { class: 'uw-card-sub', text: sub }));

  const formulaDet = el('details', { class: 'uw-card-formula' });
  formulaDet.appendChild(el('summary', { text: 'Formula' }));
  formulaDet.appendChild(el('p', { text: formula }));
  card.appendChild(formulaDet);

  if (contributors && contributors.length > 0) {
    const det = el('details', { class: 'uw-card-contrib' });
    det.appendChild(el('summary', { text: `Source fields (${contributors.length})` }));
    const list = el('ul');
    for (const c of contributors.slice(0, 30)) list.appendChild(contributorRender(c));
    if (contributors.length > 30) {
      list.appendChild(el('li', { text: `…${contributors.length - 30} more.` }));
    }
    det.appendChild(list);
    card.appendChild(det);
  }
  return card;
}

function renderTxContributor(c) {
  const li = el('li');
  const date = c.BookingDateTime?.slice(0, 10) ?? '—';
  const amt = c.Amount ? `${formatAmount(parseFloat(c.Amount.Amount))} ${c.Amount.Currency}` : '—';
  const tail = c.CreditorName ? ` · ${c.CreditorName}` : (c.TransactionInformation ? ` · ${c.TransactionInformation}` : '');
  li.textContent = `${date} · ${amt}${tail}`;
  return li;
}

function renderCommitmentContributor(c) {
  const li = el('li');
  const id = c.StandingOrderId || c.DirectDebitId || '?';
  const label = c.Reference || c.Name || c.kind;
  const amt = c.Amount ? `${c.Amount.Amount} ${c.Amount.Currency}` : '—';
  const freq = c.Frequency ? ` (${c.Frequency})` : '';
  const monthly = `≈ ${formatAmount(c.monthlyAed)} AED/mo`;
  li.textContent = `${id} · ${label} · ${amt}${freq} → ${monthly}`;
  return li;
}

// ---- EXP-12 bidirectional links ----------------------------------------------------------

function jumpFromForActiveEndpoint() {
  switch (state.endpoint) {
    case '/accounts/{AccountId}/standing-orders':
      return {
        kind: 'standing-order',
        label: (so) => `standing order "${so.Reference || so.StandingOrderId}"`,
        match: (tx, so) => {
          if (!so.Reference) return false;
          const ref = String(so.Reference).toUpperCase().slice(0, 6);
          return tx.TransactionType === 'LocalBankTransfer'
            && (tx.TransactionReference?.startsWith(ref) || tx.TransactionInformation?.toLowerCase().includes(String(so.Reference).replace(/_/g, ' ').toLowerCase()));
        },
      };
    case '/accounts/{AccountId}/direct-debits':
      return {
        kind: 'direct-debit',
        label: (dd) => `direct debit "${dd.Name || dd.DirectDebitId}"`,
        match: (tx, dd) => {
          const purpose = String(dd.Name || '').toLowerCase();
          return tx.TransactionType === 'BillPayments'
            && (tx.TransactionInformation?.toLowerCase().includes(purpose) || false);
        },
      };
    case '/accounts/{AccountId}/beneficiaries':
      return {
        kind: 'beneficiary',
        label: (b) => `beneficiary "${b.CreditorAccount?.[0]?.Name || b.BeneficiaryId}"`,
        match: (tx, b) => {
          const ben = b.CreditorAccount?.[0]?.Name?.toLowerCase();
          if (!ben) return false;
          return (tx.TransactionInformation?.toLowerCase().includes(ben)) || false;
        },
      };
    default:
      return null;
  }
}

function crossLinkToTransactions(record, jumpFrom) {
  // Find the related transactions in the bundle for the active account.
  const txs = state.bundle.transactions.filter(
    (t) => t._accountId === state.selectedAccountId && jumpFrom.match(t, record)
  );
  state.txHighlight = new Set(txs.map((t) => t.TransactionId));
  state.crossLink = {
    label: jumpFrom.label(record),
    fromEndpoint: state.endpoint,
    matchCount: txs.length,
  };
  state.endpoint = '/accounts/{AccountId}/transactions';
  // Pre-populate the search filter with the most-distinctive token so the
  // matching transactions also pass the row filter.
  state.txFilter = emptyTxFilter();
  if (jumpFrom.kind === 'direct-debit') {
    state.txFilter.search = String(record.Name || '').replace(/_/g, ' ').split(' ')[0] || '';
    state.txFilter.type = 'BillPayments';
  } else if (jumpFrom.kind === 'standing-order') {
    state.txFilter.search = String(record.Reference || '').replace(/_/g, ' ').split(' ')[0] || '';
    state.txFilter.type = 'LocalBankTransfer';
  }
  renderNavigator();
  renderPayload();
}

function renderCrossLinkBanner() {
  const banner = el('div', { class: 'cross-link-banner', attrs: { role: 'status' } });
  banner.appendChild(el('span', {
    text: `Showing transactions linked to ${state.crossLink.label} — ${state.crossLink.matchCount} match${state.crossLink.matchCount === 1 ? '' : 'es'} highlighted.`,
  }));
  banner.appendChild(el('button', {
    text: '← Back',
    onClick: () => {
      state.endpoint = state.crossLink.fromEndpoint;
      state.txFilter = emptyTxFilter();
      state.txHighlight = new Set();
      state.crossLink = null;
      renderNavigator();
      renderPayload();
    },
  }));
  return banner;
}

function stripInternal(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

function openFieldCard(name) {
  const fieldsByName = endpointFieldsByName();
  const f = fieldsByName.get(name);
  if (!f) return;
  const empty = document.getElementById('fc-empty');
  const content = document.getElementById('fc-content');
  empty.hidden = true;
  content.hidden = false;

  const rows = rowsForActiveEndpoint();
  const example = rows.find((r) => r[name] != null)?.[name];
  const band = bandForFieldName(name, state.endpoint);
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
    ['PII', isPii(name) ? 'Yes — under PDPL this field requires explicit data-handling controls.' : 'No (per the v1 PII allowlist).'],
    ['Spec', null], // rendered specially as a link
  ];
  for (const [k, v] of rowsToRender) {
    const row = el('div', { class: 'fc-row' });
    row.appendChild(el('span', { class: 'k', text: k }));
    if (k === 'Status') {
      const badge = statusBadge(f.status);
      const ve = el('span', { class: 'v' });
      ve.appendChild(
        el('span', { class: `pill ${badge.shape}`, text: badge.label, attrs: { 'aria-label': badge.text } })
      );
      ve.appendChild(document.createTextNode(badge.text));
      row.appendChild(ve);
    } else if (k === 'Spec') {
      const ve = el('span', { class: 'v' });
      if (citation) {
        ve.appendChild(
          el('a', {
            text: 'View on Nebras GitHub at pinned SHA →',
            attrs: { href: citation, target: '_blank', rel: 'noopener noreferrer' },
          })
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
    })
  );
  reportRow.appendChild(reportV);
  content.appendChild(reportRow);

  document.getElementById('field-detail').classList.add('open');
}

function formatExample(value) {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const ISSUE_REPO = 'openfinance-os/data-sandbox';

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
  ].filter((s) => s != null).join('\n');
  const params = new URLSearchParams();
  params.set('title', title);
  params.set('body', body);
  return `https://github.com/${ISSUE_REPO}/issues/new?${params.toString()}`;
}

// ---- Hover preview tooltip — quick field-card peek (EXP-14) ----------------------------

let hoverHideTimer = null;

function attachHoverPreview(node, fieldName) {
  let openTimer = null;
  const open = () => {
    clearTimeout(hoverHideTimer);
    showHoverPreview(node, fieldName);
  };
  const hide = () => {
    clearTimeout(openTimer);
    hoverHideTimer = setTimeout(hideHoverPreview, 80);
  };
  node.addEventListener('mouseenter', () => { openTimer = setTimeout(open, 120); });
  node.addEventListener('mouseleave', hide);
  node.addEventListener('focus', open);
  node.addEventListener('blur', hide);
}

function showHoverPreview(anchor, fieldName) {
  const fieldsByName = endpointFieldsByName();
  const f = fieldsByName.get(fieldName);
  if (!f) return;
  const card = document.getElementById('hovercard');
  if (!card) return;
  const band = bandForFieldName(fieldName, state.endpoint);
  const badge = statusBadge(f.status);

  card.replaceChildren();
  card.appendChild(el('div', { class: 'hc-title', text: fieldName }));
  const status = el('div', { class: 'hc-status' });
  status.appendChild(el('span', { class: `pill ${badge.shape}`, text: badge.label, attrs: { 'aria-label': badge.text } }));
  status.appendChild(document.createTextNode(badge.text));
  if (band) status.appendChild(el('span', {
    attrs: { style: 'margin-left:6px;font-size:10px;color:var(--text-muted)' },
    text: ` · ${band} band`,
  }));
  card.appendChild(status);
  card.appendChild(el('div', { class: 'hc-guidance', text: realLfisGuidance(f, band) }));
  const meta = `${f.type}${f.format ? ' · ' + f.format : ''}${Array.isArray(f.enum) ? ` · enum (${f.enum.length})` : ''}`;
  card.appendChild(el('div', { class: 'hc-meta', text: meta }));
  card.appendChild(el('div', {
    class: 'hc-meta',
    attrs: { style: 'margin-top:6px;font-style:italic' },
    text: 'Click to pin full card →',
  }));

  // Position next to the anchor — prefer below, flip above if overflowing.
  card.hidden = false;
  const r = anchor.getBoundingClientRect();
  const cardW = Math.min(card.offsetWidth, 320);
  const cardH = card.offsetHeight;
  let left = Math.min(window.innerWidth - cardW - 8, Math.max(8, r.left));
  let top = r.bottom + 6;
  if (top + cardH > window.innerHeight - 8) top = Math.max(8, r.top - cardH - 6);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function hideHoverPreview() {
  const card = document.getElementById('hovercard');
  if (card) card.hidden = true;
}

// ---- Embed-snippet copy — EXP-27 ergonomic affordance ----------------------------------

function copyEmbedSnippet() {
  const slugBase = window.location.origin + window.location.pathname.replace(/\/index\.html$/, '');
  const url = slugBase.replace(/\/$/, '') + encodeEmbed({
    personaId: state.personaId,
    lfi: state.lfi,
    endpoint: state.endpoint === OVERVIEW_PSEUDO || state.endpoint === UNDERWRITING_PSEUDO
      ? '/accounts/{AccountId}/transactions'
      : state.endpoint,
    seed: state.seed,
    height: 600,
  }).replace(/^\/embed/, '/embed.html');
  const snippet = `<iframe src="${url}" width="100%" height="600" loading="lazy" title="Open Finance Data Sandbox · ${state.personaId} · ${state.lfi}" referrerpolicy="no-referrer" style="border:1px solid #d9d5cb;border-radius:4px"></iframe>`;
  // Best-effort clipboard. Falls back to a textarea + selection so the user
  // can ⌘C themselves if the browser blocks programmatic clipboard access.
  const ok = (text) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showCopyToast('Embed snippet copied. Paste into your slide deck or article.'),
        () => fallbackCopy(text),
      );
    } else {
      fallbackCopy(text);
    }
  };
  ok(snippet);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showCopyToast('Embed snippet copied.'); }
  catch { showCopyToast('Copy blocked — selecting snippet for ⌘C / Ctrl+C.'); ta.style.opacity = '1'; return; }
  ta.remove();
}

function showCopyToast(text) {
  document.querySelectorAll('.copy-toast').forEach((n) => n.remove());
  const t = el('div', { class: 'copy-toast', attrs: { role: 'status' }, text });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// ---- First-load coachmark cascade — orientation for cold visitors ----------------------

const COACHMARKS = [
  {
    target: '#lfi-seg',
    arrow: 'top',
    title: 'LFI populate-rate — the central lever',
    body: 'Rich, Median, or Sparse decides which optional fields are populated. Switch to Sparse to see the worst-case shape your downstream UI must handle.',
  },
  {
    target: '#coverage',
    arrow: 'top',
    title: 'Coverage by populate-rate band',
    body: 'Each strip is one §7.3 band — Universal, Common, Variable, Rare. Filled cells show how many curated probes are actually populated under the current LFI profile.',
  },
  {
    target: '.persona-pane',
    arrow: 'left',
    title: 'Pick a persona that matches your job',
    body: 'Use the chip rail at the top — Affordability, AML, Thin file, FX — to filter the library. Each card has a "Best for" line so you can spot the right one without reading every narrative.',
  },
  {
    target: '#endpoint-label',
    arrow: 'top',
    title: 'Click any field name',
    body: 'Hover for a quick preview. Click to pin the full card on the right — status, type, enum, example, conditional rule, and Real-LFIs guidance, all spec-driven from the pinned SHA.',
  },
  {
    target: '#tour-btn',
    arrow: 'top',
    title: 'Want a longer walkthrough?',
    body: 'Tour walks through Sara\'s bundle in five steps — salary marker, rent commitment, field card, Sparse drop-off. Find (⌘K) jumps to any field by name.',
  },
];

function startCoachmarks() {
  if (state.coachDismissed) return;
  state.coachStep = 0;
  document.getElementById('coachmark-host').hidden = false;
  renderCoachmark();
}

function dismissCoachmarks() {
  state.coachStep = null;
  state.coachDismissed = true;
  const host = document.getElementById('coachmark-host');
  if (host) {
    host.hidden = true;
    host.replaceChildren();
  }
}

function renderCoachmark() {
  const host = document.getElementById('coachmark-host');
  if (!host) return;
  host.replaceChildren();
  const step = COACHMARKS[state.coachStep];
  if (!step) {
    dismissCoachmarks();
    return;
  }
  const target = document.querySelector(step.target);
  if (!target) {
    state.coachStep += 1;
    renderCoachmark();
    return;
  }

  const card = el('div', { class: 'coachmark', attrs: { role: 'dialog', 'aria-labelledby': 'cm-title', 'data-arrow': step.arrow } });
  card.appendChild(el('div', { class: 'cm-step', text: `Step ${state.coachStep + 1} of ${COACHMARKS.length}` }));
  card.appendChild(el('h4', { text: step.title, attrs: { id: 'cm-title' } }));
  card.appendChild(el('p', { text: step.body }));
  const actions = el('div', { class: 'cm-actions' });
  actions.appendChild(el('button', { class: 'cm-skip', text: 'Skip', onClick: dismissCoachmarks }));
  const right = el('div', { attrs: { style: 'display:flex;gap:6px' } });
  if (state.coachStep > 0) {
    right.appendChild(el('button', { text: 'Back', onClick: () => { state.coachStep -= 1; renderCoachmark(); } }));
  }
  const isLast = state.coachStep === COACHMARKS.length - 1;
  right.appendChild(el('button', {
    class: 'cm-primary',
    text: isLast ? 'Got it' : 'Next →',
    onClick: () => {
      if (isLast) dismissCoachmarks();
      else { state.coachStep += 1; renderCoachmark(); }
    },
  }));
  actions.appendChild(right);
  card.appendChild(actions);
  host.appendChild(card);

  // Position next to the target — prefer below for top-arrow, right of
  // target for left-arrow, etc.
  const r = target.getBoundingClientRect();
  const cardW = 280;
  const cardH = card.offsetHeight || 140;
  let left = r.left;
  let top = r.bottom + 12;
  if (step.arrow === 'left') {
    left = r.right + 14;
    top = Math.max(8, r.top);
  } else if (step.arrow === 'right') {
    left = r.left - cardW - 14;
    top = Math.max(8, r.top);
  } else if (step.arrow === 'bottom') {
    top = r.top - cardH - 12;
  }
  // Clamp to viewport.
  left = Math.max(8, Math.min(window.innerWidth - cardW - 8, left));
  top = Math.max(8, Math.min(window.innerHeight - cardH - 8, top));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.querySelector('.cm-primary')?.focus();
}

init().catch((err) => {
  // Render fallback safely — never use innerHTML/insertAdjacentHTML with untrusted data.
  const banner = el('pre', {
    text: `init failed: ${String(err.message ?? err)}`,
    attrs: { style: 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0' },
  });
  document.body.insertBefore(banner, document.body.firstChild);
});
