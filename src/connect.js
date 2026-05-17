// /connect page — interactive walkthrough of a consumer connecting their
// UAE bank to Claude in a chat. Four steps: pick profile → pick bank →
// share (consent) → back in chat. Modelled on Plaid + ChatGPT's
// integration pattern.
//
// State is encoded in the URL via history.replaceState so refresh / share
// preserves the journey (EXP-17-aligned). Persona/footprint data comes
// from /fixtures/v1/manifest.json (production) with a /dist/data.json
// fallback for local dev. The wizard is a UI mock; the actual OAuth
// handshake lives in packages/sandbox-mcp/src/transports/oauth-simulation.mjs
// behind --simulate-oauth.
//
// Step 4 ("Back in chat") renders a hybrid layout: a chat-style transcript
// on top with 4–5 deterministic Q&A pairs answered from the bound persona's
// fixtures, plus a compressed dashboard strip underneath (balance, last
// salary, biggest spend, next renewal). Both are fed from the *real* v2.1
// envelopes — spec compliance (EXP-01): every value comes from a
// spec-defined Data.* path:
//
//   banking accounts    → Data.Account[]                  · v2.1 §accounts
//   banking balances    → Data.Balance[]                  · v2.1 §balances
//   banking transactions→ Data.Transaction[]              · v2.1 §transactions
//   banking SOs / DDs   → Data.StandingOrder[] / DirectDebit[]
//   insurance policies  → Data.Policies[]                 · v2.1 insurance
//
// The chat and dashboard surface only fields that are spec-defined and
// present on the envelope; they never invent values. The full envelope
// is also rendered in a collapsible so the reader can verify nothing
// was fabricated.

const SCOPE_LABELS = {
  banking: {
    title: 'Bank Data Sharing',
    body: 'accounts · balances · transactions · standing orders · direct debits · beneficiaries · statements · products',
  },
  insurance: {
    title: 'Insurance Data Sharing',
    body: 'motor · home · health · life · travel · renters · employment renewals and payment details',
  },
};

// Three populate-rate profiles per PRD §8.3 / EXP-04. Anonymous-by-design
// (NG5 / D-14) — these are never tied to a named real bank.
const LFI_PROFILES = [
  { key: 'rich', name: 'LFI · Rich profile', body: 'Every optional field populated. Best-case parser test.' },
  { key: 'median', name: 'LFI · Median profile', body: 'Typical UAE-market populate rate. Default for most personas.' },
  { key: 'sparse', name: 'LFI · Sparse profile', body: 'Minimum-conformant: mandatory + a few optionals. Resilience test.' },
];

const INSURANCE_LINES = ['motor', 'home', 'health', 'life', 'travel', 'renters', 'employment'];

// ─── UAE Open Finance Standards v2.1 — Permissions taxonomy ────────
//
// The Standards define discrete read permissions ("data clusters") that a
// TPP requests via POST /account-access-consents. Each maps to a specific
// shape of data the LFI will release. This taxonomy is the source of truth
// the J1 and J2 consent screens render from — no parallel definitions.
//
// `ReadAccountsBasic` is the only mandatory permission — every consent
// must include it (otherwise the TPP can't even enumerate the accounts to
// read from). The UI shows it as disabled-but-checked.
//
// Reference: UAE OF v2.1 Bank Data Sharing spec · API Hub v8 Consent
// Manager OpenAPI. See `references/api-specifications.md#consent-management-apis`
// in the open-finance-uae skill.

const OF_PERMISSIONS = [
  { key: 'ReadAccountsBasic',       cluster: 'Accounts',         label: 'Account list',                body: 'AccountId, Type, SubType, Nickname', mandatory: true },
  { key: 'ReadAccountsDetail',      cluster: 'Accounts',         label: 'Account details',             body: 'Identifiers (IBAN, ACCT), holders, currency, opening date' },
  { key: 'ReadBalances',            cluster: 'Balances',         label: 'Balances',                    body: 'Current, available, overdraft · per-account' },
  { key: 'ReadTransactionsBasic',   cluster: 'Transactions',     label: 'Transactions (basic)',        body: 'Amount, date, direction, status' },
  { key: 'ReadTransactionsDetail',  cluster: 'Transactions',     label: 'Transactions (detail)',       body: 'Merchant, MCC, geolocation, references, counterparty' },
  { key: 'ReadStandingOrdersBasic', cluster: 'Standing orders',  label: 'Standing orders (basic)',     body: 'Counterparty + amount + frequency' },
  { key: 'ReadStandingOrdersDetail',cluster: 'Standing orders',  label: 'Standing orders (detail)',    body: 'Full schedule, references, next payment date' },
  { key: 'ReadDirectDebits',        cluster: 'Direct debits',    label: 'Direct debits',               body: 'Mandates + last collection amount' },
  { key: 'ReadBeneficiariesBasic',  cluster: 'Beneficiaries',    label: 'Beneficiaries (basic)',       body: 'Names + counterparties' },
  { key: 'ReadBeneficiariesDetail', cluster: 'Beneficiaries',    label: 'Beneficiaries (detail)',      body: 'Account identifiers (IBAN, sort/account)' },
  { key: 'ReadStatementsBasic',     cluster: 'Statements',       label: 'Statements (basic)',          body: 'Period + closing balance per statement' },
  { key: 'ReadStatementsDetail',    cluster: 'Statements',       label: 'Statements (detail)',         body: 'Per-statement transactions and references' },
  { key: 'ReadProducts',            cluster: 'Products',         label: 'Products',                    body: 'Account-type metadata, fees, conditions' },
];

// Set of mandatory permission keys for quick lookup. Per Standards, this
// must always be a subset of any granted consent.
const OF_MANDATORY_PERMISSIONS = new Set(OF_PERMISSIONS.filter((p) => p.mandatory).map((p) => p.key));

