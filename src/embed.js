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
  const url = decodeFromUrl(window.location.href);
  const [domainsRes, dataRes] = await Promise.all([
    fetch('../dist/domains.json'),
    fetch('../dist/data.json'),
  ]);
  const domainsManifest = await domainsRes.json();
  const data = await dataRes.json();
  const domains = Object.fromEntries(domainsManifest.domains.map((d) => [d.id, d]));
  const domain = domains[url.domain] ? url.domain : 'banking';
  const domainEntry = domains[domain];
  const specRes = await fetch(`..${domainEntry.parsedJsonUrl}`);
  const spec = await specRes.json();

  // Filter the persona pool to the active domain so the default fallback
  // can't bleed an insurance persona into a banking embed (or vice versa).
  const activePersonas = Object.fromEntries(
    Object.entries(data.personas).filter(([, p]) => (p.domain ?? 'banking') === domain)
  );

  // Workstream B — materialise a custom persona from the URL recipe param.
  // Custom personas are banking-only in v1.
  if (url.personaId === CUSTOM_PERSONA_SLUG && url.recipe && domain === 'banking') {
    try {
      const expanded = expandRecipe(decodeRecipe(url.recipe), data.pools);
      activePersonas[CUSTOM_PERSONA_SLUG] = expanded;
      data.personas[CUSTOM_PERSONA_SLUG] = expanded;
    } catch (err) {
      console.warn('Custom persona recipe failed to expand:', err);
    }
  }

  const personaId = url.personaId && activePersonas[url.personaId]
    ? url.personaId
    : Object.keys(activePersonas)[0];
  const persona = activePersonas[personaId];
  const endpoint = url.endpoint || domainEntry.defaultEndpoint || '/accounts';
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
  if (domain !== 'banking') linkParams.set('domain', domain);
  document.getElementById('embed-link').href = `${fullPath}?${linkParams.toString()}`;

  const bundle = buildBundle({
    persona,
    lfi,
    seed,
    pools: data.pools,
    now: new Date(data.buildInfo.nowIso),
  });

  // Banking is the only domain with a per-resource embed renderer in v1.
  // Other domains (insurance preview) render a JSON inspector with a link
  // out to the full sandbox where the per-domain UI lives.
  if (domain !== 'banking') {
    renderJsonPreview(bundle, domainEntry);
    return;
  }

  // Pick a single account (first one) for per-account endpoints.
  const acc = bundle.accounts[0];
  const rows = rowsFor(bundle, endpoint, acc?.AccountId);
  const fields = leafFields(spec, endpoint);
  const fieldsByName = new Map(fields.map((f) => [f.name, f]));

  renderTable(rows, fieldsByName);
}

function renderJsonPreview(bundle, domainEntry) {
  const body = document.getElementById('embed-body');
  body.replaceChildren();
  const note = document.createElement('p');
  note.textContent =
    `Embed mode is banking-only in v1. ${domainEntry.label} renders as a JSON inspector here; ` +
    `open the full sandbox for the spec-driven view.`;
  note.style.cssText = 'color:var(--text-muted);font-size:12px;padding:8px 12px;margin:0';
  body.appendChild(note);
  const pre = document.createElement('pre');
  pre.style.cssText = 'padding:12px;font-size:11px;overflow:auto;margin:0';
  pre.textContent = JSON.stringify(bundle, null, 2);
  body.appendChild(pre);
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
