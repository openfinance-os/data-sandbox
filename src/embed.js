// Embed mode — EXP-27.
// Chrome-less variant rendering one persona × LFI × endpoint table for
// iframe consumption (Maryam's classroom JTBD, Yusuf's blog-post embed).
// Query params: persona, lfi, endpoint, seed, height. Falls back to safe
// defaults for any missing parameter.

import { buildBundle } from './generator/index.js';
import { leafFields, statusBadge } from './shared/spec-helpers.js';
import { decodeFromUrl, CUSTOM_PERSONA_SLUG } from './url.js';
import { expandRecipe } from './persona-builder/expand.js';
import { decodeRecipe } from './persona-builder/recipe.js';

async function init() {
  const [specRes, dataRes] = await Promise.all([
    fetch('../dist/SPEC.json'),
    fetch('../dist/data.json'),
  ]);
  const spec = await specRes.json();
  const data = await dataRes.json();
  const url = decodeFromUrl(window.location.href);

  // Workstream B — materialise a custom persona from the URL recipe param.
  if (url.personaId === CUSTOM_PERSONA_SLUG && url.recipe) {
    try {
      data.personas[CUSTOM_PERSONA_SLUG] = expandRecipe(decodeRecipe(url.recipe), data.pools);
    } catch (err) {
      console.warn('Custom persona recipe failed to expand:', err);
    }
  }

  const personaId = url.personaId && data.personas[url.personaId]
    ? url.personaId
    : Object.keys(data.personas)[0];
  const persona = data.personas[personaId];
  const endpoint = url.endpoint || '/accounts';
  const lfi = url.lfi;
  const seed = url.seed;
  const height = url.height;

  if (Number.isFinite(height)) {
    document.getElementById('embed-host').style.height = `${height}px`;
  }

  document.getElementById('embed-label').textContent =
    `${persona.name} · LFI ${lfi} · seed ${seed} · ${endpoint}`;

  const fullPath = window.location.pathname.replace(/embed\.html$/, 'index.html');
  const linkParams = new URLSearchParams({ persona: personaId, lfi, seed: String(seed) });
  document.getElementById('embed-link').href = `${fullPath}?${linkParams.toString()}`;

  const bundle = buildBundle({
    persona,
    lfi,
    seed,
    pools: data.pools,
    now: new Date(data.buildInfo.nowIso),
  });

  // Pick a single account (first one) for per-account endpoints.
  const acc = bundle.accounts[0];
  const rows = rowsFor(bundle, endpoint, acc?.AccountId);
  const fields = leafFields(spec, endpoint);
  const fieldsByName = new Map(fields.map((f) => [f.name, f]));

  renderTable(rows, fieldsByName);
}

function rowsFor(bundle, endpoint, accountId) {
  switch (endpoint) {
    case '/accounts':
      return bundle.accounts;
    case '/parties':
      return bundle.callingUserParty ? [bundle.callingUserParty] : [];
    case '/accounts/{AccountId}':
      return accountId ? bundle.accounts.filter((a) => a.AccountId === accountId) : bundle.accounts.slice(0, 1);
    case '/accounts/{AccountId}/balances':
      return accountId ? bundle.balances.filter((b) => b._accountId === accountId) : [];
    case '/accounts/{AccountId}/transactions':
      return accountId ? bundle.transactions.filter((t) => t._accountId === accountId).slice(0, 50) : [];
    case '/accounts/{AccountId}/standing-orders':
      return accountId ? bundle.standingOrders.filter((x) => x._accountId === accountId) : [];
    case '/accounts/{AccountId}/direct-debits':
      return accountId ? bundle.directDebits.filter((x) => x._accountId === accountId) : [];
    case '/accounts/{AccountId}/beneficiaries':
      return accountId ? bundle.beneficiaries.filter((x) => x._accountId === accountId) : [];
    case '/accounts/{AccountId}/scheduled-payments':
      return accountId ? bundle.scheduledPayments.filter((x) => x._accountId === accountId) : [];
    case '/accounts/{AccountId}/product':
      return accountId ? bundle.product.filter((x) => x._accountId === accountId) : [];
    case '/accounts/{AccountId}/parties':
      return accountId ? bundle.parties.filter((x) => x._accountId === accountId) : [];
    case '/accounts/{AccountId}/statements':
      return accountId ? bundle.statements.filter((x) => x._accountId === accountId) : [];
    default:
      return [];
  }
}

function renderTable(rows, fieldsByName) {
  const body = document.getElementById('embed-body');
  body.replaceChildren();
  if (rows.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No records.';
    p.style.color = 'var(--text-muted)';
    body.appendChild(p);
    return;
  }
  const allKeys = new Set();
  for (const r of rows) for (const k of Object.keys(stripInternal(r))) allKeys.add(k);

  const wrap = document.createElement('div');
  wrap.className = 'payload-rendered';
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const k of allKeys) {
    const th = document.createElement('th');
    const f = fieldsByName.get(k);
    if (f) {
      const badge = statusBadge(f.status);
      const span = document.createElement('span');
      span.className = `pill ${badge.shape}`;
      span.textContent = badge.label;
      span.setAttribute('aria-label', badge.text);
      th.appendChild(span);
    }
    const button = document.createElement('button');
    button.className = 'field-name';
    button.textContent = k;
    button.style.background = 'transparent';
    button.style.border = 'none';
    button.style.cursor = 'default';
    th.appendChild(button);
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const stripped = stripInternal(r);
    for (const k of allKeys) {
      const v = stripped[k];
      const td = document.createElement('td');
      td.textContent = v == null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
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

init().catch((err) => {
  const banner = document.createElement('pre');
  banner.textContent = `embed init failed: ${String(err.message ?? err)}`;
  banner.style.cssText = 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0';
  document.body.insertBefore(banner, document.body.firstChild);
});
