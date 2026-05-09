// Sandbox UI entry — wires the three-pane layout to the deterministic
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
import { decodeFromUrl, encodeEmbed, encodeFixtureUrl, encodePermalink, CUSTOM_PERSONA_SLUG } from './url.js';
import { expandRecipe } from './persona-builder/expand.js';
import { decodeRecipe, encodeRecipe, RECIPE_DEFAULTS } from './persona-builder/recipe.js';
import { mountPersonaBuilder } from './ui/persona-builder-ui.js';
import { createFindBox } from './ui/find-box.js';
import { createTour } from './ui/tour.js';
import { createCompareView } from './ui/compare-view.js';
import { createTxFilter } from './ui/tx-filter.js';
import { createMonthlySummary } from './ui/monthly-summary.js';
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
  // Phase 2.0 multi-domain (slice 8). state.domain is 'banking' by default;
  // preview-status domains (e.g. insurance) are now visible in the chip and
  // tagged "(preview)" in the option label.
  // domains: id → manifest entry (label, status, parsedJsonUrl, defaultEndpoint).
  // activePersonas: state.data.personas filtered to state.domain.
  domain: 'banking',
  preview: false,
  domains: null,
  activePersonas: null,
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
  // PII-only column filter — Reem's JTBD-12.1 ("scope my data-handling
  // controls under PDPL"). When true, the rendered table hides every
  // column whose field is not in the curated PII allowlist.
  piiOnly: false,
  // Cold-landing welcome cards — first-load orientation for visitors arriving
  // from the Commons feed. Per EXP-22 the app does not write to local /
  // sessionStorage, so the dismissal lives only in JS state (a refresh re-shows
  // by design) and the cards fire only when the URL has no query params.
  welcomeShown: false,
  welcomeDismissed: false,
};

// Mount the Find box (Cmd+K) and the Tell-me-a-story tour. `state` is
// a const and the helpers below are hoisted function declarations —
// so closure-binding the deps here at module load is stable.
const { openFind, closeFind } = createFindBox({
  state, el, humanArchetype, rebuildAndRender, clearTxState,
  renderNavigator, renderPayload, openFieldCard,
});
const { startTour } = createTour({
  state, el, setPersona, emptyTxFilter,
  renderNavigator, renderPayload, renderCoverage,
});
const { renderCompareView } = createCompareView({
  state, el, stripInternal,
});
const { renderTxFilterBar, applyFilter, applySort, toggleSort } = createTxFilter({
  state, el, renderPayload, emptyTxFilter,
});
const { renderMonthlySummary } = createMonthlySummary({ el, formatAmount });

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
  // Wire the pane-collapse chevrons before any await so they remain live even
  // if the data/spec fetches fail (e.g. when the user serves the repo from
  // src/ alone and ../dist isn't reachable). The chevrons live in static HTML
  // and don't depend on any async state.
  wirePaneCollapse();

  // Cold landing = URL with no query params (visitor arriving from the
  // Commons feed for the first time). Drives the welcome cards since EXP-22
  // forbids storage-based "first-visit" detection.
  const isColdLanding = window.location.search === '';
  state.welcomeShown = isColdLanding;

  const url = decodeFromUrl(window.location.href);
  state.preview = url.preview;

  // Slice 8: domain manifest drives which SPEC.json to lazy-load. Banking
  // remains the default; unknown domain values fall back to banking.
  const [domainsRes, dataRes] = await Promise.all([
    fetch('../dist/domains.json'),
    fetch('../dist/data.json'),
  ]);
  const domainsManifest = await domainsRes.json();
  state.data = await dataRes.json();
  state.domains = Object.fromEntries(domainsManifest.domains.map((d) => [d.id, d]));

  let resolvedDomain = url.domain;
  const requested = state.domains[resolvedDomain];
  if (!requested) {
    resolvedDomain = 'banking';
  }
  state.domain = resolvedDomain;

  const specEntry = state.domains[state.domain];
  // parsedJsonUrl is "/dist/SPEC.<domain>.json"; the app is served from src/
  // so we walk one level up.
  const specRes = await fetch(`..${specEntry.parsedJsonUrl}`);
  state.spec = await specRes.json();

  state.activePersonas = Object.fromEntries(
    Object.entries(state.data.personas).filter(([, p]) => p.domain === state.domain)
  );

  // Workstream B — materialise a custom persona from the URL recipe param,
  // if present. The generator pipeline is persona-agnostic; injecting the
  // expanded persona into state.data.personas + state.activePersonas under
  // the 'custom' key lets the rest of the app behave identically to a
  // curated persona. The recipe itself stays in state.recipe so
  // pushPermalink can re-encode it on share / URL update.
  if (
    state.domain === 'banking' &&
    url.personaId === CUSTOM_PERSONA_SLUG &&
    url.recipe
  ) {
    try {
      const recipe = decodeRecipe(url.recipe);
      const customPersona = expandRecipe(recipe, state.data.pools);
      state.data.personas[CUSTOM_PERSONA_SLUG] = customPersona;
      state.activePersonas[CUSTOM_PERSONA_SLUG] = customPersona;
      state.recipe = recipe;
    } catch (err) {
      console.warn('Custom persona recipe failed to expand:', err);
    }
  }

  state.personaId = url.personaId && state.activePersonas[url.personaId]
    ? url.personaId
    : Object.keys(state.activePersonas)[0];
  state.lfi = url.lfi;
  state.seed = url.seed;
  // EXP-17: honour the URL's pinned endpoint when it's recognised by the
  // active domain's spec or one of the two banking pseudo-endpoints
  // (overview, underwriting). Falls back to the domain default otherwise.
  if (state.domain === 'banking') {
    const isPseudo = url.endpoint === OVERVIEW_PSEUDO || url.endpoint === UNDERWRITING_PSEUDO;
    const isSpecEndpoint = url.endpoint && ENDPOINTS.some((e) => e.path === url.endpoint);
    if (isPseudo || isSpecEndpoint) state.endpoint = url.endpoint;
  } else {
    state.endpoint = url.endpoint && state.spec.endpoints[url.endpoint]
      ? url.endpoint
      : specEntry.defaultEndpoint || Object.keys(state.spec.endpoints)[0];
  }

  document.getElementById('footer-sha').textContent = (state.spec.pinSha || 'unknown').slice(0, 7);
  // specVersion already starts with "v" — don't double-prefix.
  const v = String(state.spec.specVersion || '');
  const versionLabel = v.startsWith('v') ? v : `v${v}`;
  const pin = document.getElementById('version-pin');
  pin.textContent = `${versionLabel} @ ${(state.spec.pinSha || '').slice(0, 7)}`;
  pin.title = `Pinned spec SHA ${state.spec.pinSha}\nRetrieved ${state.spec.retrievedAt}\nUpstream: ${state.spec.upstreamRepo}/${state.spec.upstreamPath}`;

  buildJtbdRail();
  buildPersonaList();
  renderDomainChip();
  syncControls();
  attachEventHandlers();
  attachBuilderHandlers();
  // Workstream C plug-point 1 (Service Worker fixture mock) is implemented
  // and unit-tested under tests/fixture-handler.test.mjs; live registration
  // is gated on a deployment-time `Service-Worker-Allowed: /` header that
  // requires sandbox-host configuration outside this commit's scope. Until
  // that lands, custom-persona bundles are accessible via the npm engine
  // (plug-point 2) and the static-fixture zip download (plug-point 3).
  rebuildAndRender();
}