// Mint a UAE-OF-flavoured ConsentId. Format mirrors what the API Hub returns
// from POST /account-access-consents: a URN that the Consent Manager uses as
// the durable handle for the consent record. crypto.randomUUID() is available
// in every browser the rest of this page targets.
function mintConsentId() {
  const uuid = (crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `urn:openfinance:ae:consent:${uuid}`;
}

const INSURANCE_LINE_LABELS = {
  motor: { name: 'Motor Insurance', body: 'Comprehensive · TPL · UBI · 4 endpoints' },
  home: { name: 'Home Insurance', body: 'Buildings · contents · 4 endpoints' },
  health: { name: 'Health Insurance', body: 'Individual or family · 4 endpoints' },
  life: { name: 'Life Insurance', body: 'Term · mortgage-protection · 4 endpoints' },
  travel: { name: 'Travel Insurance', body: 'Annual or single-trip · 4 endpoints' },
  renters: { name: 'Renters Insurance', body: 'Tenant contents · 4 endpoints' },
  employment: { name: 'Employment Insurance (ILOE)', body: 'Income protection · 4 endpoints' },
};

function inferInsuranceLine(persona) {
  const idOrArch = (persona.persona_id || persona.id || '') + ' ' + (persona.archetype || '');
  for (const key of INSURANCE_LINES) {
    if (idOrArch.toLowerCase().includes(key)) return key;
  }
  return null;
}

function avatarColor(id) {
  const palette = ['#2d5d4f', '#6E548F', '#8b5d2e', '#3d6fa3', '#7a3d52', '#4d6d4d', '#8b3d52', '#4d4d8b'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function initials(name) {
  const cleaned = String(name || '').replace(/[—–-].*$/, '').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v === false || v == null) { /* skip */ }
    else node.setAttribute(k, v);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatAed(n) {
  if (!isFinite(n)) return '—';
  return `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Shared consent-flow render helpers ─────────────────────────────
//
// renderPermissionsList(selectedSet, onChange, opts?) — renders the v2.1
// permissions taxonomy as toggleable checkboxes grouped by cluster. The
// mandatory permission (ReadAccountsBasic) renders disabled-but-checked
// with a "required" badge; toggling any optional permission re-emits the
// new set via onChange.
//
// renderConsentParamsPanel({ expirationDays, isSingleAuth, transactionMonths },
//   onChange) — renders the consent parameter controls: ExpirationDateTime
// (30/90/180/365 day radio), IsSingleAuthorization (toggle), and
// TransactionFromDateTime window (3/6/13 month radio, 13 = Standards max).
//
// Both helpers are pure UI — they don't touch state. Callers wire onChange
// to mutate state and call refresh().

function renderPermissionsList(selectedSet, onChange, opts = {}) {
  const wrap = el('div', { className: 'permissions-list', role: 'group', 'aria-label': 'Permissions requested' });
  if (opts.heading !== false) {
    wrap.appendChild(el('div', { className: 'permissions-heading' }, [
      el('strong', {}, 'Permissions requested'),
      el('span', { className: 'permissions-help' }, '13 data clusters · ReadAccountsBasic is mandatory'),
    ]));
  }
  // Group by cluster while preserving the taxonomy order
  const byCluster = new Map();
  for (const p of OF_PERMISSIONS) {
    if (!byCluster.has(p.cluster)) byCluster.set(p.cluster, []);
    byCluster.get(p.cluster).push(p);
  }
  for (const [cluster, perms] of byCluster.entries()) {
    const block = el('div', { className: 'permissions-cluster' });
    block.appendChild(el('div', { className: 'permissions-cluster-name' }, cluster));
    const items = el('div', { className: 'permissions-items' });
    for (const p of perms) {
      const isChecked = selectedSet.has(p.key);
      const id = `perm-${opts.idPrefix || 'p'}-${p.key}`;
      const cb = el('input', {
        type: 'checkbox',
        id,
        checked: isChecked,
        disabled: !!p.mandatory,
      });
      cb.addEventListener('change', () => {
        const next = new Set(selectedSet);
        if (cb.checked) next.add(p.key);
        else next.delete(p.key);
        // Mandatory permissions stay set regardless
        for (const m of OF_MANDATORY_PERMISSIONS) next.add(m);
        onChange(next);
      });
      const label = el('label', { for: id, className: 'permissions-item' + (p.mandatory ? ' mandatory' : '') }, [
        cb,
        el('div', { className: 'permissions-item-text' }, [
          el('div', { className: 'permissions-item-label' }, [
            p.label,
            ...(p.mandatory ? [el('span', { className: 'permissions-required' }, 'required')] : []),
          ]),
          el('div', { className: 'permissions-item-body' }, p.body),
          el('code', { className: 'permissions-item-key' }, p.key),
        ]),
      ]);
      items.appendChild(label);
    }
    block.appendChild(items);
    wrap.appendChild(block);
  }
  return wrap;
}

function renderConsentParamsPanel(params, onChange, opts = {}) {
  // params: { expirationDays, isSingleAuth, transactionMonths }
  // opts:   { includeSingleAuth = true } — J1 hides the single-auth toggle
  //         since bank-direct consent is always one consumer authorising one
  //         account; multi-authoriser only meaningfully applies in J2's
  //         regulated TPP flow (joint/corporate accounts).
  const wrap = el('div', { className: 'consent-params-panel', role: 'group', 'aria-label': 'Consent parameters' });
  wrap.appendChild(el('div', { className: 'consent-params-heading' }, 'Consent parameters'));

  // ExpirationDateTime
  const expRow = el('div', { className: 'consent-params-row' });
  expRow.appendChild(el('div', { className: 'consent-params-label' }, [
    el('strong', {}, 'ExpirationDateTime'),
    el('span', { className: 'consent-params-help' }, 'Sharing window — TPP can keep reading until this date'),
  ]));
  const expChoices = el('div', { className: 'consent-params-choices', role: 'radiogroup' });
  for (const days of [30, 90, 180, 365]) {
    const selected = params.expirationDays === days;
    const chip = el('button', {
      type: 'button',
      className: 'consent-params-chip' + (selected ? ' selected' : ''),
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => onChange({ ...params, expirationDays: days }),
    }, `${days} days`);
    expChoices.appendChild(chip);
  }
  expRow.appendChild(expChoices);
  wrap.appendChild(expRow);

  // IsSingleAuthorization (J2 only by default)
  if (opts.includeSingleAuth !== false) {
    const singleAuthRow = el('div', { className: 'consent-params-row' });
    singleAuthRow.appendChild(el('div', { className: 'consent-params-label' }, [
      el('strong', {}, 'IsSingleAuthorization'),
      el('span', { className: 'consent-params-help' }, 'When on, the consent must be approved by a single authoriser. For joint or corporate accounts, leave off to allow multi-auth.'),
    ]));
    const toggle = el('button', {
      type: 'button',
      className: 'consent-params-toggle' + (params.isSingleAuth ? ' on' : ''),
      'aria-pressed': params.isSingleAuth ? 'true' : 'false',
      onclick: () => onChange({ ...params, isSingleAuth: !params.isSingleAuth }),
    }, params.isSingleAuth ? 'On' : 'Off');
    singleAuthRow.appendChild(toggle);
    wrap.appendChild(singleAuthRow);
  }

  // TransactionFromDateTime
  const txRow = el('div', { className: 'consent-params-row' });
  txRow.appendChild(el('div', { className: 'consent-params-label' }, [
    el('strong', {}, 'TransactionFromDateTime'),
    el('span', { className: 'consent-params-help' }, 'How far back the TPP can read transactions. Standards max: 13 months.'),
  ]));
  const txChoices = el('div', { className: 'consent-params-choices', role: 'radiogroup' });
  for (const months of [3, 6, 13]) {
    const selected = params.transactionMonths === months;
    const chip = el('button', {
      type: 'button',
      className: 'consent-params-chip' + (selected ? ' selected' : ''),
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => onChange({ ...params, transactionMonths: months }),
    }, `${months} months`);
    txChoices.appendChild(chip);
  }
  txRow.appendChild(txChoices);
  wrap.appendChild(txRow);

  return wrap;
}

// Sub-step indicator — small pill row used by both J1 step 3 and J2 step 4
// to show progress through the consent journey's sub-steps. Clickable for
// backward navigation only (forward nav is gated on actually completing
// the prerequisite sub-step).
function renderSubStepIndicator(steps, currentKey, onClick) {
  const list = el('ol', { className: 'sub-step-indicator', role: 'list', 'aria-label': 'Sub-step progress' });
  const curIdx = steps.findIndex((s) => s.key === currentKey);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const isActive = s.key === currentKey;
    const isDone = i < curIdx;
    const item = el('li', {
      className: 'sub-step-item' + (isActive ? ' active' : '') + (isDone ? ' done' : ''),
    }, [
      el('span', { className: 'sub-step-num' }, isDone ? '✓' : String(i + 1)),
      el('span', { className: 'sub-step-label' }, s.label),
    ]);
    if (onClick && isDone) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => onClick(s.key));
    }
    list.appendChild(item);
  }
  return list;
}

// ─── State ──────────────────────────────────────────────────────────

// view: 'hub' (default landing — two cards + J3 contrast)
//       'j1'  (Bank-direct MCP labs wizard — was the only view before this redesign)
//       'j2'  (OF rails TPP via Al Tareq wizard — Phase B)
// step:  1..4 inside the J1 wizard. Ignored when view !== 'j1'.
// j2*:   J2 wizard state (5 steps: persona → scope → LFIs → Al Tareq consent → PFM/BFM)
//        Kept independent of J1 state so users can walk both journeys without one
//        wizard's progress clobbering the other. selectedPersonaId is shared — the
//        same persona can drive both journeys.
const state = {
  view: 'hub',
  step: 1,
  filter: 'all',
  personas: [],
  selectedPersonaId: null,
  selectedBankProfiles: new Set(),
  selectedInsuranceLines: new Set(),
  approved: false,
  // J1 consent-flow extensions (Phase C — consent-fidelity refit) ───
  // subStep walks inside the J1 wizard's step 3: discovery → SCA → consent → token
  subStep: 'discovery',
  j1Permissions: new Set(OF_PERMISSIONS.map((p) => p.key)),
  j1ExpirationDays: 90,
  j1ConsentId: null,
  // J2 ──────────────────────────────────────────────────────────────
  j2Step: 1,
  j2Filter: 'all',                // 'all' | 'retail' | 'sme'
  j2Scope: null,                  // 'single' | 'multi'
  j2SelectedLFIs: new Set(),      // subset of LFI_PROFILES keys (rich/median/sparse)
  j2Approved: false,
  // J2 step 4 sub-flow state (Phase C — consent-fidelity refit) ────
  // j2SubStep walks inside J2's step 4: tpp → altareq → sca → manager
  j2SubStep: 'tpp',
  j2SCAIndex: 0,                  // 0-based index into j2SelectedLFIs during per-LFI SCA
  j2Permissions: new Set(OF_PERMISSIONS.map((p) => p.key)),
  j2ExpirationDays: 90,
  j2IsSingleAuth: false,
  j2TransactionMonths: 13,        // Standards v2.1 maximum
  j2SelectedAccounts: new Map(),  // lfiKey → Set<accountId>, populated lazily during 4c
  j2ConsentIds: new Map(),        // lfiKey → ConsentId (urn:…), minted on per-LFI confirm
  // Flat list of consent records — Consent Manager view renders from this.
  // Each record: { source: 'j1' | 'j2', tpp, lfi, consentId, permissions,
  //                expiresAt, accounts, status: 'Active' | 'Revoked' }
  consentRecords: [],
};

function selectedPersona() {
  return state.personas.find((p) => p.id === state.selectedPersonaId) || null;
}

// ─── URL state (permalink) ─────────────────────────────────────────

// Serialize the user-facing journey state into URLSearchParams. UI state
// (filter, in-flight loaders) is deliberately excluded.
function serializeStateToParams() {
  const params = new URLSearchParams();
  if (state.view && state.view !== 'hub') params.set('view', state.view);
  if (state.selectedPersonaId) params.set('persona', state.selectedPersonaId);
  if (state.selectedBankProfiles.size) params.set('banks', [...state.selectedBankProfiles].join(','));
  if (state.selectedInsuranceLines.size) params.set('lines', [...state.selectedInsuranceLines].join(','));
  if (state.step && state.step !== 1) params.set('step', String(state.step));
  // J1 sub-step (only meaningful when view=j1 and step=3)
  if (state.subStep && state.subStep !== 'discovery' && state.step === 3) params.set('substep', state.subStep);
  // J2 state — namespaced to avoid colliding with J1 params on shared URLs
  if (state.j2Step && state.j2Step !== 1) params.set('j2step', String(state.j2Step));
  if (state.j2Scope) params.set('j2scope', state.j2Scope);
  if (state.j2SelectedLFIs.size) params.set('j2lfis', [...state.j2SelectedLFIs].join(','));
  // J2 sub-step (only meaningful when view=j2 and j2step=4)
  if (state.j2SubStep && state.j2SubStep !== 'tpp' && state.j2Step === 4) params.set('j2substep', state.j2SubStep);
  // J2 SCA index (only meaningful when j2substep=sca)
  if (state.j2SCAIndex > 0 && state.j2SubStep === 'sca' && state.j2Step === 4) params.set('j2scaindex', String(state.j2SCAIndex));
  return params;
}

// Push current state to the URL without scrolling or triggering navigation.
// Called by refresh() so every state change is reflected in the address bar.
function pushUrl() {
  const params = serializeStateToParams();
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

// Read state from URL on load. Returns true if any state was restored.
function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let any = false;
  // View routing — explicit ?view=j1|j2|hub, else inferred from legacy state
  // (a pre-redesign deep-link with persona/step but no view → land in j1).
  const view = params.get('view');
  if (view === 'j1' || view === 'j2' || view === 'hub') {
    state.view = view;
    if (view !== 'hub') any = true;
  } else if (params.has('persona') || params.has('banks') || params.has('lines') || params.has('step')) {
    state.view = 'j1';
    any = true;
  }
  const personaId = params.get('persona');
  if (personaId && state.personas.some((p) => p.id === personaId)) {
    state.selectedPersonaId = personaId;
    any = true;
  }
  const banks = params.get('banks');
  if (banks) {
    state.selectedBankProfiles = new Set(banks.split(',').filter((b) => LFI_PROFILES.some((p) => p.key === b)));
    any = true;
  }
  const lines = params.get('lines');
  if (lines) {
    state.selectedInsuranceLines = new Set(lines.split(',').filter((l) => INSURANCE_LINES.includes(l)));
    any = true;
  }
  const step = parseInt(params.get('step') || '1', 10);
  if (step >= 1 && step <= 4) {
    state.step = step;
    if (step !== 1) any = true;
  }
  // Validate: if step > 1 but no persona, bounce to step 1. If step > 2 but
  // no institutions, bounce to step 2.
  if (state.step > 1 && !selectedPersona()) state.step = 1;
  if (state.step > 2 && state.selectedBankProfiles.size + state.selectedInsuranceLines.size === 0) state.step = 2;
  // J1 sub-step restore
  const subStep = params.get('substep');
  if (subStep === 'discovery' || subStep === 'sca' || subStep === 'consent' || subStep === 'token') {
    state.subStep = subStep;
    if (subStep !== 'discovery') any = true;
  }
  // J2 state restore
  const j2Step = parseInt(params.get('j2step') || '1', 10);
  if (j2Step >= 1 && j2Step <= 5) {
    state.j2Step = j2Step;
    if (j2Step !== 1) any = true;
  }
  const j2Scope = params.get('j2scope');
  if (j2Scope === 'single' || j2Scope === 'multi') {
    state.j2Scope = j2Scope;
    any = true;
  }
  const j2Lfis = params.get('j2lfis');
  if (j2Lfis) {
    state.j2SelectedLFIs = new Set(j2Lfis.split(',').filter((b) => LFI_PROFILES.some((p) => p.key === b)));
    any = true;
  }
  // J2 step gating: bounce back if the prerequisite for a step isn't met.
  if (state.j2Step > 1 && !selectedPersona()) state.j2Step = 1;
  if (state.j2Step > 2 && !state.j2Scope) state.j2Step = 2;
  if (state.j2Step > 3 && state.j2SelectedLFIs.size === 0) state.j2Step = 3;
  if (state.j2Scope === 'multi' && state.j2SelectedLFIs.size === 1 && state.j2Step > 3) state.j2Step = 3;
  // J2 sub-step restore
  const j2Sub = params.get('j2substep');
  if (j2Sub === 'tpp' || j2Sub === 'altareq' || j2Sub === 'sca' || j2Sub === 'manager') {
    state.j2SubStep = j2Sub;
    if (j2Sub !== 'tpp') any = true;
  }
  const j2ScaIdx = parseInt(params.get('j2scaindex') || '0', 10);
  if (j2ScaIdx > 0 && j2ScaIdx < state.j2SelectedLFIs.size) {
    state.j2SCAIndex = j2ScaIdx;
    any = true;
  }
  return any;
}

// ─── Data ───────────────────────────────────────────────────────────

async function loadPersonas() {
  try {
    const res = await fetch('../fixtures/v1/manifest.json');
    if (res.ok) {
      const m = await res.json();
      return toPersonaList(m.personas);
    }
  } catch { /* fall through */ }
  try {
    const res = await fetch('../dist/data.json');
    if (res.ok) {
      const d = await res.json();
      return toPersonaList(d.personas);
    }
  } catch { /* fall through */ }
  throw new Error('no persona data — run `npm run build:fixtures` or `npm run build:data`');
}

function toPersonaList(map) {
  return Object.entries(map).map(([id, v]) => ({
    id,
    name: v.name,
    archetype: v.archetype,
    domain: v.domain,
    segment: v.segment || null,
    default_seed: v.default_seed || null,
    stress_coverage: v.stress_coverage || [],
    multi_lfi_footprint: v.multi_lfi_footprint || null,
  })).sort((a, b) => {
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.name.localeCompare(b.name);
  });
}

function firstSelectedLfi() {
  const order = ['median', 'rich', 'sparse'];
  for (const k of order) if (state.selectedBankProfiles.has(k)) return k;
  return [...state.selectedBankProfiles][0] || 'median';
}

// ─── Rendering ─────────────────────────────────────────────────────

// Hub / J1 / J2 view swap. Run on every refresh so URL → view changes
// (back/forward, deep-link) stay in sync with the DOM.
function renderView() {
  const hub = document.getElementById('hub');
  const j3 = document.getElementById('j3-contrast');
  const j1Box = document.getElementById('journey-j1');
  const j2Box = document.getElementById('journey-j2');
  const showHub = state.view === 'hub';
  if (hub) hub.hidden = !showHub;
  if (j3) j3.hidden = !showHub; // J3 is part of the hub story — only visible there
  if (j1Box) j1Box.hidden = state.view !== 'j1';
  if (j2Box) j2Box.hidden = state.view !== 'j2';
  if (!showHub) {
    // When entering a journey, scroll back to top so the user lands on the
    // journey eyebrow rather than wherever the hub scroll left them.
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

function refresh() {
  renderView();
  // Only do the J1 wizard rendering work when J1 is actually visible.
  if (state.view === 'j1') {
    document.querySelectorAll('#wizard-steps .step').forEach((node) => {
      const s = Number(node.dataset.step);
      node.classList.toggle('active', s === state.step);
      node.classList.toggle('done', s < state.step);
    });
    for (const s of [1, 2, 3, 4]) {
      document.getElementById(`step-${s}`).hidden = s !== state.step;
    }
    if (state.step === 1) renderPersonaGallery();
    else if (state.step === 2) renderInstitutions();
    else if (state.step === 3) renderConsent();
    else if (state.step === 4) renderConnected();
    renderActions();
  } else if (state.view === 'j2') {
    document.querySelectorAll('#j2-wizard-steps .step').forEach((node) => {
      const s = Number(node.dataset.j2step);
      node.classList.toggle('active', s === state.j2Step);
      node.classList.toggle('done', s < state.j2Step);
    });
    for (const s of [1, 2, 3, 4, 5]) {
      document.getElementById(`j2-step-${s}`).hidden = s !== state.j2Step;
    }
    if (state.j2Step === 1) renderJ2Persona();
    else if (state.j2Step === 2) renderJ2Scope();
    else if (state.j2Step === 3) renderJ2LFIs();
    else if (state.j2Step === 4) renderJ2Consent();
    else if (state.j2Step === 5) renderJ2Dashboard();
    renderJ2Actions();
  }
  pushUrl();
}

function renderPersonaGallery() {
  const grid = document.getElementById('persona-grid');
  grid.innerHTML = '';
  const filtered = state.personas.filter((p) => {
    if (state.filter === 'all') return true;
    if (state.filter === 'banking') return p.domain === 'banking';
    if (state.filter === 'insurance') return p.domain === 'insurance';
    if (state.filter === 'sme') return (p.segment || '').toLowerCase() === 'sme';
    return true;
  });
  for (const p of filtered) {
    const card = el('button', {
      type: 'button',
      className: `persona-card${p.id === state.selectedPersonaId ? ' selected' : ''}`,
      role: 'radio',
      'aria-checked': p.id === state.selectedPersonaId ? 'true' : 'false',
      dataset: { personaId: p.id },
      onclick: () => { state.selectedPersonaId = p.id; resetInstitutionSelection(p); refresh(); },
    }, [
      el('div', { className: 'avatar', style: `background:${avatarColor(p.id)};` }, initials(p.name)),
      el('span', { className: 'pname' }, p.name),
      el('span', { className: 'pmeta' }, `${(p.archetype || '').replace(/_/g, ' ')}${p.segment ? ` · ${p.segment}` : ''}`),
      el('div', { className: 'ptags' }, [
        el('span', { className: `tag domain-${p.domain}` }, p.domain),
        ...(p.segment ? [el('span', { className: 'tag segment-sme' }, p.segment)] : []),
        ...(p.stress_coverage.slice(0, 1).map((t) => el('span', { className: 'tag' }, t.replace(/_/g, ' ')))),
      ]),
    ]);
    grid.appendChild(card);
  }
  if (!filtered.length) {
    grid.appendChild(el('p', { className: 'skeleton' }, 'No personas match this filter.'));
  }
}

// Defaults pre-tick only what the persona's bundle actually contains.
// Cross-domain options are visible-but-empty so the user can simulate
// multi-domain consent without misleading them about fixture coverage.
function resetInstitutionSelection(persona) {
  state.selectedBankProfiles = new Set();
  state.selectedInsuranceLines = new Set();
  if (persona.domain === 'banking') {
    if (persona.multi_lfi_footprint) {
      for (const role of ['primary', 'secondary', 'tertiary']) {
        const r = persona.multi_lfi_footprint[role];
        if (r && r.lfi_default) state.selectedBankProfiles.add(r.lfi_default.toLowerCase());
      }
    } else {
      state.selectedBankProfiles.add('median');
    }
  }
  if (persona.domain === 'insurance') {
    const line = inferInsuranceLine(persona);
    if (line) state.selectedInsuranceLines.add(line);
  }
}

function renderInstitutions() {
  const persona = selectedPersona();
  const body = document.getElementById('institutions-body');
  body.innerHTML = '';
  if (!persona) {
    body.appendChild(el('p', { className: 'skeleton' }, 'Pick a persona first.'));
    return;
  }
  const sub = document.getElementById('step-2-sub');
  sub.innerHTML =
    `You're connecting as <strong>${escapeHtml(persona.name)}</strong>. A real customer would see both ` +
    `<strong>Bank Data Sharing</strong> and <strong>Insurance Data Sharing</strong> sections — both are below. ` +
    `Pre-ticks reflect what's actually in this persona's bundle; cross-domain ticks are allowed for the ` +
    `consent simulation but fixtures only exist for the persona's primary domain ` +
    `(<strong>${escapeHtml(persona.domain)}</strong>).`;

  // ─── Bank Data Sharing block (always shown) ───
  const bankHeader = el('h4', {}, persona.domain === 'banking'
    ? 'Bank Data Sharing — populate-rate profiles'
    : 'Bank Data Sharing — populate-rate profiles (no fixtures for this persona)');
  body.appendChild(bankHeader);
  const bankGrid = el('div', { className: 'inst-grid' });
  for (const prof of LFI_PROFILES) {
    const selected = state.selectedBankProfiles.has(prof.key);
    const card = el('button', {
      type: 'button',
      className: `inst-card${selected ? ' selected' : ''}${persona.domain !== 'banking' ? ' cross-domain' : ''}`,
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => {
        if (state.selectedBankProfiles.has(prof.key)) state.selectedBankProfiles.delete(prof.key);
        else state.selectedBankProfiles.add(prof.key);
        renderInstitutions(); renderActions(); pushUrl();
      },
    }, [
      el('div', { className: 'ihead' }, [
        el('span', { className: 'iname' }, prof.name),
        el('span', { className: `ibadge ${prof.key}` }, prof.key),
      ]),
      el('div', { className: 'ibody' }, prof.body),
      el('div', { className: 'iendpoints' }, '12 v2.1 endpoints'),
    ]);
    bankGrid.appendChild(card);
  }
  body.appendChild(bankGrid);

  if (persona.multi_lfi_footprint) {
    const advisory = el('div', { className: 'footprint-advisory' });
    advisory.appendChild(el('strong', {}, 'Real-world plausible UAE LFIs for this persona'));
    advisory.appendChild(el('span', {}, 'Descriptive of the SME\'s likely relationships per persona manifest — not bound to any populate-rate profile (NG5 / D-14).'));
    for (const role of ['primary', 'secondary', 'tertiary']) {
      const r = persona.multi_lfi_footprint[role];
      if (!r) continue;
      const roleLabel = `${role} · ${r.role.replace(/_/g, ' ')}`;
      advisory.appendChild(el('div', { className: 'candidate-role' }, roleLabel));
      const row = el('div', { className: 'candidate-row' });
      for (const cand of (r.plausible_lfi_candidates || [])) {
        row.appendChild(el('span', { className: 'cand' }, cand));
      }
      advisory.appendChild(row);
    }
    body.appendChild(advisory);
  }

  // ─── Insurance Data Sharing block (always shown) ───
  const insHeader = el('h4', {}, persona.domain === 'insurance'
    ? 'Insurance Data Sharing — applicable lines'
    : 'Insurance Data Sharing — applicable lines (no fixtures for this persona)');
  body.appendChild(insHeader);
  const insGrid = el('div', { className: 'inst-grid' });
  const personaLine = inferInsuranceLine(persona);
  for (const lineKey of INSURANCE_LINES) {
    const meta = INSURANCE_LINE_LABELS[lineKey];
    const selected = state.selectedInsuranceLines.has(lineKey);
    const isPersonaLine = persona.domain === 'insurance' && personaLine === lineKey;
    const card = el('button', {
      type: 'button',
      className: `inst-card${selected ? ' selected' : ''}${!isPersonaLine && persona.domain !== 'banking' ? ' cross-domain' : ''}`,
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => {
        if (state.selectedInsuranceLines.has(lineKey)) state.selectedInsuranceLines.delete(lineKey);
        else state.selectedInsuranceLines.add(lineKey);
        renderInstitutions(); renderActions(); pushUrl();
      },
    }, [
      el('div', { className: 'ihead' }, [
        el('span', { className: 'iname' }, meta.name),
        el('span', { className: 'ibadge' }, isPersonaLine ? 'persona line' : 'read-only'),
      ]),
      el('div', { className: 'ibody' }, meta.body),
      el('div', { className: 'iendpoints' }, `/${lineKey}-insurance-policies/* · /quotes/*`),
    ]);
    insGrid.appendChild(card);
  }
  body.appendChild(insGrid);
}

// J1 step 3 sub-flow ────────────────────────────────────────────────
//
// Replaces the old single-screen consent with a 4-sub-step journey that
// mirrors what the MCP + OAuth handshake actually does end-to-end:
//   3a discovery — the spec-mandated 401 → .well-known → /authorize chain
//                  that runs before the user sees anything
//   3b sca       — bank-side Strong Customer Authentication (Article 18)
//   3c consent   — bank-own OAuth consent with the v2.1 Permissions taxonomy
//                  and full consent parameters (ExpirationDateTime, etc.)
//   3d token     — token exchange + bearer issued, "returning to Claude"
//
// The wizard's main Next/Back buttons walk through the sub-steps within
// step 3, then advance to step 4 once 3d completes. URL state stays
// readable: ?view=j1&step=3&substep=consent round-trips.

const J1_SUB_STEPS = [
  { key: 'discovery', label: 'Discovery' },
  { key: 'sca',       label: 'Sign in (SCA)' },
  { key: 'consent',   label: 'Consent' },
  { key: 'token',     label: 'Token' },
];

function renderConsent() {
  const persona = selectedPersona();
  const body = document.getElementById('consent-body');
  body.replaceChildren();
  if (!persona) return;

  body.appendChild(renderSubStepIndicator(J1_SUB_STEPS, state.subStep, (key) => {
    state.subStep = key;
    refresh();
  }));

  if (state.subStep === 'discovery') renderJ1Discovery(body);
  else if (state.subStep === 'sca') renderJ1SCA(body);
  else if (state.subStep === 'consent') renderJ1Consent(body);
  else if (state.subStep === 'token') renderJ1Token(body);
}

// 3a — MCP discovery chain. Four real HTTP exchanges that the MCP client
// runs before the user ever sees a consent screen. Each row visualises
// one round-trip; the "Probe the live server" button fetches the actual
// RFC 9728 / RFC 8414 documents from the Fly deploy and inlines them.
function renderJ1Discovery(body) {
  const wrap = el('div', { className: 'discovery-chain' });
  wrap.appendChild(el('p', { className: 'discovery-intro' }, [
    'When Claude first touches the sandbox MCP, the spec-mandated discovery chain runs. ',
    'You don’t see it because Claude’s MCP client handles the handshake before bringing you to the consent screen. ',
    'Each row below is one real HTTP exchange — click ',
    el('strong', {}, 'Probe the live server'),
    ' to populate the metadata rows from the production deploy at ',
    el('code', {}, 'data-sandbox.fly.dev'), '.',
  ]));

  const rows = [
    {
      method: 'GET', path: '/mcp',
      status: '401 Unauthorized', statusKind: 'warn',
      headers: [
        'WWW-Authenticate: Bearer realm="open-finance-sandbox",',
        '                  authorization_uri="…/authorize",',
        '                  resource_metadata="…/.well-known/oauth-protected-resource"',
      ],
      caption: 'Server signals that auth is required and points at metadata to bootstrap the flow.',
    },
    {
      method: 'GET', path: '/.well-known/oauth-protected-resource',
      status: '200 OK', statusKind: 'pos',
      caption: 'RFC 9728 — declares the authorization server(s) the resource trusts.',
      bodyId: 'rfc9728',
    },
    {
      method: 'GET', path: '/.well-known/oauth-authorization-server',
      status: '200 OK', statusKind: 'pos',
      caption: 'RFC 8414 — declares /authorize and /token endpoints, supported scopes, PKCE methods.',
      bodyId: 'rfc8414',
    },
    {
      method: 'GET', path: '/authorize?client_id=…&code_challenge=…&code_challenge_method=S256',
      status: '302 Found', statusKind: 'pos',
      caption: 'PKCE S256 challenge sent. Server 302s to your bank’s SCA screen — that’s sub-step 3b.',
    },
  ];

  for (const row of rows) {
    const card = el('div', { className: 'discovery-row' }, [
      el('div', { className: 'discovery-row-line' }, [
        el('span', { className: 'discovery-method' }, row.method),
        el('code', { className: 'discovery-path' }, row.path),
        el('span', { className: 'discovery-arrow' }, '→'),
        el('span', { className: 'discovery-status ' + row.statusKind }, row.status),
      ]),
      ...(row.headers ? [el('pre', { className: 'discovery-headers' }, row.headers.join('\n'))] : []),
      ...(row.bodyId ? [el('pre', { className: 'discovery-body', id: `discovery-body-${row.bodyId}` }, '(click “Probe the live server” below to populate)')] : []),
      el('p', { className: 'discovery-caption' }, row.caption),
    ]);
    wrap.appendChild(card);
  }

  const probeBtn = el('button', {
    type: 'button',
    className: 'btn primary',
    style: 'margin-top:10px;',
  }, 'Probe the live server →');
  probeBtn.addEventListener('click', () => probeLiveServer(probeBtn));
  wrap.appendChild(probeBtn);

  body.appendChild(wrap);
}

async function probeLiveServer(btn) {
  btn.disabled = true;
  btn.textContent = 'Probing…';
  const base = 'https://data-sandbox.fly.dev';
  const targets = [
    { id: 'rfc9728', url: `${base}/.well-known/oauth-protected-resource` },
    { id: 'rfc8414', url: `${base}/.well-known/oauth-authorization-server` },
  ];
  let ok = 0;
  for (const t of targets) {
    const target = document.getElementById(`discovery-body-${t.id}`);
    if (!target) continue;
    try {
      const res = await fetch(t.url);
      const json = await res.json();
      target.textContent = JSON.stringify(json, null, 2);
      ok += 1;
    } catch (err) {
      target.textContent = `(fetch failed: ${err.message})`;
    }
  }
  btn.textContent = ok === targets.length ? 'Live metadata loaded ✓' : 'Partial fetch (see panels)';
}

// 3b — Bank-side Strong Customer Authentication. Article 18 of CBUAE
// Circular C 03/2025 mandates 2FA. Mock screen shows username + password
// + 6-digit OTP (with a "use bank app" push-based alternate). All values
// are decorative — Continue advances to the consent screen regardless.
function renderJ1SCA(body) {
  const persona = selectedPersona();
  const userBase = persona ? persona.name.split('—')[0].trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '') : 'you';
  const username = `${userBase}@your-bank-labs.example`;
  const mock = el('div', { className: 'sca-mock', role: 'img', 'aria-label': 'Mock bank Strong Customer Authentication screen' });
  mock.appendChild(el('div', { className: 'browser-bar' }, [
    el('span', { className: 'dots' }, [el('span'), el('span'), el('span')]),
    el('span', { className: 'url' }, 'https://auth.your-bank-labs.example/sca?continue=…'),
  ]));
  const inner = el('div', { className: 'body' });
  inner.appendChild(el('h4', {}, 'Sign in to your bank'));
  inner.appendChild(el('p', { className: 'sub' }, [
    'Strong Customer Authentication. Your bank verifies you with knowledge (password) + possession (one-time code) — Article 18, CBUAE C 03/2025. ',
    'This is the bank’s own auth surface; Claude never sees these credentials.',
  ]));
  const form = el('div', { className: 'sca-form' });
  form.appendChild(el('label', { for: 'sca-user' }, 'Username'));
  form.appendChild(el('input', { type: 'text', id: 'sca-user', value: username, readonly: true }));
  form.appendChild(el('label', { for: 'sca-pass', style: 'margin-top:10px;' }, 'Password'));
  form.appendChild(el('input', { type: 'password', id: 'sca-pass', value: '••••••••••', readonly: true }));

  const otpBlock = el('div', { className: 'sca-otp' });
  otpBlock.appendChild(el('div', { className: 'sca-otp-heading' }, '2FA — enter the 6-digit code from your bank app'));
  const otpInputs = el('div', { className: 'sca-otp-inputs' });
  for (let i = 0; i < 6; i++) {
    otpInputs.appendChild(el('input', { type: 'text', maxlength: 1, value: ['8','3','9','1','7','2'][i], readonly: true, 'aria-label': `OTP digit ${i + 1}` }));
  }
  otpBlock.appendChild(otpInputs);
  otpBlock.appendChild(el('p', { className: 'sca-otp-alt' }, [
    'or ', el('strong', {}, 'use your bank app'), ' to push-approve this sign-in — same regulatory category (Article 18), no code to type.',
  ]));
  form.appendChild(otpBlock);
  form.appendChild(el('p', { className: 'sca-note' }, 'No real network call — values are decorative. Click ', el('strong', {}, 'Next →'), ' when ready.'));
  inner.appendChild(form);
  mock.appendChild(inner);
  body.appendChild(mock);
}

// 3c — Bank-own OAuth consent. Reuses the consent-mock chrome but with the
// real v2.1 Permissions taxonomy (toggleable, ReadAccountsBasic mandatory)
// and consent parameters panel. Shows the ConsentId that will be minted
// on Approve — bridges the OAuth and Open Finance vocabularies.
function renderJ1Consent(body) {
  const persona = selectedPersona();
  if (!persona) return;
  const mock = el('div', { className: 'consent-mock', role: 'img', 'aria-label': 'Mock bank-own OAuth consent screen (Journey 1)' });
  mock.appendChild(el('div', { className: 'browser-bar' }, [
    el('span', { className: 'dots' }, [el('span'), el('span'), el('span')]),
    el('span', { className: 'url' }, 'https://auth.your-bank-labs.example/authorize?client_id=claude&code_challenge=…&scope=…'),
  ]));
  const inner = el('div', { className: 'body' });
  inner.appendChild(el('h4', {}, 'Share with Claude · your bank’s labs MCP'));
  inner.appendChild(el('p', { className: 'sub' }, [
    'OAuth 2.1 + PKCE. Pick the data clusters Claude can read. Revocation lives in your bank’s ',
    el('em', {}, 'Connected apps'),
    ' page — not Al Tareq (that’s J2).',
  ]));
  inner.appendChild(el('div', { className: 'persona-line' }, [
    el('div', { className: 'avatar', style: `background:${avatarColor(persona.id)};` }, initials(persona.name)),
    el('div', {}, [
      el('div', { className: 'pn' }, persona.name),
      el('div', { className: 'pm' }, `${persona.domain}${persona.segment ? ` · ${persona.segment}` : ''} · single LFI (bank-direct)`),
    ]),
  ]));

  inner.appendChild(renderPermissionsList(
    state.j1Permissions,
    (next) => { state.j1Permissions = next; refresh(); },
    { idPrefix: 'j1' },
  ));

  inner.appendChild(renderConsentParamsPanel(
    { expirationDays: state.j1ExpirationDays, isSingleAuth: true, transactionMonths: 13 },
    ({ expirationDays }) => { state.j1ExpirationDays = expirationDays; refresh(); },
    { includeSingleAuth: false },
  ));

  inner.appendChild(el('div', { className: 'scope unchecked', style: 'margin-top:12px;' }, [
    el('span', { className: 'tick', 'aria-hidden': 'true' }),
    el('div', {}, [
      el('strong', {}, 'Service Initiation — payments'),
      el('span', { className: 'scope-body' }, 'Not requested · v1 read-only'),
    ]),
  ]));

  inner.appendChild(el('div', { className: 'consent-id-preview' }, [
    el('div', { className: 'consent-id-label' }, 'On approve, the bank will register:'),
    el('code', {}, 'urn:openfinance:ae:consent:<fresh-uuid-on-approve>'),
    el('div', { className: 'consent-id-help' }, 'A durable handle for the consent. The bank’s Connected apps page lists every active ConsentId; revocation takes a single tap there.'),
  ]));

  const footnote = el('p', { className: 'footnote' }, [
    'Sharing window ', el('strong', {}, `${state.j1ExpirationDays} days`),
    `. Transactions readable back ${[...state.j1Permissions].filter((k) => k.startsWith('ReadTransactions')).length ? '13 months' : '— (transactions permission off)'}. `,
    'Data is ', el('strong', {}, 'SYNTHETIC'), '. No real customer. No real institution.',
  ]);
  inner.appendChild(footnote);

  mock.appendChild(inner);
  body.appendChild(mock);
}

// 3d — Token exchange + return. Renders the artefacts that result from the
// PKCE-validated /token POST: the access bearer, expiry, scope, and the
// freshly minted ConsentId. The "Continue" button on the main wizard
// advances to step 4 (the chat-back surface).
function renderJ1Token(body) {
  const cid = state.j1ConsentId || mintConsentId(); // safety — should be set by Next handler
  state.j1ConsentId = cid;
  const tokenTail = cid.slice(-12);
  const wrap = el('div', { className: 'token-panel' });
  wrap.appendChild(el('div', { className: 'token-headline' }, [
    el('span', { className: 'token-check' }, '✓'),
    el('strong', {}, 'Bearer issued — '),
    el('span', {}, 'Claude’s MCP client just exchanged the authorization code for an access token using its private PKCE '),
    el('code', {}, 'code_verifier'), '.',
  ]));
  wrap.appendChild(el('dl', { className: 'token-dl' }, [
    el('dt', {}, 'ConsentId'),    el('dd', {}, el('code', {}, cid)),
    el('dt', {}, 'access_token'), el('dd', {}, el('code', {}, `ofx_at_${tokenTail}…`)),
    el('dt', {}, 'token_type'),   el('dd', {}, 'Bearer'),
    el('dt', {}, 'expires_in'),   el('dd', {}, `3600 (1h TTL — re-issued automatically · ${state.j1ExpirationDays}-day sharing window)`),
    el('dt', {}, 'scope'),        el('dd', {}, `${[...state.j1Permissions].length} permissions granted`),
  ]));
  wrap.appendChild(el('p', { className: 'token-note' }, [
    'From here every ', el('code', {}, 'POST /mcp'), ' call carries ', el('code', {}, 'Authorization: Bearer …'),
    '. The bearer is checked on every request, not just initialize. Click ',
    el('strong', {}, 'Next →'),
    ' to land on the chat surface.',
  ]));
  body.appendChild(wrap);
}

function renderConnected() {
  const persona = selectedPersona();
  const body = document.getElementById('connected-body');
  body.replaceChildren();
  if (!persona) return;

  const totalInst = state.selectedBankProfiles.size + state.selectedInsuranceLines.size;
  const fakeToken = `ofx_at_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

  body.appendChild(el('div', { className: 'connected-summary' }, [
    el('div', { className: 'label' }, '✓ Bearer issued'),
    el('div', { className: 'summary-line' }, [
      el('span', {}, 'Connected as '),
      el('strong', {}, persona.name),
      el('span', {}, ' · '),
      el('strong', {}, `${totalInst} institution${totalInst === 1 ? '' : 's'}`),
      el('span', {}, ' · 90-day consent window.'),
    ]),
    el('div', { className: 'summary-line', style: 'margin-top:6px;color:var(--text-muted);font-family:ui-monospace,Menlo,monospace;font-size:11.5px;' },
      `access_token: ${fakeToken}`),
  ]));

  // Auto-fetch on entering step 4 — no extra button click. This is the
  // Plaid + ChatGPT "return to chat" pattern: connection completes and
  // the conversation surface immediately reflects the new data.
  const lfi = firstSelectedLfi();
  const container = el('div', { className: 'chat-and-strip' });
  body.appendChild(container);
  if (!persona.default_seed) {
    container.appendChild(el('p', { className: 'skeleton', style: 'color:var(--warn-border);' },
      `No default_seed for this persona — run \`npm run build:fixtures && npm run build:site\` first.`));
  } else {
    container.appendChild(el('p', { className: 'skeleton' }, 'Loading your account data…'));
    runLiveFetch(persona, lfi, container);
  }

  // "Or do this for real in Claude" sidebar — the step-4 hook that takes
  // the walkthrough out of the simulator and into a real Claude.ai chat
  // backed by the same fixtures. The Fly-hosted MCP server is the
  // canonical J1 demo surface; the local-install instructions are the
  // fallback for users behind a corporate firewall.
  const forReal = el('div', { className: 'for-real-card' }, [
    el('div', { className: 'label' }, '✦ Or do this for real in Claude'),
    el('h4', {}, 'Add the sandbox as a Claude.ai custom connector'),
    el('ol', {}, [
      el('li', {}, [
        'Open ', el('strong', {}, 'Claude.ai'),
        ' (Free, Pro, Max, Team, or Enterprise) → ',
        el('strong', {}, 'Customize → Connectors → + Add custom connector'),
        '.',
      ]),
      el('li', {}, 'Paste the URL below into the connector URL field. No OAuth Client ID or Secret needed — the deploy is anonymous.'),
      el('li', {}, [
        'In a new chat, call the connector and pick the same persona via ',
        el('code', {}, 'set_session'),
        '. Then ask: ',
        el('em', {}, '“what’s my balance?”'),
      ]),
    ]),
    el('div', { className: 'url-copy', 'aria-label': 'Sandbox MCP connector URL' }, 'https://data-sandbox.fly.dev/mcp'),
    el('a', {
      className: 'docs-link',
      href: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
      target: '_blank',
      rel: 'noopener noreferrer',
    }, 'Claude custom-connector help →'),
  ]);
  body.appendChild(forReal);
}

