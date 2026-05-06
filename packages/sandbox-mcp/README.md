# @openfinance-os/sandbox-mcp

MCP server that exposes the [Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox) — synthetic UAE Open Finance v2.1 Bank Data Sharing payloads — as MCP tools, resources, and prompts.

The intended use: run Claude as a **dynamic PFM** against a synthetic customer. Pick one of 12 curated personas (salaried expat, gig worker, mortgage holder, SME owner, …) and let Claude answer balance, spend, and obligation questions over deterministic v2.1-shaped JSON.

> **All data is synthetic.** No real customer, no real institution. Every tool response carries a `_watermark` field such as `SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:salaried_expat_mid lfi:median seed:4729 retrieved:2026-04-01T00:00:00.000Z`. Preserve this watermark in any export or summary.

## Scope

- **Banking only** — Bank Data Sharing v2.1, all 12 Account-Information endpoints. Insurance defers to a later release.
- **12 curated personas** — no custom-persona builder yet.
- **Read-only** — no writes, no Service Initiation.
- **Anonymous** — no auth, no API keys, no OAuth. The data is synthetic so there is nothing real to protect.
- **Two transports** — stdio (default, for `npx` / Claude Desktop / Claude Code) and Streamable HTTP (for the Claude marketplace listing and any browser-side client). PRD decision D-13.

## Install

```sh
npx -y @openfinance-os/sandbox-mcp --help
```

### Claude marketplace (HTTP)

The hosted endpoint is published at `mcp.openfinance-os.org/sandbox`. Install via the connector directory; no API key required.

To run your own HTTP instance:

```sh
npx -y @openfinance-os/sandbox-mcp --transport http --port 8787 --host 0.0.0.0 \
  --allowed-host mcp.example.org
# → sandbox-mcp 0.0.1 listening on http://0.0.0.0:8787/mcp
#   allowed Host headers: 127.0.0.1:8787, localhost:8787, [::1]:8787, mcp.example.org
#   DNS rebinding protection: on
```

Health check:

```sh
curl http://127.0.0.1:8787/health
# → {"ok":true,"sessions":0}
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

Subsequent deploys go via the `.github/workflows/deploy-fly.yml` workflow, which fires on `mcp-v*` tags after `publish-mcp.yml` has built and pushed the container image. Set `FLY_API_TOKEN` in repo Settings → Secrets (a deploy-only token from `flyctl tokens create deploy --app of-sandbox-mcp`) before cutting the first tag.

The default config:
- `primary_region = "iad"` (US East — closest to Anthropic infrastructure; change in `fly.toml` if you want EU or APAC)
- `shared-cpu-1x` / `256mb` (covers expected traffic on the free tier; the bundled fixture corpus is ~14 MB JSON)
- `auto_stop_machines = false`, `min_machines_running = 1` — Streamable HTTP keeps `GET /mcp` open per session, so cold-starting would silently drop in-flight Claude conversations
- `MCP_ALLOWED_HOSTS` env var pre-sets DNS-rebinding allowlist to `of-sandbox-mcp.fly.dev` and `mcp.openfinance-os.org`
- Health check: `GET /health` every 30 s

### Other deployment targets

Anything that runs Docker continuously and supports long-lived HTTP connections works:
- **Railway** — free $5/mo credit, Docker-from-repo, auto-deploy from tag.
- **DigitalOcean App Platform** — `~$5/mo` basic tier, Docker-from-repo.
- **Hetzner / Linode / DigitalOcean Droplet** (any small VPS) — `docker pull ghcr.io/<org>/sandbox-mcp:latest && docker run -d -p 443:8787 ...` plus Caddy/Traefik for TLS. Cheapest option.
- **AWS Fargate / Azure Container Apps / GCP Cloud Run** — fine, but Cloud Run *requires* `--min-instances 1` because cold starts evict sessions.

**Avoid** anything request-scoped or cold-start-prone: Cloudflare Workers / Pages, Vercel functions, Lambda, Render free tier. The Streamable HTTP transport holds long-lived per-session connections that those don't tolerate.

### Production hardening

- **DNS-rebinding protection** is on by default — Host header is validated against `localhost`, `127.0.0.1`, the bound address (all `:port`), plus anything passed via `--allowed-host` (repeatable). Pass `--no-dns-rebinding-protection` to disable.
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
| `get_transactions` | `/accounts/{AccountId}/transactions` with optional `since`, `until`, `minAmount`, `maxAmount`, `category` filters. Filters run *after* the deterministic generator. |
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
