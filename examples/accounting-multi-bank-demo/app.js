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
  (window.location.origin && window.location.origin !== 'null' ? window.location.origin : '') ||
  'https://openfinance-os.org/commons/data-sandbox'
).replace(/\/$/, '');
const FX = `${ORIGIN}/fixtures/v1`;

const $ = (id) => document.getElementById(id);
const showErr = (msg) => {
  $('err').textContent = msg;
  $('err').hidden = false;
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

  renderFootprint(info);

  const [primaryAccounts, primaryBeneficiaries, ...roleBundles] = await fetchPrimaryAndRoles(
    personaId,
    lfi,
    seed,
    info,
  );

  renderReconciliation(info, primaryAccounts, primaryBeneficiaries, roleBundles);
  renderLedger(personaId, info, primaryAccounts, roleBundles);
  $('watermark').textContent = primaryAccounts._watermark ?? '';
}

async function fetchPrimaryAndRoles(personaId, lfi, seed, info) {
  // Primary bundle: /accounts is bundle-level; beneficiaries is per-account
  // — fetch for the first account.
  const primaryAccountsUrl = `${FX}/bundles/${personaId}/${lfi}/seed-${seed}/accounts.json`;
  const primaryAccounts = await getJSON(primaryAccountsUrl);
  const firstAccount = primaryAccounts.Data?.Account?.[0];
  if (!firstAccount) throw new Error('primary bundle missing /accounts.Data.Account[0]');
  const primaryBeneficiariesUrl = `${FX}/bundles/${personaId}/${lfi}/seed-${seed}/accounts__${firstAccount.AccountId}__beneficiaries.json`;
  const primaryBeneficiaries = await getJSON(primaryBeneficiariesUrl);

  // Role bundles in parallel.
  const declaredSlots = ['secondary', 'tertiary'].filter((s) => info.multi_lfi_footprint?.[s]);
  const roleFetches = declaredSlots.map(async (slot) => {
    const url = `${FX}/bundles/${personaId}/${slot}/${lfi}/seed-${seed}/accounts.json`;
    try {
      const env = await getJSON(url);
      return {
        slot,
        accounts: env,
        balanceUrl: url.replace(
          'accounts.json',
          `accounts__${env.Data?.Account?.[0]?.AccountId}__balances.json`,
        ),
      };
    } catch {
      // The slot may have all-non-bank candidates (e.g. F&B's `acquiring`
      // slot whose candidates are all PSPs not in the counterparty pool).
      // No role bundle was emitted; gracefully skip.
      return null;
    }
  });
  const roleBundlesRaw = await Promise.all(roleFetches);
  const roleBundles = [];
  for (const rb of roleBundlesRaw) {
    if (!rb) continue;
    try {
      rb.balances = await getJSON(rb.balanceUrl);
    } catch {
      rb.balances = null;
    }
    roleBundles.push(rb);
  }
  return [primaryAccounts, primaryBeneficiaries, ...roleBundles];
}

function renderFootprint(info) {
  const tbody = $('footprint-table').querySelector('tbody');
  tbody.innerHTML = '';
  const fp = info.multi_lfi_footprint;
  for (const slot of ['primary', 'secondary', 'tertiary']) {
    const v = fp[slot];
    if (!v) continue;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="lfi-pill role-${slot}">${slot}</span></td>
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

function renderLedger(personaId, info, primaryAccounts, roleBundles) {
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
      '—',
    );
  }

  for (const rb of roleBundles) {
    const acc = rb.accounts.Data?.Account?.[0];
    if (!acc) continue;
    let bal = '—';
    if (rb.balances?.Data?.Balance?.length) {
      const b = rb.balances.Data.Balance[0];
      bal = `${b.Amount?.Amount ?? '—'} ${b.Amount?.Currency ?? ''}`;
    }
    addLedgerRow(
      tbody,
      rb.slot,
      acc._meta?.servicerName,
      acc.AccountId,
      acc.Currency,
      acc.AccountIdentifiers?.[0]?.Identification,
      bal,
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
