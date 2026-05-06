# @openfinance-os/sandbox-mcp

MCP server that exposes the [Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox) — synthetic UAE Open Finance v2.1 Bank Data Sharing payloads — as MCP tools, resources, and prompts.

The intended use: run Claude as a **dynamic PFM** against a synthetic customer. Pick one of 12 curated personas (salaried expat, gig worker, mortgage holder, SME owner, …) and let Claude answer balance, spend, and obligation questions over deterministic v2.1-shaped JSON.

> **All data is synthetic.** No real customer, no real institution. Every tool response carries a `_watermark` field such as `SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:salaried_expat_mid lfi:median seed:4729 retrieved:2026-04-01T00:00:00.000Z`. Preserve this watermark in any export or summary.

## Scope (v1)

- **Banking only** — Bank Data Sharing v2.1, all 12 Account-Information endpoints. Insurance defers to a later release.
- **12 curated personas** — no custom-persona builder yet.
- **Read-only** — no writes, no Service Initiation.
- **Anonymous** — no auth, no API keys, no OAuth. The data is synthetic so there is nothing real to protect.
- **Stdio transport only** — `npx @openfinance-os/sandbox-mcp`. The hosted HTTP transport and Claude marketplace listing are gated on PRD decision D-11.

## Install

```sh
npx -y @openfinance-os/sandbox-mcp --help
```

### Claude Desktop

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

### Claude Code

```sh
claude mcp add open-finance-sandbox -- npx -y @openfinance-os/sandbox-mcp
```

## Tools

| Tool | Purpose |
|---|---|
| `list_personas` | List the 12 synthetic banking personas (id, name, archetype, default seed). |
| `set_session` | Pin `{ persona, lfi?, seed? }` for subsequent calls. `lfi` defaults to `median`; `seed` defaults to `persona.default_seed`. |
| `get_session` | Echo the active persona / lfi / seed. |
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