// Workstream B — wire the "+ Build a custom persona" CTA in the persona pane
// to the builder dialog. The dialog is mounted lazily on first open so the
// initial render stays cheap; subsequent opens reuse the same instance.
let builderInstance = null;
function attachBuilderHandlers() {
  const btn = document.getElementById('open-builder-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!builderInstance) {
      builderInstance = mountPersonaBuilder({
        pools: state.data.pools,
        currentRecipe: state.recipe,
        onApply: ({ recipe, persona }) => {
          state.data.personas[CUSTOM_PERSONA_SLUG] = persona;
          state.activePersonas[CUSTOM_PERSONA_SLUG] = persona;
          state.recipe = recipe;
          state.personaId = CUSTOM_PERSONA_SLUG;
          state.endpoint = OVERVIEW_PSEUDO;
          state.selectedAccountId = null;
          buildPersonaList();
          rebuildAndRender();
        },
      });
    }
    builderInstance.open(state.recipe ?? { ...RECIPE_DEFAULTS });
  });
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
  for (const [id, p] of Object.entries(state.activePersonas ?? state.data.personas)) {
    if (!personaMatchesActiveFilter(p)) continue;
    visibleCount += 1;

    const isCustom = id === CUSTOM_PERSONA_SLUG;
    const card = el(
      'div',
      {
        class: `persona-card${isCustom ? ' is-custom' : ''}`,
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
      el('div', { class: 'persona-name' },
        document.createTextNode(p.name),
        isCustom ? el('span', { class: 'custom-badge', text: 'Custom (not curated)' }) : null,
      ),
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
  const piiOnly = document.getElementById('toggle-pii-only');
  if (piiOnly) piiOnly.checked = !!state.piiOnly;
  for (const card of document.querySelectorAll('.persona-card')) {
    card.classList.toggle('active', card.dataset.personaId === state.personaId);
  }
}

// Side-pane collapse — frees screen real estate for the navigator. State
// lives in JS only (EXP-22 forbids storage), so a refresh restores both
// panes. Field-card opens auto-expand the right pane (matches the existing
// .field-detail.open overlay behavior used at ≤1099 px).
const PANE_COLLAPSE_CLASS = { 'persona-pane': 'left-collapsed', 'field-detail': 'right-collapsed' };
function setPaneCollapsed(target, collapsed) {
  const root = document.getElementById('three-pane');
  if (!root) return;
  const cls = PANE_COLLAPSE_CLASS[target];
  if (!cls) return;
  root.classList.toggle(cls, collapsed);
  // At ≤1099 px the field-detail is a slide-in overlay (.open), not a grid
  // column — its chevron means "dismiss" there, so drop .open too.
  if (target === 'field-detail' && collapsed) {
    document.getElementById('field-detail').classList.remove('open');
  }
  for (const btn of document.querySelectorAll(`.pane-collapse[data-target="${target}"]`)) {
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}
function wirePaneCollapse() {
  for (const btn of document.querySelectorAll('.pane-collapse')) {
    btn.addEventListener('click', () => setPaneCollapsed(btn.dataset.target, true));
  }
  for (const rail of document.querySelectorAll('.pane-rail')) {
    rail.addEventListener('click', () => setPaneCollapsed(rail.dataset.target, false));
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
  document.getElementById('seed-reset')?.addEventListener('click', () => {
    const persona = state.data.personas[state.personaId];
    const def = Number(persona?.default_seed);
    state.seed = Number.isFinite(def) ? def : 1;
    rebuildAndRender();
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
  document.getElementById('toggle-pii-only')?.addEventListener('change', (e) => {
    state.piiOnly = !!e.target.checked;
    renderPayload();
  });
  document.getElementById('export-json').addEventListener('click', exportActiveJson);
  document.getElementById('export-csv').addEventListener('click', exportActiveCsv);
  document.getElementById('export-tar').addEventListener('click', exportTarball);
  document.getElementById('export-embed')?.addEventListener('click', copyEmbedSnippet);
  document.getElementById('tour-btn').addEventListener('click', () => startTour());
  document.getElementById('find-btn').addEventListener('click', openFind);
  // EXP-17 Share — pushPermalink keeps window.location.href canonical on every
  // state change, so the live href is the right thing to put on the clipboard.
  document.getElementById('share-btn').addEventListener('click', () => {
    copyDemoSnippet(window.location.href, 'Permalink copied.');
  });
  // ⌘K / Ctrl+K opens the find box from anywhere in the app.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openFind();
    } else if (e.key === 'Escape') {
      if (document.getElementById('find-overlay')) closeFind();
    }
  });
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

  if (state.domain !== 'banking') {
    // Phase 2.0 motor full-coverage: insurance bundles render through a
    // domain-aware navigator + per-endpoint payload renderer (status badges
    // from the parsed insurance spec), replacing the bundle-wide JSON
    // inspector. Compare-LFIs / underwriting / banking-shaped coverage are
    // still banking-only — those are derived views with no insurance analogue.
    renderInsuranceBundle();
    pushPermalink();
    setTimeout(() => body?.classList.remove('is-fading'), 30);
    return;
  }

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

// ── Insurance domain UI (Phase 2.0 motor full-coverage) ────────────────────
//
// Banking and insurance share the three-pane layout, the persona library,
// the LFI selector, the share-URL machinery and the rendered/raw toggle.
// They diverge in (a) the navigator (banking has bundle + per-account
// sections; insurance has a flat motor section), (b) the payload renderer
// (banking renders rows-as-table; insurance renders nested-record-as-tree
// because the motor schemas are deep, not list-shaped), and (c) the coverage
// meter (banking probes are spec-anchored; insurance preview reuses the
// same status-badge metadata but counts populated optional leaf fields
// directly until lfi-bands.insurance.yaml grows beyond the 4-path starter).
function renderInsuranceBundle() {
  // Pin a sensible endpoint when state.endpoint is unset, was inherited from
  // a banking session, or refers to a path the active spec doesn't expose.
  if (!state.endpoint || !state.spec.endpoints?.[state.endpoint]) {
    state.endpoint =
      state.domains?.[state.domain]?.defaultEndpoint ??
      Object.keys(state.spec.endpoints ?? {})[0] ??
      null;
  }
  syncControls();
  renderInsuranceNavigator();
  renderInsurancePayload();
  renderInsuranceCoverage();
}

function renderInsuranceNavigator() {
  const nav = document.getElementById('nav-tree');
  if (!nav) return;
  nav.replaceChildren();
  const dom = state.domains?.[state.domain];
  const wrap = el('div', { class: 'nav-account is-bundle' });
  wrap.appendChild(
    el('div', { class: 'nav-account-header', text: dom?.label ?? 'Insurance' })
  );
  const inScope =
    state.spec?.inScopePaths ?? Object.keys(state.spec?.endpoints ?? {});
  for (const ep of inScope) {
    const isActive = state.endpoint === ep;
    const cov = insuranceCoverageForEndpoint(ep);
    const btn = el(
      'button',
      {
        class: `nav-endpoint${isActive ? ' active' : ''}`,
        attrs: { 'aria-current': isActive ? 'true' : null },
        dataset: { endpoint: ep },
        onClick: () => {
          state.endpoint = ep;
          renderInsuranceNavigator();
          renderInsurancePayload();
          renderInsuranceCoverage();
          pushPermalink();
        },
      },
      el('span', { class: 'nav-endpoint-label', text: ep })
    );
    if (cov.total > 0) {
      const meter = el('span', {
        class: 'nav-endpoint-meter',
        attrs: {
          title: `${cov.populated} of ${cov.total} optional leaf fields populated (${cov.pct}%)`,
        },
        text: `${cov.pct}%`,
      });
      btn.appendChild(meter);
    }
    wrap.appendChild(btn);
  }
  nav.appendChild(wrap);
}

function insuranceDataForEndpoint(endpoint) {
  switch (endpoint) {
    case '/motor-insurance-policies':
      return {
        kind: 'list',
        Data: { Policies: state.bundle.motorPolicySummaries ?? [] },
      };
    case '/motor-insurance-policies/{InsurancePolicyId}': {
      const policy = state.bundle.motorPolicies?.[0];
      return policy ? { kind: 'detail', Data: policy } : null;
    }
    case '/motor-insurance-policies/{InsurancePolicyId}/payment-details':
      return state.bundle.paymentDetails
        ? { kind: 'detail', Data: state.bundle.paymentDetails }
        : null;
    case '/motor-insurance-quotes/{QuoteId}':
      return state.bundle.motorQuote
        ? { kind: 'detail', Data: state.bundle.motorQuote }
        : null;
    default:
      return null;
  }
}

function renderInsurancePayload() {
  const body = document.getElementById('payload-body');
  const epLabel = document.getElementById('endpoint-label');
  if (!body) return;
  body.replaceChildren();
  if (epLabel) epLabel.textContent = state.endpoint ?? '';

  // Sync the rendered/raw toggle aria state so a switch from the banking flow
  // (where the toggle was already wired) stays consistent.
  document
    .getElementById('view-rendered')
    ?.classList.toggle('active', state.view === 'rendered');
  document
    .getElementById('view-raw')
    ?.classList.toggle('active', state.view === 'raw');
  document
    .getElementById('view-rendered')
    ?.setAttribute('aria-selected', state.view === 'rendered');
  document
    .getElementById('view-raw')
    ?.setAttribute('aria-selected', state.view === 'raw');

  const slice = insuranceDataForEndpoint(state.endpoint);
  if (!slice) {
    body.appendChild(
      el('p', {
        text: `No data for ${state.endpoint} in this bundle.`,
        attrs: { style: 'color:var(--text-muted);padding:8px 12px' },
      })
    );
    return;
  }

  // Build a shared field-name → metadata map from the parsed spec so the
  // tree renderer can attach status badges, formats, and enum chips.
  const fields = leafFields(state.spec, state.endpoint);
  const fieldsByName = new Map();
  for (const f of fields) fieldsByName.set(f.name, f);

  if (state.view === 'raw') {
    body.appendChild(
      el('pre', {
        class: 'payload-raw',
        text: JSON.stringify(slice.Data, null, 2),
      })
    );
    return;
  }

  const wrap = el('div', { class: 'payload-rendered insurance-payload' });

  if (slice.kind === 'list') {
    const policies = slice.Data.Policies ?? [];
    if (policies.length === 0) {
      wrap.appendChild(el('p', { text: 'No policies.' }));
    } else {
      const summary = el('div', {
        class: 'insurance-list-summary',
        text: `${policies.length} ${policies.length === 1 ? 'policy' : 'policies'} on this persona`,
      });
      wrap.appendChild(summary);
      for (const p of policies) {
        wrap.appendChild(insuranceRecordCard(p, fieldsByName));
      }
    }
  } else {
    wrap.appendChild(insuranceRecordCard(slice.Data, fieldsByName));
  }

  body.appendChild(wrap);
}

function insuranceRecordCard(record, fieldsByName) {
  const card = el('div', { class: 'insurance-record' });
  card.appendChild(insuranceFieldTree(record, fieldsByName));
  return card;
}

// Render an arbitrary JSON record as a labelled <dl> tree, attaching a
// status badge / format / enum chip to every leaf whose field name matches
// a parsed spec record. Field-name matching mirrors the banking renderer's
// endpointFieldsByName() — collisions on common names (Amount, Currency)
// resolve to the first registered field, which is acceptable for the read
// view.
function insuranceFieldTree(value, fieldsByName) {
  if (value == null) {
    return el('span', { class: 'value-empty', text: '—' });
  }
  if (typeof value !== 'object') {
    return el('span', { class: 'value-leaf', text: String(value) });
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return el('span', { class: 'value-empty', text: '[]' });
    const ol = el('ol', { class: 'insurance-array' });
    value.forEach((item, i) => {
      const li = el('li', { class: 'insurance-array-row' });
      li.appendChild(el('span', { class: 'array-index', text: `[${i}]` }));
      li.appendChild(insuranceFieldTree(item, fieldsByName));
      ol.appendChild(li);
    });
    return ol;
  }
  const dl = el('dl', { class: 'insurance-field-tree' });
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('_')) continue; // strip generator-internal markers
    const meta = fieldsByName.get(k);
    const dt = el('dt', { class: 'insurance-field-label' });
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
        })
      );
    }
    dt.appendChild(el('span', { class: 'field-name', text: k }));
    if (meta?.format) {
      dt.appendChild(el('span', { class: 'field-format', text: meta.format }));
    }
    if (meta?.enum && Array.isArray(meta.enum) && meta.enum.length <= 6) {
      dt.appendChild(
        el('span', { class: 'field-enum', text: `[${meta.enum.join(' | ')}]` })
      );
    }
    const dd = el('dd', { class: 'insurance-field-value' });
    dd.appendChild(insuranceFieldTree(v, fieldsByName));
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  return dl;
}