// ─── Multi-endpoint live fetch + chat-and-strip render ─────────────

async function runLiveFetch(persona, lfi, container) {
  try {
    if (persona.domain === 'banking') await renderBankingChat(persona, lfi, container);
    else await renderInsuranceChat(persona, container);
  } catch (err) {
    container.replaceChildren();
    container.appendChild(el('p', { className: 'skeleton', style: 'color:#a13;' },
      `Couldn't load the fixtures: ${err.message}. Run \`npm run build:fixtures && npm run build:site\`, then serve from \`_site\`.`));
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null; // optional endpoint absent
    throw new Error(`${res.status} ${res.statusText} ${url}`);
  }
  return res.json();
}

// Spec-compliant per /accounts (v2.1 §accounts):
//   Data.Account[].AccountId, Data.Account[].Currency, .Nickname, .AccountType, .AccountSubType
// Per /balances:
//   Data.Balance[].Amount.{Amount, Currency}, .CreditDebitIndicator, .Type, .DateTime
// Per /transactions:
//   Data.Transaction[].Amount.{Amount, Currency}, .CreditDebitIndicator, .BookingDateTime, .TransactionInformation
// Per /standing-orders, /direct-debits:
//   Data.StandingOrder[], Data.DirectDebit[]
//
// The chat answers and mini-strip surface only these spec-defined fields;
// nothing is invented.
async function renderBankingChat(persona, lfi, container) {
  const base = `../fixtures/v1/bundles/${persona.id}/${lfi}/seed-${persona.default_seed}`;

  // Phase 1: discover accounts.
  const acctEnv = await fetchJson(`${base}/accounts.json`);
  if (!acctEnv) throw new Error('accounts.json not found — was the site staged?');
  const accounts = acctEnv.Data?.Account ?? [];

  // Phase 2: parallel per-account fan-out — same pattern the worked TPP
  // demo at examples/tpp-budgeting-demo uses.
  const perAccount = await Promise.all(accounts.map(async (acct) => {
    const id = acct.AccountId;
    const [bal, tx, so, dd] = await Promise.all([
      fetchJson(`${base}/accounts__${id}__balances.json`),
      fetchJson(`${base}/accounts__${id}__transactions.json`),
      fetchJson(`${base}/accounts__${id}__standing-orders.json`),
      fetchJson(`${base}/accounts__${id}__direct-debits.json`),
    ]);
    return { account: acct, balances: bal, transactions: tx, standingOrders: so, directDebits: dd };
  }));

  // Phase 3: compute the deterministic answers off the bound bundle.
  const insights = computeBankingInsights(accounts, perAccount);

  // Phase 4: render — chat transcript on top, mini-strip below, full
  // envelope inventory as a collapsible at the bottom.
  container.replaceChildren();
  const wm = acctEnv._watermark || '';
  if (wm) container.appendChild(el('div', { className: 'watermark-banner' }, wm));

  container.appendChild(renderChatTranscript(persona, buildBankingChat(insights)));
  container.appendChild(renderMiniStrip(buildBankingMiniStrip(insights)));

  // Endpoint inventory — exactly which OF v2.1 paths were touched.
  const inventoryRows = [
    { path: '/accounts', env: acctEnv, count: accounts.length, key: 'Account' },
  ];
  for (const a of perAccount) {
    const id = a.account.AccountId;
    if (a.balances) inventoryRows.push({ path: `/accounts/${id}/balances`, env: a.balances, count: (a.balances.Data?.Balance ?? []).length, key: 'Balance' });
    if (a.transactions) inventoryRows.push({ path: `/accounts/${id}/transactions`, env: a.transactions, count: (a.transactions.Data?.Transaction ?? []).length, key: 'Transaction' });
    if (a.standingOrders) inventoryRows.push({ path: `/accounts/${id}/standing-orders`, env: a.standingOrders, count: (a.standingOrders.Data?.StandingOrder ?? []).length, key: 'StandingOrder' });
    if (a.directDebits) inventoryRows.push({ path: `/accounts/${id}/direct-debits`, env: a.directDebits, count: (a.directDebits.Data?.DirectDebit ?? []).length, key: 'DirectDebit' });
  }
  container.appendChild(renderEnvelopeInventory(inventoryRows, persona, lfi));

  container.appendChild(el('div', { className: 'fetch-footnote' },
    `Every value above is read from spec-defined Data.* paths on the v2.1 envelope. The chat invents nothing — expand "All envelopes" to verify.`));
}

