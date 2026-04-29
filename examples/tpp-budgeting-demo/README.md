# TPP Budgeting Demo — worked example

A faux budgeting widget that consumes the Open Finance Data Sandbox over
raw HTTPS. This is the canonical "swap your Nebras-mock backend for
sandbox personas" reference.

The Nebras-operated regulatory sandbox is intentionally thin on data —
one or two accounts, a handful of canned transactions. A TPP showcase
journey wired to those mocks looks empty. Wire the same journey to one
of the sandbox's 10 narratively-coherent personas instead, and the
demo looks like a real customer.

## What it shows

For one `(persona, lfi, seed)` tuple, in parallel HTTP fetches:

- **Customer** name + `PartyId` (from `/parties`)
- **Total balance** in AED equivalent (from each account's `/balances`)
- **Accounts** with subtype + masked identifier + closing balance
- **Fixed commitments** (from each account's `/standing-orders`)
- **Transaction timeline** — last 90 days, grouped by month, with
  credit/debit colouring (from each account's `/transactions`)

All identifiers line up — the same `AccountId` appears in `/accounts`,
`/balances`, `/transactions`, `/standing-orders`. EXP-32 enforces this in CI.

## Run it

### Against the deployed sandbox

```sh
python3 -m http.server 7000
# then open http://localhost:7000/index.html
# the page defaults to https://openfinance-os.org/commons/data-sandbox
# and uses CORS-permissive /fixtures/v1/*
```

### Against a local sandbox build

```sh
# from the repo root
npm install
npm run build:site

python3 -m http.server 8000 --directory _site
# in another terminal:
python3 -m http.server 7000 --directory examples/tpp-budgeting-demo
# open http://localhost:7000/index.html?origin=http://localhost:8000
```

The `?origin=` query param overrides the fixture origin. Default precedence:

1. `?origin=...`
2. `window.location.origin` (when the page is served from the same host
   as the staged sandbox)
3. `https://openfinance-os.org/commons/data-sandbox`

## How it maps onto a real TPP integration

The fetch sequence in `app.js` mirrors what a TPP would do post-consent
against the v2.1 Account Information surface:

```text
GET /open-finance/account-information/v2.1/parties           ─┐
GET /open-finance/account-information/v2.1/accounts          ─┤  parallel
                                                              │
for accountId in accounts:                                    │
  GET .../accounts/{accountId}/balances        ─┐             │
  GET .../accounts/{accountId}/transactions    ─┤  parallel   │
  GET .../accounts/{accountId}/standing-orders ─┘             │
```

Map each call to a sandbox URL by replacing the API base with
`/fixtures/v1/bundles/<persona>/<lfi>/seed-<n>/` and replacing
`/` in the rest of the path with `__`. The on-disk file is the same
v2.1-shaped envelope your TPP code already parses.

## Postman collection

`postman.json` mirrors the same flow, chaining `{{accountId}}` from the
`/accounts` response into the per-account requests via Postman's
test-script `pm.environment.set`.

## Pin for stability

Read `manifest.json.version` at boot (the demo prints it in the footer)
and snapshot if it changes. For high-stakes pitches, install the
`@openfinance-os/sandbox-fixtures` npm package and pin the version —
that's immutable, raw URLs are latest-only.

## Disclaimer

Synthetic, illustrative data. Not endorsed by Nebras / CBUAE / any LFI.
Not a substitute for the Nebras-operated regulatory sandbox at
certification time. Use these fixtures for showcase, not compliance.
