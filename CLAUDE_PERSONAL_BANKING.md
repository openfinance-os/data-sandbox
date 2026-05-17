# Connect your UAE bank to Claude

Status: simulation against the synthetic sandbox in this repo.
Audience: anyone building a consumer-facing AI assistant on UAE Open Finance v2.1.

This is what it looks like for a person to connect their UAE bank to Claude in a chat and start getting answers grounded in their real accounts. It's modelled on the [Plaid + ChatGPT integration](https://plaid.com/blog/chatgpt-personal-finance-plaid/) pattern — consumer-direct, permission-managed, revocable — and projected onto the UAE Open Finance Standards v2.1 surface that the rest of this repo already serves.

Nothing here is endorsed by Anthropic, CBUAE, Nebras, or any UAE LFI. The data is synthetic — every payload carries a `_watermark`. The OAuth journey is opt-in simulation behind `--simulate-oauth`; the production deploy at `https://data-sandbox.fly.dev/mcp` stays anonymous-by-default per PRD D-13.

---

## 1. What I see

I'm chatting with Claude. I ask something a chat assistant has never been able to answer: *"Can you see my main account?"* Claude says no, but offers to connect — one tap and it can read what I share. A consent screen opens.

```
┌─────────────────────────────────────────────────────────────────┐
│  Share with Claude · UAE Open Finance Authority                 │
│  ────────────────────────────────────────────────────────────── │
│  Claude will be able to read what you tick. You can stop        │
│  sharing at any time at portal.openfinance.ae · My Consents.    │
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

## 2. How consent works

Under the hood: Claude's MCP client hit `/mcp` without a bearer and got a `401` with a `WWW-Authenticate: Bearer realm="open-finance-sandbox", authorization_uri=…, resource_metadata=…` challenge. The `resource_metadata` URL is an RFC 9728 document that points Claude at the authorization server's RFC 8414 metadata; together those two documents tell Claude where to send me for consent. Claude opened `/authorize` with a PKCE S256 challenge bound to a verifier it keeps private — same shape Plaid Link uses with the institution's OAuth flow.

When I tapped Approve, the server signed a single-use authorization code and 302-redirected to Claude's callback. Claude exchanged the code for a one-hour opaque bearer at `/token`, supplying the verifier so the server could prove I'm the same user who started the flow. From here every `/mcp` call carries the bearer; the gate is on every request, not just initialize.

The sandbox's bearer is a UUID with a 1-hour TTL. A real Nebras-Open-Finance bearer would carry the same 90-day sharing window the consent screen advertises, with revocation at any time wiping the token server-side.

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

## 4. How I revoke

The consent screen pointed at `portal.openfinance.ae · My Consents` — that's the UAE Open Finance Authority's mock revoke page. In v1 of this sandbox it's a pointer, not a working URL; the journey it implies is the same one Plaid Portal models: every connection I've authorized, what data each one can read, when I gave permission, and a one-click "stop sharing" that wipes the bearer server-side and 401s every subsequent call.

Until that page is real, the local equivalent is `DELETE /mcp` with `Mcp-Session-Id` — the sandbox-mcp server destroys the session and forces re-authentication on the next call.

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