// Compute the answer-bearing facts off the v2.1 envelopes. Every field
// referenced is spec-defined. The function returns plain values so the
// downstream chat-bubble builder can compose them into prose without
// touching the envelopes again.
function computeBankingInsights(accounts, perAccount) {
  let availableTotal = 0;
  let primaryAccountLabel = '';
  let primaryAccountBalance = null;
  let inflow30 = 0;
  let outflow30 = 0;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let latestSalary = null;
  const merchants = new Map(); // 30-day merchant → cumulative outflow
  const RENT_KEY = '__RENT__';

  let soCount = 0;
  let ddCount = 0;

  for (const a of perAccount) {
    const balances = a.balances?.Data?.Balance ?? [];
    const pick = balances.find((b) => b.Type === 'InterimAvailable')
              || balances.find((b) => b.Type === 'InterimBooked')
              || balances[0];
    if (pick && pick.Amount?.Currency === 'AED') {
      const amt = parseFloat(pick.Amount.Amount);
      const signed = pick.CreditDebitIndicator === 'Credit' ? amt : -amt;
      availableTotal += signed;
      if (primaryAccountBalance == null) {
        primaryAccountBalance = signed;
        primaryAccountLabel = a.account.Nickname || a.account.AccountSubType || a.account.AccountType || 'main account';
      }
    }

    for (const t of (a.transactions?.Data?.Transaction ?? [])) {
      if (t.Amount?.Currency !== 'AED') continue;
      const when = Date.parse(t.BookingDateTime || '') || 0;
      if (when < cutoff) continue;
      const amt = parseFloat(t.Amount.Amount);
      const info = t.TransactionInformation || '';

      if (t.CreditDebitIndicator === 'Credit') {
        inflow30 += amt;
        // Salary heuristic — Standards v2.1 leaves payroll detection to TPPs;
        // SAL/PAYROLL is the synthetic-pool convention used in the fixtures.
        if (/SAL|PAYROLL/i.test(info)) {
          if (!latestSalary || when > Date.parse(latestSalary.BookingDateTime || '')) {
            latestSalary = t;
          }
        }
      } else {
        outflow30 += amt;
        // Merchant bucketing: pull the second segment of TransactionInformation
        // (synthetic-pool format "TYPE/MERCHANT/REF"), with RENT folded
        // separately so we can call it out distinctly.
        const merchantRaw = info.split('/')[1] || info;
        const m = merchantRaw === 'RENT' ? RENT_KEY : merchantRaw;
        merchants.set(m, (merchants.get(m) || 0) + amt);
      }
    }
    soCount += (a.standingOrders?.Data?.StandingOrder ?? []).length;
    ddCount += (a.directDebits?.Data?.DirectDebit ?? []).length;
  }

  const topMerchants = [...merchants.entries()]
    .filter(([k]) => k !== RENT_KEY)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const rentTotal = merchants.get(RENT_KEY) || 0;

  return {
    accounts,
    primaryAccountLabel,
    primaryAccountBalance,
    availableTotal,
    inflow30,
    outflow30,
    latestSalary,
    topMerchants,
    rentTotal,
    soCount,
    ddCount,
  };
}

// Compose 4–5 deterministic Q&A pairs that read like a Plaid + ChatGPT
// post-connect exchange. Numbers come from computeBankingInsights().
function buildBankingChat(ins) {
  const exchanges = [];

  exchanges.push({
    q: `What's my main account balance?`,
    a: ins.primaryAccountBalance != null
      ? `Your AED ${ins.primaryAccountLabel} account is at ${formatAed(ins.primaryAccountBalance)} as of the latest reported balance.`
      : `I can see ${ins.accounts.length} account${ins.accounts.length === 1 ? '' : 's'} on file, but no balance was returned for this profile.`,
  });

  if (ins.latestSalary) {
    const t = ins.latestSalary;
    const day = new Date(t.BookingDateTime).getUTCDate();
    const payer = (t.TransactionInformation || '').split('/').slice(-1)[0] || 'your payroll';
    exchanges.push({
      q: 'Did my salary land?',
      a: `Yes — ${formatAed(parseFloat(t.Amount.Amount))} on the ${day}${ordinalSuffix(day)} from ${payer}. Tagged as payroll on the standing pattern.`,
    });
  } else {
    exchanges.push({
      q: 'Did my salary land this month?',
      a: `I don't see a payroll-tagged inflow in the last 30 days. Your total credits over that window were ${formatAed(ins.inflow30)}.`,
    });
  }

  if (ins.topMerchants.length || ins.rentTotal) {
    const tops = [...ins.topMerchants];
    const lead = ins.rentTotal
      ? `Rent — ${formatAed(ins.rentTotal)} to your usual landlord.`
      : tops.length ? `${tops[0][0]} — ${formatAed(tops[0][1])}.` : null;
    const rest = (ins.rentTotal ? tops : tops.slice(1))
      .slice(0, 3)
      .map(([m, v]) => `${formatAed(v)} at ${m}`)
      .join(', ');
    exchanges.push({
      q: 'What were my biggest spends last 30 days?',
      a: lead ? `${lead}${rest ? ` After that: ${rest}.` : ''}` : `Your total outflows were ${formatAed(ins.outflow30)} across ${ins.soCount + ins.ddCount} recurring orders.`,
    });
  }

  exchanges.push({
    q: 'Am I tracking to AED 12,000 a month in non-rent spend?',
    a: (() => {
      const nonRent = ins.outflow30 - ins.rentTotal;
      const headroom = 12000 - nonRent;
      if (headroom > 0) return `You're at ${formatAed(nonRent)} in non-rent spend over the last 30 days — about ${formatAed(headroom)} under AED 12,000.`;
      return `You're at ${formatAed(nonRent)} in non-rent spend over the last 30 days, ${formatAed(-headroom)} over the AED 12,000 line. Worth a closer look.`;
    })(),
  });

  if (ins.soCount + ins.ddCount > 0) {
    exchanges.push({
      q: 'What recurring payments do I have on file?',
      a: `${ins.soCount} standing order${ins.soCount === 1 ? '' : 's'} and ${ins.ddCount} direct debit${ins.ddCount === 1 ? '' : 's'} are active. I can list them by amount or by next-due-date if you want.`,
    });
  }

  return exchanges;
}

function buildBankingMiniStrip(ins) {
  const cards = [];
  if (ins.primaryAccountBalance != null) {
    cards.push({ label: 'Main balance', value: formatAed(ins.primaryAccountBalance), hint: ins.primaryAccountLabel });
  }
  cards.push({ label: 'Inflows · 30d', value: formatAed(ins.inflow30), hint: ins.latestSalary ? 'incl. payroll' : 'no payroll match' });
  cards.push({ label: 'Outflows · 30d', value: formatAed(ins.outflow30), hint: ins.rentTotal ? `incl. ${formatAed(ins.rentTotal)} rent` : 'no rent match' });
  if (ins.soCount + ins.ddCount > 0) {
    cards.push({ label: 'Recurring', value: String(ins.soCount + ins.ddCount), hint: `${ins.soCount} SO · ${ins.ddCount} DD` });
  } else {
    cards.push({ label: 'Accounts', value: String(ins.accounts.length), hint: 'on file' });
  }
  return cards;
}

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  const last = n % 10;
  return last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
}

// Renders a chat-style transcript with alternating user / Claude bubbles.
// Q&A pairs come from build*Chat() helpers — keep this function pure UI.
function renderChatTranscript(persona, exchanges) {
  const userInitials = initials(persona.name);
  const userColor = avatarColor(persona.id);
  const wrap = el('div', { className: 'chat-mock', role: 'group', 'aria-label': 'Chat transcript' });
  wrap.appendChild(el('div', { className: 'chat-title' }, '💬 Back in the chat with Claude'));
  for (const { q, a } of exchanges) {
    wrap.appendChild(el('div', { className: 'chat-msg user' }, [
      el('span', { className: 'chat-avatar', style: `background:${userColor};` }, userInitials),
      el('span', { className: 'chat-bubble' }, q),
    ]));
    wrap.appendChild(el('div', { className: 'chat-msg claude' }, [
      el('span', { className: 'chat-avatar' }, 'C'),
      el('span', { className: 'chat-bubble' }, a),
    ]));
  }
  return wrap;
}

function renderMiniStrip(cards) {
  const strip = el('div', { className: 'mini-strip', role: 'group', 'aria-label': 'Account summary at a glance' });
  for (const c of cards) {
    strip.appendChild(el('div', { className: 'mini-card' }, [
      el('div', { className: 'mini-label' }, c.label),
      el('div', { className: 'mini-value' }, c.value),
      c.hint ? el('div', { className: 'mini-hint' }, c.hint) : null,
    ]));
  }
  return strip;
}

// Spec-compliant per /<line>-insurance-policies (v2.1 insurance):
//   Data.Policies[].InsurancePolicyId, .PolicyNumber, .PolicyStatus,
//   .PolicyStartDate, .PolicyEndDate
async function renderInsuranceChat(persona, container) {
  const line = inferInsuranceLine(persona);
  if (!line) throw new Error(`could not infer insurance line for ${persona.id}`);
  const base = `../fixtures/v1/bundles/${persona.id}/median/seed-${persona.default_seed}`;
  const env = await fetchJson(`${base}/${line}-insurance-policies.json`);
  if (!env) throw new Error(`${line}-insurance-policies.json not found`);
  const policies = env.Data?.Policies ?? [];
  const first = policies[0] || {};

  container.replaceChildren();
  const wm = env._watermark || '';
  if (wm) container.appendChild(el('div', { className: 'watermark-banner' }, wm));

  container.appendChild(renderChatTranscript(persona, buildInsuranceChat(line, policies, first)));
  container.appendChild(renderMiniStrip(buildInsuranceMiniStrip(line, policies, first)));

  container.appendChild(renderEnvelopeInventory([
    { path: `/${line}-insurance-policies`, env, count: policies.length, key: 'Policies' },
  ], persona, 'median'));

  container.appendChild(el('div', { className: 'fetch-footnote' },
    `For richer policy detail (PolicyHolder, Premium, Product, Claims) call GET /${line}-insurance-policies/{InsurancePolicyId} via the MCP — the list endpoint per spec carries summary fields only.`));
}

function buildInsuranceChat(line, policies, first) {
  const lineName = INSURANCE_LINE_LABELS[line]?.name || `${line} insurance`;
  const exchanges = [];
  exchanges.push({
    q: `What ${line} cover do I have?`,
    a: policies.length
      ? `You have ${policies.length} ${lineName.toLowerCase()} polic${policies.length === 1 ? 'y' : 'ies'} on file. The active one is ${first.PolicyNumber || 'unknown'} — status ${first.PolicyStatus || 'unknown'}.`
      : `I don't see any ${lineName.toLowerCase()} policies on the consent.`,
  });
  if (first.PolicyEndDate) {
    exchanges.push({
      q: 'When does it renew?',
      a: `Your policy ends on ${formatDate(first.PolicyEndDate)}${first.PolicyStartDate ? ` (active since ${formatDate(first.PolicyStartDate)})` : ''}. Expect a renewal quote a few weeks beforehand.`,
    });
  }
  exchanges.push({
    q: 'Can you pull the policy details?',
    a: `For premium, policyholder, product details, and claims history I'd call GET /${line}-insurance-policies/${first.InsurancePolicyId || '{id}'} next. The list response only carries the summary view.`,
  });
  return exchanges;
}

function buildInsuranceMiniStrip(line, policies, first) {
  return [
    { label: 'Policies', value: String(policies.length), hint: INSURANCE_LINE_LABELS[line]?.name || line },
    { label: 'Number', value: first.PolicyNumber || '—', hint: 'Data.Policies[0].PolicyNumber' },
    { label: 'Status', value: first.PolicyStatus || '—', hint: 'Data.Policies[0].PolicyStatus' },
    { label: 'Renews', value: first.PolicyEndDate ? formatDate(first.PolicyEndDate) : '—', hint: 'Data.Policies[0].PolicyEndDate' },
  ];
}

