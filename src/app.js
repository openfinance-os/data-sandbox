// Phase 0 sandbox UI — wires the three-pane layout to the deterministic
// generator and the parsed SPEC.json. The browser fetches both as static
// JSON (no build chain). State lives in a single object updated by select-
// box and persona-card events; every change re-renders the active panes.

import { buildBundle } from './generator/index.js';
import {
  coverage,
  coverageForEndpoint,
  leafFields,
  statusBadge,
  specCitationUrl,
  realLfisGuidance,
  bandForFieldName,
} from './shared/spec-helpers.js';
import { decodeFromUrl, encodePermalink } from './url.js';
import {
  envelopesFromBundle,
  csvForResource,
  downloadJson,
  downloadCsv,
  downloadTarball,
} from './ui/export.js';
import { conditionalRule, isPii, whyEmpty } from './shared/field-knowledge.js';

// All 12 v1 endpoints (Appendix C). Three are bundle-level (no AccountId
// scope): /accounts and /parties. The others are per-account.
const ENDPOINTS = [
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
  view: 'rendered',
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

  buildPersonaList();
  syncControls();
  attachEventHandlers();
  rebuildAndRender();
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
    if (state.stressFilter && !(p.stress_coverage ?? []).includes(state.stressFilter)) continue;
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
          rebuildAndRender();
        },
      },
      el('div', { class: 'persona-name', text: p.name }),
      el('div', { class: 'persona-archetype', text: humanArchetype(p.archetype) }),
    );
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

function syncControls() {
  document.getElementById('persona-select').value = state.personaId;
  document.getElementById('lfi-select').value = state.lfi;
  document.getElementById('seed-input').value = String(state.seed);
  for (const card of document.querySelectorAll('.persona-card')) {
    card.classList.toggle('active', card.dataset.personaId === state.personaId);
  }
}

function attachEventHandlers() {
  document.getElementById('persona-select').addEventListener('change', (e) => {
    state.personaId = e.target.value;
    rebuildAndRender();
  });
  document.getElementById('lfi-select').addEventListener('change', (e) => {
    state.lfi = e.target.value;
    rebuildAndRender();
  });
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
  document.getElementById('export-json').addEventListener('click', exportActiveJson);
  document.getElementById('export-csv').addEventListener('click', exportActiveCsv);
  document.getElementById('export-tar').addEventListener('click', exportTarball);
  document.getElementById('tour-btn').addEventListener('click', () => startTour());
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
  document.getElementById('coverage-fill').style.width = `${cov.pct}%`;
  document.getElementById('coverage-pct').textContent = `${cov.pct}%`;
}

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
  const btn = el('button', {
    class: `nav-endpoint${active ? ' active' : ''}`,
    attrs: { 'aria-current': active ? 'true' : null },
    dataset: { endpoint, accountId: accountId ?? '' },
    onClick: onSelect,
  });
  btn.appendChild(el('span', { class: 'nav-endpoint-label', text: endpoint }));
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
  document.getElementById('endpoint-label').textContent = state.endpoint;
  const allRows = rowsForActiveEndpoint();
  const fieldsByName = endpointFieldsByName();
  const body = document.getElementById('payload-body');
  body.replaceChildren();

  document.getElementById('view-rendered').classList.toggle('active', state.view === 'rendered');
  document.getElementById('view-raw').classList.toggle('active', state.view === 'raw');
  document.getElementById('view-rendered').setAttribute('aria-selected', state.view === 'rendered');
  document.getElementById('view-raw').setAttribute('aria-selected', state.view === 'raw');

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
    th.appendChild(
      el('button', {
        class: 'field-name',
        text: k,
        onClick: (e) => { e.stopPropagation(); openFieldCard(k); },
      })
    );
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

init().catch((err) => {
  // Render fallback safely — never use innerHTML/insertAdjacentHTML with untrusted data.
  const banner = el('pre', {
    text: `init failed: ${String(err.message ?? err)}`,
    attrs: { style: 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0' },
  });
  document.body.insertBefore(banner, document.body.firstChild);
});