// Coverage for the active insurance endpoint: of the leaf optional fields
// the spec defines, how many actually carry a value in the rendered slice.
// A simple, domain-honest metric — banking's spec-anchored probes don't
// translate to motor-insurance shapes, and the lfi-bands.insurance.yaml
// starter only calibrates four paths, so band-segmented coverage isn't
// honest yet.
function insuranceCoverageForEndpoint(endpoint) {
  const fields = leafFields(state.spec, endpoint);
  const optional = fields.filter((f) => f.status !== 'mandatory');
  if (optional.length === 0) return { populated: 0, total: 0, pct: 0 };
  const slice = insuranceDataForEndpoint(endpoint);
  if (!slice) return { populated: 0, total: optional.length, pct: 0 };
  const valuesByName = collectValuesByFieldName(slice.Data);
  let populated = 0;
  for (const f of optional) {
    const values = valuesByName.get(f.name);
    if (values && values.some((v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))) {
      populated += 1;
    }
  }
  return {
    populated,
    total: optional.length,
    pct: Math.round((populated / optional.length) * 100),
  };
}

function collectValuesByFieldName(value, out = new Map()) {
  if (value == null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const v of value) collectValuesByFieldName(v, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('_')) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(v);
    collectValuesByFieldName(v, out);
  }
  return out;
}