function formatDate(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderEnvelopeInventory(rows, persona, lfi) {
  const wrapper = el('details', { className: 'envelopes' });
  wrapper.appendChild(el('summary', {}, `All envelopes (${rows.length}) — verify spec compliance`));
  const table = el('table', { className: 'env-table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', {}, 'OF v2.1 path'),
    el('th', {}, 'Data.*'),
    el('th', {}, 'Count'),
  ])]));
  const tbody = el('tbody', {});
  for (const r of rows) {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, el('code', {}, r.path)),
      el('td', {}, el('code', {}, `Data.${r.key}[]`)),
      el('td', { style: 'text-align:right;' }, String(r.count)),
    ]));
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);

  // Render each envelope as a collapsible JSON block.
  for (const r of rows) {
    const sub = el('details', { className: 'env-json-wrap' });
    sub.appendChild(el('summary', {}, [
      el('code', {}, `GET ${r.path}`),
      el('span', { className: 'env-summary-meta' },
        ` · Data.${r.key}[${r.count}] · persona:${persona.id} lfi:${lfi} seed:${persona.default_seed}`),
    ]));
    const pre = el('pre', { className: 'fetch-json' });
    pre.textContent = JSON.stringify(r.env, null, 2);
    sub.appendChild(pre);
    wrapper.appendChild(sub);
  }
  return wrapper;
}

function renderActions() {
  const next = document.getElementById('btn-next');
  const back = document.getElementById('btn-back');
  const restart = document.getElementById('btn-restart');
  const status = document.getElementById('wizard-status');
  const persona = selectedPersona();
  const totalInst = state.selectedBankProfiles.size + state.selectedInsuranceLines.size;

  back.disabled = state.step <= 1;
  restart.hidden = state.step !== 4;

  if (state.step === 1) {
    next.disabled = !persona;
    next.textContent = persona ? `Continue as ${persona.name.split('—')[0].trim()} →` : 'Pick a profile →';
    status.textContent = persona ? `Selected: ${persona.name}.` : 'Pick a profile to continue.';
  } else if (state.step === 2) {
    next.disabled = totalInst === 0;
    next.textContent = totalInst ? `Share with Claude (${totalInst}) →` : 'Pick at least one to share';
    status.textContent = persona ? `${persona.name} · ${totalInst} selected.` : '';
  } else if (state.step === 3) {
    next.disabled = false;
    if (state.subStep === 'discovery') {
      next.textContent = 'Continue to sign-in →';
      status.textContent = 'Sub-step 3a · MCP discovery chain — the spec-mandated handshake before consent.';
    } else if (state.subStep === 'sca') {
      next.textContent = 'Continue to consent →';
      status.textContent = 'Sub-step 3b · Strong Customer Authentication (Article 18).';
    } else if (state.subStep === 'consent') {
      next.textContent = 'Approve & mint ConsentId →';
      status.textContent = `Sub-step 3c · ${[...state.j1Permissions].length} of ${OF_PERMISSIONS.length} permissions ticked.`;
    } else if (state.subStep === 'token') {
      next.textContent = 'Open chat →';
      status.textContent = `Sub-step 3d · ConsentId ${state.j1ConsentId ? state.j1ConsentId.slice(-12) : '—'} issued.`;
    }
  } else if (state.step === 4) {
    next.disabled = true;
    next.textContent = 'Back in chat ✓';
    status.textContent = `Bearer issued. Claude can answer about ${persona?.name?.split('—')[0]?.trim() || persona?.name}'s accounts.`;
  }
}

// ─── J2 wizard rendering ────────────────────────────────────────────
//
// Five steps that walk the user through a regulated TPP consent journey:
// persona → single/multi scope → LFI picker → Al Tareq CAAP consent → PFM
// (Retail) or BFM (SME) dashboard. Persona selection is shared with J1 via
// state.selectedPersonaId; everything else lives in state.j2*.

// Filter pipeline for J2's persona gallery. J2's dashboard at step 5 is a
// banking PFM/BFM view, so we constrain to banking-domain personas (insurance
// personas have no banking fixtures and would render empty cards in v1). The
// retail/sme filter then slices on segment (SME personas carry segment="SME";
// everything else is Retail).
function j2FilteredPersonas() {
  return state.personas.filter((p) => {
    if (p.domain !== 'banking') return false;
    if (state.j2Filter === 'all') return true;
    const isSme = (p.segment || '').toLowerCase() === 'sme';
    if (state.j2Filter === 'sme') return isSme;
    if (state.j2Filter === 'retail') return !isSme;
    return true;
  });
}

