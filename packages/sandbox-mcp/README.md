# @openfinance-os/sandbox-mcp

MCP server that exposes the [Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox) — synthetic UAE Open Finance v2.1 Bank Data Sharing payloads — as MCP tools, resources, and prompts.

The intended use: run Claude as a **dynamic PFM** against a synthetic customer. Pick one of 12 curated personas (salaried expat, gig worker, mortgage holder, SME owner, …) and let Claude answer balance, spend, and obligation questions over deterministic v2.1-shaped JSON.

> **All data is synthetic.** No real customer, no real institution. Every tool response carries a `_watermark` field such as `SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:salaried_expat_mid lfi:median seed:4729 retrieved:2026-04-01T00:00:00.000Z`. Preserve this watermark in any export or summary.

## Scope

- **Banking only** — Bank Data Sharing v2.1, all 12 Account-Information endpoints. Insurance defers to a later release.
- **12 curated personas + a custom-persona builder** — pick from the curated list with `set_session`, or compose a recipe and call `build_persona` to generate a fresh deterministic persona at runtime.
- **Read-only** — no writes, no Service Initiation.
- **Anonymous** — no auth, no API keys, no OAuth. The data is synthetic so there is nothing real to protect.
- **Two transports** — stdio (default, for `npx` / Claude Desktop / Claude Code) and Streamable HTTP (for the Claude marketplace listing and any browser-side client). PRD decision D-13.

## Install

```sh
npx -y @openfinance-os/sandbox-mcp --help
```

### Claude connector (hosted HTTP)

Published endpoint: **`https://data-sandbox.fly.dev/mcp`** (live; canonical CNAME `https://mcp.openfinance-os.org/mcp` lands during the OF-OS Commons cutover per PRD D-13). Anonymous, no auth, no API key.

Add it as a custom connector in **Claude.ai → Settings → Connectors → Add custom connector** (paste the URL). In Claude Code:

```sh
claude mcp add --transport http open-finance-sandbox https://data-sandbox.fly.dev/mcp
```

To run your own HTTP instance:

```sh
npx -y @openfinance-os/sandbox-mcp --transport http --port 8787 --host 0.0.0.0 \
  --allowed-host mcp.example.org
# → sandbox-mcp 0.0.1 listening on http://0.0.0.0:8787/mcp
#   allowed Host headers: 127.0.0.1:8787, localhost:8787, [::1]:8787, mcp.example.org
#   DNS rebinding protection: on
```

`MCP_ALLOWED_HOSTS=a.example,b.example` is equivalent to repeated `--allowed-host` flags and is the preferred config channel for container deployments (the bundled `fly.toml` uses it).

Health check:

```sh
curl http://127.0.0.1:8787/health
# → {"ok":true,"sessions":0}
```