function renderInsuranceCoverage() {
  const cov = insuranceCoverageForEndpoint(state.endpoint);
  const pctEl = document.getElementById('coverage-pct');
  if (pctEl) pctEl.textContent = cov.total > 0 ? `${cov.pct}%` : '—';
  // Banking band cells don't translate to insurance preview — clear them
  // rather than render a misleading per-band breakdown against an
  // uncalibrated band map.
  document.getElementById('coverage-bands')?.replaceChildren();
}

// Slice 8b: visible domain selector. The chip lists every domain from
// dist/domains.json; preview-status domains carry a "(preview)" tag.
function renderDomainChip() {
  const chip = document.getElementById('domain-chip');
  if (!chip) return;
  chip.hidden = false;
  chip.replaceChildren();
  for (const dom of Object.values(state.domains)) {
    const opt = document.createElement('option');
    opt.value = dom.id;
    opt.textContent = dom.status === 'preview' ? `${dom.label} (preview)` : dom.label;
    if (dom.id === state.domain) opt.selected = true;
    chip.appendChild(opt);
  }
  // Use onchange (not addEventListener) so multiple renderDomainChip calls
  // don't stack handlers.
  chip.onchange = (e) => {
    const next = e.target.value;
    if (next !== state.domain) void switchDomain(next);
  };
}

