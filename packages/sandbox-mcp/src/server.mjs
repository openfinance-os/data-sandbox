import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  loadFixture,
  loadJourney,
  loadPersonaManifest,
  loadSpec,
  listPersonas,
  getPersonaInfo,
  manifest,
} from '@openfinance-os/sandbox-fixtures';
import { z } from 'zod';
import { getSession, setSession, peekSession } from './session.mjs';
import { registerPrompts } from './prompts.mjs';

const PKG_NAME = '@openfinance-os/sandbox-mcp';
const PKG_VERSION = '0.0.1';

const PFM_INSTRUCTIONS = [
  'You are wired to a sandbox of synthetic UAE Open Finance v2.1 Bank Data Sharing payloads.',
  'All data is fictional — no real customer, no real institution. Every response carries a `_watermark`',
  'field; preserve it in any user-visible summary, table, or export.',
  '',
  'Workflow:',
  '  1. Call `list_personas` and ask the user to pick one (or accept a persona id directly).',
  '  2. Call `set_session` with { persona, lfi?, seed? }. lfi defaults to median; seed defaults to the',
  '     persona\'s default_seed. The same (persona, lfi, seed) always returns byte-identical data.',
  '  3. Use `get_party`, `get_accounts`, `get_balances`, `get_transactions`, etc. for granular data.',
  '     Use `load_journey` only when the user wants a single dump of everything.',
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
  const fxKey = `${session.persona}|${session.lfi}|${session.seed}`;
  const fx = manifest.fixtures[fxKey];
  const ids = fx?.accountIds ?? [];
  if (!ids.includes(requested)) {
    throw new Error(
      `unknown accountId: ${requested}. Available for this session: ${ids.join(', ') || '(none)'}`,
    );
  }
  return requested;
}

function fanOutAccountIds(session) {
  const fxKey = `${session.persona}|${session.lfi}|${session.seed}`;
  const fx = manifest.fixtures[fxKey];
  return fx?.accountIds ?? [];
}

function fetchPerAccount(session, suffix, accountId) {
  const ids = accountId ? [accountId] : fanOutAccountIds(session);
  return ids.map((id) => ({
    accountId: id,
    envelope: loadFixture({
      persona: session.persona,
      lfi: session.lfi,
      seed: session.seed,
      endpoint: `/accounts/${id}${suffix}`,
    }),
  }));
}

function filterTransactions(envelopeJson, { since, until, minAmount, maxAmount, category }) {
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
  return {
    ...envelopeJson,
    Data: { ...envelopeJson.Data, Transaction: filtered },
    _filter: { since, until, minAmount, maxAmount, category, kept: filtered.length, total: txs.length },
  };
}

export function createServer() {
  const server = new McpServer(
    { name: PKG_NAME, version: PKG_VERSION },
    { instructions: PFM_INSTRUCTIONS },
  );

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
      const s = setSession({ persona, lfi, seed });
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
      const s = peekSession();
      if (!s) return textResult('no active session — call set_session first.');
      return textResult(JSON.stringify(s, null, 2));
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
      const s = getSession();
      const env = loadFixture({ persona: s.persona, lfi: s.lfi, seed: s.seed, endpoint: '/parties' });
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
      const s = getSession();
      const env = loadFixture({ persona: s.persona, lfi: s.lfi, seed: s.seed, endpoint: '/accounts' });
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
      const s = getSession();
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
        'Return /accounts/{AccountId}/transactions. Optional server-side filters: since/until (ISO8601 dates), minAmount/maxAmount (numeric), category (substring match against MerchantCategoryCode + TransactionInformation). Filters run after the deterministic generator — they never alter the underlying synthetic data.',
      inputSchema: {
        ...accountIdOptional,
        since: z.string().optional().describe('Inclusive lower bound on BookingDateTime, ISO8601.'),
        until: z.string().optional().describe('Inclusive upper bound on BookingDateTime, ISO8601.'),
        minAmount: z.number().optional().describe('Minimum transaction amount.'),
        maxAmount: z.number().optional().describe('Maximum transaction amount.'),
        category: z
          .string()
          .optional()
          .describe('Substring filter against MerchantCategoryCode or TransactionInformation.'),
      },
    },
    async ({ accountId, since, until, minAmount, maxAmount, category }) => {
      const s = getSession();
      const id = resolveAccountId(s, accountId);
      const results = fetchPerAccount(s, '/transactions', id);
      const text = results
        .map((r) => {
          const filtered = filterTransactions(r.envelope, { since, until, minAmount, maxAmount, category });
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
        const s = getSession();
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
      const s = getSession();
      const id = resolveAccountId(s, accountId);
      const env = loadFixture({
        persona: s.persona,
        lfi: s.lfi,
        seed: s.seed,
        endpoint: `/accounts/${id}/product`,
      });
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
      const s = getSession();
      const id = resolveAccountId(s, accountId);
      const env = loadFixture({
        persona: s.persona,
        lfi: s.lfi,
        seed: s.seed,
        endpoint: `/accounts/${id}/statements`,
      });
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
      const s = getSession();
      const j = loadJourney({ persona: s.persona, lfi: s.lfi, seed: s.seed });
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
