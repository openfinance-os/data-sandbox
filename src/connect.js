// /connect page — interactive simulator for the Claude-for-Open-Finance
// connector journey. Four steps: persona gallery → institution picker →
// authorize → connected.
//
// State is encoded in the URL via history.replaceState so refresh / share
// preserves the journey (EXP-17-aligned). Persona/footprint data comes
// from /fixtures/v1/manifest.json (production) with a /dist/data.json
// fallback for local dev. The wizard is a UI mock; the actual OAuth
// handshake lives in packages/sandbox-mcp/src/transports/oauth-simulation.mjs
// behind --simulate-oauth.
//
// Step 4 (Connected) fans out across multiple OF v2.1 endpoints and
// renders a small PFM card from the *real* fixture envelopes. Spec
// compliance (EXP-01): every key it reads is one the parsed OpenAPI spec
// declares at /accounts, /balances, /transactions, /standing-orders,
// /direct-debits, and the per-line insurance policies endpoint:
//
//   banking accounts    → Data.Account[]                  · v2.1 §accounts
//   banking balances    → Data.Balance[]                  · v2.1 §balances
//   banking transactions→ Data.Transaction[]              · v2.1 §transactions
//   banking SOs / DDs   → Data.StandingOrder[] / DirectDebit[]
//   insurance policies  → Data.Policies[]                 · v2.1 insurance
//
// The card surfaces only fields that are spec-defined and present on the
// envelope; it never invents values. The full envelope is also rendered
// in a collapsible so the reader can verify nothing was fabricated.

