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

// view: 'hub' (default landing — two cards + J3 contrast)
//       'j1'  (Bank-direct MCP labs wizard — was the only view before this redesign)
//       'j2'  (OF rails TPP via Al Tareq — placeholder in Phase A, wizard in Phase B)
// step:  1..4 inside the J1 wizard. Ignored when view !== 'j1'.
const state = {
  view: 'hub',
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
  if (state.view && state.view !== 'hub') params.set('view', state.view);
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

  // J1 framing: this is the BANK's own OAuth screen, not Al Tareq. URL,
  // heading, and revocation pointer all sit with the bank — that's the
  // load-bearing distinction between J1 (direct, bank-own consent) and
  // J2 (regulated, Consent Manager as single source of truth).
  const mock = el('div', { className: 'consent-mock', role: 'img', 'aria-label': 'Mock bank-own OAuth consent screen (Journey 1)' }, [
    el('div', { className: 'browser-bar' }, [
      el('span', { className: 'dots' }, [el('span'), el('span'), el('span')]),
      el('span', { className: 'url' }, 'https://auth.your-bank-labs.example/authorize?client_id=claude&…'),
    ]),
  ]);
  const inner = el('div', { className: 'body' });
  inner.appendChild(el('h4', {}, 'Share with Claude · your bank’s labs MCP'));
  inner.appendChild(el('p', { className: 'sub' }, [
    'OAuth 2.1 + PKCE. Claude will be able to read what you tick. You can stop sharing at any time in your bank’s ',
    el('em', {}, 'Connected apps'),
    ' page (not Al Tareq — this is the bank’s own consent surface).',
  ]));

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

  const footnote = el('p', { className: 'footnote' }, [
    'Sharing window ', el('strong', {}, '90 days'),
    ' · Revoke any time in your bank’s ', el('em', {}, 'Connected apps'), '. ',
    'Data is ', el('strong', {}, 'SYNTHETIC'), '. No real customer. No real institution.',
  ]);
  inner.appendChild(footnote);

  mock.appendChild(inner);
  body.appendChild(mock);
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
    next.textContent = 'Approve all (1 tap)';
    status.textContent = 'Approving will simulate the OAuth handshake — no real network call.';
  } else if (state.step === 4) {
    next.disabled = true;
    next.textContent = 'Back in chat ✓';
    status.textContent = `Bearer issued. Claude can answer about ${persona?.name?.split('—')[0]?.trim() || persona?.name}'s accounts.`;
  }
}

// ─── Wiring ────────────────────────────────────────────────────────

function wireControls() {
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
