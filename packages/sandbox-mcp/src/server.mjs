import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  loadJourney,
  loadPersonaManifest,
  loadSpec,
  listPersonas,
  listEndpoints,
  getPersonaInfo,
  buildBundle,
  expandRecipe,
  getPools,
  envelopesFromBundle,
  RECIPE_DEFAULTS,
  recipeHash,
  validateRecipe,
  encodeRecipe,
  decodeRecipe,
  manifest,
} from '@openfinance-os/sandbox-fixtures';
import { z } from 'zod';
import { createSessionStore, getEndpointEnvelope, fanOutAccountIds, fixtureEntry } from './session.mjs';
import { registerPrompts } from './prompts.mjs';

const PKG_NAME = '@openfinance-os/sandbox-mcp';
const PKG_VERSION = '0.0.1';

const PFM_INSTRUCTIONS = [
  'You are wired to a sandbox of synthetic UAE Open Finance v2.1 payloads across two domains:',
  '  • Bank Data Sharing (18 banking personas) — accounts, balances, transactions, parties, etc.',
  '  • Insurance Data Sharing preview (3 motor-insurance personas) — motor policies, payment',
  '    details, and a read-quote endpoint, all v2.1-errata1 shaped.',
  'All data is fictional — no real customer, no real institution. Every response carries a `_watermark`',
  'field; preserve it in any user-visible summary, table, or export.',
  '',
  'Workflow — curated persona (recommended for first use):',
  '  1. Call `list_personas` (optionally with { domain: "banking" | "insurance" }) and ask the user',
  '     to pick one (or accept a persona id directly). The persona\'s `domain` determines which',
  '     get_* tools apply.',
  '  2. Call `set_session` with { persona, lfi?, seed? }. lfi defaults to median; seed defaults to',
  '     the persona\'s default_seed. The same (persona, lfi, seed) always returns byte-identical data.',
  '  3. For a banking session: use `get_party`, `get_accounts`, `get_balances`, `get_transactions`,',
  '     `get_standing_orders`, `get_direct_debits`, `get_scheduled_payments`, `get_beneficiaries`,',
  '     `get_product`, `get_statements`. Use `load_journey` for a single dump of everything.',
  '  4. For an insurance session: use `get_motor_policies`, `get_motor_policy`,',
  '     `get_motor_payment_details`, `get_motor_quote`. Banking get_* tools error against an',
  '     insurance session and vice versa — switch personas to switch domain.',
  '',
  'Workflow — custom persona (banking only — recipe schema covers retail/SME/corporate banking):',
  '  1. Call `get_recipe_defaults` (or read the `recipe://schema` resource) to see the available knobs.',
  '  2. Translate the user\'s description into a recipe object (any subset of those knobs — missing keys',
  '     fall back to defaults). Call `build_persona` with { recipe, lfi?, seed? }.',
  '  3. The banking get_* tools then return the in-memory custom journey.',
  '  Same recipe + lfi + seed → byte-identical bundle. Persona id is `custom_<recipeHash>`.',
  '',
  'LFI profiles model how richly a Licensed Financial Institution populates optional fields:',
  '  rich    — all optional fields populated.',
  '  median  — typical UAE-market populate rate (default).',
  '  sparse  — minimum-conformant: only mandatory fields plus a few optionals.',
  'Mandatory fields are never redacted regardless of profile.',
].join('\n');

function envelope(persona, lfi, seed, kind, payload) {
  // Wrap a v2.1 envelope JSON in an MCP tool result. Stringified for portability.
  // Watermark is repeated in the prefix so it surfaces even if a client trims `_watermark`.
  const wm = payload?._watermark ?? '';
  const header = `[${kind}] persona:${persona} lfi:${lfi} seed:${seed}`;
  const text = [header, wm ? `# ${wm}` : null, '', JSON.stringify(payload, null, 2)]
    .filter(Boolean)
    .join('\n');
  return {
    content: [{ type: 'text', text }],
  };
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text) {
  return { isError: true, content: [{ type: 'text', text }] };
}

function resolveAccountId(session, requested) {
  if (!requested) return null;
  const ids = fanOutAccountIds(session);
  if (!ids.includes(requested)) {
    throw new Error(
      `unknown accountId: ${requested}. Available for this session: ${ids.join(', ') || '(none)'}`,
    );
  }
  return requested;
}

/**
 * Throw a helpful error if the active session domain doesn't match the tool.
 * Banking get_* tools should reject an insurance session and vice versa, so
 * the LLM gets a clear "switch personas" signal instead of a quiet failure.
 */
function requireDomain(session, expected, toolName) {
  const got = session.domain ?? 'banking';
  if (got !== expected) {
    throw new Error(
      `${toolName} requires a ${expected} session; this session is ${got} (persona ${session.persona}). ` +
      `Call list_personas({ domain: '${expected}' }) → set_session to switch.`,
    );
  }
}

function resolvePolicyId(session, requested) {
  const fx = fixtureEntry(session);
  const ids = fx?.policyIds ?? [];
  if (!requested) return ids[0] ?? null;
  if (!ids.includes(requested)) {
    throw new Error(
      `unknown policyId: ${requested}. Available for this session: ${ids.join(', ') || '(none)'}`,
    );
  }
  return requested;
}

function resolveQuoteId(session, requested) {
  const fx = fixtureEntry(session);
  const onlyId = fx?.quoteId ?? null;
  if (!requested) return onlyId;
  if (requested !== onlyId) {
    throw new Error(
      `unknown quoteId: ${requested}. Available for this session: ${onlyId ?? '(none)'}`,
    );
  }
  return requested;
}

function fetchPerAccount(session, suffix, accountId) {
  const ids = accountId ? [accountId] : fanOutAccountIds(session);
  return ids.map((id) => ({
    accountId: id,
    envelope: getEndpointEnvelope(session, `/accounts/${id}${suffix}`),
  }));
}

