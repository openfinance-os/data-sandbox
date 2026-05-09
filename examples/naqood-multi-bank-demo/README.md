# Naqood-style multi-bank reconciliation demo

A worked TPP-side example showing how an accounting-system integration
(e.g. Naqood ↔ Woven ↔ ADCB) consumes UAE Open Finance bank feeds across
**multiple banks for the same SME** and reconciles them into a single
ledger by IBAN identity.

This is the canonical use case for the `multi_lfi_footprint` feature
introduced in PRD decision **D-14** and the role-keyed Phase D bundles
shipped in Slice 5.

## What it demonstrates

For an SME persona with `multi_lfi_footprint` declared (e.g. the F&B
multi-outlet operator, the e-commerce marketplace seller, the RAK
trading SME), the demo:

1. Reads the persona's declared footprint slots (primary / secondary /
   tertiary) from `manifest.json`.
2. Fetches the **primary bundle** at
   `/fixtures/v1/bundles/<persona>/<lfi>/seed-N/...` — what the
   persona's primary banker sees.
3. Inspects the primary bundle's beneficiaries for `self-to-<slot>`
   entries — these are the persona's own accounts at OTHER LFIs,
   surfaced as outbound payment targets.
4. Fetches each declared **role bundle** in parallel at
   `/fixtures/v1/bundles/<persona>/<slot>/<lfi>/seed-N/...`.
5. **Reconciles by IBAN identity** — each role bundle's
   `account[0].AccountIdentifiers[0].Identification` byte-matches the
   primary bundle's `self-to-<slot>` beneficiary's
   `CreditorAccount.Identification`. That match proves "the same
   persona at two banks" without any out-of-band identifier.
6. Renders a **consolidated multi-bank ledger view** — every account
   the SME holds across every LFI, joined into one table.

## Spec adherence

Every payload is a v2.1-shaped envelope (`{ Data, Links, Meta }` plus
the underscore-prefixed `_watermark`/`_persona`/`_lfi`/`_seed`/`_specSha`
sandbox metadata). All IBANs pass ISO-13616 mod-97 validation
(carrying a 3-digit `bank_code` at positions 5–7 — synthetic, NOT real
CBUAE-assigned routing identifiers per NG5). All BICs match the
ISO-9362 BIC8 shape `BBBBAEXX`. SchemeName values are drawn from the
spec's `AEExternalFinancialInstitutionIdentificationCode` enum.

## Running

The demo is a static HTML + ES-module page; serve it from anywhere
that can also serve the staged `_site/fixtures/v1/...` (or pass
`?origin=https://your-host/commons/data-sandbox` to point at a remote
sandbox).

Local dev:

```sh
npm run build:site                       # emits _site/fixtures/v1/...
cd _site && python3 -m http.server 8080  # serve the staged site
# in another terminal:
cd examples/naqood-multi-bank-demo && python3 -m http.server 8081
# open http://localhost:8081/?origin=http://localhost:8080
```

Pointing at production:

```sh
cd examples/naqood-multi-bank-demo && python3 -m http.server 8081
# open http://localhost:8081/?origin=https://openfinance-os.org/commons/data-sandbox
```

## Files

- `index.html` — three-section layout (footprint table → cross-bundle
  reconciliation table → consolidated ledger view).
- `app.js` — fetches primary + role bundles in parallel, reconciles
  by IBAN, renders the three tables.
- `README.md` — this file.

## Why "Naqood-style"?

[Naqood](https://www.naqood.com/) is a UAE accounting platform that
integrates with banking partners over Open Finance. The hard problem
their platform — and any equivalent platform — solves is matching the
same economic event across multiple LFI feeds: a supplier paid from
the operating bank → the same supplier reflected at a digital
challenger's PSP relationship → reconciled into one journal entry. The
sandbox's role-keyed bundles give the integration a concrete shape to
build against without consenting at any real LFI.

## Synthetic-data disclaimer

Every persona, every name, every IBAN, every BIC, every transaction
in this demo is fabricated. No real customer data is involved (NG4).
Real UAE bank names appear only at the two D-14 allow-sites — the
counterparty pool and the persona manifest's `plausible_lfi_candidates`
arrays — and never bind to a populate-rate or to any operational
claim about the named bank.