async function switchDomain(newDomain) {
  const entry = state.domains?.[newDomain];
  if (!entry) return;
  const specRes = await fetch(`..${entry.parsedJsonUrl}`);
  state.spec = await specRes.json();
  state.domain = newDomain;
  state.activePersonas = Object.fromEntries(
    Object.entries(state.data.personas).filter(([, p]) => p.domain === newDomain)
  );
  state.personaId = Object.keys(state.activePersonas)[0];
  state.endpoint = entry.defaultEndpoint || Object.keys(state.spec.endpoints)[0];
  // Refresh topbar metadata to reflect the active spec.
  const v = String(state.spec.specVersion || '');
  const versionLabel = v.startsWith('v') ? v : `v${v}`;
  const pin = document.getElementById('version-pin');
  if (pin) {
    pin.textContent = `${versionLabel} @ ${(state.spec.pinSha || '').slice(0, 7)}`;
    pin.title = `Pinned spec SHA ${state.spec.pinSha}\nRetrieved ${state.spec.retrievedAt}\nUpstream: ${state.spec.upstreamRepo}/${state.spec.upstreamPath}`;
  }
  buildPersonaList();
  renderDomainChip();
  rebuildAndRender();
}

function pushPermalink() {
  // Phase 0: keep the current pathname; only update the query string. Phase 1
  // will switch to the §6.8 permalink shape (/commons/[slug]/p/<id>?...) once
  // the Commons publication path is live.
  const params = new URLSearchParams();
  params.set('persona', state.personaId);
  params.set('lfi', state.lfi);
  params.set('seed', String(state.seed));
  // Slice 8: domain + preview round-trip. Banking is the default and stays
  // implicit so existing permalinks remain unchanged.
  if (state.domain && state.domain !== 'banking') params.set('domain', state.domain);
  if (state.preview) params.set('preview', '1');
  // EXP-17: encode the active endpoint so Share copies "where the user
  // currently is", not the cold-landing default. Account scope is implicit —
  // selectedAccountId is always the first account of the active persona on
  // hydrate, so we don't need to round-trip it. The two pseudo-endpoints
  // (overview, underwriting) are the cold-landing defaults; emitting them
  // would just clutter the URL, so they stay implicit.
  if (
    state.endpoint &&
    state.endpoint !== '/accounts' &&
    state.endpoint !== OVERVIEW_PSEUDO &&
    state.endpoint !== UNDERWRITING_PSEUDO
  ) {
    params.set('endpoint', state.endpoint);
  }
  // Workstream B — emit the recipe param when the active persona is the
  // ephemeral custom one, so the URL fully describes the bundle.
  if (state.personaId === CUSTOM_PERSONA_SLUG && state.recipe) {
    params.set('recipe', encodeRecipe(state.recipe));
  }
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

  // Cold-landing welcome — three jump cards routing the user to the surface
  // that matches their JTBD (Sara explore vs. Maryam embed vs. Hamid
  // fixtures). Lives at the top of the payload area; one-shot, dismissed
  // via JS state once the user picks a path.
  if (state.welcomeShown && !state.welcomeDismissed) {
    body.appendChild(renderWelcomeCards());
  }

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
    // Sara's primary JTBD-1.1/1.2 lives on /transactions. Dock a compact
    // 4-stat strip so the underwriting signals are one glance away
    // without leaving the wire view; clicking opens the full panel.
    body.appendChild(renderUnderwritingStrip());
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

  // PII-only filter (Reem) — drop every column whose field is not in the
  // curated PII allowlist. Mandatory or not, only PDPL-relevant columns
  // remain so the user can scope data-handling controls.
  if (state.piiOnly) {
    for (const k of [...allKeys]) if (!isPii(k)) allKeys.delete(k);
    if (allKeys.size === 0) {
      body.appendChild(el('div', {
        class: 'pii-empty',
        attrs: { role: 'status' },
        text: 'No PII fields under this endpoint. Personal data lives mostly on /accounts (identifiers, holder name) and /parties — switch to one of those endpoints, or untick "PII only" to see the full payload.',
      }));
      return;
    }
  }

  // Cross-link match counts (EXP-12) — pre-computed per row so the header
  // affordance reads "→ N matching transactions" instead of a quiet hover.
  const jumpFrom = jumpFromForActiveEndpoint();
  const linkedColumn = jumpFrom != null;
  const matchCountByRow = new Map();
  if (linkedColumn) {
    const accTx = (state.bundle.transactions ?? []).filter((t) => t._accountId === state.selectedAccountId);
    for (const r of visible) {
      const n = accTx.filter((t) => jumpFrom.match(t, r)).length;
      matchCountByRow.set(r, n);
    }
  }

  // Sticky leftmost column is most useful on /transactions (the only really
  // wide table). Apply selectively rather than to every endpoint.
  const stickyColClass = isTransactions ? ' has-sticky-col' : '';
  const wrap = el('div', { class: `payload-rendered${stickyColClass}${linkedColumn ? ' has-linked-col' : ''}` });
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
    // Real-LFIs guidance as a column-header subtitle — the soul of the
    // product (PRD §5.3) escapes the field card and reads ambiently. Only
    // for non-mandatory fields where the guidance is non-trivial; mandatory
    // fields' "Always present per spec" is already implied by the M pill.
    if (f && f.status !== 'mandatory') {
      const band = bandForFieldName(k, state.endpoint, state.spec);
      th.appendChild(el('span', {
        class: 'col-guidance',
        text: realLfisGuidance(f, band),
      }));
    }
    headRow.appendChild(th);
  }
  if (linkedColumn) {
    const linkedTh = el('th', { class: 'th-linked', attrs: { scope: 'col', title: 'Linked transactions — count of /transactions rows that match each record on this endpoint (EXP-12).' } });
    linkedTh.appendChild(el('span', { class: 'pill pill-linked', text: '→' }));
    linkedTh.appendChild(el('span', { class: 'field-name', text: 'Linked tx' }));
    headRow.appendChild(linkedTh);
  }
  table.appendChild(el('thead', {}, headRow));
  const persona = state.data.personas[state.personaId];
  const tbody = el('tbody');
  // Expand-all — inline field metadata row directly under the headers.
  // Type / format / enum-cardinality detail (the Real-LFIs guidance line
  // is now ambient on every non-mandatory column header, so this row
  // carries the wire-shape detail not the prose).
  if (state.expandFields) {
    const fieldRow = el('tr', { class: 'field-row' });
    for (const k of allKeys) {
      const f = fieldsByName.get(k);
      const td = el('td');
      if (f) {
        const meta = `${f.type}${f.format ? ' · ' + f.format : ''}${Array.isArray(f.enum) ? ` · enum (${f.enum.length})` : ''}`;
        td.appendChild(el('span', { class: 'fr-meta', text: meta }));
        if (Array.isArray(f.enum) && f.enum.length > 0) {
          td.appendChild(el('span', { class: 'fr-guidance', text: f.enum.slice(0, 6).join(', ') + (f.enum.length > 6 ? `, …(+${f.enum.length - 6})` : '') }));
        }
      } else {
        td.textContent = '—';
      }
      fieldRow.appendChild(td);
    }
    if (linkedColumn) fieldRow.appendChild(el('td'));
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
          band: bandForFieldName(k, state.endpoint, state.spec),
        });
      }
      tr.appendChild(td);
    }
    if (linkedColumn) {
      const n = matchCountByRow.get(r) ?? 0;
      const td = el('td', { class: 'td-linked' });
      const btn = el('button', {
        class: `linked-btn${n === 0 ? ' is-empty' : ''}`,
        attrs: {
          type: 'button',
          title: n > 0
            ? `Jump to /transactions filtered by ${jumpFrom.label(r)} — ${n} match${n === 1 ? '' : 'es'} highlighted.`
            : `Jump to /transactions filtered by ${jumpFrom.label(r)} — no matches under this LFI / seed (a real signal: under Sparse the filter token may not survive redaction). The banner explains what you'd see if matches existed.`,
        },
        text: n > 0 ? `→ ${n} matching tx` : '→ no matches',
        onClick: (e) => {
          e.stopPropagation();
          crossLinkToTransactions(r, jumpFrom);
        },
      });
      td.appendChild(btn);
      tr.appendChild(td);
      // Whole-row click always fires — even with zero matches the cross-link
      // banner is informative ("0 matches highlighted") and keeps the EXP-12
      // affordance consistent across rows. Empty rows just land on an
      // unfiltered /transactions view with the banner.
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

function formatAmount(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ---- Cold-landing welcome cards — route by JTBD bucket ------------------------------------

function renderWelcomeCards() {
  const wrap = el('div', { class: 'welcome-cards', attrs: { role: 'region', 'aria-label': 'Welcome — three ways to use this' } });
  const head = el('div', { class: 'welcome-head' });
  head.appendChild(el('span', { class: 'welcome-eyebrow', text: 'Welcome' }));
  head.appendChild(el('button', {
    class: 'welcome-dismiss',
    attrs: { type: 'button', 'aria-label': 'Dismiss welcome' },
    text: '×',
    onClick: () => {
      state.welcomeDismissed = true;
      renderPayload();
    },
  }));
  wrap.appendChild(head);
  wrap.appendChild(el('h3', { class: 'welcome-title', text: 'Three ways to use the sandbox' }));

  const grid = el('div', { class: 'welcome-grid' });

  // Bucket 1 — explore the data (default flow). Closes the welcome and
  // jumps the active endpoint to /transactions on the first account so
  // the user lands on the highest-signal surface.
  grid.appendChild(welcomeCard({
    label: 'Explore the data',
    body: 'Walk a synthetic UAE customer end-to-end. Switch the LFI profile to see how field coverage drops; click any field name for spec-grounded guidance.',
    cta: 'Open Sara → Transactions',
    onClick: () => {
      state.welcomeDismissed = true;
      state.endpoint = '/accounts/{AccountId}/transactions';
      state.selectedAccountId = state.bundle.accounts?.[0]?.AccountId ?? null;
      clearTxState();
      renderNavigator();
      renderPayload();
    },
  }));
  // Bucket 2 — embed in your article / class (Maryam, Yusuf).
  grid.appendChild(welcomeCard({
    label: 'Embed in your article or class',
    body: 'Drop a chrome-less view of a single persona+endpoint into a slide deck, blog post, or LMS module. Snippet pre-filled to the active state.',
    cta: 'Copy embed snippet',
    onClick: () => {
      state.welcomeDismissed = true;
      copyEmbedSnippet();
      renderPayload();
    },
  }));
  // Bucket 3 — grab fixtures (Priya, Hamid).
  grid.appendChild(welcomeCard({
    label: 'Grab fixtures for your tests',
    body: 'Versioned, deterministic test corpus on npm + PyPI under @openfinance-os/sandbox-fixtures (MIT code, CC0 data). Pin to the same SHA the sandbox uses.',
    cta: 'See packaging on About →',
    href: 'about.html#fixtures',
  }));

  wrap.appendChild(grid);
  return wrap;
}

function welcomeCard({ label, body, cta, onClick, href }) {
  const card = el('div', { class: 'welcome-card' });
  card.appendChild(el('div', { class: 'welcome-card-label', text: label }));
  card.appendChild(el('p', { class: 'welcome-card-body', text: body }));
  if (href) {
    card.appendChild(el('a', { class: 'welcome-cta', text: cta, attrs: { href } }));
  } else {
    card.appendChild(el('button', { class: 'welcome-cta', attrs: { type: 'button' }, text: cta, onClick }));
  }
  return card;
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

  // EXP-30 — TPP-developer affordance: render the "Use this persona in your
  // demo" panel as the last element on the overview. Surfaces the four plug
  // points (iframe, npm, pip, curl) so a TPP can lift this persona's payloads
  // straight into a Nebras-mock-shaped demo flow without losing coherence.
  wrap.appendChild(renderUseInDemoPanel());

  body.appendChild(wrap);
}

// ---- EXP-30 "Use this persona in your demo" --------------------------------------------

function renderUseInDemoPanel() {
  const personaId = state.personaId;
  const lfi = state.lfi;
  const seed = state.seed;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const slugBase = typeof window !== 'undefined'
    ? (window.location.origin + window.location.pathname.replace(/\/(index|embed)\.html$/, '')).replace(/\/$/, '')
    : '';

  // The curl snippet targets /accounts as the simplest entry — it has no
  // {AccountId} dependency and is safe to demo without prior IDs.
  const curlUrl = encodeFixtureUrl({ origin, personaId, lfi, seed, endpoint: '/accounts' });
  const manifestUrl = `${origin}/fixtures/v1/manifest.json`;

  const embedHref = slugBase + encodeEmbed({
    personaId, lfi,
    endpoint: '/accounts/{AccountId}/transactions',
    seed, height: 600,
  }).replace(/^\/embed/, '/embed.html');
  const iframeSnippet = `<iframe src="${embedHref}" width="100%" height="600" loading="lazy" title="Open Finance Data Sandbox · ${personaId} · ${lfi}" referrerpolicy="no-referrer" style="border:1px solid #d9d5cb;border-radius:4px"></iframe>`;

  const npmSnippet =
`npm install @openfinance-os/sandbox-fixtures
import { loadJourney } from '@openfinance-os/sandbox-fixtures';
const j = loadJourney({ persona: '${personaId}', lfi: '${lfi}', seed: ${seed} });
// j.endpoints['/accounts'], j.endpoints['/parties'],
// j.endpoints['/accounts/{AccountId}/transactions'], ...`;

  const pipSnippet =
`pip install openfinance-os-sandbox-fixtures
from openfinance_os_sandbox_fixtures import load_journey
j = load_journey('${personaId}', lfi='${lfi}', seed=${seed})
# j['endpoints']['/accounts'], j['endpoints']['/parties'],
# j['endpoints']['/accounts/{AccountId}/transactions'], ...`;

  const curlSnippet =
`curl -fsS '${manifestUrl}'   # discover personas, LFIs, endpoints, version pin
curl -fsS '${curlUrl}'`;

  const details = el('details', { class: 'demo-panel', attrs: { 'aria-label': 'Use this persona in your demo' } });
  const summary = el('summary', { class: 'demo-panel-summary' });
  summary.appendChild(el('span', { class: 'demo-panel-eyebrow', text: 'For TPP demos' }));
  summary.appendChild(el('span', { class: 'demo-panel-title', text: 'Use this persona in your demo' }));
  details.appendChild(summary);

  const note = el('p', { class: 'demo-panel-note' });
  note.appendChild(document.createTextNode('Synthetic, illustrative data. '));
  const strong = el('strong', { text: 'Not endorsed by Nebras / CBUAE / any LFI.' });
  note.appendChild(strong);
  note.appendChild(document.createTextNode(' Not a substitute for the Nebras-operated regulatory sandbox at certification time. '));
  const link = el('a', { attrs: { href: 'integrate.html' }, text: 'Full integration guide →' });
  note.appendChild(link);
  details.appendChild(note);

  const rows = [
    {
      eyebrow: 'Path 1 · iframe embed',
      hint: 'Drop a chrome-less view into a slide deck, blog post, or LMS module.',
      snippet: iframeSnippet,
      copyLabel: 'Copy iframe',
      doneLabel: 'Iframe snippet copied — paste into your HTML.',
    },
    {
      eyebrow: 'Path 2 · npm — Node / TypeScript',
      hint: 'Swap your Nebras-mock backend; loadJourney() returns the full coherent bundle.',
      snippet: npmSnippet,
      copyLabel: 'Copy npm snippet',
      doneLabel: 'npm snippet copied.',
    },
    {
      eyebrow: 'Path 3 · PyPI — Python',
      hint: 'Notebook, FastAPI mock-server, ML pipeline.',
      snippet: pipSnippet,
      copyLabel: 'Copy pip snippet',
      doneLabel: 'pip snippet copied.',
    },
    {
      eyebrow: 'Path 4 · raw HTTPS — Swift / Kotlin / Postman / curl / .NET',
      hint: 'Static JSON, CORS-permissive. Pin manifest.json.version for stability.',
      snippet: curlSnippet,
      copyLabel: 'Copy curl',
      doneLabel: 'curl snippet copied.',
    },
  ];

  for (const r of rows) {
    const row = el('div', { class: 'demo-row' });
    row.appendChild(el('div', { class: 'demo-row-eyebrow', text: r.eyebrow }));
    row.appendChild(el('div', { class: 'demo-row-hint', text: r.hint }));
    const pre = el('pre', { class: 'demo-row-pre' });
    pre.appendChild(el('code', { text: r.snippet }));
    row.appendChild(pre);
    const btn = el('button', {
      class: 'demo-row-copy',
      attrs: { type: 'button' },
      text: r.copyLabel,
      onClick: () => copyDemoSnippet(r.snippet, r.doneLabel),
    });
    row.appendChild(btn);
    details.appendChild(row);
  }

  return details;
}

function copyDemoSnippet(text, doneLabel) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showCopyToast(doneLabel),
      () => fallbackCopy(text),
    );
  } else {
    fallbackCopy(text);
  }
}

