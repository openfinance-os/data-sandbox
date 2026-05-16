// /connect page — interactive simulator for the Claude-for-Open-Finance
// connector journey. Four steps: persona gallery → institution picker →
// authorize → connected. State is in-memory only (EXP-22-aligned: no
// storage writes). Persona/footprint data is fetched from the staged
// fixture manifest at /fixtures/v1/manifest.json with a fall-back to
// /dist/data.json for local-dev (matches integrate.js / about.js).
//
// The wizard is a UI mock. The actual OAuth handshake (401 challenge +
// PKCE + bearer-gated /mcp) lives in
// packages/sandbox-mcp/src/transports/oauth-simulation.mjs and is
// exercisable via `npx -y @openfinance-os/sandbox-mcp --transport http
// --simulate-oauth`.

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

// Mirrors the populate-rate profile cards a customer would see if real
// LFIs were attached. Anonymous-by-design per NG5 / D-14 — these are
// never tied to a named real bank.
const LFI_PROFILES = [
  { key: 'rich', name: 'LFI · Rich profile', body: 'Every optional field populated. Best-case parser test.' },
  { key: 'median', name: 'LFI · Median profile', body: 'Typical UAE-market populate rate. Default for most personas.' },
  { key: 'sparse', name: 'LFI · Sparse profile', body: 'Minimum-conformant: mandatory + a few optionals. Resilience test.' },
];

const INSURANCE_LINE_LABELS = {
  motor: { name: 'Motor Insurance', body: 'Comprehensive · TPL · UBI · 4 endpoints' },
  home: { name: 'Home Insurance', body: 'Buildings · contents · 4 endpoints' },
  health: { name: 'Health Insurance', body: 'Individual or family · 4 endpoints' },
  life: { name: 'Life Insurance', body: 'Term · mortgage-protection · 4 endpoints' },
  travel: { name: 'Travel Insurance', body: 'Annual or single-trip · 4 endpoints' },
  renters: { name: 'Renters Insurance', body: 'Tenant contents · 4 endpoints' },
  employment: { name: 'Employment Insurance (ILOE)', body: 'Income protection · 4 endpoints' },
};

// Map an insurance persona's archetype/persona_id to a line key.
function inferInsuranceLine(persona) {
  const idOrArch = (persona.persona_id || persona.id || '') + ' ' + (persona.archetype || '');
  for (const key of Object.keys(INSURANCE_LINE_LABELS)) {
    if (idOrArch.toLowerCase().includes(key)) return key;
  }
  return null;
}

// Deterministic avatar colour from a persona id (so the same persona
// gets the same swatch every time).
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

// ─── State ──────────────────────────────────────────────────────────

const state = {
  step: 1,
  filter: 'all',
  personas: [],          // [{id, name, archetype, domain, segment, stress_coverage, multi_lfi_footprint}]
  selectedPersonaId: null,
  selectedBankProfiles: new Set(),  // 'rich' | 'median' | 'sparse'
  selectedInsuranceLines: new Set(),
  approved: false,
};

function selectedPersona() {
  return state.personas.find((p) => p.id === state.selectedPersonaId) || null;
}

// ─── Data ───────────────────────────────────────────────────────────

async function loadPersonas() {
  // Try the staged fixture manifest first (production path).
  try {
    const res = await fetch('../fixtures/v1/manifest.json');
    if (res.ok) {
      const m = await res.json();
      return toPersonaList(m.personas);
    }
  } catch { /* fall through */ }
  // Local-dev fallback: dist/data.json from `npm run build:spec && build:data`.
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
    stress_coverage: v.stress_coverage || [],
    multi_lfi_footprint: v.multi_lfi_footprint || null,
  })).sort((a, b) => {
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    return a.name.localeCompare(b.name);
  });
}

// ─── Rendering ─────────────────────────────────────────────────────

