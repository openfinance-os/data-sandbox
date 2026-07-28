# Claude marketplace listing — copy

Drafted for [claude.ai/directory](https://claude.ai/directory) submission of `@openfinance-os/sandbox-mcp`. Tone matches the package README and the OF-OS Commons posture (no separate branding per PRD NG6).

---

## Display name

**Open Finance Data Sandbox**

## Short description (≤ 80 chars, for the catalog tile)

> Synthetic UAE Open Finance customer data — use Claude as a dynamic PFM.

Alternates if the field caps differently:

- **120 chars** — Pick a synthetic UAE bank customer and ask Claude balance, spend, and obligation questions over real v2.1 payloads.
- **60 chars** — Synthetic UAE bank customers + Claude as a dynamic PFM.

## Long description

> Plug Claude into a sandbox of synthetic UAE Open Finance v2.1 payloads — Bank Data Sharing, Insurance Data Sharing (all 7 lines), and the ATM Locator — and use it as a dynamic Personal Financial Manager. Pick from 39 curated personas — salaried expat, gig worker, mortgage holder, SME owner, corporate treasury, motor/home/health/life/travel/renters/employment-insured, multi-bank multi-insurer flagships, and more — or describe your own customer in plain English and have Claude build one on the fly. Every tool response is a real v2.1-shaped envelope with mandatory/optional/conditional fields driven by the published OpenAPI spec.
>
> The data is fully fictional — no real customer, no real institution. Every response carries a `SYNTHETIC` watermark you can preserve in summaries and exports. Determinism (`(persona, lfi, seed)` → byte-identical bundle) and the pinned spec SHA make every conversation reproducible.
>
> Behind the scenes this is a Model Context Protocol server that wraps `@openfinance-os/sandbox-fixtures`, the same corpus already published on npm and PyPI. The connector is anonymous (no auth, no API key), open-source under MIT, and shipped as part of [OpenFinance-OS Commons](https://openfinance-os.org).

## Categories / tags

`finance` `developer-tools` `open-banking` `synthetic-data` `uae` `pfm` `connectors`

## Install URL (Streamable HTTP)

```
https://data-sandbox.fly.dev/mcp
```

(`https://mcp.openfinance-os.org/mcp` is the future canonical URL — it lands with the OF-OS Commons CNAME cutover per PRD D-13 and is not live yet. Re-point the listing when DNS goes live; re-listing is cheap.)

## Auth

**Anonymous** — no OAuth, no API key. The corpus is fully synthetic so there is nothing real to protect.

## Logo / icon

Use the OF-OS Commons mark. **No separate branding** per PRD NG6 — the connector is positioned as a Commons contribution, not a standalone product.

## Sample prompts (3-5, ready-to-paste)

These are pre-validated against the deployed connector. Each one drives a distinct part of the surface:

1. **First-run / persona picker**

   > Show me the synthetic customers available in the Open Finance sandbox, then pick the salaried expat for me and run a month-end PFM summary.

2. **Custom persona from natural language**

   > I want to explore an Emirati HNW customer with multi-currency accounts, FX activity, and no distress signals. Build that persona and walk me through their balances and biggest categories of spend.

3. **Underwriting-style scrutiny**

   > Run the mortgage-holder persona under the sparse LFI profile. Tell me which fields are missing that an underwriter would need, what the DBR looks like, and what assumptions you're making.

4. **Cash-flow narrative for an SME**

   > Pick the SME trading-business persona, fan out across all accounts, and tell me a month-by-month cash-flow narrative for the last quarter. Flag anything an SME credit officer should ask about.

5. **Spec grounding**

   > Using the parsed v2.1 OpenAPI spec from this connector, list every mandatory field on the `Balance` resource and quote the descriptions verbatim.

## What it is not

A short note worth including in the listing description so users don't expect what's not there:

- **Not a connection to real banks.** No live API calls. No real customer data.
- **Not a writeable surface.** Read-only — no payments, no Service Initiation, no account opening.
- **UAE-specific.** Bank Data Sharing, Insurance Data Sharing (all 7 lines), and the ATM Locator on v2.1; Open Wealth and payment-initiation are deferred.

## Submission notes (internal)

- Reuse the README screenshots / examples for the listing's media slots once we have them.
- Keep the listing pointed at the custom domain (`mcp.openfinance-os.org`) once DNS is live; before that, point at the Fly URL and update later — re-listing is cheap.
- The `_watermark` instruction is baked into the server's MCP `instructions` field, so Claude sees it on every session start without us repeating it in the listing.
