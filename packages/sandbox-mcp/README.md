# @openfinance-os/sandbox-mcp

MCP server that exposes the [Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox) — synthetic UAE Open Finance v2.1 payloads across three domains (Bank Data Sharing, Insurance Data Sharing, and the ATM Locator) — as MCP tools, resources, and prompts.

The intended use: run Claude as a **dynamic PFM** against a synthetic customer. Pick one of 39 curated personas (21 banking-only + 9 insurance-only + 8 multi-domain + the `atm_directory` infrastructure persona — salaried expat, gig worker, mortgage holder, SME owner, motor / home / health / life / travel / renters / employment-insured, plus the flagship `retail_multi_banker` whose footprint spans four LFIs and three insurers) and let Claude answer balance, spend, obligation, and coverage questions over deterministic v2.1-shaped JSON.

> **All data is synthetic.** No real customer, no real institution. Every tool response carries a `_watermark` field such as `SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:salaried_expat_mid lfi:median seed:4729 retrieved:2026-04-01T00:00:00.000Z`. Preserve this watermark in any export or summary.

## Scope

- **Three domains** — Bank Data Sharing v2.1 (all 12 Account-Information endpoints), Insurance Data Sharing v2.1 GA (7 lines: motor, home, health, life, travel, renters, employment — each with the 4-endpoint MVP + cross-line Consents = 30 endpoints), and the ATM Locator (`/atms` public directory via `get_atms`).
- **39 curated personas (21 banking-only + 9 insurance-only + 8 multi-domain + 1 ATM directory) + a custom-persona builder** — pick from the curated list with `set_session`, or compose a recipe and call `build_persona` to generate a fresh deterministic persona at runtime. Multi-domain personas appear in both `domain: "banking"` and `domain: "insurance"` filters.
- **Read-only** — no writes, no Service Initiation.
- **Anonymous by default** — no auth, no API keys, no OAuth. The data is synthetic so there is nothing real to protect. PRD D-13.
- **Opt-in OAuth journey simulation** — `--simulate-oauth` / `MCP_SIMULATE_OAUTH=1` wires a bank-own OAuth 2.1 + PKCE consent screen, RFC 9728 + RFC 8414 metadata, a PKCE-validated `/authorize` + `/token` pair, and a stub RFC 7591 `/register` (Dynamic Client Registration) endpoint in front of `/mcp`, so a consumer-facing AI assistant can walk the share-with-Claude journey end-to-end. Off by default — the production deploy stays anonymous. See [`CLAUDE_PERSONAL_BANKING.md`](../../CLAUDE_PERSONAL_BANKING.md) at the repo root.
- **Two transports** — stdio (default, for `npx` / Claude Desktop / Claude Code) and Streamable HTTP (for the Claude marketplace listing and any browser-side client). PRD decision D-13.

## Which connection journey does this server back?

The sandbox's `/connect` page teaches three connection journeys for UAE Open Finance. All three return the same v2.1 data contract — only the consent journey varies. This MCP server primarily backs **Journey 1**; Journey 2 is client-side for v1.

| Journey | Pattern | Consent UI | This server's role |
|---|---|---|---|
| **J1 — Bank-direct (MCP labs)** | A single LFI exposes the OF v2.1 data shape directly to its own retail or SME customer | Bank's own OAuth 2.1 + PKCE (the `--simulate-oauth` screen in this server). The on-page sandbox now walks the J1 consent in 4 sub-steps that mirror what this server does: MCP discovery (401 + RFC 9728/8414) → bank-side SCA (Article 18) → consent (v2.1 Permissions taxonomy + ExpirationDateTime + TransactionFromDateTime) → token (PKCE-validated bearer). | **Canonical backend.** `https://data-sandbox.fly.dev/mcp` is the live J1 demo surface — add it as a Claude custom connector. |
| **J2 — OF rails (TPP via Al Tareq)** | A regulated TPP aggregates one or many LFIs through Al Tareq CAAP / Consent Manager (FAPI 2.0, OFTF mTLS) | Al Tareq CAAP (regulated, centralized at the Consent Manager) | Out of scope for v1. The `/connect` page's J2 wizard is fully client-side and reads the same fixture corpus directly. A future `/tpp/*` surface here would let a real agent walk J2 too. |
| **J3 — Off-rails aggregator (Plaid-pattern)** | Multi-entity aggregation via screen-scraping or partner deals | None (no consent broker) | **Specifically not modelled.** UAE Article 15 forecloses this pattern; `/connect` shows it as a static contrast only. |