// Per-tool-result size cap on the consuming MCP client (Claude.ai/Claude Code)
// is the load-bearing constraint here. A whole-account transaction list for a
// high-volume persona (hnw_multicurrency: 969 txs ≈ 700 KB; corporate_treasury_listed:
// 720+ txs ≈ 460 KB) trips the cap, the client spills the response to a temp
// file, and downstream tool calls in the same turn fail. So `get_transactions`
// caps output at MAX_LIMIT, defaults to DEFAULT_LIMIT, and offers a `summary`
// mode for the canonical PFM aggregate-by-category use case.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function summariseTransactions(txs) {
  const byDirection = { Credit: { count: 0, total: 0 }, Debit: { count: 0, total: 0 } };
  const byCategory = new Map();
  const byMonth = new Map();
  let earliest = null;
  let latest = null;
  for (const t of txs) {
    const amt = Number(t?.Amount?.Amount) || 0;
    const dir = t?.CreditDebitIndicator === 'Credit' ? 'Credit' : 'Debit';
    byDirection[dir].count += 1;
    byDirection[dir].total = +(byDirection[dir].total + amt).toFixed(2);
    const code = (t?.MerchantDetails?.MerchantCategoryCode ?? 'uncategorised').toString();
    const cat = byCategory.get(code) ?? { MerchantCategoryCode: code, count: 0, total: 0 };
    cat.count += 1;
    cat.total = +(cat.total + (dir === 'Debit' ? -amt : amt)).toFixed(2);
    byCategory.set(code, cat);
    if (t?.BookingDateTime) {
      const month = String(t.BookingDateTime).slice(0, 7);
      const m = byMonth.get(month) ?? { month, count: 0, credit: 0, debit: 0 };
      m.count += 1;
      if (dir === 'Credit') m.credit = +(m.credit + amt).toFixed(2);
      else m.debit = +(m.debit + amt).toFixed(2);
      byMonth.set(month, m);
      const ts = Date.parse(t.BookingDateTime);
      if (Number.isFinite(ts)) {
        if (earliest == null || ts < earliest) earliest = ts;
        if (latest == null || ts > latest) latest = ts;
      }
    }
  }
  const topCategories = [...byCategory.values()]
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 10);
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  return {
    count: txs.length,
    byDirection,
    byMonth: months,
    topCategories,
    earliest: earliest != null ? new Date(earliest).toISOString() : null,
    latest: latest != null ? new Date(latest).toISOString() : null,
  };
}

function filterTransactions(envelopeJson, { since, until, minAmount, maxAmount, category, limit, summary }) {
  const txs = envelopeJson?.Data?.Transaction;
  if (!Array.isArray(txs)) return envelopeJson;
  const sinceTs = since ? Date.parse(since) : null;
  const untilTs = until ? Date.parse(until) : null;
  const matches = (t) => {
    const ts = t.BookingDateTime ? Date.parse(t.BookingDateTime) : null;
    if (sinceTs && ts && ts < sinceTs) return false;
    if (untilTs && ts && ts > untilTs) return false;
    const amt = Number(t?.Amount?.Amount);
    if (Number.isFinite(amt)) {
      if (minAmount != null && amt < minAmount) return false;
      if (maxAmount != null && amt > maxAmount) return false;
    }
    if (category) {
      const code = (t?.MerchantDetails?.MerchantCategoryCode ?? '').toString();
      const name = (t?.TransactionInformation ?? '').toString().toLowerCase();
      const wanted = category.toLowerCase();
      if (!code.toLowerCase().includes(wanted) && !name.includes(wanted)) return false;
    }
    return true;
  };
  const filtered = txs.filter(matches);

  if (summary) {
    const summaryBlock = summariseTransactions(filtered);
    // The v2.1 spec defines `Data` with `additionalProperties: false` and
    // requires `Transaction` to be present (AEReadTransaction). Aggregates
    // therefore live at the envelope root with an underscore prefix — the
    // same convention the codebase already uses for `_filter`, `_watermark`,
    // `_specSha`, etc. — so a strict TPP consumer can strip them and still
    // get a spec-conformant envelope. `Data.Transaction` stays as an empty
    // array so the required field is present.
    return {
      ...envelopeJson,
      Data: { ...envelopeJson.Data, Transaction: [] },
      _filter: {
        since, until, minAmount, maxAmount, category,
        mode: 'summary',
        total: txs.length,
        matched: filtered.length,
      },
      _summary: summaryBlock,
    };
  }

  const effLimit = Math.max(0, Math.min(MAX_LIMIT, limit ?? DEFAULT_LIMIT));
  // Generator emits transactions in ascending BookingDateTime order. PFM use
  // cases want recent activity, so when we cap, we keep the *tail* (most
  // recent) and preserve ascending order in the output.
  const truncated = filtered.length > effLimit;
  const kept = truncated ? filtered.slice(filtered.length - effLimit) : filtered;
  const filterBlock = {
    since, until, minAmount, maxAmount, category,
    limit: effLimit,
    total: txs.length,
    matched: filtered.length,
    kept: kept.length,
    truncated,
  };
  if (truncated) {
    const oldestKept = kept[0]?.BookingDateTime ?? null;
    filterBlock._paginationHint = [
      `Returned the ${kept.length} most recent transactions (of ${filtered.length} matching, ${txs.length} total).`,
      oldestKept
        ? `For older items: re-call with until="${oldestKept}" (and optionally a smaller limit) to walk backwards in time.`
        : 'For older items: re-call with a tighter since/until window or a higher limit (max ' + MAX_LIMIT + ').',
      'For aggregate analysis (category/month buckets) call with summary=true instead — single small response.',
    ].join(' ');
  }
  return {
    ...envelopeJson,
    Data: { ...envelopeJson.Data, Transaction: kept },
    _filter: filterBlock,
  };
}

// LFI populate-rate profiles. The wording mirrors PFM_INSTRUCTIONS so consumers
// see the same description whether they read the server-level instructions or
// call `lfi_profiles` directly.
const LFI_PROFILES = [
  { id: 'rich', label: 'Rich', description: 'All optional fields populated.', populate_band: 'all-optional' },
  { id: 'median', label: 'Median', description: 'Typical UAE-market populate rate (default).', populate_band: 'typical' },
  { id: 'sparse', label: 'Sparse', description: 'Minimum-conformant: only mandatory fields plus a few optionals.', populate_band: 'minimum-plus' },
];
const LFI_INVARIANT = 'Mandatory fields are never redacted regardless of profile (EXP-04 / §8.3).';

