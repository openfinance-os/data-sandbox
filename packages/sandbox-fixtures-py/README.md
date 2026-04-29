# openfinance-os-sandbox-fixtures

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures from the
[Open Finance Data Sandbox](https://github.com/openfinance-os/data-sandbox).

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
    load_fixture, list_personas, list_endpoints, load_spec,
)

sara = load_fixture(
    persona="salaried_expat_mid",
    lfi="median",
    endpoint="/accounts/{AccountId}/transactions",
)
# v2.1-shaped envelope: {"Data": {"AccountId", "Transaction": [...]}, "Links", "Meta", "_watermark", ...}

list_personas()
# ['salaried_expat_mid', 'salaried_emirati_affluent', ...]

list_endpoints("hnw_multicurrency")
# ['/accounts', '/accounts/{AccountId}', '/accounts/{AccountId}/balances', ...]

spec = load_spec()
spec["endpoints"]["/accounts"]["fields"]
# field metadata: status (mandatory/optional/conditional), type, format, enum, ...
```

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