function refresh() {
  // Step indicator
  document.querySelectorAll('#wizard-steps .step').forEach((node) => {
    const s = Number(node.dataset.step);
    node.classList.toggle('active', s === state.step);
    node.classList.toggle('done', s < state.step);
  });

  // Show/hide step bodies
  for (const s of [1, 2, 3, 4]) {
    document.getElementById(`step-${s}`).hidden = s !== state.step;
  }

  // Render per-step
  if (state.step === 1) renderPersonaGallery();
  else if (state.step === 2) renderInstitutions();
  else if (state.step === 3) renderConsent();
  else if (state.step === 4) renderConnected();

  renderActions();
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

// Pre-select sensible defaults when a persona is first picked.
function resetInstitutionSelection(persona) {
  state.selectedBankProfiles = new Set();
  state.selectedInsuranceLines = new Set();
  if (persona.domain === 'banking') {
    if (persona.multi_lfi_footprint) {
      // SMEs have explicit roles — pre-tick the ones the persona uses.
      for (const role of ['primary', 'secondary', 'tertiary']) {
        const r = persona.multi_lfi_footprint[role];
        if (r && r.lfi_default) state.selectedBankProfiles.add(r.lfi_default.toLowerCase());
      }
    } else {
      // Non-SME default: median.
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
  document.getElementById('step-2-sub').innerHTML =
    `You're connecting as <strong>${escapeHtml(persona.name)}</strong>. Tick the institutions ` +
    `this persona shares data from. Pre-selected based on the persona manifest; you can change them.`;

  // Banking block — show for banking personas, hidden for pure insurance personas.
  if (persona.domain === 'banking') {
    body.appendChild(el('h4', {}, 'Bank Data Sharing — populate-rate profiles'));
    const grid = el('div', { className: 'inst-grid' });
    for (const prof of LFI_PROFILES) {
      const selected = state.selectedBankProfiles.has(prof.key);
      const card = el('button', {
        type: 'button',
        className: `inst-card${selected ? ' selected' : ''}`,
        'aria-pressed': selected ? 'true' : 'false',
        onclick: () => {
          if (state.selectedBankProfiles.has(prof.key)) state.selectedBankProfiles.delete(prof.key);
          else state.selectedBankProfiles.add(prof.key);
          renderInstitutions(); renderActions();
        },
      }, [
        el('div', { className: 'ihead' }, [
          el('span', { className: 'iname' }, prof.name),
          el('span', { className: `ibadge ${prof.key}` }, prof.key),
        ]),
        el('div', { className: 'ibody' }, prof.body),
        el('div', { className: 'iendpoints' }, '12 v2.1 endpoints'),
      ]);
      grid.appendChild(card);
    }
    body.appendChild(grid);

    // SME advisory — pull real LFI candidates from the persona's footprint.
    // This is the only place real UAE bank names are surfaced, and only
    // as descriptive of relationship — not bound to populate-rate.
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
  }

  // Insurance block — show for insurance personas only.
  if (persona.domain === 'insurance') {
    body.appendChild(el('h4', {}, 'Insurance Data Sharing — applicable line'));
    const grid = el('div', { className: 'inst-grid' });
    const line = inferInsuranceLine(persona);
    // Show only the line this persona has; greying out the others
    // would imply this persona has no relationship with them, which is
    // correct — keep the picker minimal.
    if (line) {
      const meta = INSURANCE_LINE_LABELS[line];
      const selected = state.selectedInsuranceLines.has(line);
      const card = el('button', {
        type: 'button',
        className: `inst-card${selected ? ' selected' : ''}`,
        'aria-pressed': selected ? 'true' : 'false',
        onclick: () => {
          if (state.selectedInsuranceLines.has(line)) state.selectedInsuranceLines.delete(line);
          else state.selectedInsuranceLines.add(line);
          renderInstitutions(); renderActions();
        },
      }, [
        el('div', { className: 'ihead' }, [
          el('span', { className: 'iname' }, meta.name),
          el('span', { className: 'ibadge' }, 'read-only'),
        ]),
        el('div', { className: 'ibody' }, meta.body),
        el('div', { className: 'iendpoints' }, `/${line}-insurance-policies/* · /quotes/* · /payment-details`),
      ]);
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }
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
  const sub = el('p', { className: 'sub' });
  sub.innerHTML = `Claude is requesting access on behalf of <strong>"Claude for Open Finance"</strong> · TPP licence <code>SANDBOX-CC-9F3A</code>`;
  inner.appendChild(sub);

  // Persona line
  const pline = el('div', { className: 'persona-line' }, [
    el('div', { className: 'avatar', style: `background:${avatarColor(persona.id)};` }, initials(persona.name)),
    el('div', {}, [
      el('div', { className: 'pn' }, persona.name),
      el('div', { className: 'pm' }, `${persona.domain}${persona.segment ? ` · ${persona.segment}` : ''} · ${totalInst} institution${totalInst === 1 ? '' : 's'} selected`),
    ]),
  ]);
  inner.appendChild(pline);

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

  const summary = el('div', { className: 'connected-summary' }, [
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
  ]);
  body.appendChild(summary);

  // Suggest a first prompt + tool chain based on persona domain.
  const prompts = nextPromptFor(persona);
  for (const p of prompts) {
    const next = el('div', { className: 'next-prompt' }, [
      el('div', { className: 'label' }, p.label),
      el('div', { className: 'prompt-quote' }, `"${p.quote}"`),
      el('div', { className: 'tool-chain' }, `tool chain: ${p.tools.join(' → ')}`),
    ]);
    body.appendChild(next);
  }

  // CLI to re-run with the actual MCP.
  const reuse = el('div', { className: 'callout' });
  reuse.innerHTML =
    `<strong>Want to fire this against the live MCP?</strong> ` +
    `<code>npx -y @openfinance-os/sandbox-mcp --transport http --simulate-oauth</code>, ` +
    `then point a Claude.ai connector at <code>http://127.0.0.1:8787/mcp</code>.`;
  body.appendChild(reuse);
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
      quote: `Reconcile this month\'s aggregator payouts against POS settlements across all three accounts and flag anything unusual.`,
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

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  // Step nav by clicking on the breadcrumb (only backwards, never forwards).
  document.querySelectorAll('#wizard-steps .step').forEach((node) => {
    node.addEventListener('click', () => {
      const target = Number(node.dataset.step);
      if (target < state.step) { state.step = target; refresh(); }
    });
  });
}

// ─── Live spec pin (matches integrate.js / about.js) ───────────────

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
  refresh();
  fillSpecMeta().catch(() => {});
}

init().catch((err) => {
  const banner = document.createElement('pre');
  banner.textContent = `connect init failed: ${String(err.message ?? err)}`;
  banner.style.cssText = 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0';
  document.body.insertBefore(banner, document.body.firstChild);
});