The endpoint is the [Streamable HTTP](https://spec.modelcontextprotocol.io/specification/basic/transports/#streamable-http) transport at `/mcp`. CORS is permissive (`*`); `Mcp-Session-Id` round-trips. One process serves many concurrent MCP sessions with per-session state isolation.

### Production hardening

- **DNS-rebinding protection** is on by default — Host header is validated against `localhost`, `127.0.0.1`, the bound address (all `:port`), plus anything passed via `--allowed-host` (repeatable) or the `MCP_ALLOWED_HOSTS` env var (comma-separated). Pass `--no-dns-rebinding-protection` to disable.
- **Idle session TTL** (default 30 min) and **max session count** (default 1024) cap memory growth on a public anonymous endpoint. Tunable via `MCP_SESSION_IDLE_TTL_MS` and `MCP_MAX_SESSIONS` env vars.
- **Graceful shutdown** — SIGTERM / SIGINT closes every active MCP session before the process exits, so `docker stop` and Kubernetes pod evictions don't drop in-flight requests.
- **Structured request logging** — every request emits `<ISO timestamp> METHOD /path STATUS Nms session=<id8>` to stderr (stdout is reserved for stdio MCP framing).

### Claude Desktop (stdio)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "open-finance-sandbox": {
      "command": "npx",
      "args": ["-y", "@openfinance-os/sandbox-mcp"]
    }
  }
}
```

Restart Claude Desktop, then run the bundled `pick-a-persona` prompt.

### Claude Code (stdio)

```sh
claude mcp add open-finance-sandbox -- npx -y @openfinance-os/sandbox-mcp
```

## Tools

### Session

| Tool | Purpose |
|---|---|
| `list_personas` | List the 12 synthetic banking personas (id, name, archetype, default seed). |
| `set_session` | Pin a curated persona via `{ persona, lfi?, seed? }`. `lfi` defaults to `median`; `seed` defaults to `persona.default_seed`. |
| `get_session` | Echo the active persona / lfi / seed (and recipe hash for custom personas). |

### Custom personas (in-memory)

| Tool | Purpose |
|---|---|
| `get_recipe_defaults` | Return the full `RECIPE_DEFAULTS` object — every knob the builder accepts, with default values. |
| `build_persona` | Build a custom persona from a recipe, generate a v2.1 bundle in-memory, and pin it as the active session. The same `(recipe, lfi, seed)` always produces a byte-identical bundle; persona id is `custom_<recipeHash>`. |

### Banking endpoints (v2.1, work for both curated and custom sessions)

| Tool | Purpose |
|---|---|
| `get_party` | v2.1 `/parties` envelope (synthetic customer profile). |
| `get_accounts` | v2.1 `/accounts` envelope. |
| `get_balances` | `/accounts/{AccountId}/balances` — fans out across every account when `accountId` is omitted. |
| `get_transactions` | `/accounts/{AccountId}/transactions` with optional `since`, `until`, `minAmount`, `maxAmount`, `category` filters and `limit` (default 50, max 500) / `summary` (aggregate-only) controls. Filters run *after* the deterministic generator. The default `limit` keeps the response under the host MCP client's tool-result size cap on high-volume personas (HNW, Corporate, SME); `summary: true` returns `count` + `byDirection` + `byMonth` + `topCategories` at envelope-root `_summary` (the spec defines `Data` with `additionalProperties: false`, so aggregates ride alongside `_filter` / `_watermark` and `Data.Transaction` stays as an empty array). When truncation kicks in the response carries `_filter.truncated=true` and a `_paginationHint` describing how to walk backwards in time. |
| `get_standing_orders` | `/accounts/{AccountId}/standing-orders` (recurring outbound payments). |
| `get_direct_debits` | `/accounts/{AccountId}/direct-debits` (mandates and frequencies). |
| `get_scheduled_payments` | `/accounts/{AccountId}/scheduled-payments` (future-dated). |
| `get_beneficiaries` | `/accounts/{AccountId}/beneficiaries`. |
| `get_product` | `/accounts/{AccountId}/product` (mortgage rate, card APR, …). `accountId` required. |
| `get_statements` | `/accounts/{AccountId}/statements`. `accountId` required. |
| `load_journey` | Every endpoint in one call. Verbose — prefer the granular tools. |

## Resources

- `spec://uae-account-information-v2.1` — parsed v2.1 OpenAPI (pinned by SHA upstream).
- `recipe://schema` — full `RECIPE_DEFAULTS` object documenting every knob `build_persona` accepts.
- `persona://<id>` — manifest for each curated persona (demographics, income, accounts, commitments, narrative).

## Prompts

- `pick-a-persona` — guided persona-selection flow.
- `monthly-summary` — month-end PFM summary that chains `get_accounts → get_balances → get_transactions → get_standing_orders → get_direct_debits` and preserves the watermark.

## LFI profiles

Mirror how richly a Licensed Financial Institution populates optional fields:

- `rich` — every optional field populated.
- `median` — typical UAE-market populate rate (default).
- `sparse` — minimum-conformant: mandatory fields plus a few optionals.

Mandatory fields are never redacted by profile.

## Determinism

`(persona, lfi, seed) → bundle` is a pure function. Two MCP sessions with the same triple return byte-identical JSON. Bumping the bundled `@openfinance-os/sandbox-fixtures` version is the only way the data changes.

## License

MIT (loader code) · CC0 (synthetic data corpus, inherited from `@openfinance-os/sandbox-fixtures`).