// Parsed-spec memo. spec.json (banking) is ~326 KB; spec.insurance.json is
// ~108 KB. Parsing is sub-millisecond on warm cache, but every `field_status`
// call would otherwise re-parse — so memo per-process. Same lifecycle as
// `_poolsCache` in the fixtures package.
const _specCache = new Map();
function getSpec(domain) {
  if (!_specCache.has(domain)) _specCache.set(domain, loadSpec({ domain }));
  return _specCache.get(domain);
}

function inferDomain(endpoint) {
  if (typeof endpoint === 'string' && endpoint.startsWith('/motor-insurance-')) return 'insurance';
  return 'banking';
}

const FIELD_DEFAULT_LIMIT = 200;
const FIELD_MAX_LIMIT = 500;

function findFields(spec, endpoint, query, limit) {
  const ep = spec?.endpoints?.[endpoint];
  if (!ep) return null;
  const fields = Array.isArray(ep.fields) ? ep.fields : [];
  if (!query) {
    const cap = Math.max(0, Math.min(FIELD_MAX_LIMIT, limit ?? FIELD_DEFAULT_LIMIT));
    return {
      schemaRef: ep.schemaRef ?? null,
      total: fields.length,
      matched: fields.length,
      returned: Math.min(fields.length, cap),
      truncated: fields.length > cap,
      fields: fields.slice(0, cap),
    };
  }
  const q = String(query).toLowerCase();
  const exactPath = fields.filter((f) => String(f.path ?? '').toLowerCase() === q);
  const exactName = fields.filter((f) => String(f.name ?? '').toLowerCase() === q && !exactPath.includes(f));
  const substr = fields.filter(
    (f) =>
      !exactPath.includes(f) &&
      !exactName.includes(f) &&
      (String(f.path ?? '').toLowerCase().includes(q) || String(f.name ?? '').toLowerCase().includes(q)),
  );
  const ranked = [...exactPath, ...exactName, ...substr];
  const cap = Math.max(0, Math.min(FIELD_MAX_LIMIT, limit ?? FIELD_DEFAULT_LIMIT));
  return {
    schemaRef: ep.schemaRef ?? null,
    total: fields.length,
    matched: ranked.length,
    returned: Math.min(ranked.length, cap),
    truncated: ranked.length > cap,
    fields: ranked.slice(0, cap),
  };
}

// Pool kinds keyed by the top-level keys of getPools(). The values are the
// "kind" labels we surface to the consumer so they can disambiguate when a
// pool id collides across kinds (none today, but the schema is open).
const POOL_KINDS = {
  names: 'namesByPoolId',
  employers: 'employersByPoolId',
  merchants: 'merchantsByCategory',
  counterparty_banks: 'counterpartyBanksByCategory',
  ibans: 'ibansByCategory',
  organisations: 'organisationsByPoolId',
  counterparties: 'counterpartiesByPoolId',
};

function summarisePools(pools) {
  const kinds = {};
  const totals = {};
  for (const [kind, key] of Object.entries(POOL_KINDS)) {
    const bucket = pools?.[key] ?? {};
    const ids = Object.keys(bucket);
    kinds[kind] = ids;
    totals[kind] = ids.length;
  }
  return { kinds, totals };
}

function findPool(pools, poolId, kindHint) {
  const kindsToTry = kindHint ? [kindHint] : Object.keys(POOL_KINDS);
  for (const kind of kindsToTry) {
    const key = POOL_KINDS[kind];
    if (!key) continue;
    const bucket = pools?.[key];
    if (bucket && Object.prototype.hasOwnProperty.call(bucket, poolId)) {
      return { kind, value: bucket[poolId] };
    }
  }
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function suggestPoolIds(target, pools) {
  const all = [];
  for (const key of Object.values(POOL_KINDS)) {
    for (const id of Object.keys(pools?.[key] ?? {})) all.push(id);
  }
  return all
    .map((id) => ({ id, d: levenshtein(target.toLowerCase(), id.toLowerCase()) }))
    .filter((x) => x.d > 0 && x.d <= 2)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.id);
}

function poolValuesPayload({ pool, kind, value, limit, search }) {
  const cap = Math.max(0, Math.min(500, limit ?? 50));
  // Pool entries are heterogeneous: names buckets are { given_names: [], surnames: [] };
  // employer/organisation buckets are { employers: [...] } / { organisations: [...] };
  // merchants/counterparty-banks/ibans/counterparties buckets are arrays directly.
  // Surface a generic shape: pick the first array-valued field, return that.
  let arr = [];
  let arrayField = null;
  if (Array.isArray(value)) {
    arr = value;
    arrayField = '(root)';
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v)) {
        arr = v;
        arrayField = k;
        break;
      }
    }
  }
  let filtered = arr;
  if (search) {
    const q = String(search).toLowerCase();
    filtered = arr.filter((entry) => JSON.stringify(entry).toLowerCase().includes(q));
  }
  const sample = filtered.slice(0, cap);
  return {
    pool,
    kind,
    arrayField,
    count: arr.length,
    matched: filtered.length,
    returned: sample.length,
    limit: cap,
    search: search ?? null,
    truncated: filtered.length > sample.length,
    sample,
    // For pools that carry sibling metadata (e.g. names buckets carry a
    // `given_names` array AND a `surnames` array), expose the full set of
    // sibling array keys so the consumer knows what else is there.
    siblings:
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value)
            .filter(([, v]) => Array.isArray(v))
            .map(([k, v]) => ({ key: k, count: v.length }))
        : null,
  };
}