function renderJ2Persona() {
  // Sync the filter buttons with state.j2Filter on every render so URL or
  // back-button-driven state changes show through to the active tab.
  document.querySelectorAll('#j2-persona-filters button').forEach((b) => {
    const on = b.dataset.j2filter === state.j2Filter;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const grid = document.getElementById('j2-persona-grid');
  grid.replaceChildren();
  const filtered = j2FilteredPersonas();
  for (const p of filtered) {
    const card = el('button', {
      type: 'button',
      className: `persona-card${p.id === state.selectedPersonaId ? ' selected' : ''}`,
      role: 'radio',
      'aria-checked': p.id === state.selectedPersonaId ? 'true' : 'false',
      dataset: { personaId: p.id },
      onclick: () => { state.selectedPersonaId = p.id; refresh(); },
    }, [
      el('div', { className: 'avatar', style: `background:${avatarColor(p.id)};` }, initials(p.name)),
      el('span', { className: 'pname' }, p.name),
      el('span', { className: 'pmeta' }, `${(p.archetype || '').replace(/_/g, ' ')}${p.segment ? ` · ${p.segment}` : ''}`),
      el('div', { className: 'ptags' }, [
        el('span', { className: `tag domain-${p.domain}` }, p.domain),
        ...(p.segment ? [el('span', { className: 'tag segment-sme' }, p.segment)] : []),
        ...(p.multi_lfi_footprint ? [el('span', { className: 'tag' }, 'multi-LFI footprint')] : []),
      ]),
    ]);
    grid.appendChild(card);
  }
  if (!filtered.length) {
    grid.appendChild(el('p', { className: 'skeleton' }, 'No personas match this filter.'));
  }
}

function renderJ2Scope() {
  const persona = selectedPersona();
  const grid = document.getElementById('j2-scope-grid');
  grid.replaceChildren();

  // Suggest multi-LFI when the persona's manifest has a footprint that
  // explicitly maps primary/secondary/tertiary banking relationships. The
  // recommendation is a UX nudge; the user can still pick either.
  const suggestsMulti = !!persona?.multi_lfi_footprint;

  const options = [
    {
      key: 'single',
      title: 'Single LFI',
      pill: 'Most TPPs today',
      body: 'The TPP requests consent from one LFI at a time. Same Al Tareq rails as multi; just one bank in the bundle. Closest to the v1 Nebras sandbox shape.',
      meta: 'One Authorization Server endpoint · one consent grant · one bearer scope.',
      recommended: !suggestsMulti,
    },
    {
      key: 'multi',
      title: 'Multi-LFI',
      pill: 'Headline OF capability',
      body: 'One CAAP consent journey, multiple LFIs authorized in one tap. The user sees per-LFI scopes and grants them together. End-state is an aggregated cross-LFI dashboard.',
      meta: suggestsMulti
        ? `This persona has a multi_lfi_footprint manifest — designed for this path.`
        : 'Works for any persona; pick 2–4 LFI profiles to simulate a portfolio.',
      recommended: suggestsMulti,
    },
  ];

  for (const opt of options) {
    const selected = state.j2Scope === opt.key;
    const card = el('button', {
      type: 'button',
      className: `scope-card${selected ? ' selected' : ''}`,
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => {
        state.j2Scope = opt.key;
        // Switching to single-LFI mode trims the selection down to at most
        // one profile so step 3 doesn't surface a stale multi-pick.
        if (opt.key === 'single' && state.j2SelectedLFIs.size > 1) {
          const keep = state.j2SelectedLFIs.has('median') ? 'median' : [...state.j2SelectedLFIs][0];
          state.j2SelectedLFIs = new Set([keep]);
        }
        refresh();
      },
    }, [
      el('div', { className: 'sc-head' }, [
        el('span', { className: 'sc-title' }, opt.title + (opt.recommended ? ' (suggested)' : '')),
        el('span', { className: 'sc-pill' }, opt.pill),
      ]),
      el('div', { className: 'sc-body' }, opt.body),
      el('div', { className: 'sc-meta' }, opt.meta),
    ]);
    grid.appendChild(card);
  }
}

function renderJ2LFIs() {
  const persona = selectedPersona();
  const body = document.getElementById('j2-lfi-body');
  body.replaceChildren();
  if (!persona) return;

  const sub = document.getElementById('j2-step-3-sub');
  const multi = state.j2Scope === 'multi';
  sub.textContent = multi
    ? `${persona.name} — pick 2 to 4 anonymous LFI profiles. Each profile stands in for a regulated LFI authorized in the same consent grant. Per PRD NG5, profiles are never bound to real bank names.`
    : `${persona.name} — pick one anonymous LFI profile (the TPP requests consent from a single LFI through Al Tareq).`;

  const header = el('h4', {}, multi ? 'Pick 2–4 LFI profiles' : 'Pick one LFI profile');
  body.appendChild(header);
  const grid = el('div', { className: 'inst-grid' });
  for (const prof of LFI_PROFILES) {
    const selected = state.j2SelectedLFIs.has(prof.key);
    const disabledByCap = multi && !selected && state.j2SelectedLFIs.size >= 4;
    const card = el('button', {
      type: 'button',
      className: `inst-card${selected ? ' selected' : ''}${disabledByCap ? ' cross-domain' : ''}`,
      'aria-pressed': selected ? 'true' : 'false',
      disabled: disabledByCap,
      onclick: () => {
        if (multi) {
          if (state.j2SelectedLFIs.has(prof.key)) state.j2SelectedLFIs.delete(prof.key);
          else if (state.j2SelectedLFIs.size < 4) state.j2SelectedLFIs.add(prof.key);
        } else {
          // Single mode: radio behaviour — replace, never accumulate.
          state.j2SelectedLFIs = new Set([prof.key]);
        }
        refresh();
      },
    }, [
      el('div', { className: 'ihead' }, [
        el('span', { className: 'iname' }, prof.name),
        el('span', { className: `ibadge ${prof.key}` }, prof.key),
      ]),
      el('div', { className: 'ibody' }, prof.body),
      el('div', { className: 'iendpoints' }, '12 v2.1 endpoints · OFTF mTLS · FAPI 2.0'),
    ]);
    grid.appendChild(card);
  }
  body.appendChild(grid);

  if (persona.multi_lfi_footprint) {
    const advisory = el('div', { className: 'footprint-advisory' });
    advisory.appendChild(el('strong', {}, 'Real-world plausible UAE LFIs for this persona'));
    advisory.appendChild(el('span', {}, 'Descriptive — from persona manifest, never bound to a populate-rate profile (NG5 / D-14).'));
    for (const role of ['primary', 'secondary', 'tertiary']) {
      const r = persona.multi_lfi_footprint[role];
      if (!r) continue;
      advisory.appendChild(el('div', { className: 'candidate-role' }, `${role} · ${r.role.replace(/_/g, ' ')}`));
      const row = el('div', { className: 'candidate-row' });
      for (const cand of (r.plausible_lfi_candidates || [])) {
        row.appendChild(el('span', { className: 'cand' }, cand));
      }
      advisory.appendChild(row);
    }
    body.appendChild(advisory);
  }
}

// J2 step 4 sub-flow ────────────────────────────────────────────────
//
// Replaces the old single-screen Al Tareq consent with a multi-screen
// journey that mirrors what the regulated TPP flow actually does:
//   4a tpp     — Khazaa's TPP-side launchpad (the moment you tap "Connect
//                your bank accounts" in a real PFM/BFM app)
//   4b altareq — Al Tareq CAAP with full Permissions taxonomy +
//                consent parameters + per-LFI summary
//   4c sca     — per-LFI Strong Customer Authentication + account selection
//                (lands in Part 2)
//   4d manager — Nebras Consent Manager confirmation, ConsentId per LFI
//                (lands in Part 2)
//
// For Phase C part 1, sub-steps tpp and altareq are fully rendered. Next
// from altareq advances straight to step 5 (the dashboard) until Part 2
// inserts sca and manager between them.

const J2_SUB_STEPS = [
  { key: 'tpp',     label: 'TPP launchpad' },
  { key: 'altareq', label: 'Al Tareq consent' },
  { key: 'sca',     label: 'Per-LFI sign-in' },
  { key: 'manager', label: 'Consent Manager' },
];

// Account cache for J2 SCA per-LFI account picker. Module-level (not in
// state / URL) since it's just a fetch cache — accounts come from the
// persona's deterministic bundle, so re-fetch is cheap but also redundant
// once we've seen them this session.
const j2AccountCache = new Map(); // lfiKey → Account[]

async function fetchJ2AccountsFor(persona, lfiKey) {
  if (j2AccountCache.has(lfiKey)) return j2AccountCache.get(lfiKey);
  if (!persona.default_seed) return [];
  const base = `../fixtures/v1/bundles/${persona.id}/${lfiKey}/seed-${persona.default_seed}`;
  const env = await fetchJson(`${base}/accounts.json`);
  const accounts = env?.Data?.Account ?? [];
  j2AccountCache.set(lfiKey, accounts);
  // Default selection: all accounts ticked (Standards default — TPP gets
  // every account unless the user narrows it down).
  if (!state.j2SelectedAccounts.has(lfiKey)) {
    state.j2SelectedAccounts.set(lfiKey, new Set(accounts.map((a) => a.AccountId)));
  }
  return accounts;
}

function renderJ2Consent() {
  const persona = selectedPersona();
  const body = document.getElementById('j2-consent-body');
  body.replaceChildren();
  if (!persona) return;

  body.appendChild(renderSubStepIndicator(J2_SUB_STEPS, state.j2SubStep, (key) => {
    state.j2SubStep = key;
    refresh();
  }));

  if (state.j2SubStep === 'tpp') renderJ2TppLaunchpad(body, persona);
  else if (state.j2SubStep === 'altareq') renderJ2AlTareq(body, persona);
  else if (state.j2SubStep === 'sca') renderJ2SCA(body, persona);
  else if (state.j2SubStep === 'manager') renderJ2ConsentConfirmed(body, persona);
  else {
    state.j2SubStep = 'tpp';
    renderJ2TppLaunchpad(body, persona);
  }
}

// 4a — TPP launchpad. The user is inside Khazaa's PFM/BFM app, about to
// tap "Connect your bank accounts." Shows the TPP licence stub (Article 6
// requires a UAE OF Provider Licence) and previews what's about to happen
// in the next three sub-steps. The "Continue with Al Tareq" CTA mirrors
// the real handoff to the regulated CAAP surface.
function renderJ2TppLaunchpad(body, persona) {
  const isSme = (persona.segment || '').toLowerCase() === 'sme';
  const tppName = isSme ? 'Khazaa BFM' : 'Khazaa PFM';
  const tppTagline = isSme
    ? 'Working capital, receivables, payables — across every regulated LFI you bank with.'
    : 'Your full financial picture — every account, every LFI, one view.';

  const wrap = el('div', { className: 'tpp-launchpad', role: 'img', 'aria-label': 'Mock TPP launchpad' });
  wrap.appendChild(el('div', { className: 'tpp-launchpad-chrome' }, [
    el('span', { className: 'tpp-chrome-dot' }),
    el('span', { className: 'tpp-chrome-dot' }),
    el('span', { className: 'tpp-chrome-dot' }),
    el('span', { className: 'tpp-chrome-app' }, `${tppName} · iOS / web`),
  ]));
  const inner = el('div', { className: 'tpp-launchpad-body' });
  inner.appendChild(el('div', { className: 'tpp-launchpad-brand' }, [
    el('div', { className: 'tpp-icon-large', 'aria-hidden': 'true' }, 'K'),
    el('div', {}, [
      el('div', { className: 'tpp-launchpad-name' }, tppName),
      el('div', { className: 'tpp-launchpad-tagline' }, tppTagline),
    ]),
  ]));
  inner.appendChild(el('h4', { className: 'tpp-launchpad-h' }, 'Connect your bank accounts via UAE Open Finance'));
  inner.appendChild(el('p', { className: 'tpp-launchpad-lede' }, [
    `${tppName} is licensed by the CBUAE to read account data via UAE Open Finance. `,
    'The next three screens are the regulated consent flow — operated by Al Tareq (Nebras), not by ',
    el('strong', {}, tppName),
    '. We never see your credentials or your bank login.',
  ]));
  const steps = el('ol', { className: 'tpp-launchpad-steps' });
  steps.appendChild(el('li', {}, [
    el('strong', {}, 'Al Tareq consent.'),
    ' Pick the data clusters and sharing window. One consent grant covers every LFI you authorise.',
  ]));
  steps.appendChild(el('li', {}, [
    el('strong', {}, 'Bank sign-in.'),
    ' Strong Customer Authentication at each LFI. Article 18 — your bank verifies you with 2FA.',
  ]));
  steps.appendChild(el('li', {}, [
    el('strong', {}, 'Back to ' + tppName + '.'),
    ` ${isSme ? 'Your BFM dashboard' : 'Your PFM dashboard'} populates the moment consent registers with the Nebras Consent Manager.`,
  ]));
  inner.appendChild(steps);
  inner.appendChild(el('div', { className: 'tpp-licence-stub' }, [
    el('div', { className: 'tpp-licence-label' }, 'Licence'),
    el('div', { className: 'tpp-licence-body' }, [
      el('strong', {}, `${tppName} FZ-LLC`),
      ' · Licensed by CBUAE · Open Finance Provider Licence ',
      el('code', {}, 'OF-DSPL-2026-K001'),
      ' · Data Sharing Provider · ',
      el('strong', {}, 'AED 1,000,000'),
      ' paid-up capital · PI insurance ',
      el('strong', {}, 'AED 5,000,000'),
      ' (Article 6, 7, 9).',
    ]),
  ]));
  inner.appendChild(el('p', { className: 'tpp-launchpad-note' }, [
    'No real network call. Click ',
    el('strong', {}, 'Continue →'),
    ' to hand off to Al Tareq.',
  ]));
  wrap.appendChild(inner);
  body.appendChild(wrap);
}

// 4b — Al Tareq CAAP consent. The regulated unified consent surface.
// Now carries the full Permissions taxonomy (toggleable), consent
// parameters (ExpirationDateTime / IsSingleAuthorization /
// TransactionFromDateTime), and per-LFI consent summary groupings.
function renderJ2AlTareq(body, persona) {
  const isSme = (persona.segment || '').toLowerCase() === 'sme';
  const tppName = isSme ? 'Khazaa BFM' : 'Khazaa PFM';
  const tppRole = 'Regulated TPP · Data Sharing Provider · UAE OF licensed';

  const consent = el('div', { className: 'altareq-consent', role: 'img', 'aria-label': 'Mock Al Tareq CAAP consent screen (Journey 2)' });
  consent.appendChild(el('div', { className: 'browser-bar' }, [
    el('span', { className: 'dots' }, [el('span'), el('span'), el('span')]),
    el('span', { className: 'url' }, 'https://caap.altareq.openfinanceuae.ae/authorize?client_id=khazaa&request=…&intent_id=…'),
  ]));
  consent.appendChild(el('div', { className: 'ribbon' }, [
    el('span', {}, 'Al Tareq · Consent and Authorization Application Platform'),
    el('span', { className: 'ribbon-meta' }, 'FAPI 2.0 · OFTF mTLS · Operated by Nebras'),
  ]));

  const inner = el('div', { className: 'body' });
  inner.appendChild(el('h4', {}, 'Authorize data sharing'));
  inner.appendChild(el('p', { className: 'sub' }, [
    el('strong', {}, tppName),
    ` is requesting consent to read your Open Finance data at ${state.j2SelectedLFIs.size} LFI${state.j2SelectedLFIs.size === 1 ? '' : 's'}. `,
    'Pick the data clusters and sharing window. After Approve, you’ll authenticate at each LFI separately (Sub-step 4c).',
  ]));

  inner.appendChild(el('div', { className: 'tpp-info' }, [
    el('div', { className: 'tpp-icon', 'aria-hidden': 'true' }, 'K'),
    el('div', {}, [
      el('div', { className: 'tpp-name' }, tppName),
      el('div', { className: 'tpp-role' }, tppRole),
    ]),
  ]));

  inner.appendChild(renderPermissionsList(
    state.j2Permissions,
    (next) => { state.j2Permissions = next; refresh(); },
    { idPrefix: 'j2' },
  ));

  inner.appendChild(renderConsentParamsPanel(
    {
      expirationDays: state.j2ExpirationDays,
      isSingleAuth: state.j2IsSingleAuth,
      transactionMonths: state.j2TransactionMonths,
    },
    ({ expirationDays, isSingleAuth, transactionMonths }) => {
      state.j2ExpirationDays = expirationDays;
      state.j2IsSingleAuth = isSingleAuth;
      state.j2TransactionMonths = transactionMonths;
      refresh();
    },
  ));

  // Per-LFI summary groupings — one per LFI the user picked in step 3.
  // For Part 1 these show scopes generically; Part 2 swaps in account
  // selection per LFI captured during the SCA loop.
  for (const key of state.j2SelectedLFIs) {
    const prof = LFI_PROFILES.find((p) => p.key === key);
    if (!prof) continue;
    const block = el('div', { className: 'per-lfi' });
    block.appendChild(el('div', { className: 'lfi-head' }, [
      el('span', { className: 'lfi-label' }, prof.name),
      el('span', { className: 'lfi-badge' }, prof.key),
    ]));
    block.appendChild(el('div', { className: 'lfi-scopes' },
      `${[...state.j2Permissions].length} permission${[...state.j2Permissions].length === 1 ? '' : 's'} requested · account selection happens during this LFI’s sign-in (sub-step 4c)`));
    inner.appendChild(block);
  }

  inner.appendChild(el('p', { className: 'footnote' }, [
    'Sharing window ', el('strong', {}, `${state.j2ExpirationDays} days`),
    `. Transactions readable back ${state.j2TransactionMonths} months. `,
    'Revoke any time at ',
    el('em', {}, 'portal.openfinance.ae · My Consents'),
    ' (Nebras Consent Manager — the single source of truth for every TPP consent under UAE Open Finance). ',
    'Data is ', el('strong', {}, 'SYNTHETIC'), '. No real customer. No real institution.',
  ]));

  consent.appendChild(inner);
  body.appendChild(consent);
}

// 4c — Per-LFI SCA + account selection. Walks each selected LFI sequentially
// via state.j2SCAIndex. For each LFI: bank chrome → username + password +
// OTP (decorative, Article 18 SCA framing) → account picker fetched lazily
// from the persona's bundle at that LFI. The main wizard Next button mints
// a ConsentId for the current LFI and advances the index, or jumps to 4d
// once the last LFI is done.
function renderJ2SCA(body, persona) {
  const lfiKeys = [...state.j2SelectedLFIs];
  if (!lfiKeys.length) {
    body.appendChild(el('p', { className: 'skeleton' }, 'No LFIs selected — go back to step 3.'));
    return;
  }
  // Clamp index defensively.
  if (state.j2SCAIndex >= lfiKeys.length) state.j2SCAIndex = lfiKeys.length - 1;
  if (state.j2SCAIndex < 0) state.j2SCAIndex = 0;

  const currentLfi = lfiKeys[state.j2SCAIndex];
  const prof = LFI_PROFILES.find((p) => p.key === currentLfi);

  body.appendChild(el('div', { className: 'sca-progress' }, [
    el('span', {}, `LFI ${state.j2SCAIndex + 1} of ${lfiKeys.length}`),
    el('span', { className: 'sca-progress-name' }, prof?.name || currentLfi),
    el('span', { className: 'sca-progress-hint' },
      state.j2SCAIndex < lfiKeys.length - 1
        ? `After confirming, you'll authenticate at LFI ${state.j2SCAIndex + 2} of ${lfiKeys.length}.`
        : 'Last LFI — confirming will register every consent with the Consent Manager.'),
  ]));

  const mock = el('div', { className: 'sca-mock', role: 'img', 'aria-label': `Mock Strong Customer Authentication screen at LFI ${currentLfi}` });
  mock.appendChild(el('div', { className: 'browser-bar' }, [
    el('span', { className: 'dots' }, [el('span'), el('span'), el('span')]),
    el('span', { className: 'url' }, `https://auth.${currentLfi}-lfi.example/sca?caap_intent=urn:openfinance:ae:intent:…`),
  ]));
  const inner = el('div', { className: 'body' });
  inner.appendChild(el('h4', {}, `Sign in at ${prof?.name || currentLfi}`));
  inner.appendChild(el('p', { className: 'sub' }, [
    `Strong Customer Authentication for the ${prof?.body || currentLfi}. `,
    'After SCA, pick which accounts at this LFI Khazaa will see.',
  ]));

  const userBase = persona ? persona.name.split('—')[0].trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '') : 'you';
  const form = el('div', { className: 'sca-form' });
  form.appendChild(el('label', { for: `sca-user-${currentLfi}` }, 'Username'));
  form.appendChild(el('input', { type: 'text', id: `sca-user-${currentLfi}`, value: `${userBase}@${currentLfi}-lfi.example`, readonly: true }));
  form.appendChild(el('label', { for: `sca-pass-${currentLfi}`, style: 'margin-top:10px;' }, 'Password'));
  form.appendChild(el('input', { type: 'password', id: `sca-pass-${currentLfi}`, value: '••••••••••', readonly: true }));

  const otpBlock = el('div', { className: 'sca-otp' });
  otpBlock.appendChild(el('div', { className: 'sca-otp-heading' }, '2FA — enter the 6-digit code from your bank app'));
  const otpInputs = el('div', { className: 'sca-otp-inputs' });
  const otpDigits = (currentLfi === 'rich' ? ['8','3','9','1','7','2']
                  : currentLfi === 'median' ? ['4','5','0','2','8','1']
                  : ['9','1','3','6','5','4']);
  for (let i = 0; i < 6; i++) {
    otpInputs.appendChild(el('input', { type: 'text', maxlength: 1, value: otpDigits[i], readonly: true, 'aria-label': `OTP digit ${i + 1}` }));
  }
  otpBlock.appendChild(otpInputs);
  otpBlock.appendChild(el('p', { className: 'sca-otp-alt' }, [
    'or ', el('strong', {}, 'use your bank app'), ' to push-approve — same regulatory category.',
  ]));
  form.appendChild(otpBlock);
  inner.appendChild(form);
  mock.appendChild(inner);
  body.appendChild(mock);

  // Account picker — fetched lazily from the LFI's bundle. Shows checkboxes
  // for each account; defaults to all checked. Real consent grant binds to
  // the AccountId set the user picks here.
  const acctSection = el('div', { className: 'sca-accounts' });
  acctSection.appendChild(el('h4', { style: 'margin-top:18px;' }, 'Pick accounts to authorise at this LFI'));
  acctSection.appendChild(el('p', { className: 'sub', style: 'margin-bottom:10px;' }, [
    'Per-account consent. ',
    el('strong', {}, 'Standards default'),
    ' is all accounts; untick to grant narrower scope. Khazaa will only read transactions for the accounts you keep ticked.',
  ]));
  const acctList = el('div', { className: 'sca-account-list' });
  acctList.appendChild(el('p', { className: 'skeleton' }, 'Loading accounts at this LFI…'));
  acctSection.appendChild(acctList);
  body.appendChild(acctSection);

  fetchJ2AccountsFor(persona, currentLfi).then((accounts) => {
    acctList.replaceChildren();
    if (!accounts.length) {
      acctList.appendChild(el('p', { className: 'skeleton' }, `No accounts returned for ${persona.name} at LFI · ${currentLfi}. Try a different persona or LFI profile.`));
      return;
    }
    const selected = state.j2SelectedAccounts.get(currentLfi) || new Set();
    for (const acct of accounts) {
      const isOn = selected.has(acct.AccountId);
      const id = `j2acct-${currentLfi}-${acct.AccountId}`;
      const ident = acct.AccountIdentifiers?.[0]?.Identification?.slice(0, 18) ?? acct.AccountId;
      const cb = el('input', { type: 'checkbox', id, checked: isOn });
      const row = el('label', { for: id, className: 'sca-account-row' + (isOn ? ' selected' : '') }, [
        cb,
        el('div', { className: 'sca-account-text' }, [
          el('div', { className: 'sca-account-name' }, acct.Nickname || acct.AccountSubType || acct.AccountType || 'Account'),
          el('div', { className: 'sca-account-meta' }, [
            el('code', {}, ident + '…'),
            ` · ${acct.AccountSubType || acct.AccountType || ''}`,
          ]),
        ]),
      ]);
      cb.addEventListener('change', () => {
        const cur = state.j2SelectedAccounts.get(currentLfi) || new Set();
        if (cb.checked) cur.add(acct.AccountId); else cur.delete(acct.AccountId);
        state.j2SelectedAccounts.set(currentLfi, cur);
        row.classList.toggle('selected', cb.checked);
      });
      acctList.appendChild(row);
    }
  }).catch((err) => {
    acctList.replaceChildren();
    acctList.appendChild(el('p', { className: 'skeleton', style: 'color:#a13;' }, `Couldn't load accounts: ${err.message}.`));
  });
}

// 4d — Consent Manager confirmation. After all per-LFI SCAs complete, this
// is the screen that confirms the consent grants registered centrally with
// the Nebras Consent Manager. Renders a per-LFI table with the ConsentId,
// expiration, permissions, accounts, and transaction window. The "View at
// portal.openfinance.ae" link will open the Consent Manager modal once
// Task #12 lands; for now it's a stub.
function renderJ2ConsentConfirmed(body, persona) {
  const isSme = (persona.segment || '').toLowerCase() === 'sme';
  const tppName = isSme ? 'Khazaa BFM' : 'Khazaa PFM';

  body.appendChild(el('div', { className: 'consent-confirmed-headline' }, [
    el('span', { className: 'consent-confirmed-tick' }, '✓'),
    el('div', {}, [
      el('div', { className: 'consent-confirmed-title' }, 'Consent registered with the Nebras Consent Manager'),
      el('div', { className: 'consent-confirmed-sub' },
        `${state.j2ConsentIds.size} ConsentId${state.j2ConsentIds.size === 1 ? '' : 's'} active · ${tppName} can now read your authorised data via the API Hub.`),
    ]),
  ]));

  const table = el('div', { className: 'consent-records-table' });
  if (!state.j2ConsentIds.size) {
    table.appendChild(el('p', { className: 'skeleton' }, 'No consents minted yet — go back to sub-step 4c.'));
  } else {
    for (const [lfi, cid] of state.j2ConsentIds.entries()) {
      const prof = LFI_PROFILES.find((p) => p.key === lfi);
      const accounts = state.j2SelectedAccounts.get(lfi) || new Set();
      const acctCount = accounts.size;
      const expiresAt = new Date(Date.now() + state.j2ExpirationDays * 86400000);
      const row = el('div', { className: 'consent-record-row' }, [
        el('div', { className: 'consent-record-head' }, [
          el('span', { className: 'consent-record-lfi' }, prof?.name || lfi),
          el('span', { className: 'consent-record-badge active' }, 'Active'),
        ]),
        el('dl', { className: 'consent-record-dl' }, [
          el('dt', {}, 'ConsentId'),    el('dd', {}, el('code', {}, cid)),
          el('dt', {}, 'Expires'),      el('dd', {}, expiresAt.toUTCString()),
          el('dt', {}, 'Permissions'),  el('dd', {}, `${[...state.j2Permissions].length} of ${OF_PERMISSIONS.length} clusters`),
          el('dt', {}, 'Accounts'),     el('dd', {}, `${acctCount} authorised`),
          el('dt', {}, 'Tx window'),    el('dd', {}, `${state.j2TransactionMonths} months back`),
        ]),
      ]);
      table.appendChild(row);
    }
  }
  body.appendChild(table);

  const cmLink = el('a', { href: '#', className: 'consent-manager-link' },
    '→ View at portal.openfinance.ae · My Consents');
  cmLink.addEventListener('click', (ev) => {
    ev.preventDefault();
    openConsentManager();
  });
  body.appendChild(el('div', { className: 'consent-confirmed-actions' }, [
    cmLink,
    el('div', { className: 'consent-confirmed-cta-hint' }, [
      'Click ', el('strong', {}, 'Return to ' + tppName + ' →'),
      ` to load your aggregated ${isSme ? 'BFM' : 'PFM'} view, or open the Consent Manager above to inspect or revoke each grant.`,
    ]),
  ]));
}

// ─── Consent Manager modal (Task #12) ──────────────────────────────
//
// portal.openfinance.ae · My Consents — the central registry every UAE OF
// TPP consent lands in. Opens from J2 step 4d's "View at portal" link.
// Lists every consent record minted this session (J1 + J2) with a Revoke
// button per record. Revocation flips status to 'Revoked' and persists in
// state.consentRecords; the J2 dashboard empties out when no Active J2
// consents remain.

function openConsentManager() {
  const modal = document.getElementById('consent-manager-modal');
  if (!modal) return;
  renderConsentManagerView();
  modal.hidden = false;
  // Stash the previously focused element so we can restore on close.
  modal.dataset.previousFocus = (document.activeElement && document.activeElement.id) || '';
  const close = document.getElementById('consent-manager-close');
  if (close) close.focus();
}

function closeConsentManager() {
  const modal = document.getElementById('consent-manager-modal');
  if (!modal) return;
  modal.hidden = true;
  // Trigger a refresh so any consents-dependent UI (J2 dashboard empty state)
  // picks up revocations made inside the modal.
  refresh();
  const prevId = modal.dataset.previousFocus;
  if (prevId) {
    const prev = document.getElementById(prevId);
    if (prev) prev.focus();
  }
}

function renderConsentManagerView() {
  const body = document.getElementById('consent-manager-body');
  if (!body) return;
  body.replaceChildren();

  if (!state.consentRecords.length) {
    body.appendChild(el('div', { className: 'cm-empty' },
      'No consents minted yet. Walk through J1 or J2 to register a consent — it’ll show up here.'));
    return;
  }

  // Sort records: Active first, then by source (J2 before J1).
  const sorted = [...state.consentRecords].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'Active' ? -1 : 1;
    if (a.source !== b.source) return a.source === 'j2' ? -1 : 1;
    return 0;
  });

  for (const rec of sorted) {
    const prof = LFI_PROFILES.find((p) => p.key === rec.lfi);
    const acctSummary = Array.isArray(rec.accounts)
      ? `${rec.accounts.length} authorised`
      : String(rec.accounts || '—');
    const row = el('div', { className: 'cm-record' + (rec.status === 'Revoked' ? ' revoked' : '') });
    row.appendChild(el('div', { className: 'cm-record-head' }, [
      el('div', {}, [
        el('span', { className: 'cm-record-title' }, `${rec.tpp} → ${prof?.name || rec.lfi}`),
        el('span', { className: 'cm-record-source' }, rec.source.toUpperCase()),
      ]),
      el('span', { className: 'consent-record-badge ' + (rec.status === 'Revoked' ? 'revoked' : 'active') }, rec.status),
    ]));
    row.appendChild(el('dl', { className: 'cm-record-dl' }, [
      el('dt', {}, 'ConsentId'),    el('dd', {}, el('code', {}, rec.consentId)),
      el('dt', {}, 'Expires'),      el('dd', {}, new Date(rec.expiresAt).toUTCString()),
      el('dt', {}, 'Permissions'),  el('dd', {}, `${(rec.permissions || []).length} of ${OF_PERMISSIONS.length} clusters`),
      el('dt', {}, 'Accounts'),     el('dd', {}, acctSummary),
      el('dt', {}, 'Source'),       el('dd', {}, rec.source === 'j2' ? 'Al Tareq CAAP · Nebras Consent Manager' : 'Bank-own OAuth · Connected apps (not OF rails)'),
    ]));
    if (rec.status === 'Active') {
      const revokeBtn = el('button', {
        type: 'button',
        className: 'cm-revoke-btn',
      }, 'Revoke');
      revokeBtn.addEventListener('click', () => {
        rec.status = 'Revoked';
        // For J2 records, also drop the ConsentId from the active map so
        // the dashboard / confirmation views know nothing's active for
        // that LFI anymore.
        if (rec.source === 'j2') state.j2ConsentIds.delete(rec.lfi);
        // For J1, clear j1ConsentId so the token panel reflects revocation
        // if the user navigates back.
        if (rec.source === 'j1' && state.j1ConsentId === rec.consentId) state.j1ConsentId = null;
        renderConsentManagerView();
      });
      row.appendChild(el('div', { className: 'cm-record-actions' }, revokeBtn));
    }
    body.appendChild(row);
  }
}

