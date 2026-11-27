# Open Finance Data Sandbox

Synthetic UAE Open Finance v2.1 data you can browse, fetch or plug into an AI assistant. It gives you realistic Bank Data Sharing, Insurance and ATM Locator payloads for 38 fictional customers, with every field marked mandatory, optional or conditional straight from the published OpenAPI spec. Nothing here comes from a real customer or a real bank.

- **Explorer:** <https://data-sandbox.openfinance-os.org/>
- **Hosted MCP server:** `https://data-sandbox.fly.dev/mcp` (anonymous, no API key)
- **Integration guide:** <https://data-sandbox.openfinance-os.org/src/integrate.html>

## Try it in a minute

**1. Fetch a payload.** Static fixtures are plain JSON, served with open CORS. This is Sara, a salaried expat, as a typical bank would return her accounts:

```sh
curl -fsS https://data-sandbox.openfinance-os.org/fixtures/v1/bundles/salaried_expat_mid/median/seed-4729/accounts.json
```

Use `fixtures/v1/index.json` (about 40 KB) to list personas and their published seeds. Each persona has one published seed; any other seed is generated on demand by the options below.

**2. Ask an AI assistant.** Add the hosted MCP server as a custom connector in Claude (Settings, Connectors, Add custom connector) or in Claude Code:

```sh
claude mcp add --transport http open-finance-sandbox https://data-sandbox.fly.dev/mcp
```

Then ask, for example: "List the banking personas, pick the gig worker, and tell me how regular their income is." The assistant calls `list_personas`, `set_session` and `get_transactions`. Every tool is read-only.

**3. Use it in code.** The npm and PyPI packages are not on the registries yet, so build them from this repository:

```sh
git clone https://github.com/openfinance-os/data-sandbox.git
cd data-sandbox
npm ci && npm run build:fixtures
```

```js
// in your project, after: npm install /path/to/data-sandbox/packages/sandbox-fixtures
import { loadJourney } from '@openfinance-os/sandbox-fixtures';

const journey = loadJourney({ persona: 'salaried_expat_mid', lfi: 'median' });
console.log(journey.accountIds, Object.keys(journey.endpoints));
```

Python works the same way with `pip install ./packages/sandbox-fixtures-py` and `load_journey()`.

## What the data looks like

- **Personas:** 29 in banking (retail, SME and corporate), 17 in insurance across seven lines, and an ATM directory. Eight personas hold both bank accounts and insurance policies.
- **History:** 24 completed months up to 1 May 2026. Balances add up: salaries land in the main current account, cards are repaid monthly, and accounts do not go below zero without a credit line. `tests/financial-coherence.test.mjs` checks this for every banking persona.
- **Bank profiles:** Rich, Median and Sparse show how many optional fields a bank fills in. They are anonymous; mandatory fields are always present.
- **Reproducible:** the same persona, profile and seed always give the same bytes. Every export carries a `SYNTHETIC` watermark.

## Run it locally

Use Node 22 and Python 3.11+:

```sh
npm ci
npm run build:site
npm run serve
```

Open `http://localhost:8000/src/index.html`. `serve` uses the staged `_site/` directory. The staged examples are at `/examples/tpp-budgeting-demo/` and `/examples/accounting-multi-bank-demo/`; guided tasks are at `/src/labs.html`.

```sh
node examples/labs/run.mjs income
node examples/labs/run.mjs reconciliation
node examples/labs/run.mjs cover
npm run export:tables -- salaried_expat_mid rich
```

For failure cases (pagination, consent expiry, 429s, latency), run the local mock with `npm run mock`; see "Integrations and reproducibility" below.

## Data and purpose

There are **38 customer personas and one ATM directory manifest**: 21 banking-only, 9 insurance-only, 8 combined banking/insurance, plus ATM. The banking filter includes 29 personas and insurance includes 17. There are 12 banking GET paths, 30 insurance GET paths across seven lines and consents, and `GET /atms`.

Rich, Median and Sparse are anonymous synthetic field-population profiles. They are not measurements of named institutions. Outputs contain synthetic identities and narratives; every export carries a watermark. Integer minor units, booking status and currency determine balances and completed-period statements. Failed attempts remain available as signals but do not move booked balances.

