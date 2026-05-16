# Claude for Open Finance — design memo

Status: draft, simulation only.
Branch: `claude/mcp-auth-simulation-JPwtT`.
Audience: OF-OS Commons maintainers and UAE TPP builders evaluating Claude
as a TPP-side AISP client.

This memo borrows the product shape of Anthropic's
[Claude for Small Business](https://www.anthropic.com/news/claude-for-small-business)
launch — **toggle install + bundled connectors + ready-made workflows + AI
Fluency course + workshop tour** — and reprojects it onto the UAE Open
Finance Bank/Insurance Data Sharing sandbox the rest of this repo ships.

Nothing here is endorsed by Anthropic, CBUAE, Nebras, or any UAE LFI. The
"connectors" are anonymised populate-rate profiles over the synthetic v2.1
corpus served by `packages/sandbox-mcp/`; that server remains
anonymous-by-default per PRD D-13. The OAuth journey shown in §3 is
implemented as **opt-in simulation mode** behind `--simulate-oauth` /
`MCP_SIMULATE_OAUTH=1`; the default deploy at
`https://data-sandbox.fly.dev/mcp` continues to require no credentials.

---

## 1. TL;DR

- **One toggle, full estate.** A single OAuth consent unlocks 9 LFI
  populate-rate profiles + 7 insurance lines for the active Claude session
  — the AISP analogue of SMB's "toggle on QuickBooks + PayPal + HubSpot in
  one click".
- **15 ready-made TPP skills**, the same shape as SMB's 15 ready-made
  workflows.
- **AI Fluency for Open Finance** — a free, self-paced reprojection of
  Anthropic × PayPal's AI Fluency for Small Business, retargeted to TPP
  devs. Same 4D framework (Delegation · Description · Discernment ·
  Diligence), Standards-v2.1-flavoured.
- **10-stop dev workshop tour** across UAE + GCC, mirroring SMB's
  10-city US tour.

## 2. The bundle

| SMB launch (real) | Open Finance projection (this memo) |
| --- | --- |
| QuickBooks, PayPal, Stripe, Square | 9 UAE LFIs across 3 anonymised populate-rate profiles: **Rich · Median · Sparse** |
| HubSpot, Canva, Docusign | 5 insurance carriers across 7 lines — motor · home · health · life · travel · renters · employment |
| Google Workspace, Microsoft 365 | OF-OS Commons spec resources: v2.1 Bank Data Sharing + v2.1 Insurance Data Sharing (pinned SHA `bc1cd97…`) |

Anonymous-by-design: per PRD NG5 / D-14 the LFI profiles are never
named, and operational claims never bind to a real bank. Real UAE bank
names appear only where no operational claim binds to them — counterparty
pools and the optional `multi_lfi_footprint.plausible_lfi_candidates`
array, both lint-enforced.

## 3. The toggle install — one screen, not seven

The first prompt after adding the connector triggers the journey. The MCP
server returns:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="open-finance-sandbox",
                  authorization_uri="https://auth.openfinance-os.org/oauth2/authorize",
                  resource_metadata="https://data-sandbox.fly.dev/.well-known/oauth-protected-resource"
```

Claude calls `authenticate`, surfaces the consent URL, and the user lands
on a UAE OF-Authority-styled screen:

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude × UAE Open Finance Authority                            │
│  ────────────────────────────────────────────────────────────── │
│  Claude is requesting access on behalf of:                      │
│    "Claude for Open Finance" (TPP licence: SANDBOX-CC-9F3A)     │
│                                                                 │
│  ☑ Bank Data Sharing  — accounts · balances · transactions ·    │
│                         standing orders · direct debits ·       │
│                         beneficiaries · statements · products   │
│  ☑ Insurance Data Sharing — policies · payment details ·        │
│                             quotes (read-only)                  │
│  ☐ Service Initiation — payments  (NOT requested · v1 read-only)│
│                                                                 │
│  Sharing window:  90 days  ·  Revoke any time at My Consents    │
│  Data is SYNTHETIC.  No real customer.  No real institution.    │
│                                                                 │
│            [  Deny  ]              [  Approve all (1 tap)  ]    │
└─────────────────────────────────────────────────────────────────┘
```

One tap → all 9 LFI profiles and 7 insurance lines unlock. The browser
redirects to `http://localhost:<port>/callback?code=…&state=…`, the user
pastes that URL back into the chat, Claude calls `complete_authentication`,
and a bearer token replaces the `WWW-Authenticate` challenge on every
subsequent `/mcp` POST.

## 4. The 15 ready-made skills

Mirroring SMB's 15 ready workflows ("planning payroll, balancing the
books, onboarding new employees"), retargeted to a TPP:

1. **Monthly PFM summary** — chains `get_accounts → get_balances → get_transactions → get_standing_orders → get_direct_debits`, watermark preserved.
2. **Underwriting scenario** (EXP-18) — DBR / affordability against the pinned illustrative formulas.
3. **Cash-flow forecast** — extrapolate next 90 days from recurring SOs + DDs.
4. **Expense categorisation** — MCC-clustered with confidence.
5. **Salary detection** — find the inflow that pays the rent.
6. **Subscription audit** — recurring DDs/SOs > 3 cycles.
7. **Beneficiary risk review** — flag stale or unusual beneficiaries.
8. **Coverage gap check** — for insurance personas, cross-reference policy vs. assets.
9. **Renewal calendar** — motor/home/health policies coming due.
10. **KYC freshness check** — `get_party` vs. consent window.
11. **Affordability uplift** — DBR delta under a hypothetical loan.
12. **Multi-LFI footprint reconciliation** — for SME personas with primary + secondary + tertiary roles.
13. **Statement narrative** — natural-language month-end commentary.
14. **Sparse-profile resilience test** — verify a TPP UX degrades gracefully when an LFI populates the minimum-conformant set.
15. **Spec drift sentinel** — diff the live response against `field_status` and flag surprises.

Each skill is a prompt + tool sequence over the existing
`@openfinance-os/sandbox-mcp` tools — no new server tools required.

## 5. AI Fluency for Open Finance — the 4D framework

Free, self-paced. Same shape as Anthropic × PayPal's
[AI Fluency for Small Business](https://www.anthropic.com/news/claude-for-small-business),
retargeted:

| 4D pillar | SMB framing | Open Finance framing |
| --- | --- | --- |
| **Delegation** | which tasks to hand to AI | PFM summarisation, categorisation, alerting — *never* automated credit decisions without human-in-loop |
| **Description** | prompt-writing best practices | how to prompt over v2.1 envelopes (Data / Links / Meta) without hallucinating fields |
| **Discernment** | QA mechanisms | preserve `_watermark`; reconcile any field claim against `field_status`; never redact mandatory under Sparse |
| **Diligence** | governance framework | synthetic-only guardrails; pinned `_specSha`; deterministic `(persona, lfi, seed)` replay for every customer-facing answer |

Co-taught (mock) by three sandbox-native TPPs the way SMB is co-taught
by Prospect Butcher Co. and MAKS TIPM Rebuilders: a Dubai PFM startup, a
free-zone SaaS lender, and a Sharjah motor-insurance aggregator.

## 6. Workshop tour

10 free dev-workshops across the GCC region, mirroring SMB's 10-city US
tour through June:

| Date | City | Venue (mock) |
| --- | --- | --- |
| May 14 | Dubai | DIFC FinTech Hive |
| May 21 | Abu Dhabi | ADGM Hub71 |
| May 28 | Sharjah | Sheraa |
| Jun 4 | Riyadh | Fintech Saudi |
| Jun 7 | Manama | Bahrain FinTech Bay |
| Jun 11 | Doha | QFC |
| Jun 14 | Kuwait City | KFAS |
| Jun 18 | Muscat | OAB Innovation Lab |
| Jun 22 | Cairo | AUC Venture Lab |
| Jun 26 | Amman | Orange Hub |

## 7. Try the journey

Two ways to experience the consent flow against this repo's MCP server:

```sh
# Anonymous (the production default per D-13)
npx -y @openfinance-os/sandbox-mcp --transport http --port 8787

# Opt-in OAuth simulation — surfaces 401 + WWW-Authenticate, /authorize,
# /token, and bearer-validation on every /mcp POST
npx -y @openfinance-os/sandbox-mcp --transport http --port 8787 --simulate-oauth
# or: MCP_SIMULATE_OAUTH=1 npx -y @openfinance-os/sandbox-mcp --transport http
```

A walkthrough of the rendered consent screen and the bundled-skills grid
lives at `/src/connect.html` in this repo (staged to `/connect.html` on
deploy).

## 8. Status & scope

This memo is **a simulation, not a roadmap**. Nothing here changes the
load-bearing invariants of the sandbox:

- Spec-driven field metadata, never hand-authored (EXP-01).
- No real customer data, ever (NG4 / EXP-07).
- No institution-specific operational detail, ever (NG5 / D-14).
- Deterministic generation (EXP-05).
- Standards baseline is v2.1 only (D-01).
- No separate contributor branding (NG6).

The OAuth simulation is purely transport-side theatre — it gates the same
synthetic payloads behind a bearer token. There is nothing real to
protect; the value is letting a TPP demo a customer-facing consent
journey end-to-end before they have to wire a real Nebras-Open-Finance
client.
