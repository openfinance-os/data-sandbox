# @openfinance-os/sandbox-mcp

MCP server that exposes the [Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox) — synthetic UAE Open Finance v2.1 Bank Data Sharing payloads — as MCP tools, resources, and prompts.

The intended use: run Claude as a **dynamic PFM** against a synthetic customer. Pick one of 12 curated personas (salaried expat, gig worker, mortgage holder, SME owner, …) and let Claude answer balance, spend, and obligation questions over deterministic v2.1-shaped JSON.

> **All data is synthetic.** No real customer, no real institution. Every tool response carries a `_watermark` field such as `SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:salaried_expat_mid lfi:median seed:4729 retrieved:2026-04-01T00:00:00.000Z`. Preserve this watermark in any export or summary.

## Scope

- **Two domains** — Bank Data Sharing v2.1 (all 12 Account-Information endpoints) and an Insurance Data Sharing preview (motor v2.1-errata1: policies list, policy detail, payment-details, read-quote).
- **15 curated personas (12 banking + 3 motor-insurance) + a custom-persona builder** — pick from the curated list with `set_session`, or compose a recipe and call `build_persona` to generate a fresh deterministic persona at runtime.
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
| `list_personas` | List the 15 synthetic personas (12 banking + 3 motor-insurance) with id, name, archetype, default seed, domain, and stress-coverage tags. Pass `{ domain: 'banking' \| 'insurance' }` to filter. |
| `lfi_profiles` | Describe the three LFI populate-rate profiles (rich/median/sparse) and the EXP-04 invariant that mandatory fields are never redacted. |
| `set_session` | Pin a curated persona via `{ persona, lfi?, seed? }`. `lfi` defaults to `median`; `seed` defaults to `persona.default_seed`. |
| `get_session` | Echo the active persona / lfi / seed (and recipe hash for custom personas). |

### Custom personas (in-memory)

| Tool | Purpose |
|---|---|
| `get_recipe_defaults` | Return the full `RECIPE_DEFAULTS` object — every knob the builder accepts, with default values. |
| `build_persona` | Build a custom persona from a recipe, generate a v2.1 bundle in-memory, and pin it as the active session. The same `(recipe, lfi, seed)` always produces a byte-identical bundle; persona id is `custom_<recipeHash>`. |
| `list_pool_values` | Enumerate values from any pool referenced by `RECIPE_DEFAULTS` (`name_pool`, `employer_pool`, `legal_name_pool`, `signatory_pool`, `customer_inflow_pool`, `supplier_outflow_pool`). Call with no args for an index of every pool id by kind, or pass a `pool` to inspect its members. Unknown pool ids get a "did you mean" suggestion. |
| `encode_recipe` | Serialise a recipe to the URL-safe blob used by the persona-builder web UI. Returns `{ encoded, recipeHash, canonical }`. Pure — same input always returns the same encoded value. |
| `decode_recipe` | Decode an encoded recipe blob back into a canonical recipe object and validate it against the available pools. Returns `{ recipe, recipeHash, valid, errors? }`. |

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

### Insurance endpoints (motor v2.1-errata1, Phase 2.0 preview)

| Tool | Purpose |
|---|---|
| `get_motor_policies` | `/motor-insurance-policies` envelope — list of policy summaries for the active insurance persona. |
| `get_motor_policy` | `/motor-insurance-policies/{InsurancePolicyId}` — full policy detail (PolicyHolder, Identity, Product, Claims, Premium). Omit `policyId` to use the persona's only policy. |
| `get_motor_payment_details` | `/motor-insurance-policies/{InsurancePolicyId}/payment-details` — IBAN-keyed payment account for the premium-payment instruction. |
| `get_motor_quote` | `/motor-insurance-quotes/{QuoteId}` — quote-read response with `ServiceRating`, `Premium`, `PolicyIssuanceAllowed`. |

### Discovery & spec metadata