The explorer supports schema inspection, profile comparison, source-backed income/commitment comparison, JSON/CSV downloads, and embeds. Labs cover income/fixed payments, multi-bank reconciliation, consent-aware reads, and combined banking/insurance information. Missing data is unknown, never a fabricated zero or underwriting conclusion.

## Standards evidence

The stable baseline remains **v2.1 with official consolidated Errata 4**, dated 18 September 2026. Effective wire files resolve independently: banking `v2.1-errata2`, insurance `v2.1-errata3`, ATM base `v2.1`. Exact paths, commits, hashes and official document revision are in [spec/provenance.json](spec/provenance.json).

The [official consolidated corrections](https://openfinanceuae.atlassian.net/wiki/spaces/OF/pages/1366294554/Standards+V2.1+API+Hub+V8+-+Consolidated+Errata) lead the community register, which still lists errata3. Documentation advertises v2.2-rc2 while canonical api-specs main has rc1. Neither preview was adopted as a released stable replacement.

Strict validation preserves unknown-field rejection. The upstream insurance quote `oneOf`/`allOf` compositions are defective under literal JSON Schema. A reviewed, source-hash keyed adapter flattens only those named compositions; tests report literal rejection separately from normalized acceptance. This is not certification or an upstream correction. See [docs/standards-conformance.md](docs/standards-conformance.md).

## Integrations and reproducibility

Static JSON exposes **only manifest-listed seeds/roles**. Use `index.json` to discover personas and seeds, and `manifest.json` (about 1.8 MB) only when you need the full file list. Custom recipes and arbitrary seeds use a downloaded envelope, the Node runtime generator, or the local mock. A static file ignores query parameters; it does not provide server pagination.

```sh
curl -fsS http://localhost:8000/fixtures/v1/index.json
curl -fsS http://localhost:8000/fixtures/v1/bundles/salaried_expat_mid/median/seed-4729/accounts.json
npm run mock
curl -fsS http://localhost:8788/scenarios/salaried_expat_mid/accounts
```

The mock exposes curated/custom/role scenarios, cursor pagination, empty/short history, optional absence, simulated API Hub permission loss/expiry/revocation, latency, 429 and temporary failures. These are labelled transport simulations. No real token or consent authority is issued.

The full npm/Python distributions share the same generated fixture corpus. Registry availability must be verified at release time; local tarballs/wheels are the supported way to inspect this unpublished candidate:

```sh
npm run test:install
npm run build:evaluation
npm run build:archives
```

Archives under `artifacts/releases/<corpus-version>/` include full, banking, insurance, ATM and optional evaluation packs with SHA-256 checksums. Reusing a corpus version for changed canonical bytes fails. `/fixtures/v1/` is a current alias, not an immutable historical URL; old citations use retained release packages/archives. A share URL includes its corpus version and declines replay of a different version on the current explorer.

Generated payload types are available under `@openfinance-os/sandbox-fixtures/payloads/<domain>`. The `./validation` export exposes the strict validator and documented insurance adapter; raw schemas ship under `schemas/`. Algorithms receive wire payloads. The opt-in evaluation pack keeps observed inputs and synthetic labels in separate directories, with persona-family and merchant-entity holdouts. Existing enrichment sidecars are **synthetic answer labels**, not observed bank data.

MCP supports every domain, including ATM. Transaction cursors are tied to the complete scenario and filters. Numerical summaries use the reference cutoff, default to Booked, separate currencies/status, and expose a small source-ID page plus a cursor to the remaining evidence. No mixed-currency total is implied.

## Verification and release

```sh
npm run ci
npm run build:site
npm run test:e2e
npm run test:perf
npm run test:install
node tools/check-spec-drift.mjs
```

`check:dist-clean` requires generated outputs to have been committed. Do not weaken checks to accommodate an uncommitted working tree. Releases validate the exact trusted main revision; dependent MCP publication requires its matching fixture version already in npm. Health metadata carries revision, corpus date/version, domain pins and tool catalogue hash. The post-deploy smoke performs actual synthetic banking, insurance, secondary-bank and ATM reads.

Publishing the npm and PyPI packages is pending registry credentials and configuration. The explorer stays `noindex` until the public experience has been verified. Analytics stay anonymous and allowlisted; optional lab completion is self-reported within a session and does not establish retention or user success. No outreach or user research has been performed by this change.

Code and loader license: MIT. Synthetic fixture data: CC0. Not endorsed by CBUAE, Nebras or any named institution.
