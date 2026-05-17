# Connection journeys — Journey 1: bank-direct (MCP labs)

Status: simulation against the synthetic sandbox in this repo.
Audience: anyone building a consumer-facing AI assistant on UAE Open Finance v2.1.

This is one of three connection journeys the sandbox teaches on its `/connect` page. **Journey 1** is the *bank-direct* path: what if your bank ran a labs MCP endpoint exposing the same OF v2.1 data shape directly to its own retail or SME customer — no TPP, no Al Tareq? The consent below is the bank's own OAuth, not the regulator's Consent Manager.

- **Journey 2** (separate flow, not covered here): the regulated TPP path through Al Tareq CAAP, FAPI 2.0, and the Nebras Consent Manager — single or multi-LFI aggregation, with revocation centralized at the regulator. See `/connect → OF rails`.
- **Journey 3** (contrast only): the off-rails Plaid-style aggregator pattern, specifically foreclosed in UAE by Article 15 of CBUAE Circular C 03/2025.

The load-bearing invariant: **all three return the same v2.1 data contract**. Only the consent journey varies. That's what makes the bank-direct labs path here faithful to UAE Open Finance even though it never enters Al Tareq — the data shape is the regulated standard, just delivered through a non-regulated consent surface.

Nothing here is endorsed by Anthropic, CBUAE, Nebras, or any UAE LFI. The data is synthetic — every payload carries a `_watermark`. The OAuth journey is opt-in simulation behind `--simulate-oauth`; the production deploy at `https://data-sandbox.fly.dev/mcp` stays anonymous-by-default per PRD D-13.

---

## 1. What I see

I'm chatting with Claude. I ask something a chat assistant has never been able to answer: *"Can you see my main account?"* Claude says no, but offers to connect — one tap and it can read what I share. My bank's own OAuth consent screen opens.

```
┌─────────────────────────────────────────────────────────────────┐
│  Share with Claude · your bank's labs MCP                       │
│  ────────────────────────────────────────────────────────────── │
│  OAuth 2.1 + PKCE. Claude will be able to read what you tick.   │
│  You can stop sharing at any time in your bank's Connected      │
│  apps page (not Al Tareq — this is the bank's own surface).     │
│                                                                 │
│  ☑ Bank Data Sharing  — accounts · balances · transactions ·    │
│                         standing orders · direct debits ·       │
│                         beneficiaries · statements · products   │
│  ☑ Insurance Data Sharing — motor · home · health · life ·      │
│                             travel · renters · employment       │
│                             renewals and payment details        │
│  ☐ Service Initiation — payments  (NOT requested · v1 read-only)│
│                                                                 │
│  Sharing window:  90 days  ·  SYNTHETIC sandbox data            │
│                                                                 │
│            [  Deny  ]              [  Approve all (1 tap)  ]    │
└─────────────────────────────────────────────────────────────────┘
```

I tap Approve. The browser redirects back to Claude. I'm in the chat again and Claude tells me what it can now answer.

## 2. How consent works (J1)

Under the hood: Claude's MCP client hit `/mcp` without a bearer and got a `401` with a `WWW-Authenticate: Bearer realm="open-finance-sandbox", authorization_uri=…, resource_metadata=…` challenge. The `resource_metadata` URL is an RFC 9728 document that points Claude at the authorization server's RFC 8414 metadata; together those two documents tell Claude where to send me for consent. Claude opened `/authorize` with a PKCE S256 challenge bound to a verifier it keeps private — same shape Plaid Link uses with the institution's OAuth flow.

When I tapped Approve, the server signed a single-use authorization code and 302-redirected to Claude's callback. Claude exchanged the code for a one-hour opaque bearer at `/token`, supplying the verifier so the server could prove I'm the same user who started the flow. From here every `/mcp` call carries the bearer; the gate is on every request, not just initialize.

The sandbox's bearer is a UUID with a 1-hour TTL. A real bank-labs deployment would carry the same 90-day sharing window the consent screen advertises, with revocation at any time wiping the token server-side. Revocation lives in the bank's own "Connected apps" page — the regulator's Consent Manager isn't in this loop (that's Journey 2's territory).

## 3. What Claude can answer

