# openfinance-os-sandbox-fixtures

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the
[Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox).

39 personas (21 banking + 9 insurance + 8 multi-domain + 1 ATM directory) ×
3 LFI profiles × every v2.1 endpoint per persona's accounts/policies,
plus the parsed v2.1 OpenAPI specs for all three domains (banking +
insurance + ATM Locator), the persona manifests, the enrichment sidecars,
and the brand registry.

Python wrapper around the npm package
[`@openfinance-os/sandbox-fixtures`](https://www.npmjs.com/package/@openfinance-os/sandbox-fixtures).
Same fixtures, same SHA, same determinism guarantees.

## Install

```
pip install openfinance-os-sandbox-fixtures
```

## Use

```python
from openfinance_os_sandbox_fixtures import (
    load_fixture, load_journey, list_personas, list_endpoints, load_spec,
)

sara = load_fixture(
    persona="salaried_expat_mid",
    lfi="median",
    endpoint="/accounts/{AccountId}/transactions",
)
# v2.1-shaped envelope: {"Data": {"AccountId", "Transaction": [...]}, "Links", "Meta", "_watermark", ...}

journey = load_journey(persona="salaried_expat_mid", lfi="median")
# {"persona", "lfi", "seed", "accountIds", "customerId",
#  "specVersion", "specSha", "version",
#  "endpoints": {"/accounts": envelope, "/parties": envelope,
#                "/accounts/{AccountId}/balances": envelope, ... all coherent}}
# AccountIds, CustomerId line up across every endpoint — drop-in replacement
# for the Nebras-operated regulatory sandbox's mock data when wiring up TPP
# demo journeys for sales / pitch / QA flows that need richer payloads.

list_personas()
# ['salaried_expat_mid', 'salaried_emirati_affluent', ...]

list_endpoints("hnw_multicurrency")
# ['/accounts', '/accounts/{AccountId}', '/accounts/{AccountId}/balances', ...]

spec = load_spec()
spec["endpoints"]["/accounts"]["fields"]
# field metadata: status (mandatory/optional/conditional), type, format, enum, ...

load_spec(domain="insurance")   # parsed insurance spec (all 7 lines)
load_spec(domain="atm")         # parsed ATM Locator spec

list_personas(domain="banking")
# banking + multi-domain persona ids — multi-domain personas appear under
# BOTH the 'banking' and 'insurance' filters, matching the sandbox UI
```

## Role bundles (multi-LFI footprints)

Personas declaring a `multi_lfi_footprint` ship extra role bundles — the same
customer seen from their secondary/tertiary (or Phase 2.2 N-slot) banking
relationships:

```python
from openfinance_os_sandbox_fixtures import list_role_bundles, load_journey

list_role_bundles("sme_fnb_multi_outlet")   # e.g. ['secondary', 'tertiary']
side = load_journey(persona="sme_fnb_multi_outlet", lfi="median", lfi_role="secondary")
```

## Enrichment sidecar + brand registry

```python
from openfinance_os_sandbox_fixtures import load_enrichment, load_brand_registry

enriched = load_enrichment("salaried_expat_mid")
# {"schema", "personaId", "seed", "records": {TransactionId: {merchant, mcc,
#   category, subcategory, logoSlug, logoUrl, primaryColor, parentGroup, ...}}}

registry = load_brand_registry()
# slug-keyed: {"records": {logoSlug: {merchantName, logoUrl, primaryColor, ...}}}
```

## Pagination

`load_fixture_page(persona, endpoint=..., offset=..., limit=...)` returns one
page of a listing endpoint with spec-correct `Links` / `Meta.TotalPages` and a
`_pagination` sidecar; `paginate_envelope` works on an envelope already in
memory. Defaults match the npm package (`limit=25`, max 500).

## Typing

The package ships a `py.typed` marker — the inline annotations are visible to
mypy / pyright.

## Determinism

Every fixture is a pure function of `(persona_id, lfi_profile, seed, build-time now-anchor)`.
Same package version → byte-identical fixtures. Pin the package, pin your tests.

## Spec version

UAE Open Finance Standards `v2.1`, vendored from
[Nebras-Open-Finance/api-specs:ozone](https://github.com/Nebras-Open-Finance/api-specs/tree/ozone)
at the SHA recorded in `manifest()["specSha"]`.

## Licensing

- **Loader code:** MIT
- **Synthetic data:** CC0 — public domain

## Reporting issues

[github.com/openfinance-os/data-sandbox/issues](https://github.com/openfinance-os/data-sandbox/issues)