// ---- EXP-18 Underwriting Scenario panel -------------------------------------------------

// Compact 4-stat strip docked above /transactions. Click "Open full panel →"
// to pivot to the EXP-18 endpoint for source fields and formulas. Honours
// the EXP-18 low-volume guard with an inline notice. Plain <div>, not
// <details> — a focusable button inside <summary> would trip the
// axe-core nested-interactive rule (WCAG 4.1.2 / EXP-23).
function renderUnderwritingStrip() {
  const now = new Date(state.data.buildInfo.nowIso);
  const r = computeUnderwriting(state.bundle, now);
  const strip = el('div', { class: 'uw-strip', attrs: { role: 'region', 'aria-label': 'Underwriting at-a-glance' } });
  const head = el('div', { class: 'uw-strip-head' });
  head.appendChild(el('span', { class: 'uw-strip-eyebrow', text: 'Underwriting at-a-glance' }));
  if (r.guard.triggered) {
    head.appendChild(el('span', { class: 'uw-strip-guard', text: 'Low-volume guard active' }));
  }
  head.appendChild(el('button', {
    class: 'uw-strip-jump',
    attrs: { type: 'button', title: 'Open the full Underwriting Scenario panel — formulas, source fields, contributors.' },
    text: 'Open full panel →',
    onClick: () => {
      state.endpoint = UNDERWRITING_PSEUDO;
      state.selectedAccountId = null;
      renderNavigator();
      renderPayload();
    },
  }));
  strip.appendChild(head);

  const grid = el('div', { class: 'uw-strip-grid' });
  const stats = [
    {
      title: 'Income',
      value: r.income.value != null ? `${formatAmount(r.income.value)} ${r.income.currency}` : '—',
      sub: r.income.sourceLabel,
    },
    {
      title: 'Fixed commitments',
      value: `${formatAmount(r.commitments.value)} ${r.commitments.currency}`,
      sub: `${r.commitments.contributors.length} active`,
    },
    {
      title: 'Implied DBR',
      value: r.dbr.value != null ? r.dbr.label : '—',
      sub: r.dbr.value != null ? 'Commitments ÷ income' : (r.dbr.reason ?? 'Undefined'),
    },
    {
      title: 'NSF events',
      value: String(r.nsf.value),
      sub: r.nsf.value > 0 ? 'Trailing 12 months' : 'None in window',
    },
  ];
  for (const s of stats) {
    const card = el('div', { class: 'uw-strip-card' });
    card.appendChild(el('div', { class: 'uw-strip-title', text: s.title }));
    card.appendChild(el('div', { class: 'uw-strip-value', text: s.value }));
    card.appendChild(el('div', { class: 'uw-strip-sub', text: s.sub }));
    grid.appendChild(card);
  }
  strip.appendChild(grid);
  return strip;
}

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
  setPaneCollapsed('field-detail', false);
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
  const band = bandForFieldName(fieldName, state.endpoint, state.spec);
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

init().catch((err) => {
  // Render fallback safely — never use innerHTML/insertAdjacentHTML with untrusted data.
  const banner = el('pre', {
    text: `init failed: ${String(err.message ?? err)}`,
    attrs: { style: 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0' },
  });
  document.body.insertBefore(banner, document.body.firstChild);
});