| Tool | Purpose |
|---|---|
| `list_endpoints` | List the v2.1 endpoint paths exposed by the active persona+LFI fixture, plus pinned `specVersion` / `specSha`. Cheaper than `load_journey` when you only need to know what endpoints exist. |
| `field_status` | Look up `mandatory` / `optional` / `conditional` status (and type / format / enum / description) for fields on a given endpoint, without downloading the full `spec://…` resource. Domain auto-detected from the endpoint prefix. Pre-flattened — `oneOf` / `allOf` already resolved. |

## Resources

- `spec://uae-account-information-v2.1` — parsed banking v2.1 OpenAPI (pinned by SHA upstream).
- `spec://uae-insurance-v2.1` — parsed insurance v2.1-errata1 OpenAPI (motor-line GETs).
- `recipe://schema` — full `RECIPE_DEFAULTS` object documenting every knob `build_persona` accepts.
- `persona://<id>` — manifest for each curated persona (demographics, income, accounts, commitments, narrative).

## Prompts

- `pick-a-persona` — guided persona-selection flow.
- `monthly-summary` — month-end PFM summary that chains `get_accounts → get_balances → get_transactions → get_standing_orders → get_direct_debits` and preserves the watermark.

## Example transcripts

### Banking PFM (curated persona)

```text
> set_session { persona: "salaried_expat_mid" }
session set → persona:salaried_expat_mid (Salaried Expat — Mid) lfi:median seed:4729

> get_balances {}
[/accounts/salaried-expat-mid-acct-01/balances] persona:salaried_expat_mid lfi:median seed:4729
# SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:salaried_expat_mid lfi:median seed:4729 retrieved:2026-04-01T00:00:00.000Z
{ "Data": { "Balance": [ { "Type": "InterimAvailable", "Amount": { "Amount": "12450.32", "Currency": "AED" }, ... } ] }, ... }

> get_transactions { summary: true }
{ "_summary": { "count": 312, "byDirection": { "Credit": { "count": 6, "total": 78000 }, "Debit": { "count": 306, "total": -64218.55 } },
  "byMonth": [ { "month": "2026-01", "credit": 26000, "debit": -21115.40, "count": 104 }, ... ],
  "topCategories": [ { "MerchantCategoryCode": "5411", "count": 38, "total": -4820.10 }, ... ] },
  "_watermark": "SYNTHETIC — Open Finance Data Sandbox · …" }
```

### Insurance read-quote (motor preview)

```text
> list_personas { domain: "insurance" }
{ "personas": [{ "id": "motor_comprehensive_mid", ... }, ...], "count": 3 }

> set_session { persona: "motor_comprehensive_mid" }
session set → persona:motor_comprehensive_mid (Motor Comprehensive — Mid) lfi:median seed:8112

> get_motor_quote {}
[/motor-insurance-quotes/Q-0001] persona:motor_comprehensive_mid lfi:median seed:8112
# SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:motor_comprehensive_mid lfi:median seed:8112 retrieved:2026-04-01T00:00:00.000Z
{ "Data": { "QuoteStatus": "PolicyIssued",
            "Premium": { "Amount": { "Amount": "2480.00", "Currency": "AED" } },
            "ServiceRating": { ... }, "PolicyIssuanceAllowed": { ... } }, ... }
```

## LFI profiles

Mirror how richly a Licensed Financial Institution populates optional fields:

- `rich` — every optional field populated.
- `median` — typical UAE-market populate rate (default).
- `sparse` — minimum-conformant: mandatory fields plus a few optionals.

Mandatory fields are never redacted by profile. The `lfi_profiles` tool exposes this same table at runtime.

## Determinism

`(persona, lfi, seed) → bundle` is a pure function. Two MCP sessions with the same triple return byte-identical JSON. Bumping the bundled `@openfinance-os/sandbox-fixtures` version is the only way the data changes.

## License

MIT (loader code) · CC0 (synthetic data corpus, inherited from `@openfinance-os/sandbox-fixtures`).