These are five real exchanges against the `salaried_expat_mid` persona (Sara — Salaried Expat, Mid Tier) on the median LFI profile. Every figure is computed deterministically from the v2.1 fixtures served by `packages/sandbox-fixtures/`.

> **Me:** What's my main account balance?
> **Claude:** Your AED Current account is at AED 182,515.53 as of the latest reported balance.

> **Me:** Did my salary land this month?
> **Claude:** Yes — AED 25,000 hit on the 27th from `SAL/PAYROLL/KESTRELCLO`. That's the same payer and amount as the last six months, so the pattern looks stable.

> **Me:** What was my biggest spend last month?
> **Claude:** Rent — AED 16,000 to your usual landlord. After that, AED 1,705 at Saffron Dental, AED 1,306 on DuneDirect, and AED 1,061 in utilities.

> **Me:** Am I tracking to AED 12,000 a month in non-rent spend?
> **Claude:** Looking at March so far, you're at AED 6,200 with two weeks to go — roughly on track if the rest of the month looks like the first half.

> **Me:** When does my motor insurance renew?
> **Claude:** Your motor policy renews on 14 June 2026. The carrier emailed you the quote three weeks before last year — expect the same.

The answers are deterministic for any `(persona, lfi, seed)` triple. That makes them safe to demo, to test against, and to put in a sandbox-flavoured screenshot without any chance of leaking a real person's data.

## 4. How I revoke (J1)

Because J1's consent is the bank's own OAuth — not Al Tareq — revocation lives in the *bank's* "Connected apps" page, not the regulator's Consent Manager. In a real LFI deployment, that would be a screen in the bank's mobile or web app listing every connected MCP client, what data each one can read, when consent was given, and a one-click "stop sharing" that wipes the bearer server-side and 401s every subsequent call.

Until that page is real, the local equivalent is `DELETE /mcp` with `Mcp-Session-Id` — the sandbox-mcp server destroys the session and forces re-authentication on the next call.

For Journey 2's revocation flow — through the regulated Al Tareq Consent Manager, which is the single source of truth for any TPP-mediated consent — see the `/connect → OF rails` walkthrough.

## 5. Regulatory context

This whole flow is theatre over synthetic data. The load-bearing invariants don't bend:

- **CBUAE Standards v2.1** is the only baseline (D-01). Pinned at SHA `bc1cd97`. Both Bank Data Sharing and Insurance Data Sharing are in scope; Service Initiation is v2+.
- **No real customer data, ever** (NG4, EXP-07). Synthetic identity pool only.
- **No institution-specific operational detail, ever** (NG5, refined by D-14). LFI profiles are anonymous Rich/Median/Sparse bands.
- **Deterministic generation** (EXP-05). `(persona, lfi, seed)` → byte-identical bundle.
- **Mandatory fields are never redacted** (EXP-04). The Sparse profile only drops optional/conditional fields.
- **Anonymous-by-default deploy** (D-13). The OAuth simulation is opt-in via `--simulate-oauth` / `MCP_SIMULATE_OAUTH=1`. The production `https://data-sandbox.fly.dev/mcp` requires no credentials.
- **Watermark every export** (EXP-19). Every payload Claude reads carries `SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · persona:{id} lfi:{profile} seed:{seed} retrieved:{timestamp}`.

For the full PRD see `PRD_OF_Data_Explorer.md`. For the visual mockup of the connect flow, see [`/connect.html`](src/connect.html). For the OAuth-sim implementation, see [`packages/sandbox-mcp/src/transports/oauth-simulation.mjs`](packages/sandbox-mcp/src/transports/oauth-simulation.mjs).

---

## Try the journey

```sh
# Anonymous (the production default per D-13)
npx -y @openfinance-os/sandbox-mcp --transport http --port 8787

# Opt-in OAuth simulation — surfaces 401 + WWW-Authenticate, /authorize,
# /token, and bearer-validation on every /mcp POST
npx -y @openfinance-os/sandbox-mcp --transport http --port 8787 --simulate-oauth
# or:  MCP_SIMULATE_OAUTH=1 npx -y @openfinance-os/sandbox-mcp --transport http
```

Then walk the wizard at `/connect.html` end-to-end, or hit `/authorize` directly with a PKCE S256 challenge. The full discovery → consent → token → bearer-gated `/mcp` chain matches what a real consumer-facing TPP would implement against Nebras-Open-Finance.
