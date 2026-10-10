// Multi-bank reconciliation demo (D-14 / Phase D Slice 5).
//
// What a TPP-side accounting system would do over the Open Finance Data
// Sandbox to demonstrate the multi-bank reality of UAE SMEs:
//
//   1. Fetch the persona's primary bundle (`/fixtures/v1/bundles/<persona>/
//      <lfi>/seed-N/...`) — what the persona's primary banker sees.
//   2. Inspect the primary bundle's beneficiaries for `self-to-<slot>`
//      entries that point at the persona's accounts at OTHER LFIs.
//   3. Fetch the role bundle for each declared slot in parallel
//      (`/fixtures/v1/bundles/<persona>/<slot>/<lfi>/seed-N/...`).
//   4. Reconcile by IBAN identity: each role bundle's account[0]
//      AccountIdentifiers[0].Identification byte-matches the primary's
//      self-to-<slot> beneficiary's CreditorAccount.Identification.
//   5. Render a consolidated multi-bank ledger view from the joined
//      bundles.
//
// All data is synthetic; every envelope carries a _watermark.

const params = new URLSearchParams(window.location.search);
const ORIGIN = (
  params.get('origin') ||
  (window.location.origin && window.location.origin !== 'null'
    ? new URL('../../', import.meta.url).href.replace(/\/$/, '')
    : '') ||
  'https://data-sandbox.openfinance-os.org'
).replace(/\/$/, '');
const FX = `${ORIGIN}/fixtures/v1`;

const $ = (id) => document.getElementById(id);
const showErr = (msg) => {
  $('err').textContent = msg;
  $('err').hidden = false;
  $('load-status').textContent = '';
  $('results').setAttribute('aria-busy', 'false');
  if (!$('persona-select').value) {
    $('scenario-name').textContent = 'Unavailable';
    $('holder-names').textContent = 'Unavailable';
  }
};

async function getJSON(url, signal) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!r.ok) {
    const error = new Error(`${r.status} ${r.statusText} — ${url}`);
    error.status = r.status;
    throw error;
  }
  return r.json();
}

let manifest;
let currentRequest;
let renderGeneration = 0;

// Mirror of normalizeFootprint() in src/generator/multi-lfi.js — the demo is
// a standalone page fetching a remote manifest, so it carries its own copy.
// Handles both the legacy primary/secondary/tertiary triad and the Phase 2.2
// N-slot `slots: []` shape. slots[0] is the bundle-emitting (primary) LFI;
// role bundles are staged under the remaining slots' `key` directories.
function normalizeFootprint(footprint) {
  if (!footprint) return null;
  let raw;
  if (Array.isArray(footprint.slots)) {
    raw = footprint.slots.filter((s) => s != null);
  } else {
    raw = [];
    for (const k of ['primary', 'secondary', 'tertiary']) {
      const v = footprint[k];
      if (v == null) continue;
      raw.push({ ...v, key: k });
    }
  }
  if (raw.length === 0) return null;
  return {
    slots: raw.map((s, i) => ({ ...s, key: s.key ?? (i === 0 ? 'primary' : `slot-${i + 1}`) })),
  };
}

