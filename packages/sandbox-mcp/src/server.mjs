import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  loadJourney,
  loadPersonaManifest,
  loadSpec,
  listPersonas,
  getPersonaInfo,
  buildBundle,
  expandRecipe,
  getPools,
  envelopesFromBundle,
  RECIPE_DEFAULTS,
  recipeHash,
  validateRecipe,
  manifest,
} from '@openfinance-os/sandbox-fixtures';
import { z } from 'zod';
import { createSessionStore, getEndpointEnvelope, fanOutAccountIds } from './session.mjs';
import { registerPrompts } from './prompts.mjs';

const PKG_NAME = '@openfinance-os/sandbox-mcp';
const PKG_VERSION = '0.0.1';

const PFM_INSTRUCTIONS = [
  'You are wired to a sandbox of synthetic UAE Open Finance v2.1 Bank Data Sharing payloads.',
  'All data is fictional — no real customer, no real institution. Every response carries a `_watermark`',
  'field; preserve it in any user-visible summary, table, or export.',
  '',
  'Workflow — curated persona (recommended for first use):',
  '  1. Call `list_personas` and ask the user to pick one (or accept a persona id directly).',
  '  2. Call `set_session` with { persona, lfi?, seed? }. lfi defaults to median; seed defaults to the',
  '     persona\'s default_seed. The same (persona, lfi, seed) always returns byte-identical data.',
  '  3. Use `get_party`, `get_accounts`, `get_balances`, `get_transactions`, etc. for granular data.',
  '     Use `load_journey` only when the user wants a single dump of everything.',
  '',
  'Workflow — custom persona (when the user describes someone not in the curated list):',
  '  1. Call `get_recipe_defaults` (or read the `recipe://schema` resource) to see the available knobs.',
  '  2. Translate the user\'s description into a recipe object (any subset of those knobs — missing keys',
  '     fall back to defaults). Call `build_persona` with { recipe, lfi?, seed? }.',
  '  3. The same get_* tools then return the in-memory custom journey.',
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
        'List the 12 curated synthetic UAE banking personas available in this sandbox. Returns id, display name, archetype, default seed, and stress-coverage tags. Insurance personas are excluded from v1.',
      inputSchema: {},
    },
    async () => {
      const ids = listPersonas();
      const rows = ids.map((id) => {
        const info = getPersonaInfo(id);
        return {
          id,
          name: info?.name ?? id,
          archetype: info?.archetype ?? null,
          default_seed: info?.default_seed ?? null,
          stress_coverage: info?.stress_coverage ?? [],
        };
      });
      return textResult(JSON.stringify({ personas: rows, count: rows.length }, null, 2));
    },
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

  // ── Banking endpoint wrappers ──────────────────────────────────────────────

  server.registerTool(
    'get_party',
    {
      title: 'Get customer party (profile)',
      description:
        'Return the v2.1 /parties envelope for the active persona — synthetic customer profile (name, DOB band, contact). Always synthetic.',
      inputSchema: {},
    },
    async () => {
      const s = session.get();
      const env = getEndpointEnvelope(s, '/parties');
      return envelope(s.persona, s.lfi, s.seed, '/parties', env);
    },
  );

  server.registerTool(
    'get_accounts',
    {
      title: 'List accounts',
      description: 'Return the v2.1 /accounts envelope for the active persona.',
      inputSchema: {},
    },
    async () => {
      const s = session.get();
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
      const id = resolveAccountId(s, accountId);
      const env = getEndpointEnvelope(s, `/accounts/${id}/statements`);
      return envelope(s.persona, s.lfi, s.seed, `/accounts/${id}/statements`, env);
    },
  );

  server.registerTool(
    'load_journey',
    {
      title: 'Load full journey',
      description:
        'Return every endpoint for the active persona in one call (parties + accounts + per-account balances/transactions/standing-orders/direct-debits/beneficiaries/scheduled-payments/product/parties/statements). Verbose — prefer the granular tools when answering targeted questions.',
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

  // ── Resources ──────────────────────────────────────────────────────────────

  server.registerResource(
    'spec',
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