// J2 dashboard: PFM (Retail) or BFM (SME) end-state. Fetches the same persona's
// banking bundle at every selected LFI profile and aggregates: total balance
// across LFIs, accounts list with per-LFI badges, fixed commitments rolled up,
// transaction timeline (last 90 days) interleaved by date.
async function renderJ2Dashboard() {
  const persona = selectedPersona();
  const body = document.getElementById('j2-dashboard-body');
  body.replaceChildren();
  if (!persona) return;

  const isSme = (persona.segment || '').toLowerCase() === 'sme';
  document.getElementById('j2-step-5-h').textContent = isSme ? 'Aggregated BFM view' : 'Aggregated PFM view';

  // If every J2 consent was revoked via the Consent Manager modal, the TPP
  // has no live data-sharing grant — every /accounts call would 401. Render
  // the empty state instead of fetching.
  const activeJ2 = state.consentRecords.filter((r) => r.source === 'j2' && r.status === 'Active');
  if (state.j2Approved && activeJ2.length === 0 && state.consentRecords.some((r) => r.source === 'j2')) {
    document.getElementById('j2-step-5-sub').textContent = 'All J2 consents revoked at the Consent Manager — the TPP can no longer read your data.';
    const tppName = isSme ? 'Khazaa BFM' : 'Khazaa PFM';
    body.appendChild(el('div', { className: 'j2-revoked-empty' }, [
      el('h3', {}, `${tppName} is locked out`),
      el('p', {}, [
        'Every ConsentId minted for this session has been revoked at portal.openfinance.ae · My Consents. ',
        'In production, the TPP\'s next ',
        el('code', {}, 'GET /accounts'),
        ' call would return ',
        el('code', {}, '401 invalid_consent'),
        '. To re-grant: back up to step 4 (Al Tareq) and walk the consent flow again.',
      ]),
    ]));
    return;
  }

  document.getElementById('j2-step-5-sub').textContent = isSme
    ? `Khazaa BFM rolls up the consented data across ${state.j2SelectedLFIs.size} LFI${state.j2SelectedLFIs.size === 1 ? '' : 's'}. Every figure is computed deterministically from real v2.1 fixture data.`
    : `Khazaa PFM aggregates the consented data across ${state.j2SelectedLFIs.size} LFI${state.j2SelectedLFIs.size === 1 ? '' : 's'}. Every figure is computed deterministically from real v2.1 fixture data.`;

  if (!persona.default_seed) {
    body.appendChild(el('p', { className: 'skeleton', style: 'color:var(--warn-border);' },
      `No default_seed for this persona — run \`npm run build:fixtures && npm run build:site\` first.`));
    return;
  }

  body.appendChild(el('p', { className: 'skeleton' }, `Loading consented data across ${state.j2SelectedLFIs.size} LFI${state.j2SelectedLFIs.size === 1 ? '' : 's'}…`));

  try {
    const perLfi = await Promise.all([...state.j2SelectedLFIs].map(async (lfi) => {
      const base = `../fixtures/v1/bundles/${persona.id}/${lfi}/seed-${persona.default_seed}`;
      const acctEnv = await fetchJson(`${base}/accounts.json`);
      if (!acctEnv) return { lfi, accounts: [], perAccount: [] };
      const accounts = acctEnv.Data?.Account ?? [];
      const perAccount = await Promise.all(accounts.map(async (acct) => {
        const id = acct.AccountId;
        const [bal, tx, so, dd] = await Promise.all([
          fetchJson(`${base}/accounts__${id}__balances.json`),
          fetchJson(`${base}/accounts__${id}__transactions.json`),
          fetchJson(`${base}/accounts__${id}__standing-orders.json`),
          fetchJson(`${base}/accounts__${id}__direct-debits.json`),
        ]);
        return { account: acct, balances: bal, transactions: tx, standingOrders: so, directDebits: dd };
      }));
      return { lfi, accountsEnvelope: acctEnv, accounts, perAccount };
    }));

    body.replaceChildren();
    body.appendChild(isSme ? renderBfmDashboard(persona, perLfi) : renderPfmDashboard(persona, perLfi));

    // Watermark line — one per consented LFI, so the reader can verify the
    // dashboard's numbers trace back to the real fixture corpus.
    const wm = el('div', { className: 'j2-dash-watermark' });
    for (const { lfi, accountsEnvelope } of perLfi) {
      if (accountsEnvelope?._watermark) {
        wm.appendChild(el('div', {}, `LFI ${lfi}: ${accountsEnvelope._watermark}`));
      }
    }
    body.appendChild(wm);
  } catch (err) {
    body.replaceChildren();
    body.appendChild(el('p', { className: 'skeleton', style: 'color:#a13;' },
      `Couldn't load the fixtures: ${err.message}. Run \`npm run build:fixtures && npm run build:site\`, then serve from \`_site\`.`));
  }
}

function aggregateJ2Insights(perLfi) {
  // Aggregate balances, recurring outflows, and a 90-day transaction stream
  // across every consented LFI. The same spec-defined paths the J1 wizard
  // uses (Data.Account[], Data.Balance[], Data.Transaction[], …) — just
  // unioned and tagged with which LFI each row came from.
  let totalAed = 0;
  const accountsRolled = [];
  const commitments = [];
  const allTx = [];

  for (const { lfi, perAccount } of perLfi) {
    for (const a of perAccount) {
      const balances = a.balances?.Data?.Balance ?? [];
      const pick = balances.find((b) => b.Type === 'InterimAvailable')
                || balances.find((b) => b.Type === 'InterimBooked')
                || balances[0];
      let bal = null, ccy = null;
      if (pick && pick.Amount?.Currency) {
        const amt = parseFloat(pick.Amount.Amount);
        bal = pick.CreditDebitIndicator === 'Credit' ? amt : -amt;
        ccy = pick.Amount.Currency;
        if (ccy === 'AED') totalAed += bal;
      }
      accountsRolled.push({
        lfi,
        name: a.account.Nickname || a.account.AccountSubType || a.account.AccountType || a.account.AccountId,
        subtype: a.account.AccountSubType || '',
        balance: bal,
        currency: ccy || '—',
      });
      for (const so of (a.standingOrders?.Data?.StandingOrder ?? [])) {
        const amt = so.FirstPaymentAmount?.Amount ?? so.NextPaymentAmount?.Amount ?? '—';
        const ccyC = so.FirstPaymentAmount?.Currency ?? so.NextPaymentAmount?.Currency ?? '';
        commitments.push({
          lfi,
          label: so.Reference || so.CreditorAccount?.Name || 'Standing order',
          amount: amt,
          currency: ccyC,
          frequency: so.Frequency || '',
          kind: 'SO',
        });
      }
      for (const dd of (a.directDebits?.Data?.DirectDebit ?? [])) {
        commitments.push({
          lfi,
          label: dd.Name || dd.MandateIdentification || 'Direct debit',
          amount: dd.PreviousPaymentAmount?.Amount || '—',
          currency: dd.PreviousPaymentAmount?.Currency || '',
          frequency: 'DD',
          kind: 'DD',
        });
      }
      for (const t of (a.transactions?.Data?.Transaction ?? [])) {
        allTx.push({ ...t, _lfi: lfi });
      }
    }
  }

  allTx.sort((a, b) => (b.BookingDateTime || '').localeCompare(a.BookingDateTime || ''));
  const cutoffMs = Date.now() - 90 * 24 * 3600 * 1000;
  const recentTx = allTx.filter((t) => Date.parse(t.BookingDateTime || '') > cutoffMs).slice(0, 80);

  return { totalAed, accountsRolled, commitments, recentTx };
}

function renderPfmDashboard(persona, perLfi) {
  const ins = aggregateJ2Insights(perLfi);
  const dash = el('div', { className: 'pfm-dashboard' });

  // Customer card
  dash.appendChild(el('div', { className: 'dash-card' }, [
    el('h3', {}, 'Customer'),
    el('div', { className: 'stat' }, persona.name),
    el('div', { className: 'stat-sub' }, `${(persona.archetype || '').replace(/_/g, ' ')} · Retail · ${state.j2SelectedLFIs.size} LFI${state.j2SelectedLFIs.size === 1 ? '' : 's'} consented`),
  ]));

  // Cross-LFI total balance
  dash.appendChild(el('div', { className: 'dash-card' }, [
    el('h3', {}, 'Total balance (AED, cross-LFI)'),
    el('div', { className: 'stat' }, formatAed(ins.totalAed)),
    el('div', { className: 'stat-sub' }, `Across ${ins.accountsRolled.length} accounts · non-AED accounts listed separately`),
  ]));

  // Accounts — per-LFI badges
  const acctList = el('ul', {});
  for (const a of ins.accountsRolled) {
    acctList.appendChild(el('li', {}, [
      el('div', { className: 'row' }, [
        el('span', {}, [a.name, el('span', { className: 'lfi-badge' }, a.lfi)]),
        el('span', { className: 'right' }, a.balance != null ? `${a.currency} ${formatNumber(a.balance)}` : '—'),
      ]),
      el('div', { className: 'stat-sub' }, a.subtype),
    ]));
  }
  if (!ins.accountsRolled.length) acctList.appendChild(el('li', { className: 'stat-sub' }, 'No accounts returned.'));
  dash.appendChild(el('div', { className: 'dash-card' }, [el('h3', {}, 'Accounts'), acctList]));

  // Fixed commitments rolled up
  const soList = el('ul', {});
  if (!ins.commitments.length) {
    soList.appendChild(el('li', { className: 'stat-sub' }, 'No standing orders or direct debits for this persona.'));
  } else {
    for (const c of ins.commitments.slice(0, 10)) {
      soList.appendChild(el('li', {}, [
        el('div', { className: 'row' }, [
          el('span', {}, [c.label, el('span', { className: 'lfi-badge' }, c.lfi)]),
          el('span', { className: 'right' }, `${c.currency} ${c.amount}`),
        ]),
        el('div', { className: 'stat-sub' }, `${c.kind} · ${c.frequency}`),
      ]));
    }
  }
  dash.appendChild(el('div', { className: 'dash-card' }, [el('h3', {}, 'Fixed commitments'), soList]));

  // Timeline (full width)
  dash.appendChild(renderJ2Timeline(ins.recentTx));
  return dash;
}

function renderBfmDashboard(persona, perLfi) {
  // BFM view: receivables (positive cashflow lines), payables (commitments),
  // 90-day cashflow forecast (last 30 net inflow as proxy), multi-outlet
  // rollup if persona is multi-LFI.
  const ins = aggregateJ2Insights(perLfi);

  // Last-30-day net inflow per LFI as cashflow indicator
  const cutoff30 = Date.now() - 30 * 24 * 3600 * 1000;
  const byLfi = new Map();
  for (const t of ins.recentTx) {
    const when = Date.parse(t.BookingDateTime || '');
    if (when < cutoff30) continue;
    if (t.Amount?.Currency !== 'AED') continue;
    const amt = parseFloat(t.Amount.Amount);
    const signed = t.CreditDebitIndicator === 'Credit' ? amt : -amt;
    byLfi.set(t._lfi, (byLfi.get(t._lfi) || 0) + signed);
  }
  let netInflow30 = 0;
  for (const v of byLfi.values()) netInflow30 += v;

  let inflow30 = 0, outflow30 = 0;
  for (const t of ins.recentTx) {
    const when = Date.parse(t.BookingDateTime || '');
    if (when < cutoff30) continue;
    if (t.Amount?.Currency !== 'AED') continue;
    const amt = parseFloat(t.Amount.Amount);
    if (t.CreditDebitIndicator === 'Credit') inflow30 += amt; else outflow30 += amt;
  }

  const dash = el('div', { className: 'bfm-dashboard' });

  // SME entity card
  dash.appendChild(el('div', { className: 'dash-card' }, [
    el('h3', {}, 'SME entity'),
    el('div', { className: 'stat' }, persona.name),
    el('div', { className: 'stat-sub' }, `${(persona.archetype || '').replace(/_/g, ' ')} · SME · ${state.j2SelectedLFIs.size} LFI${state.j2SelectedLFIs.size === 1 ? '' : 's'} consented`),
  ]));

  // Cross-LFI working capital
  dash.appendChild(el('div', { className: 'dash-card' }, [
    el('h3', {}, 'Working capital (AED, cross-LFI)'),
    el('div', { className: 'stat' }, formatAed(ins.totalAed)),
    el('div', { className: 'stat-sub' }, `Across ${ins.accountsRolled.length} accounts at ${byLfi.size || state.j2SelectedLFIs.size} LFI${(byLfi.size || state.j2SelectedLFIs.size) === 1 ? '' : 's'}`),
  ]));

  // Receivables — 30-day inflow
  dash.appendChild(el('div', { className: 'dash-card' }, [
    el('h3', {}, 'Receivables · 30d'),
    el('div', { className: 'stat pos' }, formatAed(inflow30)),
    el('div', { className: 'stat-sub' }, `Total credits across all consented accounts`),
  ]));

  // Payables — 30-day outflow + committed
  dash.appendChild(el('div', { className: 'dash-card' }, [
    el('h3', {}, 'Payables · 30d + committed'),
    el('div', { className: 'stat neg' }, formatAed(outflow30)),
    el('div', { className: 'stat-sub' }, `${ins.commitments.length} standing instruction${ins.commitments.length === 1 ? '' : 's'} on file`),
  ]));

  // Per-LFI cashflow rollup (span 2)
  const perLfiUl = el('ul', {});
  for (const [lfi, net] of byLfi.entries()) {
    perLfiUl.appendChild(el('li', {}, [
      el('div', { className: 'row' }, [
        el('span', {}, [`LFI ${lfi}`, el('span', { className: 'lfi-badge' }, lfi)]),
        el('span', { className: `right ${net >= 0 ? 'pos' : 'neg'}` },
          `${net >= 0 ? '+' : ''}${formatAed(net)}`),
      ]),
      el('div', { className: 'stat-sub' }, 'Net AED flow · last 30 days'),
    ]));
  }
  if (!byLfi.size) perLfiUl.appendChild(el('li', { className: 'stat-sub' }, 'No AED transactions in the last 30 days.'));
  dash.appendChild(el('div', { className: 'dash-card span-2' }, [
    el('h3', {}, 'Per-LFI cashflow · 30d (net AED)'),
    perLfiUl,
  ]));

  dash.appendChild(renderJ2Timeline(ins.recentTx));
  return dash;
}

