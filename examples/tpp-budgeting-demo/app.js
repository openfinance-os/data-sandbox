// Worked example — a faux TPP budgeting widget that consumes the Open
// Finance Data Sandbox over raw HTTPS. Mirrors what a real TPP demo
// would do: fetch /accounts, then balances + transactions + standing
// orders for each account, render a coherent journey.
//
// Origin precedence:
//   1. ?origin=... query param
//   2. window.location.origin (works when this file is served from the
//      same host as the staged sandbox under _site/)
//   3. https://openfinance-os.org/commons/data-sandbox (production)

const params = new URLSearchParams(window.location.search);
const ORIGIN = (
  params.get('origin')
    || (window.location.origin && window.location.origin !== 'null' ? window.location.origin : '')
    || 'https://openfinance-os.org/commons/data-sandbox'
).replace(/\/$/, '');
const FX = `${ORIGIN}/fixtures/v1`;

const $ = (id) => document.getElementById(id);
const showErr = (msg) => {
  const el = $('err');
  el.textContent = msg;
  el.hidden = false;
};

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.json();
}

let manifest;

async function init() {
  try {
    manifest = await getJSON(`${FX}/manifest.json`);
  } catch (err) {
    showErr(`Could not fetch ${FX}/manifest.json — ${err.message}. If running locally, start a server in _site/ and open this file from there, or pass ?origin=https://openfinance-os.org/commons/data-sandbox.`);
    return;
  }

  const sel = $('persona');
  for (const id of Object.keys(manifest.personas)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${manifest.personas[id].name}`;
    sel.appendChild(opt);
  }
  sel.value = 'salaried_expat_mid';
  sel.addEventListener('change', render);
  for (const r of document.querySelectorAll('input[name="lfi"]')) {
    r.addEventListener('change', render);
  }
  $('spec-pin').textContent = `${manifest.specVersion} @ ${manifest.specSha.slice(0, 7)} · sandbox v${manifest.version}`;
  await render();
}

function lfi() {
  return document.querySelector('input[name="lfi"]:checked')?.value || 'median';
}

async function render() {
  $('err').hidden = true;
  const personaId = $('persona').value;
  const profile = lfi();
  const seed = manifest.personas[personaId].default_seed;
  const base = `${FX}/bundles/${personaId}/${profile}/seed-${seed}`;
  $('source-url').textContent = base;

  // /parties + /accounts in parallel — the same parallel fetch a TPP would
  // make after consent. AccountIds drawn from /accounts; we then issue
  // balances + transactions + standing-orders for each in parallel.
  let parties, accounts;
  try {
    [parties, accounts] = await Promise.all([
      getJSON(`${base}/parties.json`),
      getJSON(`${base}/accounts.json`),
    ]);
  } catch (err) {
    showErr(err.message);
    return;
  }

  const party = parties.Data?.Party ?? {};
  $('customer-name').textContent = party.Name ?? '—';
  $('customer-sub').textContent = `PartyId ${party.PartyId ?? '—'} · ${party.PartyCategory ?? '—'}`;

  const accountList = accounts.Data?.Account ?? [];
  const ids = accountList.map((a) => a.AccountId);

  const perAccount = await Promise.all(ids.map(async (id) => {
    const [bal, tx, so] = await Promise.all([
      getJSON(`${base}/accounts__${id}__balances.json`).catch(() => null),
      getJSON(`${base}/accounts__${id}__transactions.json`).catch(() => null),
      getJSON(`${base}/accounts__${id}__standing-orders.json`).catch(() => null),
    ]);
    return { id, account: accountList.find((a) => a.AccountId === id), bal, tx, so };
  }));

  renderAccounts(perAccount);
  renderTotalBalance(perAccount);
  renderStandingOrders(perAccount);
  renderTimeline(perAccount);
}

function renderAccounts(rows) {
  const ul = $('account-list');
  ul.innerHTML = '';
  for (const r of rows) {
    const li = document.createElement('li');
    const a = r.account || {};
    const ident = a.AccountIdentifiers?.[0]?.Identification?.slice(0, 14) ?? a.AccountId;
    const balance = r.bal?.Data?.Balance?.find((b) => b.Type === 'ClosingAvailable')
                 ?? r.bal?.Data?.Balance?.[0];
    li.innerHTML = `<div class="row"><span>${escape(a.Nickname || a.AccountSubType || a.AccountId)}</span><span>${balance ? `${fmt(balance.Amount.Amount)} ${balance.Amount.Currency}` : '—'}</span></div><div class="stat-sub">${a.AccountSubType ?? ''} · ${ident}…</div>`;
    ul.appendChild(li);
  }
}

function renderTotalBalance(rows) {
  let aed = 0;
  for (const r of rows) {
    const b = r.bal?.Data?.Balance?.find((x) => x.Type === 'ClosingAvailable')
           ?? r.bal?.Data?.Balance?.[0];
    if (!b) continue;
    if (b.Amount.Currency === 'AED') aed += parseFloat(b.Amount.Amount);
    // Non-AED skipped intentionally — a real TPP would FX-convert here.
  }
  $('total-balance').textContent = `AED ${fmt(aed)}`;
  const nonAed = rows.filter((r) => {
    const b = r.bal?.Data?.Balance?.[0];
    return b && b.Amount.Currency !== 'AED';
  }).length;
  $('balance-sub').textContent = nonAed
    ? `${rows.length} accounts · ${nonAed} non-AED account(s) shown separately`
    : `${rows.length} accounts`;
}

function renderStandingOrders(rows) {
  const ul = $('so-list');
  ul.innerHTML = '';
  let any = false;
  for (const r of rows) {
    for (const so of r.so?.Data?.StandingOrder ?? []) {
      any = true;
      const amt = so.FirstPaymentAmount?.Amount ?? so.NextPaymentAmount?.Amount ?? '—';
      const ccy = so.FirstPaymentAmount?.Currency ?? so.NextPaymentAmount?.Currency ?? '';
      const li = document.createElement('li');
      li.innerHTML = `<div class="row"><span>${escape(so.Reference || so.CreditorAccount?.Name || 'Standing order')}</span><span>${ccy} ${amt}</span></div><div class="stat-sub">${so.Frequency ?? ''}</div>`;
      ul.appendChild(li);
    }
  }
  if (!any) {
    const li = document.createElement('li');
    li.className = 'stat-sub';
    li.textContent = 'No standing orders for this persona.';
    ul.appendChild(li);
  }
}

function renderTimeline(rows) {
  const all = [];
  for (const r of rows) {
    for (const t of r.tx?.Data?.Transaction ?? []) {
      all.push({ ...t, _accountId: r.id });
    }
  }
  all.sort((a, b) => (b.BookingDateTime || '').localeCompare(a.BookingDateTime || ''));
  const cutoffMs = Date.now() - 90 * 24 * 3600 * 1000;
  const recent = all.filter((t) => Date.parse(t.BookingDateTime || '') > cutoffMs).slice(0, 80);
  const tl = $('tx-timeline');
  tl.innerHTML = '';
  if (!recent.length) {
    tl.innerHTML = '<div class="stat-sub">No transactions in the last 90 days for this persona.</div>';
    return;
  }
  let lastMonth = '';
  for (const t of recent) {
    const month = (t.BookingDateTime || '').slice(0, 7);
    if (month !== lastMonth) {
      const m = document.createElement('div');
      m.className = 'timeline-month';
      m.textContent = month;
      tl.appendChild(m);
      lastMonth = month;
    }
    const li = document.createElement('div');
    const isCredit = t.CreditDebitIndicator === 'Credit';
    const sign = isCredit ? '+' : '−';
    const amt = `${sign} ${fmt(t.Amount?.Amount)} ${t.Amount?.Currency || ''}`;
    li.innerHTML = `<div class="row"><span>${escape(t.TransactionInformation || t.MerchantDetails?.MerchantName || 'Transaction')}</span><span class="${isCredit ? 'pos' : 'neg'}">${amt}</span></div><div class="stat-sub">${(t.BookingDateTime || '').slice(0, 10)} · ${t.ProprietaryBankTransactionCode?.Code ?? ''}</div>`;
    tl.appendChild(li);
  }
}

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escape(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

init().catch((err) => showErr(err.message));