export function createServer() {
  const server = new McpServer(
    { name: PKG_NAME, version: PKG_VERSION },
    { instructions: PFM_INSTRUCTIONS },
  );
  const session = createSessionStore();

  // ── Persona / session tools ────────────────────────────────────────────────

  server.registerTool(
    'list_personas',
    {
      title: 'List synthetic personas',
      description:
        'List the curated synthetic UAE personas in this sandbox: 18 banking + 3 insurance preview. Returns id, display name, archetype, default seed, domain, stress-coverage tags, and a `multi_lfi_footprint` field declaring the persona\'s plausible multi-bank reality (primary / secondary / tertiary LFI roles, each with named real-UAE bank candidates — D-14 allow-site). Pass { domain: "banking" } or { domain: "insurance" } to filter; omit to get all 21.',
      inputSchema: {
        domain: z
          .enum(['banking', 'insurance'])
          .optional()
          .describe('Optional domain filter. Omit to list every curated persona across domains.'),
      },
    },
    async ({ domain }) => {
      const ids = domain ? listPersonas({ domain }) : listPersonas();
      const rows = ids.map((id) => {
        const info = getPersonaInfo(id);
        const fp = info?.multi_lfi_footprint ?? null;
        return {
          id,
          name: info?.name ?? id,
          archetype: info?.archetype ?? null,
          domain: info?.domain ?? 'banking',
          default_seed: info?.default_seed ?? null,
          stress_coverage: info?.stress_coverage ?? [],
          // D-14: compact multi-LFI footprint so an LLM consumer can
          // discover the persona's plausible multi-bank reality without
          // a separate persona://<id> resource fetch. `multi_lfi_footprint`
          // is null for personas without a declared footprint.
          multi_lfi_footprint: fp
            ? {
                roles: ['primary', 'secondary', 'tertiary']
                  .filter((r) => fp[r])
                  .map((r) => ({
                    slot: r,
                    role: fp[r].role,
                    plausible_lfi_candidates: fp[r].plausible_lfi_candidates ?? [],
                  })),
              }
            : null,
        };
      });
      return textResult(JSON.stringify({ personas: rows, count: rows.length, domain: domain ?? 'all' }, null, 2));
    },
  );

  server.registerTool(
    'lfi_profiles',
    {
      title: 'Describe the LFI populate-rate profiles',
      description:
        'Return the three LFI populate-rate profiles (rich, median, sparse) with their semantics and the load-bearing invariant that mandatory fields are never redacted. Use this when the user asks "what does sparse mean?" or to explain what changes when the same persona is re-pinned at a different profile.',
      inputSchema: {},
    },
    async () =>
      textResult(
        JSON.stringify(
          { profiles: LFI_PROFILES, invariant: LFI_INVARIANT, default: 'median' },
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'set_session',
    {
      title: 'Pin persona + LFI profile + seed',
      description:
        'Pin the active persona, LFI profile, and seed for subsequent tool calls. lfi defaults to "median". seed defaults to the persona\'s default_seed (recommended). The same (persona, lfi, seed) is deterministic across calls and across processes.',
      inputSchema: {
        persona: z
          .string()
          .describe('Persona id from list_personas (e.g. "salaried_expat_mid").'),
        lfi: z
          .enum(['rich', 'median', 'sparse'])
          .optional()
          .describe('LFI populate-rate profile. Default: median.'),
        seed: z.number().int().optional().describe('RNG seed. Default: persona.default_seed.'),
      },
    },
    async ({ persona, lfi, seed }) => {
      const s = session.setCurated({ persona, lfi, seed });
      return textResult(
        `session set → persona:${s.persona} (${s.personaName}) lfi:${s.lfi} seed:${s.seed}`,
      );
    },
  );

  server.registerTool(
    'get_session',
    {
      title: 'Show active session',
      description:
        'Echo the currently pinned persona, LFI profile, and seed. Useful for confirming context to the user before answering a question.',
      inputSchema: {},
    },
    async () => {
      const s = session.peek();
      if (!s) return textResult('no active session — call set_session first.');
      // The `journey` field can be very large for custom personas; omit it
      // from the echoed session — Claude can call load_journey if needed.
      const { journey: _omit, ...rest } = s;
      return textResult(JSON.stringify(rest, null, 2));
    },
  );

  // ── Custom persona builder ─────────────────────────────────────────────────

  server.registerTool(
    'get_recipe_defaults',
    {
      title: 'Show custom-persona recipe defaults',
      description:
        'Return the full RECIPE_DEFAULTS object for the custom-persona builder. Each field is a knob the user can override when calling build_persona — segment (Retail/SME/Corporate), name_pool, age_band, emirate, income_band (thin/mid/affluent/hnw/gig), products, card_limit, spend_intensity, fx_activity, cash_deposit, distress (none/occasional/frequent), and (for non-Retail) organisation + cash-flow knobs. Use this before build_persona when the user asks "what can I customise?".',
      inputSchema: {},
    },
    async () => textResult(JSON.stringify(RECIPE_DEFAULTS, null, 2)),
  );

  server.registerTool(
    'build_persona',
    {
      title: 'Build a custom synthetic persona from a recipe',
      description:
        'Compose a custom UAE banking persona from a recipe (any subset of the knobs in get_recipe_defaults — missing fields fall back to defaults), generate a deterministic v2.1 bundle, and pin it as the active session. Subsequent get_party / get_accounts / get_transactions / etc. calls return the in-memory custom journey instead of a curated fixture. The persona id is "custom_<recipeHash>" — same recipe + lfi + seed always produces byte-identical output.',
      inputSchema: {
        recipe: z
          .record(z.unknown())
          .describe(
            'Recipe object. Any subset of RECIPE_DEFAULTS keys (call get_recipe_defaults to see them all). Missing keys fall back to defaults.',
          ),
        lfi: z
          .enum(['rich', 'median', 'sparse'])
          .optional()
          .describe('LFI populate-rate profile. Default: median.'),
        seed: z.number().int().optional().describe('RNG seed. Default: 1.'),
      },
    },
    async ({ recipe, lfi = 'median', seed = 1 }) => {
      const merged = { ...RECIPE_DEFAULTS, ...recipe };
      const pools = getPools();
      const validation = validateRecipe(merged, pools);
      if (!validation.ok) {
        return errorResult(
          `recipe validation failed:\n  - ${validation.errors.join('\n  - ')}`,
        );
      }
      const expanded = expandRecipe(merged, pools);
      // Anchor `now` and `retrievedAt` to the bundled fixture corpus's
      // nowAnchor so two calls with the same (recipe, lfi, seed) produce
      // byte-identical envelopes — same determinism guarantee EXP-05 gives
      // curated personas. specSha + specVersion follow the corpus.
      const nowAnchor = manifest.nowAnchor ?? '2026-04-01T00:00:00.000Z';
      const now = new Date(nowAnchor);
      const bundle = buildBundle({ persona: expanded, lfi, seed, pools, now });
      const ctx = {
        personaId: expanded.persona_id,
        lfi,
        seed,
        specVersion: manifest.specVersion ?? 'v2.1',
        specSha: manifest.specSha ?? 'unknown',
        retrievedAt: nowAnchor,
      };
      const endpoints = envelopesFromBundle(bundle, ctx);
      const accountIds = bundle.accounts.map((a) => a.AccountId);
      const customerId = endpoints['/parties']?.Data?.Party?.PartyId ?? null;
      const journey = {
        persona: expanded.persona_id,
        lfi,
        seed,
        accountIds,
        customerId,
        specVersion: ctx.specVersion,
        specSha: ctx.specSha,
        version: manifest.version ?? PKG_VERSION,
        endpoints,
      };
      const hash = recipeHash(merged);
      session.setCustom({
        persona: expanded.persona_id,
        lfi,
        seed,
        journey,
        recipe: merged,
        recipeHash: hash,
        personaName: expanded.name ?? `Custom (${hash})`,
      });
      return textResult(
        [
          `custom session set → persona:${expanded.persona_id} lfi:${lfi} seed:${seed}`,
          `recipeHash: ${hash}`,
          `accounts: ${accountIds.join(', ') || '(none)'}`,
          `customerId: ${customerId ?? '(none)'}`,
          '',
          'Now call get_accounts / get_balances / get_transactions / etc. as usual.',
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'list_pool_values',
    {
      title: 'List values from a recipe pool',
      description:
        'Enumerate values from the pools referenced by RECIPE_DEFAULTS (name_pool, employer_pool, legal_name_pool, signatory_pool, customer_inflow_pool, supplier_outflow_pool, …). Call with no `pool` arg to list every pool id grouped by kind (names, employers, organisations, counterparties, merchants, counterparty_banks, ibans). Pass a `pool` id to get its members; pools are heterogeneous so the response also lists sibling array keys (e.g. names pools carry both `given_names` and `surnames`).',
      inputSchema: {
        pool: z
          .string()
          .optional()
          .describe('Pool id (e.g. "expat_indian", "tech_freezone"). Omit to list all pool ids by kind.'),
        kind: z
          .enum([
            'names',
            'employers',
            'merchants',
            'counterparty_banks',
            'ibans',
            'organisations',
            'counterparties',
          ])
          .optional()
          .describe('Disambiguate when a pool id collides across kinds. Optional.'),
        limit: z
          .number()
          .int()
          .min(0)
          .max(500)
          .optional()
          .describe('Max sample entries returned. Default 50, max 500.'),
        search: z
          .string()
          .optional()
          .describe('Case-insensitive substring filter against the JSON-stringified pool entry.'),
      },
    },
    async ({ pool, kind, limit, search }) => {
      const pools = getPools();
      if (!pool) {
        return textResult(JSON.stringify(summarisePools(pools), null, 2));
      }
      const found = findPool(pools, pool, kind);
      if (!found) {
        const suggestions = suggestPoolIds(pool, pools);
        const hint = suggestions.length
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : ' Call list_pool_values with no arguments to see all pool ids.';
        return errorResult(`unknown pool: ${pool}.${hint}`);
      }
      return textResult(
        JSON.stringify(
          poolValuesPayload({ pool, kind: found.kind, value: found.value, limit, search }),
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    'encode_recipe',
    {
      title: 'Encode a recipe to a URL-safe blob',
      description:
        'Serialise a recipe to the URL-safe encoding used by the persona-builder web UI. Returns the encoded string, the canonical merged recipe (defaults + overrides), and the recipeHash. Pure — same input always returns the same encoded value.',
      inputSchema: {
        recipe: z
          .record(z.unknown())
          .describe('Recipe object. Any subset of RECIPE_DEFAULTS keys; missing keys fall back to defaults.'),
      },
    },
    async ({ recipe }) => {
      const merged = { ...RECIPE_DEFAULTS, ...recipe };
      return textResult(
        JSON.stringify(
          {
            encoded: encodeRecipe(recipe),
            recipeHash: recipeHash(merged),
            canonical: merged,
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    'decode_recipe',
    {
      title: 'Decode a recipe blob',
      description:
        'Decode a URL-safe recipe blob (produced by encode_recipe or shared from the persona-builder web UI) back into a canonical recipe object. Validates against the available pools and returns `valid: false` with a list of errors if the recipe references unknown pools. Empty string decodes to RECIPE_DEFAULTS. Does not auto-build the persona — call build_persona explicitly to materialise.',
      inputSchema: {
        encoded: z
          .string()
          .describe('URL-safe recipe blob (output of encode_recipe). Empty string returns RECIPE_DEFAULTS.'),
      },
    },
    async ({ encoded }) => {
      let recipe;
      try {
        recipe = decodeRecipe(encoded);
      } catch (err) {
        return errorResult(`could not decode recipe: ${err?.message ?? String(err)}`);
      }
      const pools = getPools();
      const validation = validateRecipe(recipe, pools);
      return textResult(
        JSON.stringify(
          {
            recipe,
            recipeHash: recipeHash(recipe),
            valid: validation.ok,
            errors: validation.ok ? undefined : validation.errors,
          },
          null,
          2,
        ),
      );
    },
  );

  // ── Banking endpoint wrappers ──────────────────────────────────────────────

  server.registerTool(
    'get_party',
    {
      title: 'Get customer party (profile)',
      description:
        'Return the v2.1 /parties envelope for the active banking persona — synthetic customer profile (name, DOB band, contact). Always synthetic. Errors if the active session is an insurance persona.',
      inputSchema: {},
    },
    async () => {
      const s = session.get();
      requireDomain(s, 'banking', 'get_party');
      const env = getEndpointEnvelope(s, '/parties');
      return envelope(s.persona, s.lfi, s.seed, '/parties', env);
    },
  );

  server.registerTool(
    'get_accounts',
    {
      title: 'List accounts',
      description: 'Return the v2.1 /accounts envelope for the active banking persona. Errors if the active session is an insurance persona.',
      inputSchema: {},
    },
    async () => {
      const s = session.get();
      requireDomain(s, 'banking', 'get_accounts');
      const env = getEndpointEnvelope(s, '/accounts');
      return envelope(s.persona, s.lfi, s.seed, '/accounts', env);
    },
  );

  const accountIdOptional = {
    accountId: z
      .string()
      .optional()
      .describe('Account id from get_accounts. Omit to fan out across every account in the session.'),
  };

  server.registerTool(
    'get_balances',
    {
      title: 'Get balances',
      description:
        'Return /accounts/{AccountId}/balances. If accountId is omitted, fans out across every account for the active persona and returns one envelope per account.',
      inputSchema: accountIdOptional,
    },
    async ({ accountId }) => {
      const s = session.get();
      requireDomain(s, 'banking', 'get_balances');
      const id = resolveAccountId(s, accountId);
      const results = fetchPerAccount(s, '/balances', id);
      const text = results
        .map((r) => {
          const wm = r.envelope?._watermark ?? '';
          return [
            `[/accounts/${r.accountId}/balances] persona:${s.persona} lfi:${s.lfi} seed:${s.seed}`,
            wm ? `# ${wm}` : null,
            '',
            JSON.stringify(r.envelope, null, 2),
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n---\n\n');
      return textResult(text);
    },
  );

  server.registerTool(
    'get_transactions',
    {
      title: 'Get transactions',
      description:
        'Return /accounts/{AccountId}/transactions. Server-side filters: since/until (ISO8601), minAmount/maxAmount (numeric), category (substring match against MerchantCategoryCode + TransactionInformation). Filters run after the deterministic generator — they never alter the underlying synthetic data.\n\n' +
        'High-volume personas (HNW, Corporate, SME) can hold hundreds of transactions per account; full-list responses can exceed the host MCP client\'s tool-result size cap. To stay safely under it, output is capped at `limit` (default 50, max 500) — the most recent N matching transactions are returned, in ascending BookingDateTime order, with `_filter.truncated=true` and a `_paginationHint` when truncation occurs. For aggregate analysis (top categories, monthly buckets, credit/debit totals) pass `summary=true` to skip the per-row payload entirely.',
      inputSchema: {
        ...accountIdOptional,
        since: z
          .string()
          .refine((s) => !Number.isNaN(Date.parse(s)), {
            message: 'must be ISO8601 (e.g. "2026-03-01" or "2026-03-01T12:00:00Z")',
          })
          .optional()
          .describe('Inclusive lower bound on BookingDateTime, ISO8601.'),
        until: z
          .string()
          .refine((s) => !Number.isNaN(Date.parse(s)), {
            message: 'must be ISO8601 (e.g. "2026-03-01" or "2026-03-01T12:00:00Z")',
          })
          .optional()
          .describe('Inclusive upper bound on BookingDateTime, ISO8601.'),
        minAmount: z.number().optional().describe('Minimum transaction amount.'),
        maxAmount: z.number().optional().describe('Maximum transaction amount.'),
        category: z
          .string()
          .optional()
          .describe('Substring filter against MerchantCategoryCode or TransactionInformation.'),
        limit: z
          .number()
          .int()
          .min(0)
          .max(MAX_LIMIT)
          .optional()
          .describe(
            `Max transactions per account in the response. Default ${DEFAULT_LIMIT}, hard cap ${MAX_LIMIT}. When the matching set exceeds this, the most recent N are returned (ascending order preserved) and \`_filter.truncated\` is set with a \`_paginationHint\`.`,
          ),
        summary: z
          .boolean()
          .optional()
          .describe(
            'Return aggregates (count, byDirection totals, byMonth buckets, top MerchantCategoryCode buckets) instead of individual transactions. Use this for monthly-summary / category-breakdown style questions — a single small response per account regardless of volume.',
          ),
      },
    },
    async ({ accountId, since, until, minAmount, maxAmount, category, limit, summary }) => {
      const s = session.get();
      requireDomain(s, 'banking', 'get_transactions');
      const id = resolveAccountId(s, accountId);
      const results = fetchPerAccount(s, '/transactions', id);
      const text = results
        .map((r) => {
          const filtered = filterTransactions(r.envelope, {
            since, until, minAmount, maxAmount, category, limit, summary,
          });
          const wm = filtered?._watermark ?? '';
          return [
            `[/accounts/${r.accountId}/transactions] persona:${s.persona} lfi:${s.lfi} seed:${s.seed}`,
            wm ? `# ${wm}` : null,
            '',
            JSON.stringify(filtered, null, 2),
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n---\n\n');
      return textResult(text);
    },
  );

  function makePerAccountTool(name, suffix, title, description) {
    server.registerTool(
      name,
      { title, description, inputSchema: accountIdOptional },
      async ({ accountId }) => {
        const s = session.get();
        requireDomain(s, 'banking', name);
        const id = resolveAccountId(s, accountId);
        const results = fetchPerAccount(s, suffix, id);
        const text = results
          .map((r) => {
            const wm = r.envelope?._watermark ?? '';
            return [
              `[/accounts/${r.accountId}${suffix}] persona:${s.persona} lfi:${s.lfi} seed:${s.seed}`,
              wm ? `# ${wm}` : null,
              '',
              JSON.stringify(r.envelope, null, 2),
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n---\n\n');
        return textResult(text);
      },
    );
  }

  makePerAccountTool(
    'get_standing_orders',
    '/standing-orders',
    'Get standing orders',
    'Return /accounts/{AccountId}/standing-orders — recurring outbound payments (e.g. rent).',
  );
  makePerAccountTool(
    'get_direct_debits',
    '/direct-debits',
    'Get direct-debit mandates',
    'Return /accounts/{AccountId}/direct-debits — direct-debit mandates and frequencies.',
  );
  makePerAccountTool(
    'get_scheduled_payments',
    '/scheduled-payments',
    'Get scheduled payments',
    'Return /accounts/{AccountId}/scheduled-payments — future-dated payments.',
  );
  makePerAccountTool(
    'get_beneficiaries',
    '/beneficiaries',
    'Get saved beneficiaries',
    'Return /accounts/{AccountId}/beneficiaries — saved payees.',
  );

  const accountIdRequired = {
    accountId: z.string().describe('Account id from get_accounts.'),
  };

  server.registerTool(
    'get_product',
    {
      title: 'Get product detail',
      description:
        'Return /accounts/{AccountId}/product — product detail (mortgage rate, card APR, current-account fees, etc.). accountId is required.',
      inputSchema: accountIdRequired,
    },
    async ({ accountId }) => {
      const s = session.get();
      requireDomain(s, 'banking', 'get_product');
      const id = resolveAccountId(s, accountId);
      const env = getEndpointEnvelope(s, `/accounts/${id}/product`);
      return envelope(s.persona, s.lfi, s.seed, `/accounts/${id}/product`, env);
    },
  );

  server.registerTool(
    'get_statements',
    {
      title: 'Get statements',
      description:
        'Return /accounts/{AccountId}/statements — statement summaries. accountId is required.',
      inputSchema: accountIdRequired,
    },
    async ({ accountId }) => {
      const s = session.get();
      requireDomain(s, 'banking', 'get_statements');
      const id = resolveAccountId(s, accountId);
      const env = getEndpointEnvelope(s, `/accounts/${id}/statements`);
      return envelope(s.persona, s.lfi, s.seed, `/accounts/${id}/statements`, env);
    },
  );

  // ── Insurance endpoint wrappers (Phase 2.0 motor full-coverage) ───────────

  server.registerTool(
    'get_motor_policies',
    {
      title: 'List motor insurance policies',
      description:
        'Return the v2.1-errata1 /motor-insurance-policies envelope (list of policy summaries) for the active insurance persona. Errors if the active session is a banking persona.',
      inputSchema: {},
    },
    async () => {
      const s = session.get();
      requireDomain(s, 'insurance', 'get_motor_policies');
      const env = getEndpointEnvelope(s, '/motor-insurance-policies');
      return envelope(s.persona, s.lfi, s.seed, '/motor-insurance-policies', env);
    },
  );

  const policyIdOptional = {
    policyId: z
      .string()
      .optional()
      .describe(
        'Insurance policy id from get_motor_policies. Omit to use the persona\'s only policy (Phase 2.0 personas have exactly one).',
      ),
  };

  server.registerTool(
    'get_motor_policy',
    {
      title: 'Get motor insurance policy detail',
      description:
        'Return the v2.1-errata1 /motor-insurance-policies/{InsurancePolicyId} envelope — the full policy detail (PolicyHolder, Identity, Product, Claims, Premium). Errors if the active session is a banking persona.',
      inputSchema: policyIdOptional,
    },
    async ({ policyId }) => {
      const s = session.get();
      requireDomain(s, 'insurance', 'get_motor_policy');
      const id = resolvePolicyId(s, policyId);
      if (!id) throw new Error('no motor policy in this session');
      const env = getEndpointEnvelope(s, `/motor-insurance-policies/${id}`);
      return envelope(s.persona, s.lfi, s.seed, `/motor-insurance-policies/${id}`, env);
    },
  );

  server.registerTool(
    'get_motor_payment_details',
    {
      title: 'Get motor insurance payment details',
      description:
        'Return the v2.1-errata1 /motor-insurance-policies/{InsurancePolicyId}/payment-details envelope — IBAN-keyed payment account + bank for the policy\'s premium-payment instruction. Errors if the active session is a banking persona.',
      inputSchema: policyIdOptional,
    },
    async ({ policyId }) => {
      const s = session.get();
      requireDomain(s, 'insurance', 'get_motor_payment_details');
      const id = resolvePolicyId(s, policyId);
      if (!id) throw new Error('no motor policy in this session');
      const env = getEndpointEnvelope(s, `/motor-insurance-policies/${id}/payment-details`);
      return envelope(s.persona, s.lfi, s.seed, `/motor-insurance-policies/${id}/payment-details`, env);
    },
  );

  server.registerTool(
    'get_motor_quote',
    {
      title: 'Get motor insurance quote',
      description:
        'Return the v2.1-errata1 /motor-insurance-quotes/{QuoteId} envelope — the quote-read response (QuoteStatus=PolicyIssued for personas who already have an issued policy), with ServiceRating, Premium, and PolicyIssuanceAllowed sub-objects. Errors if the active session is a banking persona.',
      inputSchema: {
        quoteId: z
          .string()
          .optional()
          .describe('Quote id; omit to use the persona\'s only quote.'),
      },
    },
    async ({ quoteId }) => {
      const s = session.get();
      requireDomain(s, 'insurance', 'get_motor_quote');
      const id = resolveQuoteId(s, quoteId);
      if (!id) throw new Error('no motor quote in this session');
      const env = getEndpointEnvelope(s, `/motor-insurance-quotes/${id}`);
      return envelope(s.persona, s.lfi, s.seed, `/motor-insurance-quotes/${id}`, env);
    },
  );

  server.registerTool(
    'load_journey',
    {
      title: 'Load full journey',
      description:
        'Return every in-scope endpoint for the active persona in one call. For a banking session: /parties + /accounts + per-account balances/transactions/standing-orders/direct-debits/beneficiaries/scheduled-payments/product/statements/parties. For an insurance session: /motor-insurance-policies + /motor-insurance-policies/{id} + /motor-insurance-policies/{id}/payment-details + /motor-insurance-quotes/{id}. Verbose — prefer the granular tools when answering targeted questions.',
      inputSchema: {},
    },
    async () => {
      const s = session.get();
      const j =
        s.kind === 'custom'
          ? s.journey
          : loadJourney({ persona: s.persona, lfi: s.lfi, seed: s.seed });
      return textResult(JSON.stringify(j, null, 2));
    },
  );

  server.registerTool(
    'list_endpoints',
    {
      title: 'List endpoints available to the active session',
      description:
        'Return the v2.1 endpoint paths exposed by the active persona+LFI fixture. Banking sessions: /parties, /accounts, and per-account paths. Insurance sessions: the motor-line GETs. Cheap — prefer this over `load_journey` when you only need to know which endpoints exist for the current persona.',
      inputSchema: {},
    },
    async () => {
      const s = session.get();
      const endpoints =
        s.kind === 'custom'
          ? Object.keys(s.journey?.endpoints ?? {})
          : listEndpoints(s.persona, s.lfi);
      return textResult(
        JSON.stringify(
          {
            persona: s.persona,
            lfi: s.lfi,
            seed: s.seed,
            domain: s.domain ?? 'banking',
            count: endpoints.length,
            endpoints,
            specVersion: manifest.specVersion,
            specSha: manifest.specSha,
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    'field_status',
    {
      title: 'Look up field status from the parsed OpenAPI spec',
      description:
        'Answer "is <field> mandatory/optional/conditional on <endpoint>?" without downloading the full spec://… resource. Reads from the parsed OpenAPI table that ships with the fixture corpus (pinned by SHA), with `oneOf` / `allOf` already flattened. Pass `endpoint` (e.g. "/accounts" or "/motor-insurance-policies/{InsurancePolicyId}") and an optional `field` (case-insensitive — exact path / name match first, then substring). Domain auto-detected from endpoint prefix; pass `domain` to override.',
      inputSchema: {
        endpoint: z
          .string()
          .describe(
            'Endpoint path as it appears in the v2.1 spec (e.g. "/accounts/{AccountId}/balances", "/motor-insurance-policies").',
          ),
        field: z
          .string()
          .optional()
          .describe(
            'Field name or dotted path to filter on (e.g. "Currency" or "Data.Account[].Currency"). Omit to return every field on the endpoint.',
          ),
        domain: z
          .enum(['banking', 'insurance'])
          .optional()
          .describe('Optional domain override. Auto-detected from endpoint prefix when omitted.'),
        limit: z
          .number()
          .int()
          .min(0)
          .max(FIELD_MAX_LIMIT)
          .optional()
          .describe(`Max fields returned. Default ${FIELD_DEFAULT_LIMIT}, hard cap ${FIELD_MAX_LIMIT}.`),
      },
    },
    async ({ endpoint, field, domain, limit }) => {
      const dom = domain ?? inferDomain(endpoint);
      const spec = getSpec(dom);
      const found = findFields(spec, endpoint, field, limit);
      if (!found) {
        const known = Object.keys(spec?.endpoints ?? {});
        return errorResult(
          `unknown ${dom} endpoint: ${endpoint}. Known endpoints: ${known.join(', ') || '(none)'}`,
        );
      }
      const payload = {
        endpoint,
        domain: dom,
        specVersion: manifest.specVersion,
        specSha: manifest.specSha,
        schemaRef: found.schemaRef,
        ...(field ? { query: field } : {}),
        total: found.total,
        matched: found.matched,
        returned: found.returned,
        truncated: found.truncated,
        fields: found.fields,
      };
      if (found.truncated) {
        payload._paginationHint = `Returned ${found.returned} of ${found.matched} fields. Re-call with field="<substring>" to narrow, or limit=${FIELD_MAX_LIMIT} to retrieve more.`;
      }
      return textResult(JSON.stringify(payload, null, 2));
    },
  );

  // ── Resources ──────────────────────────────────────────────────────────────

  server.registerResource(
    'spec-banking',
    'spec://uae-account-information-v2.1',
    {
      title: 'UAE Open Finance Bank Data Sharing v2.1 (parsed)',
      description:
        'Parsed OpenAPI spec from the pinned upstream commit. Use to ground field-level answers ("is Currency mandatory on Balance?") in the spec rather than guessing.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const spec = loadSpec();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(spec),
          },
        ],
      };
    },
  );

  server.registerResource(
    'spec-insurance',
    'spec://uae-insurance-v2.1',
    {
      title: 'UAE Open Finance Insurance Data Sharing v2.1-errata1 (parsed, motor)',
      description:
        'Parsed insurance OpenAPI spec from the pinned upstream commit, scoped to the four motor-line GET endpoints (policies list, policy detail, payment-details, read-quote). Use to ground field-level answers about the insurance domain ("is Takaful mandatory on a motor policy?").',
      mimeType: 'application/json',
    },
    async (uri) => {
      const spec = loadSpec({ domain: 'insurance' });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(spec),
          },
        ],
      };
    },
  );

  server.registerResource(
    'recipe-schema',
    'recipe://schema',
    {
      title: 'Custom-persona recipe defaults + knob schema',
      description:
        'The full RECIPE_DEFAULTS object — every knob the build_persona tool accepts, with default values. Use this as a reference when composing a recipe from natural-language input.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(RECIPE_DEFAULTS, null, 2),
        },
      ],
    }),
  );

  for (const id of listPersonas()) {
    const info = getPersonaInfo(id);
    server.registerResource(
      `persona-${id}`,
      `persona://${id}`,
      {
        title: info?.name ?? id,
        description: `Persona manifest for ${id}. Includes demographics, income, accounts, fixed commitments, spend profile, and narrative — all synthetic.`,
        mimeType: 'application/json',
      },
      async (uri) => {
        const data = loadPersonaManifest(id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      },
    );
  }

  registerPrompts(server);

  return server;
}