async function init() {
  try {
    manifest = await getJSON(`${FX}/manifest.json`);
  } catch (err) {
    showErr(`Could not fetch ${FX}/manifest.json — ${err.message}.`);
    return;
  }

  // Personas with multi_lfi_footprint declared (D-14).
  const footprintPersonas = Object.entries(manifest.personas)
    .filter(([, info]) => info.multi_lfi_footprint)
    .map(([id]) => id);
  const sel = $('persona-select');
  for (const id of footprintPersonas) {
    const info = manifest.personas[id];
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${info.name} (${id})`;
    sel.appendChild(opt);
  }
  if (footprintPersonas.length === 0) {
    showErr(
      'No personas with multi_lfi_footprint were found in manifest.json. Rebuild fixtures with `npm run build:fixtures`.',
    );
    return;
  }
  sel.value = footprintPersonas[0];
  sel.addEventListener('change', renderAll);
  $('lfi-select').addEventListener('change', renderAll);
  await renderAll();
}

async function renderAll() {
  const personaId = $('persona-select').value;
  const lfi = $('lfi-select').value;
  const info = manifest.personas[personaId];
  const seed = info.default_seed;
  const generation = ++renderGeneration;
  currentRequest?.abort();
  const controller = new AbortController();
  currentRequest = controller;

  $('err').hidden = true;
  $('load-status').textContent = 'Loading synthetic accounts and balances…';
  $('scenario-name').textContent = info.name;
  $('holder-names').textContent = 'Loading…';
  $('results').setAttribute('aria-busy', 'true');
  $('recon-table').querySelector('tbody').replaceChildren();
  $('ledger-table').querySelector('tbody').replaceChildren();
  $('watermark').textContent = '';
  renderFootprint(info);

  try {
    const [primaryAccounts, primaryBeneficiaries, primaryBalances, ...roleBundles] =
      await fetchPrimaryAndRoles(personaId, lfi, seed, info, controller.signal);
    if (generation !== renderGeneration) return;

    const holders = new Set(
      [primaryAccounts, ...roleBundles.map((rb) => rb.accounts)].flatMap((env) =>
        (env.Data?.Account ?? []).map((acc) => acc.AccountHolderName).filter(Boolean),
      ),
    );
    $('holder-names').textContent = [...holders].join(' · ') || 'Not supplied';
    renderReconciliation(info, primaryAccounts, primaryBeneficiaries, roleBundles);
    renderLedger(primaryAccounts, primaryBalances, roleBundles);
    $('watermark').textContent = primaryAccounts._watermark ?? '';
    const unavailable = [
      ...primaryBalances.values(),
      ...roleBundles.map((rb) => rb.balances),
    ].filter((env) => env === null).length;
    $('load-status').textContent = unavailable
      ? `Loaded accounts. ${unavailable === 1 ? '1 balance feed is' : `${unavailable} balance feeds are`} unavailable; those balances are not shown.`
      : 'Synthetic accounts and balances loaded.';
  } catch (err) {
    if (generation !== renderGeneration || controller.signal.aborted) return;
    $('holder-names').textContent = 'Unavailable';
    $('load-status').textContent = '';
    showErr(`Could not load this scenario. Choose a scenario or profile to retry. ${err.message}`);
  } finally {
    if (generation === renderGeneration) $('results').setAttribute('aria-busy', 'false');
  }
}

async function fetchPrimaryAndRoles(personaId, lfi, seed, info, signal) {
  // Primary bundle: /accounts is bundle-level; beneficiaries is per-account
  // — fetch for the first account.
  const primaryAccountsUrl = `${FX}/bundles/${personaId}/${lfi}/seed-${seed}/accounts.json`;
  const primaryAccounts = await getJSON(primaryAccountsUrl, signal);
  const firstAccount = primaryAccounts.Data?.Account?.[0];
  if (!firstAccount) throw new Error('primary bundle missing /accounts.Data.Account[0]');
  const primaryBeneficiariesUrl = `${FX}/bundles/${personaId}/${lfi}/seed-${seed}/accounts__${firstAccount.AccountId}__beneficiaries.json`;
  const primaryBeneficiariesFetch = getJSON(primaryBeneficiariesUrl, signal);
  const primaryBalanceFetches = (primaryAccounts.Data.Account ?? []).map(async (acc) => {
    const url = primaryAccountsUrl.replace(
      'accounts.json',
      `accounts__${acc.AccountId}__balances.json`,
    );
    return [acc.AccountId, await fetchBalance(url, signal)];
  });

  // Role bundles in parallel — every declared slot beyond the primary
  // (slots[0]), whichever footprint shape the persona uses.
  const fp = normalizeFootprint(info.multi_lfi_footprint);
  const declaredSlots = (fp?.slots ?? []).slice(1).map((s) => s.key);
  const roleFetches = declaredSlots.map(async (slot) => {
    const url = `${FX}/bundles/${personaId}/${slot}/${lfi}/seed-${seed}/accounts.json`;
    try {
      const env = await getJSON(url, signal);
      return {
        slot,
        accounts: env,
        balances: await fetchBalance(
          url.replace(
            'accounts.json',
            `accounts__${env.Data?.Account?.[0]?.AccountId}__balances.json`,
          ),
          signal,
        ),
      };
    } catch (err) {
      // The slot may have all-non-bank candidates (e.g. F&B's `acquiring`
      // slot whose candidates are all PSPs not in the counterparty pool).
      // No role bundle was emitted; gracefully skip.
      if (err.status === 404) return null;
      throw err;
    }
  });
  const [primaryBeneficiaries, primaryBalanceEntries, roleBundles] = await Promise.all([
    primaryBeneficiariesFetch,
    Promise.all(primaryBalanceFetches),
    Promise.all(roleFetches),
  ]);
  return [
    primaryAccounts,
    primaryBeneficiaries,
    new Map(primaryBalanceEntries),
    ...roleBundles.filter(Boolean),
  ];
}

async function fetchBalance(url, signal) {
  try {
    return await getJSON(url, signal);
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

function balanceText(env) {
  if (env === null) return 'Unavailable';
  const balance = env?.Data?.Balance?.[0];
  if (balance?.Amount?.Amount == null || !balance.Amount.Currency) return 'Not supplied';
  return `${balance.CreditDebitIndicator === 'Debit' ? '-' : ''}${balance.Amount.Amount} ${balance.Amount.Currency}`;
}

function renderFootprint(info) {
  const tbody = $('footprint-table').querySelector('tbody');
  tbody.innerHTML = '';
  const fp = normalizeFootprint(info.multi_lfi_footprint);
  for (const [i, v] of (fp?.slots ?? []).entries()) {
    const slot = i === 0 ? 'primary' : v.key;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="lfi-pill role-${i === 0 ? 'primary' : 'secondary'}">${slot}</span></td>
      <td>${v.role}</td>
      <td>${(v.plausible_lfi_candidates ?? []).join(', ')}</td>
      <td>${v.lfi_default ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderReconciliation(info, primaryAccounts, primaryBeneficiaries, roleBundles) {
  const tbody = $('recon-table').querySelector('tbody');
  tbody.innerHTML = '';

  // Primary bundle's accounts
  for (const acc of primaryAccounts.Data?.Account ?? []) {
    const ai = acc.AccountIdentifiers?.[0] ?? {};
    addReconRow(
      tbody,
      'Primary /accounts',
      acc._meta?.servicerName ?? '—',
      '—',
      ai.Identification,
      acc.AccountHolderName,
    );
  }

  // Primary's self-to-<slot> beneficiaries
  const selfBeneficiaries = (primaryBeneficiaries.Data?.Beneficiary ?? []).filter((b) =>
    (b.Reference ?? '').startsWith('self-to-'),
  );
  const selfIbansBySlot = {};
  for (const b of selfBeneficiaries) {
    const slot = b.Reference.replace('self-to-', '');
    const iban = b.CreditorAccount?.[0]?.Identification;
    selfIbansBySlot[slot] = iban;
    addReconRow(
      tbody,
      `Primary self-to-${slot} beneficiary`,
      b.CreditorAgent?.Name ?? '—',
      b.CreditorAgent?.Identification ?? '—',
      iban,
      b.CreditorAccount?.[0]?.Name ?? '—',
    );
  }

  // Each role bundle's account[0] — highlight if IBAN matches the
  // corresponding self-to-<slot> beneficiary.
  for (const rb of roleBundles) {
    const acc = rb.accounts.Data?.Account?.[0];
    const ai = acc?.AccountIdentifiers?.[0] ?? {};
    const matches = ai.Identification === selfIbansBySlot[rb.slot];
    const tr = addReconRow(
      tbody,
      `${rb.slot} bundle /accounts`,
      acc?._meta?.servicerName ?? '—',
      acc?.Servicer?.Identification ?? '—',
      ai.Identification,
      acc?.AccountHolderName ?? '—',
    );
    if (matches) {
      tr.classList.add('row-link');
      tr.lastElementChild.innerHTML += ` <span class="match">↑ matches self-to-${rb.slot}</span>`;
    }
  }
}

function addReconRow(tbody, source, bank, bic, iban, holder) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${escapeHtml(source)}</td>
    <td>${escapeHtml(bank)}</td>
    <td class="iban">${escapeHtml(bic ?? '—')}</td>
    <td class="iban">${escapeHtml(iban ?? '—')}</td>
    <td>${escapeHtml(holder)}</td>
  `;
  tbody.appendChild(tr);
  return tr;
}

function renderLedger(primaryAccounts, primaryBalances, roleBundles) {
  const tbody = $('ledger-table').querySelector('tbody');
  tbody.innerHTML = '';

  // Primary slot — every account in the primary bundle.
  for (const acc of primaryAccounts.Data?.Account ?? []) {
    addLedgerRow(
      tbody,
      'primary',
      acc._meta?.servicerName,
      acc.AccountId,
      acc.Currency,
      acc.AccountIdentifiers?.[0]?.Identification,
      balanceText(primaryBalances.get(acc.AccountId)),
    );
  }

  for (const rb of roleBundles) {
    const acc = rb.accounts.Data?.Account?.[0];
    if (!acc) continue;
    addLedgerRow(
      tbody,
      rb.slot,
      acc._meta?.servicerName,
      acc.AccountId,
      acc.Currency,
      acc.AccountIdentifiers?.[0]?.Identification,
      balanceText(rb.balances),
    );
  }
}

function addLedgerRow(tbody, slot, bank, accountId, currency, iban, balance) {
  const tr = document.createElement('tr');
  tr.classList.add('ledger-row');
  tr.innerHTML = `
    <td><span class="lfi-pill role-${slot}">${slot}</span></td>
    <td>${escapeHtml(bank ?? '—')}</td>
    <td>${escapeHtml(accountId)}</td>
    <td>${escapeHtml(currency)}</td>
    <td class="iban">${escapeHtml(iban ?? '—')}</td>
    <td>${escapeHtml(balance)}</td>
  `;
  tbody.appendChild(tr);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

init();