For end users: the fastest way to try J1 is **Claude.ai → Customize → Connectors → Add custom connector → paste `https://data-sandbox.fly.dev/mcp`**. No OAuth client setup is required for the anonymous deploy.

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
# → {"ok":true,"version":"0.0.1","specVersion":"v2.1-errata2","specSha":"52caa14…",
#    "personaCount":39,"toolCount":51,"uptimeMs":1234,"sessions":0}
```

The endpoint is the [Streamable HTTP](https://spec.modelcontextprotocol.io/specification/basic/transports/#streamable-http) transport at `/mcp`. CORS is permissive (`*`); `Mcp-Session-Id` round-trips. One process serves many concurrent MCP sessions with per-session state isolation.

### Deploying to Fly.io

`fly.toml` at the repo root is the canonical deploy. First-time setup:

```sh
flyctl auth login
flyctl launch --copy-config --no-deploy   # imports fly.toml, creates the app
flyctl secrets set FLY_API_TOKEN=…        # (optional, for CD)
flyctl deploy
flyctl certs add mcp.openfinance-os.org   # custom domain
```

Subsequent deploys go via the `.github/workflows/deploy-mcp.yml` workflow, which fires on every push to `main` that touches the MCP server, its Dockerfile, `fly.toml`, or the workflow itself. Set `FLY_API_TOKEN` in repo Settings → Environments → `fly.io` (a deploy-only token from `flyctl tokens create deploy -a data-sandbox`).

The default config:
- `primary_region = "fra"` (Frankfurt — change in `fly.toml` if you want US or APAC)
- `shared-cpu-1x` / `512mb` (covers expected traffic on the free tier; the bundled fixture corpus is ~14 MB JSON)
- `auto_stop_machines = "stop"`, `min_machines_running = 0` — single machine, autostarts on first request. If long-lived MCP sessions start dropping at idle, raise `min_machines_running` so Streamable HTTP `GET /mcp` connections survive
- `MCP_ALLOWED_HOSTS` env var pre-sets DNS-rebinding allowlist to `data-sandbox.fly.dev` and `mcp.openfinance-os.org`
- Health check: `GET /health` every 30 s

### Other deployment targets

Anything that runs Docker continuously and supports long-lived HTTP connections works:
- **Railway** — free $5/mo credit, Docker-from-repo, auto-deploy from tag.
- **DigitalOcean App Platform** — `~$5/mo` basic tier, Docker-from-repo.
- **Hetzner / Linode / DigitalOcean Droplet** (any small VPS) — `docker pull ghcr.io/<org>/sandbox-mcp:latest && docker run -d -p 443:8787 ...` plus Caddy/Traefik for TLS. Cheapest option.
- **AWS Fargate / Azure Container Apps / GCP Cloud Run** — fine, but Cloud Run *requires* `--min-instances 1` because cold starts evict sessions.

**Avoid** anything request-scoped or cold-start-prone: Cloudflare Workers / Pages, Vercel functions, Lambda, Render free tier. The Streamable HTTP transport holds long-lived per-session connections that those don't tolerate.

### Production hardening

- **DNS-rebinding protection** is on by default — Host header is validated against `localhost`, `127.0.0.1`, the bound address (all `:port`), plus anything passed via `--allowed-host` (repeatable) or the `MCP_ALLOWED_HOSTS` env var (comma-separated). Pass `--no-dns-rebinding-protection` to disable.
- **Idle session TTL** (default 30 min) and **max session count** (default 1024) cap memory growth on a public anonymous endpoint. Tunable via `MCP_SESSION_IDLE_TTL_MS` and `MCP_MAX_SESSIONS` env vars.
- **Per-IP rate limit** — a token bucket on `POST /mcp` (default: burst 60, refill 10 req/s per client IP; `429` + `Retry-After` when exceeded). Tunable via `MCP_RATE_LIMIT_BURST` / `MCP_RATE_LIMIT_RPS`; set `MCP_RATE_LIMIT_BURST=0` to disable.
- **Scoped CORS** — the `Access-Control-Allow-Origin: *` wildcard applies only to `/mcp` and `/health`, never to the OAuth simulation endpoints (`/authorize`, `/token`, `/register`, `/.well-known/*`).
- **Public URL** — `--public-url https://mcp.example.org` (or `MCP_PUBLIC_URL`) declares the deployment's public https origin. It is validated (must be `https://`), added to the Host allowlist, and used as the OAuth issuer in the RFC 8414/9728 discovery documents instead of the internal `http://host:port` listen address. For the Fly deploy, set `MCP_PUBLIC_URL = "https://data-sandbox.fly.dev"` in `fly.toml` `[env]` (the deploy workflow already uses the same value to smoke-test the endpoint).
- **Stub Dynamic Client Registration** — with `--simulate-oauth`, `POST /register` implements an RFC 7591 stub (echoes back a synthetic `client_id`, public client, PKCE-only) and the RFC 8414 metadata advertises `registration_endpoint`, so real MCP clients that attempt DCR (Claude.ai, VS Code) can complete the simulated flow.
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
| `list_personas` | List the 39 synthetic personas (21 banking-only + 9 insurance-only: 3 motor, 1 home, 1 health, 1 life, 1 travel, 1 renters, 1 employment + 8 multi-domain + the `atm_directory` infrastructure persona) with id, name, archetype, default seed, domain (`"banking"` / `"insurance"` / `"multi"` / `"atm"`), stress-coverage tags, and `multi_lfi_footprint` / `multi_insurer_footprint` slot arrays. Pass `{ domain: 'banking' \| 'insurance' \| 'atm' }` to filter; multi-domain personas appear under both banking and insurance filters. Per-line `get_*` tools (motor / home / health / life / travel / renters / employment) cover every insurance line. |
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

### Insurance endpoints (v2.1, all 7 lines — same 4-tool surface per line)

Every line — `motor`, `home`, `health`, `life`, `travel`, `renters`, `employment` — gets the same four tools. Substitute the line for `<line>`:

| Tool | Purpose |
|---|---|
| `get_<line>_policies` | `/<line>-insurance-policies` envelope — list of policy summaries for the active insurance persona on that line. |
| `get_<line>_policy` | `/<line>-insurance-policies/{InsurancePolicyId}` — full policy detail (PolicyHolder, Identity, Product, Claims, Premium). Omit `policyId` to use the persona's only policy on that line. |
| `get_<line>_payment_details` | `/<line>-insurance-policies/{InsurancePolicyId}/payment-details` — IBAN-keyed payment account for the premium-payment instruction. |
| `get_<line>_quote` | `/<line>-insurance-quotes/{QuoteId}` — quote-read response with `ServiceRating`, `Premium`, `PolicyIssuanceAllowed`. |

Calling a tool for a line the active persona doesn't carry errors with a "switch persona" hint; multi-domain personas resolve per line.

### ATM Locator (Phase 2.3)

| Tool | Purpose |
|---|---|
| `get_atms` | `/atms` envelope — the synthetic public ATM directory (per-ATM location, services, fees, accessibility) from the `atm_directory` infrastructure persona. Works without a session (`lfi` defaults to `median`); an active `atm_directory` session's lfi/seed are used as defaults. `city` filters by TownName / CountrySubDivision; `limit` caps entries (default 25). |

### Discovery & spec metadata

| Tool | Purpose |
|---|---|
| `list_endpoints` | List the v2.1 endpoint paths exposed by the active persona+LFI fixture, plus pinned `specVersion` / `specSha`. Cheaper than `load_journey` when you only need to know what endpoints exist. |
| `field_status` | Look up `mandatory` / `optional` / `conditional` status (and type / format / enum / description) for fields on a given endpoint, without downloading the full `spec://…` resource. Domain auto-detected from the endpoint prefix. Pre-flattened — `oneOf` / `allOf` already resolved. |

## Resources

- `spec://uae-account-information-v2.1` — parsed banking v2.1 OpenAPI (pinned by SHA upstream).
- `spec://uae-insurance-v2.1` — parsed insurance v2.1-errata1 OpenAPI (all 7 lines + Insurance Consents).
- `spec://uae-atm-v2.1` — parsed ATM Locator OpenAPI (`/atms`).
- `recipe://schema` — full `RECIPE_DEFAULTS` object documenting every knob `build_persona` accepts.
- `persona://<id>` — manifest for each curated persona (demographics, income, accounts, commitments, narrative).

## Prompts

- `pick-a-persona` — guided persona-selection flow.
- `monthly-summary` — month-end PFM summary that chains `get_accounts → get_balances → get_transactions → get_standing_orders → get_direct_debits` and preserves the watermark.
- `insurance-coverage-review` — per-line coverage review (policies → detail → payment details → quote) for an insurance or multi-domain persona.
- `multi-lfi-financial-picture` — whole-of-market aggregation across every bank slot in a persona's `multi_lfi_footprint` (via `set_session` `lfi_role`) plus their insurance lines.

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

### Insurance read-quote (motor)

```text
> list_personas { domain: "insurance" }
{ "personas": [{ "id": "motor_comprehensive_mid", ... }, ...], "count": 9 }

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