function renderJ2Timeline(recentTx) {
  const card = el('div', { className: 'dash-card span-2' }, [el('h3', {}, 'Transactions — last 90 days (cross-LFI)')]);
  const tl = el('div', { className: 'dash-timeline' });
  if (!recentTx.length) {
    tl.appendChild(el('div', { className: 'stat-sub' }, 'No transactions in the last 90 days across the consented LFIs.'));
    card.appendChild(tl);
    return card;
  }
  let lastMonth = '';
  for (const t of recentTx) {
    const month = (t.BookingDateTime || '').slice(0, 7);
    if (month !== lastMonth) {
      tl.appendChild(el('div', { className: 'dash-timeline-month' }, month));
      lastMonth = month;
    }
    const isCredit = t.CreditDebitIndicator === 'Credit';
    const sign = isCredit ? '+' : '−';
    const amt = `${sign} ${formatNumber(t.Amount?.Amount)} ${t.Amount?.Currency || ''}`;
    const li = el('li', { style: 'border-top:1px dashed var(--border); padding:6px 0; list-style:none;' }, [
      el('div', { className: 'row' }, [
        el('span', {}, [
          t.TransactionInformation || t.MerchantDetails?.MerchantName || 'Transaction',
          el('span', { className: 'lfi-badge' }, t._lfi),
        ]),
        el('span', { className: `right ${isCredit ? 'pos' : 'neg'}` }, amt),
      ]),
      el('div', { className: 'stat-sub' }, `${(t.BookingDateTime || '').slice(0, 10)} · ${t.ProprietaryBankTransactionCode?.Code || ''}`),
    ]);
    tl.appendChild(li);
  }
  card.appendChild(tl);
  return card;
}

function formatNumber(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderJ2Actions() {
  const persona = selectedPersona();
  const next = document.getElementById('j2-btn-next');
  const back = document.getElementById('j2-btn-back');
  const restart = document.getElementById('j2-btn-restart');
  const status = document.getElementById('j2-wizard-status');
  if (!next || !back || !status) return;

  back.disabled = state.j2Step <= 1;
  restart.hidden = state.j2Step !== 5;

  const lfiCount = state.j2SelectedLFIs.size;
  const minLfi = state.j2Scope === 'multi' ? 2 : 1;

  if (state.j2Step === 1) {
    next.disabled = !persona;
    next.textContent = persona ? `Continue as ${persona.name.split('—')[0].trim()} →` : 'Pick a persona →';
    status.textContent = persona ? `Selected: ${persona.name}.` : 'Pick a persona to continue.';
  } else if (state.j2Step === 2) {
    next.disabled = !state.j2Scope;
    next.textContent = state.j2Scope ? `Continue (${state.j2Scope}) →` : 'Pick scope →';
    status.textContent = state.j2Scope ? `${state.j2Scope === 'multi' ? 'Multi-LFI' : 'Single-LFI'} scope.` : 'Single LFI or multi-LFI?';
  } else if (state.j2Step === 3) {
    const ready = lfiCount >= minLfi;
    next.disabled = !ready;
    next.textContent = ready ? `Open Al Tareq consent (${lfiCount} LFI${lfiCount === 1 ? '' : 's'}) →` : `Pick ${state.j2Scope === 'multi' ? '2–4 profiles' : 'one profile'}`;
    status.textContent = `${lfiCount} of ${state.j2Scope === 'multi' ? '2–4' : '1'} LFI profile${lfiCount === 1 ? '' : 's'} selected.`;
  } else if (state.j2Step === 4) {
    next.disabled = false;
    const tppName = (persona?.segment || '').toLowerCase() === 'sme' ? 'Khazaa BFM' : 'Khazaa PFM';
    const lfiKeys = [...state.j2SelectedLFIs];
    if (state.j2SubStep === 'tpp') {
      next.textContent = 'Continue with Al Tareq →';
      status.textContent = `Sub-step 4a · ${tppName} launchpad — TPP-side initiation.`;
    } else if (state.j2SubStep === 'altareq') {
      next.textContent = `Continue (${[...state.j2Permissions].length} permissions, ${state.j2ExpirationDays}d) →`;
      status.textContent = `Sub-step 4b · Al Tareq CAAP · ${lfiKeys.length} LFI${lfiKeys.length === 1 ? '' : 's'} requested.`;
    } else if (state.j2SubStep === 'sca') {
      const currentLfi = lfiKeys[state.j2SCAIndex] || '?';
      const prof = LFI_PROFILES.find((p) => p.key === currentLfi);
      const isLast = state.j2SCAIndex >= lfiKeys.length - 1;
      next.textContent = isLast ? `Confirm consent at ${prof?.name || currentLfi} →` : `Continue (${state.j2SCAIndex + 2} of ${lfiKeys.length}) →`;
      status.textContent = `Sub-step 4c · SCA at ${prof?.name || currentLfi} (${state.j2SCAIndex + 1} / ${lfiKeys.length}).`;
    } else if (state.j2SubStep === 'manager') {
      next.textContent = `Return to ${tppName} →`;
      status.textContent = `Sub-step 4d · Consent Manager · ${state.j2ConsentIds.size} ConsentId${state.j2ConsentIds.size === 1 ? '' : 's'} active.`;
    } else {
      next.textContent = 'Continue →';
      status.textContent = `Sub-step ${state.j2SubStep}.`;
    }
  } else if (state.j2Step === 5) {
    next.disabled = true;
    next.textContent = 'Aggregated ✓';
    status.textContent = `Khazaa ${(persona?.segment || '').toLowerCase() === 'sme' ? 'BFM' : 'PFM'} is now aggregating ${persona?.name?.split('—')[0]?.trim() || persona?.name}'s consented data.`;
  }
}

// ─── Wiring ────────────────────────────────────────────────────────

function wireControls() {
  // Consent Manager modal controls — close button, backdrop click, ESC key.
  const cmClose = document.getElementById('consent-manager-close');
  if (cmClose) cmClose.addEventListener('click', closeConsentManager);
  const cmClose2 = document.getElementById('consent-manager-close-2');
  if (cmClose2) cmClose2.addEventListener('click', closeConsentManager);
  const cmBackdrop = document.getElementById('consent-manager-backdrop');
  if (cmBackdrop) cmBackdrop.addEventListener('click', closeConsentManager);
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const modal = document.getElementById('consent-manager-modal');
    if (modal && !modal.hidden) closeConsentManager();
  });

  // Hub → journey card clicks. Both buttons drop the user into their
  // respective journey container. The J1 wizard rehydrates from existing
  // state (persona / step) so a back-trip from the hub doesn't reset it.
  const openJ1 = document.getElementById('open-j1');
  if (openJ1) openJ1.addEventListener('click', () => { state.view = 'j1'; refresh(); });
  const openJ2 = document.getElementById('open-j2');
  if (openJ2) openJ2.addEventListener('click', () => { state.view = 'j2'; refresh(); });

  // "← Back to all journeys" links inside each journey container.
  const goHub = (ev) => { ev.preventDefault(); state.view = 'hub'; refresh(); };
  const backJ1 = document.getElementById('back-from-j1');
  if (backJ1) backJ1.addEventListener('click', goHub);
  const backJ2 = document.getElementById('back-from-j2');
  if (backJ2) backJ2.addEventListener('click', goHub);

  document.querySelectorAll('.persona-filters button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.persona-filters button').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      state.filter = btn.dataset.filter;
      renderPersonaGallery();
    });
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    if (state.step < 3) { state.step += 1; refresh(); return; }
    if (state.step === 3) {
      const order = ['discovery', 'sca', 'consent', 'token'];
      const i = order.indexOf(state.subStep);
      // From the last sub-step, the main Next advances to step 4 (chat).
      if (i === -1 || i >= order.length - 1) {
        state.approved = true;
        state.step = 4;
        // Reset subStep so a re-entry to step 3 starts at discovery again.
        state.subStep = 'discovery';
        refresh();
        return;
      }
      const next = order[i + 1];
      // Transition into 'token' = the actual consent grant moment. Mint a
      // fresh ConsentId and append/replace the J1 consent record so the
      // Consent Manager view (and the token panel itself) can render it.
      if (next === 'token') {
        state.j1ConsentId = mintConsentId();
        state.approved = true;
        const expiresAt = new Date(Date.now() + state.j1ExpirationDays * 86400000).toISOString();
        const lfi = firstSelectedLfi();
        const record = {
          source: 'j1',
          tpp: 'Claude · Anthropic',
          lfi,
          consentId: state.j1ConsentId,
          permissions: [...state.j1Permissions],
          expiresAt,
          accounts: 'all',
          status: 'Active',
        };
        // Replace any existing J1 record (re-grants after a back-and-forth
        // produce a fresh ConsentId rather than stacking duplicates).
        const existingIdx = state.consentRecords.findIndex((r) => r.source === 'j1');
        if (existingIdx >= 0) state.consentRecords[existingIdx] = record;
        else state.consentRecords.push(record);
      }
      state.subStep = next;
      refresh();
    }
  });
  document.getElementById('btn-back').addEventListener('click', () => {
    if (state.step === 3) {
      const order = ['discovery', 'sca', 'consent', 'token'];
      const i = order.indexOf(state.subStep);
      if (i > 0) { state.subStep = order[i - 1]; refresh(); return; }
      // At 'discovery' (or unknown), back leaves step 3 entirely.
      state.step = 2;
      state.subStep = 'discovery';
      refresh();
      return;
    }
    if (state.step > 1) { state.step -= 1; refresh(); }
  });
  document.getElementById('btn-restart').addEventListener('click', () => {
    state.step = 1;
    state.selectedPersonaId = null;
    state.selectedBankProfiles = new Set();
    state.selectedInsuranceLines = new Set();
    state.approved = false;
    refresh();
  });
  document.querySelectorAll('#wizard-steps .step').forEach((node) => {
    node.addEventListener('click', () => {
      const target = Number(node.dataset.step);
      if (target < state.step) { state.step = target; refresh(); }
    });
  });

  // ── J2 wizard controls ─────────────────────────────────────────────
  document.querySelectorAll('#j2-persona-filters button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.j2Filter = btn.dataset.j2filter;
      renderJ2Persona();
    });
  });

  const j2Next = document.getElementById('j2-btn-next');
  if (j2Next) j2Next.addEventListener('click', () => {
    if (state.j2Step < 4) { state.j2Step += 1; refresh(); return; }
    if (state.j2Step === 4) {
      const keys = J2_SUB_STEPS.map((s) => s.key);
      const cur = state.j2SubStep;

      // Special case 1: sca loop — Next mints a ConsentId for the current
      // LFI and advances the index; if last LFI, moves to manager.
      if (cur === 'sca') {
        const lfiKeys = [...state.j2SelectedLFIs];
        const i = state.j2SCAIndex;
        const currentLfi = lfiKeys[i];
        if (currentLfi) {
          const cid = mintConsentId();
          state.j2ConsentIds.set(currentLfi, cid);
          // Append/replace consent record for this LFI
          const expiresAt = new Date(Date.now() + state.j2ExpirationDays * 86400000).toISOString();
          const accounts = state.j2SelectedAccounts.get(currentLfi) || new Set();
          const record = {
            source: 'j2',
            tpp: (selectedPersona()?.segment || '').toLowerCase() === 'sme' ? 'Khazaa BFM' : 'Khazaa PFM',
            lfi: currentLfi,
            consentId: cid,
            permissions: [...state.j2Permissions],
            expiresAt,
            accounts: [...accounts],
            status: 'Active',
          };
          const existingIdx = state.consentRecords.findIndex((r) => r.source === 'j2' && r.lfi === currentLfi);
          if (existingIdx >= 0) state.consentRecords[existingIdx] = record;
          else state.consentRecords.push(record);
        }
        if (i + 1 < lfiKeys.length) {
          state.j2SCAIndex = i + 1;
          refresh();
          return;
        }
        // Last LFI confirmed → advance to manager sub-step
        state.j2SubStep = 'manager';
        refresh();
        return;
      }

      // Special case 2: altareq → sca transition starts the LFI loop fresh.
      if (cur === 'altareq') {
        state.j2SubStep = 'sca';
        state.j2SCAIndex = 0;
        // Clear any stale ConsentIds + per-LFI record state so the loop
        // re-mints cleanly. (Re-entries after Back-and-forth still produce
        // fresh ConsentIds.)
        state.j2ConsentIds = new Map();
        state.consentRecords = state.consentRecords.filter((r) => r.source !== 'j2');
        refresh();
        return;
      }

      // Default forward nav within the sub-step list, or jump out to step 5
      // from the last sub-step (manager).
      const i = keys.indexOf(cur);
      if (i === -1 || i >= keys.length - 1) {
        state.j2Approved = true;
        state.j2Step = 5;
        state.j2SubStep = 'tpp';
        refresh();
        return;
      }
      state.j2SubStep = keys[i + 1];
      refresh();
    }
  });
  const j2Back = document.getElementById('j2-btn-back');
  if (j2Back) j2Back.addEventListener('click', () => {
    if (state.j2Step === 4) {
      const keys = J2_SUB_STEPS.map((s) => s.key);
      const cur = state.j2SubStep;

      // sca: back walks the LFI index down; from index 0, back returns to altareq.
      if (cur === 'sca') {
        if (state.j2SCAIndex > 0) { state.j2SCAIndex -= 1; refresh(); return; }
        state.j2SubStep = 'altareq';
        refresh();
        return;
      }
      // manager: back goes to the last LFI's SCA screen.
      if (cur === 'manager') {
        state.j2SubStep = 'sca';
        state.j2SCAIndex = Math.max(0, [...state.j2SelectedLFIs].length - 1);
        refresh();
        return;
      }

      const i = keys.indexOf(cur);
      if (i > 0) { state.j2SubStep = keys[i - 1]; refresh(); return; }
      state.j2Step = 3;
      state.j2SubStep = 'tpp';
      refresh();
      return;
    }
    if (state.j2Step > 1) { state.j2Step -= 1; refresh(); }
  });
  const j2Restart = document.getElementById('j2-btn-restart');
  if (j2Restart) j2Restart.addEventListener('click', () => {
    state.j2Step = 1;
    state.j2Scope = null;
    state.j2SelectedLFIs = new Set();
    state.j2Approved = false;
    refresh();
  });
  document.querySelectorAll('#j2-wizard-steps .step').forEach((node) => {
    node.addEventListener('click', () => {
      const target = Number(node.dataset.j2step);
      // Backwards-nav is always allowed; forward-nav only when the
      // prerequisite for that step is met.
      if (target < state.j2Step) { state.j2Step = target; refresh(); return; }
      if (target === state.j2Step) return;
      if (target === 2 && !selectedPersona()) return;
      if (target === 3 && !state.j2Scope) return;
      const minLfi = state.j2Scope === 'multi' ? 2 : 1;
      if (target === 4 && state.j2SelectedLFIs.size < minLfi) return;
      if (target === 5 && state.j2SelectedLFIs.size < minLfi) return;
      state.j2Step = target; refresh();
    });
  });
}

// ─── Live spec pin ─────────────────────────────────────────────────

async function fillSpecMeta() {
  let manifest = null;
  try {
    const res = await fetch('../fixtures/v1/manifest.json');
    if (res.ok) manifest = await res.json();
  } catch { /* ignore */ }

  let spec = null;
  if (!manifest) {
    try {
      const res = await fetch('../dist/SPEC.json');
      if (res.ok) spec = await res.json();
    } catch { /* ignore */ }
  }

  const sha = (manifest?.specSha ?? spec?.pinSha ?? 'unknown').slice(0, 7);
  document.getElementById('footer-sha').textContent = sha;
  document.getElementById('meta-sha').textContent = manifest?.specSha ?? spec?.pinSha ?? '—';
  document.getElementById('meta-retrieved').textContent = manifest?.nowAnchor ?? spec?.retrievedAt ?? '—';
  document.getElementById('meta-version').textContent = manifest?.version ?? '—';
  document.getElementById('meta-generated').textContent = manifest?.generatedAt ?? '—';
}

// ─── Boot ──────────────────────────────────────────────────────────

async function init() {
  wireControls();
  try {
    state.personas = await loadPersonas();
  } catch (err) {
    const grid = document.getElementById('persona-grid');
    grid.innerHTML = '';
    grid.appendChild(el('p', { className: 'skeleton' }, `Could not load personas: ${err.message}`));
    return;
  }
  // Restore from URL after personas loaded so persona-id validation works.
  restoreStateFromUrl();
  refresh();
  fillSpecMeta().catch(() => {});
}

init().catch((err) => {
  const banner = document.createElement('pre');
  banner.textContent = `connect init failed: ${String(err.message ?? err)}`;
  banner.style.cssText = 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0';
  document.body.insertBefore(banner, document.body.firstChild);
});
