// Phase 0 sandbox UI — wires the three-pane layout to the deterministic
// generator and the parsed SPEC.json. The browser fetches both as static
// JSON (no build chain). State lives in a single object updated by select-
// box and persona-card events; every change re-renders the active panes.

import { buildBundle } from './generator/index.js';
import { coverage, leafFields, statusBadge } from './shared/spec-helpers.js';
import { decodeFromUrl, encodePermalink } from './url.js';

const PHASE_0_ENDPOINTS = [
  '/accounts',
  '/accounts/{AccountId}/balances',
  '/accounts/{AccountId}/transactions',
];

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
};

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
  document.getElementById('version-pin').textContent = `v${state.spec.specVersion} @ ${(state.spec.pinSha || '').slice(0, 7)}`;

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
  for (const [id, p] of Object.entries(state.data.personas)) {
    const card = el(
      'div',
      {
        class: 'persona-card',
        attrs: { role: 'listitem' },
        dataset: { personaId: id },
        onClick: () => {
          state.personaId = id;
          rebuildAndRender();
        },
      },
      el('div', { class: 'persona-name', text: p.name }),
      el('div', { class: 'persona-archetype', text: p.archetype })
    );
    list.appendChild(card);

    const opt = el('option', { text: p.name, attrs: { value: id } });
    select.appendChild(opt);
  }
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
}

function rebuildAndRender() {
  const persona = state.data.personas[state.personaId];
  state.bundle = buildBundle({
    persona,
    lfi: state.lfi,
    seed: state.seed,
    pools: state.data.pools,
    now: new Date(state.data.buildInfo.nowIso),
  });
  state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
  syncControls();
  renderNavigator();
  renderPayload();
  renderCoverage();
  pushPermalink();
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
  for (const acc of state.bundle.accounts) {
    const wrap = el('div', { class: 'nav-account' });
    wrap.appendChild(
      el('div', {
        class: 'nav-account-header',
        text: `${acc.AccountSubType} · ${acc.AccountIdentifiers?.[0]?.Identification?.slice(0, 12) ?? acc.AccountId}…`,
      })
    );
    for (const ep of PHASE_0_ENDPOINTS) {
      const isActive = state.endpoint === ep && state.selectedAccountId === acc.AccountId;
      const btn = el('button', {
        class: `nav-endpoint${isActive ? ' active' : ''}`,
        text: ep,
        attrs: { 'aria-current': isActive ? 'true' : null },
        dataset: { endpoint: ep, accountId: acc.AccountId },
        onClick: () => {
          state.endpoint = ep;
          state.selectedAccountId = acc.AccountId;
          renderNavigator();
          renderPayload();
        },
      });
      wrap.appendChild(btn);
    }
    nav.appendChild(wrap);
  }
}

function rowsForActiveEndpoint() {
  const acc = state.bundle.accounts.find((a) => a.AccountId === state.selectedAccountId);
  if (!acc) return [];
  switch (state.endpoint) {
    case '/accounts':
      return state.bundle.accounts;
    case '/accounts/{AccountId}/balances':
      return state.bundle.balances.filter((b) => b._accountId === acc.AccountId);
    case '/accounts/{AccountId}/transactions':
      return state.bundle.transactions.filter((t) => t._accountId === acc.AccountId);
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
  const rows = rowsForActiveEndpoint();
  const fieldsByName = endpointFieldsByName();
  const body = document.getElementById('payload-body');
  body.replaceChildren();

  document.getElementById('view-rendered').classList.toggle('active', state.view === 'rendered');
  document.getElementById('view-raw').classList.toggle('active', state.view === 'raw');
  document.getElementById('view-rendered').setAttribute('aria-selected', state.view === 'rendered');
  document.getElementById('view-raw').setAttribute('aria-selected', state.view === 'raw');

  if (state.view === 'raw') {
    const pre = el('pre', {
      class: 'payload-raw',
      text: JSON.stringify(rows.map(stripInternal), null, 2),
    });
    body.appendChild(pre);
    return;
  }

  if (rows.length === 0) {
    const wrap = el('div', { class: 'payload-rendered' },
      el('p', { text: 'No records.', attrs: { style: 'color:var(--text-muted)' } })
    );
    body.appendChild(wrap);
    return;
  }

  // Cap row count for the rendered table to keep DOM light.
  const visible = rows.slice(0, 100);
  const allKeys = new Set();
  for (const r of visible) for (const k of Object.keys(stripInternal(r))) allKeys.add(k);

  const wrap = el('div', { class: 'payload-rendered' });
  const table = el('table');
  const headRow = el('tr');
  for (const k of allKeys) {
    const th = el('th');
    const f = fieldsByName.get(k);
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
        onClick: () => openFieldCard(k),
      })
    );
    headRow.appendChild(th);
  }
  table.appendChild(el('thead', {}, headRow));
  const tbody = el('tbody');
  for (const r of visible) {
    const tr = el('tr');
    const stripped = stripInternal(r);
    for (const k of allKeys) {
      const v = stripped[k];
      const text = v == null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      tr.appendChild(el('td', { text }));
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

  body.appendChild(wrap);
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
  content.replaceChildren();

  const rowsToRender = [
    ['Name', name],
    ['Path', f.path],
    ['Status', null], // rendered specially below
    ['Type', f.type],
    ['Format', f.format ?? '—'],
    ['Enum', Array.isArray(f.enum) ? f.enum.join(', ') : '—'],
    ['Example', example == null ? '—' : (typeof example === 'object' ? JSON.stringify(example) : String(example))],
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
    } else {
      row.appendChild(el('span', { class: 'v', text: v }));
    }
    content.appendChild(row);
  }

  document.getElementById('field-detail').classList.add('open');
}

init().catch((err) => {
  // Render fallback safely — never use innerHTML/insertAdjacentHTML with untrusted data.
  const banner = el('pre', {
    text: `init failed: ${String(err.message ?? err)}`,
    attrs: { style: 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0' },
  });
  document.body.insertBefore(banner, document.body.firstChild);
});