const SCOPE_LABELS = {
  banking: {
    title: 'Bank Data Sharing',
    body: 'accounts · balances · transactions · standing orders · direct debits · beneficiaries · statements · products',
  },
  insurance: {
    title: 'Insurance Data Sharing',
    body: 'policies · payment details · quotes (read-only across 7 lines)',
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

// ─── State ──────────────────────────────────────────────────────────

const state = {
  step: 1,
  filter: 'all',
  personas: [],
  selectedPersonaId: null,
  selectedBankProfiles: new Set(),
  selectedInsuranceLines: new Set(),
  approved: false,
};

function selectedPersona() {
  return state.personas.find((p) => p.id === state.selectedPersonaId) || null;
}

// ─── URL state (permalink) ─────────────────────────────────────────

// Serialize the user-facing journey state into URLSearchParams. UI state
// (filter, in-flight loaders) is deliberately excluded.
function serializeStateToParams() {
  const params = new URLSearchParams();
  if (state.selectedPersonaId) params.set('persona', state.selectedPersonaId);
  if (state.selectedBankProfiles.size) params.set('banks', [...state.selectedBankProfiles].join(','));
  if (state.selectedInsuranceLines.size) params.set('lines', [...state.selectedInsuranceLines].join(','));
  if (state.step && state.step !== 1) params.set('step', String(state.step));
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

function refresh() {
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

function renderConsent() {
  const persona = selectedPersona();
  const body = document.getElementById('consent-body');
  body.innerHTML = '';
  if (!persona) return;

  const totalInst = state.selectedBankProfiles.size + state.selectedInsuranceLines.size;
  const showBanking = state.selectedBankProfiles.size > 0;
  const showInsurance = state.selectedInsuranceLines.size > 0;
  const bankList = [...state.selectedBankProfiles].map((p) => `LFI · ${p}`).join('  ·  ');
  const insList = [...state.selectedInsuranceLines].map((l) => INSURANCE_LINE_LABELS[l].name).join('  ·  ');

  const mock = el('div', { className: 'consent-mock', role: 'img', 'aria-label': 'Mock UAE Open Finance consent screen' }, [
    el('div', { className: 'browser-bar' }, [
      el('span', { className: 'dots' }, [el('span'), el('span'), el('span')]),
      el('span', { className: 'url' }, 'https://auth.openfinance-os.org/oauth2/authorize?client_id=cc-connector-9f3a&…'),
    ]),
  ]);
  const inner = el('div', { className: 'body' });
  inner.appendChild(el('h4', {}, 'Claude × UAE Open Finance Authority'));
  const subL = el('p', { className: 'sub' });
  subL.innerHTML = `Claude is requesting access on behalf of <strong>"Claude for Open Finance"</strong> · TPP licence <code>SANDBOX-CC-9F3A</code>`;
  inner.appendChild(subL);

  inner.appendChild(el('div', { className: 'persona-line' }, [
    el('div', { className: 'avatar', style: `background:${avatarColor(persona.id)};` }, initials(persona.name)),
    el('div', {}, [
      el('div', { className: 'pn' }, persona.name),
      el('div', { className: 'pm' }, `${persona.domain}${persona.segment ? ` · ${persona.segment}` : ''} · ${totalInst} institution${totalInst === 1 ? '' : 's'} selected`),
    ]),
  ]));

  if (showBanking) {
    inner.appendChild(el('div', { className: 'scope' }, [
      el('span', { className: 'tick', 'aria-hidden': 'true' }, '✓'),
      el('div', {}, [
        el('strong', {}, SCOPE_LABELS.banking.title),
        el('span', { className: 'scope-body' }, SCOPE_LABELS.banking.body),
        el('div', { className: 'selected-insts' }, bankList),
      ]),
    ]));
  }
  if (showInsurance) {
    inner.appendChild(el('div', { className: 'scope' }, [
      el('span', { className: 'tick', 'aria-hidden': 'true' }, '✓'),
      el('div', {}, [
        el('strong', {}, SCOPE_LABELS.insurance.title),
        el('span', { className: 'scope-body' }, SCOPE_LABELS.insurance.body),
        el('div', { className: 'selected-insts' }, insList),
      ]),
    ]));
  }
  inner.appendChild(el('div', { className: 'scope unchecked' }, [
    el('span', { className: 'tick', 'aria-hidden': 'true' }),
    el('div', {}, [
      el('strong', {}, 'Service Initiation — payments'),
      el('span', { className: 'scope-body' }, 'Not requested · v1 read-only'),
    ]),
  ]));

  const footnote = el('p', { className: 'footnote' });
  footnote.innerHTML = 'Sharing window <strong>90 days</strong> · Revoke any time at <em>My Consents</em>. Data is <strong>SYNTHETIC</strong>. No real customer. No real institution.';
  inner.appendChild(footnote);

  mock.appendChild(inner);
  body.appendChild(mock);
}

function renderConnected() {
  const persona = selectedPersona();
  const body = document.getElementById('connected-body');
  body.innerHTML = '';
  if (!persona) return;

  const totalInst = state.selectedBankProfiles.size + state.selectedInsuranceLines.size;
  const fakeToken = `ofx_at_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

  body.appendChild(el('div', { className: 'connected-summary' }, [
    el('div', { className: 'label' }, '✓ Connected'),
    el('div', { className: 'summary-line' }, [
      el('span', {}, 'Bearer issued for '),
      el('strong', {}, persona.name),
      el('span', {}, ' · '),
      el('strong', {}, `${totalInst} institution${totalInst === 1 ? '' : 's'}`),
      el('span', {}, ' · 90-day consent window.'),
    ]),
    el('div', { className: 'summary-line', style: 'margin-top:6px;color:var(--text-muted);font-family:ui-monospace,Menlo,monospace;font-size:11.5px;' },
      `access_token: ${fakeToken}`),
  ]));

  for (const p of nextPromptFor(persona)) {
    body.appendChild(el('div', { className: 'next-prompt' }, [
      el('div', { className: 'label' }, p.label),
      el('div', { className: 'prompt-quote' }, `"${p.quote}"`),
      el('div', { className: 'tool-chain' }, `tool chain: ${p.tools.join(' → ')}`),
    ]));
  }

  // Multi-endpoint fetch CTA. Only available for personas with a primary
  // domain that has fixtures; cross-domain ticks are surfaced in the
  // consent step (3) but the sandbox doesn't ship cross-domain bundles.
  const lfi = firstSelectedLfi();
  const fetchPanel = el('div', { className: 'fetch-panel' });
  fetchPanel.appendChild(el('div', { className: 'label', style: 'margin-bottom:6px;' },
    'Close the loop — pull the real envelopes'));
  const desc = persona.domain === 'banking'
    ? `Chains GET /accounts → per-account GET /balances + /transactions + /standing-orders + /direct-debits and renders a PFM card.`
    : `Fetches GET /${inferInsuranceLine(persona) || 'motor'}-insurance-policies and renders the policy summary.`;
  fetchPanel.appendChild(el('div', { className: 'tool-chain', style: 'margin-top:0;margin-bottom:8px;' }, desc));
  const fetchBtn = el('button', {
    type: 'button',
    className: 'btn primary',
    onclick: () => runLiveFetch(persona, lfi, fetchPanel),
  }, persona.domain === 'banking' ? 'Build PFM snapshot →' : 'Pull policy summary →');
  fetchPanel.appendChild(fetchBtn);
  if (!persona.default_seed) {
    fetchPanel.appendChild(el('div', { className: 'tool-chain', style: 'margin-top:6px;color:var(--warn-border);' },
      `No default_seed for this persona — run \`npm run build:fixtures\` first.`));
    fetchBtn.disabled = true;
  }
  body.appendChild(fetchPanel);

  const reuse = el('div', { className: 'callout' });
  reuse.innerHTML =
    `<strong>Want to fire this against the live MCP?</strong> ` +
    `<code>npx -y @openfinance-os/sandbox-mcp --transport http --simulate-oauth</code>, ` +
    `then point a Claude.ai connector at <code>http://127.0.0.1:8787/mcp</code>.`;
  body.appendChild(reuse);
}

// ─── Multi-endpoint live fetch + PFM card ───────────────────────────

async function runLiveFetch(persona, lfi, panel) {
  const old = panel.querySelector('.fetch-result');
  if (old) old.remove();
  const result = el('div', { className: 'fetch-result' });
  result.appendChild(el('div', { className: 'fetch-status' }, 'Fetching envelopes…'));
  panel.appendChild(result);

  try {
    if (persona.domain === 'banking') await renderBankingPFM(persona, lfi, result);
    else await renderInsuranceSummary(persona, result);
  } catch (err) {
    result.innerHTML = '';
    result.appendChild(el('div', { className: 'fetch-status', style: 'color:#a13;' },
      `Fetch failed: ${err.message}. Run \`npm run build:fixtures && npm run build:site\`, then serve from \`_site\`.`));
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
//   Data.Transaction[].Amount.{Amount, Currency}, .CreditDebitIndicator, .BookingDateTime
// Per /standing-orders, /direct-debits:
//   Data.StandingOrder[], Data.DirectDebit[]
//
// The PFM card only surfaces these spec-defined fields; nothing is invented.
async function renderBankingPFM(persona, lfi, container) {
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

  // Phase 3: aggregate. Per spec:
  //   • Available balance: prefer Balance.Type=InterimAvailable, else
  //     InterimBooked, else most-recent. CreditDebitIndicator drives sign.
  //   • Inflow / outflow: sum Transaction.Amount.Amount by CreditDebitIndicator
  //     over the last 30 days of BookingDateTime.
  //   • SO / DD count: cardinality of Data.StandingOrder[] / Data.DirectDebit[].
  let availableTotal = 0;
  let inflow30 = 0;
  let outflow30 = 0;
  let soCount = 0;
  let ddCount = 0;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let latestTx = null;

  for (const a of perAccount) {
    const balances = a.balances?.Data?.Balance ?? [];
    const pick = balances.find((b) => b.Type === 'InterimAvailable')
              || balances.find((b) => b.Type === 'InterimBooked')
              || balances[0];
    if (pick && pick.Amount?.Currency === 'AED') {
      const amt = parseFloat(pick.Amount.Amount);
      availableTotal += pick.CreditDebitIndicator === 'Credit' ? amt : -amt;
    }
    for (const t of (a.transactions?.Data?.Transaction ?? [])) {
      if (t.Amount?.Currency !== 'AED') continue;
      const when = Date.parse(t.BookingDateTime || '') || 0;
      if (when < cutoff) continue;
      const amt = parseFloat(t.Amount.Amount);
      if (t.CreditDebitIndicator === 'Credit') inflow30 += amt;
      else outflow30 += amt;
      if (!latestTx || when > Date.parse(latestTx.BookingDateTime || '')) latestTx = t;
    }
    soCount += (a.standingOrders?.Data?.StandingOrder ?? []).length;
    ddCount += (a.directDebits?.Data?.DirectDebit ?? []).length;
  }

  // Phase 4: render.
  container.innerHTML = '';
  const wm = acctEnv._watermark || '';
  if (wm) container.appendChild(el('div', { className: 'watermark-banner' }, wm));

  container.appendChild(el('div', { className: 'pfm-card' }, [
    el('div', { className: 'pfm-title' }, '📊 PFM snapshot · last 30 days'),
    el('div', { className: 'pfm-grid' }, [
      pfmMetric('Available balance', formatAed(availableTotal), 'sum across accounts (InterimAvailable / InterimBooked)'),
      pfmMetric('Accounts', String(accounts.length), accounts.map((a) => a.AccountSubType || a.AccountType || '?').join(' · ')),
      pfmMetric('Inflows (30d)', formatAed(inflow30), 'sum of Credit transactions'),
      pfmMetric('Outflows (30d)', formatAed(outflow30), 'sum of Debit transactions'),
      pfmMetric('Standing orders', String(soCount), 'Data.StandingOrder[]'),
      pfmMetric('Direct debits', String(ddCount), 'Data.DirectDebit[]'),
    ]),
  ]));

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
    `Every value above is read from spec-defined Data.* paths on the v2.1 envelope. The PFM card invents nothing — expand "All envelopes" to verify.`));
}

// Spec-compliant per /<line>-insurance-policies (v2.1 insurance):
//   Data.Policies[].InsurancePolicyId, .PolicyNumber, .PolicyStatus,
//   .PolicyStartDate, .PolicyEndDate
async function renderInsuranceSummary(persona, container) {
  const line = inferInsuranceLine(persona);
  if (!line) throw new Error(`could not infer insurance line for ${persona.id}`);
  const base = `../fixtures/v1/bundles/${persona.id}/median/seed-${persona.default_seed}`;
  const env = await fetchJson(`${base}/${line}-insurance-policies.json`);
  if (!env) throw new Error(`${line}-insurance-policies.json not found`);
  const policies = env.Data?.Policies ?? [];

  container.innerHTML = '';
  const wm = env._watermark || '';
  if (wm) container.appendChild(el('div', { className: 'watermark-banner' }, wm));

  const first = policies[0] || {};
  container.appendChild(el('div', { className: 'pfm-card' }, [
    el('div', { className: 'pfm-title' }, `🛡 ${INSURANCE_LINE_LABELS[line].name} · summary`),
    el('div', { className: 'pfm-grid' }, [
      pfmMetric('Policies on file', String(policies.length), `Data.Policies[]`),
      pfmMetric('Policy number', first.PolicyNumber || '—', 'Data.Policies[0].PolicyNumber'),
      pfmMetric('Status', first.PolicyStatus || '—', 'Data.Policies[0].PolicyStatus'),
      pfmMetric('Start', first.PolicyStartDate || '—', 'Data.Policies[0].PolicyStartDate'),
      pfmMetric('End', first.PolicyEndDate || '—', 'Data.Policies[0].PolicyEndDate'),
    ]),
  ]));

  container.appendChild(renderEnvelopeInventory([
    { path: `/${line}-insurance-policies`, env, count: policies.length, key: 'Policies' },
  ], persona, 'median'));

  container.appendChild(el('div', { className: 'fetch-footnote' },
    `For richer policy detail (PolicyHolder, Premium, Product, Claims) call GET /${line}-insurance-policies/{InsurancePolicyId} via the MCP — the list endpoint per spec carries summary fields only.`));
}

function pfmMetric(label, value, hint) {
  return el('div', { className: 'pfm-metric' }, [
    el('div', { className: 'pfm-label' }, label),
    el('div', { className: 'pfm-value' }, value),
    hint ? el('div', { className: 'pfm-hint' }, hint) : null,
  ]);
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

function nextPromptFor(persona) {
  if (persona.domain === 'insurance') {
    const line = inferInsuranceLine(persona) || 'motor';
    return [{
      label: 'Suggested first prompt',
      quote: `Show me ${persona.name.replace(/—.*$/, '').trim()}'s current ${line} policy and the next renewal date.`,
      tools: ['set_session', `get_${line}_policies`, `get_${line}_policy`],
    }];
  }
  if (persona.segment === 'SME') {
    return [{
      label: 'Suggested first prompt',
      quote: `Reconcile this month's aggregator payouts against POS settlements across all three accounts and flag anything unusual.`,
      tools: ['set_session', 'get_accounts', 'get_transactions', 'get_standing_orders', 'get_direct_debits'],
    }];
  }
  return [{
    label: 'Suggested first prompt — ready skill #1: Monthly PFM Summary',
    quote: `Give me a month-end PFM summary for ${persona.name.replace(/—.*$/, '').trim()}.`,
    tools: ['set_session', 'get_accounts', 'get_balances', 'get_transactions', 'get_standing_orders', 'get_direct_debits'],
  }];
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
    next.textContent = persona ? `Continue as ${persona.name.split('—')[0].trim()} →` : 'Pick a persona →';
    status.textContent = persona ? `Selected: ${persona.name}.` : 'Pick a persona to continue.';
  } else if (state.step === 2) {
    next.disabled = totalInst === 0;
    next.textContent = totalInst ? `Authorize ${totalInst} institution${totalInst === 1 ? '' : 's'} →` : 'Select at least one institution';
    status.textContent = persona ? `${persona.name} · ${totalInst} institution${totalInst === 1 ? '' : 's'} selected.` : '';
  } else if (state.step === 3) {
    next.disabled = false;
    next.textContent = 'Approve all (1 tap)';
    status.textContent = 'Approving will simulate the OAuth handshake — no real network call.';
  } else if (state.step === 4) {
    next.disabled = true;
    next.textContent = 'Connected ✓';
    status.textContent = `Bearer issued. Tools unlocked for ${persona?.name}.`;
  }
}

// ─── Wiring ────────────────────────────────────────────────────────

function wireControls() {
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
    if (state.step === 3) { state.approved = true; state.step = 4; refresh(); return; }
  });
  document.getElementById('btn-back').addEventListener('click', () => {
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
