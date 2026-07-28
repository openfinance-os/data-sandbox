"""@openfinance-os/sandbox-fixtures — Python loader.

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures.
39 personas (21 banking + 9 insurance + 8 multi-domain + 1 ATM directory) ×
3 LFI profiles × every v2.1 endpoint per persona's accounts/policies, plus
the parsed v2.1 OpenAPI specs (banking + insurance + ATM) and the persona
manifests. CC0 data, MIT loader code.

Mirror of the npm package `@openfinance-os/sandbox-fixtures`.

Example
-------
    from openfinance_os_sandbox_fixtures import load_fixture, list_personas, load_spec

    sara = load_fixture(persona="salaried_expat_mid", lfi="median",
                        endpoint="/accounts/{AccountId}/transactions")
    # → v2.1-shaped envelope: {Data: {AccountId, Transaction: [...]}, Links, Meta, _watermark, ...}

    list_personas()
    # → ['salaried_expat_mid', 'salaried_emirati_affluent', ...]

    spec = load_spec()
    spec["endpoints"]["/accounts"]["fields"]   # field metadata: status, type, format, enum
"""
from __future__ import annotations

import json
from importlib import resources
from pathlib import Path
from typing import Any, Dict, List, Optional


def _data_dir() -> Path:
    """Path to the bundled `data/` directory inside the package."""
    return Path(__file__).parent / "data"


_MANIFEST_CACHE: Optional[Dict[str, Any]] = None


def _manifest() -> Dict[str, Any]:
    # Cached after first read — the manifest is immutable for a given
    # installed wheel, and several public functions consult it more than
    # once per call (mirrors the npm loader's module-scope caching).
    global _MANIFEST_CACHE
    if _MANIFEST_CACHE is None:
        _MANIFEST_CACHE = json.loads((_data_dir() / "manifest.json").read_text(encoding="utf-8"))
    return _MANIFEST_CACHE


def list_personas(domain: Optional[str] = None) -> List[str]:
    """Return the list of persona ids in the bundled fixture set.

    With ``domain`` ('banking' | 'insurance' | 'atm'), filters on the
    persona's declared domain set. Phase 2.2 multi-domain personas declare
    ``domains: ['banking', 'insurance']`` and appear under BOTH the banking
    and insurance filters — mirroring the npm loader and the sandbox UI.
    Legacy single-domain personas carrying only the singular ``domain``
    field are honoured too.
    """
    personas = _manifest()["personas"]
    if domain is None:
        return list(personas.keys())
    out: List[str] = []
    for pid, info in personas.items():
        ds = info.get("domains")
        if not isinstance(ds, list) or not ds:
            ds = [info.get("domain") or "banking"]
        if domain in ds:
            out.append(pid)
    return out


def get_persona_info(persona_id: str) -> Optional[Dict[str, Any]]:
    """Return persona metadata (name, archetype, default_seed, stress_coverage)."""
    return _manifest()["personas"].get(persona_id)


def list_endpoints(persona_id: str, lfi: str = "median") -> List[str]:
    """List the endpoints fixturised for a (persona, lfi) pair."""
    info = _manifest()["personas"].get(persona_id)
    if info is None:
        raise KeyError(f"unknown persona: {persona_id}")
    fx = _manifest()["fixtures"].get(f"{persona_id}|{lfi}|{info['default_seed']}")
    if fx is None:
        raise KeyError(f"unknown fixture key for {persona_id}|{lfi}")
    return list(fx["endpoints"].keys())


def load_fixture(
    persona: str,
    *,
    lfi: str = "median",
    seed: Optional[int] = None,
    endpoint: str,
    lfi_role: Optional[str] = None,
) -> Dict[str, Any]:
    """Load a v2.1-shaped envelope for a (persona, lfi, seed, endpoint) tuple.

    Returns the parsed JSON envelope including the watermark fields
    (_persona, _lfi, _seed, _specSha, _retrievedAt).

    ``lfi_role`` (D-14 / Phase D Slice 5): pass a non-primary role-slot key
    to read the persona's multi-LFI-footprint role bundle instead of the
    primary fixture. Legacy personas use 'secondary'/'tertiary'; Phase 2.2
    N-slot personas use arbitrary keys — see :func:`list_role_bundles`.
    """
    manifest = _manifest()
    info = manifest["personas"].get(persona)
    if info is None:
        raise KeyError(f"unknown persona: {persona}")
    use_seed = seed if seed is not None else info["default_seed"]
    if lfi_role and lfi_role != "primary":
        rkey = f"{persona}|{lfi_role}|{lfi}|{use_seed}"
        rfx = (manifest.get("roleFixtures") or {}).get(rkey)
        if rfx is None:
            raise KeyError(f"no role-bundle fixture for {rkey}")
        rel = rfx["endpoints"].get(endpoint)
        if rel is None:
            raise KeyError(f"no fixture for endpoint {endpoint!r} in {rkey}")
        return json.loads((_data_dir() / rel).read_text(encoding="utf-8"))
    key = f"{persona}|{lfi}|{use_seed}"
    fx = manifest["fixtures"].get(key)
    if fx is None:
        raise KeyError(f"no fixture for {key}")
    rel = fx["endpoints"].get(endpoint)
    if rel is None:
        raise KeyError(f"no fixture for endpoint {endpoint!r} in {key}")
    return json.loads((_data_dir() / rel).read_text(encoding="utf-8"))


def list_role_bundles(persona_id: str) -> List[str]:
    """Return the role-slot keys with an emitted role bundle for this persona.

    Derived from the manifest's roleFixtures (supports Phase 2.2 N-slot
    personas, not just the legacy secondary/tertiary triad). Mirrors the npm
    loader's ``listRoleBundles``.
    """
    out: List[str] = []
    m = _manifest()
    if persona_id not in m["personas"]:
        return out
    prefix = f"{persona_id}|"
    for key in (m.get("roleFixtures") or {}):
        if not key.startswith(prefix):
            continue
        slot = key[len(prefix):].split("|")[0]
        if slot not in out:
            out.append(slot)
    return out


_SPEC_FILE_BY_DOMAIN = {
    "banking": "spec.json",
    "insurance": "spec.insurance.json",
    "atm": "spec.atm.json",
}


def load_spec(domain: str = "banking") -> Dict[str, Any]:
    """Load a parsed v2.1 OpenAPI spec — keyed by endpoint with field metadata.

    ``domain`` selects the spec: 'banking' (default, spec.json),
    'insurance' (spec.insurance.json), or 'atm' (spec.atm.json). Mirrors the
    npm loader's ``loadSpec({ domain })``.
    """
    file = _SPEC_FILE_BY_DOMAIN.get(domain)
    if file is None:
        raise KeyError(f"unknown domain: {domain!r} (expected one of {sorted(_SPEC_FILE_BY_DOMAIN)})")
    return json.loads((_data_dir() / file).read_text(encoding="utf-8"))


def load_persona_manifest(persona_id: str) -> Dict[str, Any]:
    """Load a persona's full YAML-derived manifest (demographics, commitments, narrative)."""
    return json.loads((_data_dir() / "personas" / f"{persona_id}.json").read_text(encoding="utf-8"))


def load_journey(
    persona: str,
    *,
    lfi: str = "median",
    seed: Optional[int] = None,
    lfi_role: Optional[str] = None,
) -> Dict[str, Any]:
    """Load the full coherent bundle for one (persona, lfi, seed) tuple.

    Returns a journey dict::

        {
          "persona": str, "lfi": str, "seed": int,
          "accountIds": [str, ...],
          "customerId": str | None,             # /parties Data.Party.PartyId
          "specVersion": "v2.1", "specSha": str, "version": str,
          "endpoints": { "/accounts": envelope,
                          "/parties": envelope,
                          "/accounts/{AccountId}/balances": envelope, ... }
        }

    AccountIds, CustomerId, transactions all line up across endpoints — drop
    this in where your TPP demo currently calls the Nebras-operated regulatory
    sandbox to get richer, persona-coherent data for sales / pitch / QA flows.
    """
    m = _manifest()
    info = m["personas"].get(persona)
    if info is None:
        raise KeyError(f"unknown persona: {persona}")
    use_seed = seed if seed is not None else info["default_seed"]
    if lfi_role and lfi_role != "primary":
        rkey = f"{persona}|{lfi_role}|{lfi}|{use_seed}"
        rfx = (m.get("roleFixtures") or {}).get(rkey)
        if rfx is None:
            raise KeyError(f"no role-bundle journey for {rkey}")
        endpoints = {
            ep: json.loads((_data_dir() / rel).read_text(encoding="utf-8"))
            for ep, rel in rfx["endpoints"].items()
        }
        parties_env = endpoints.get("/parties", {})
        return {
            "persona": persona,
            "lfi": lfi,
            "lfi_role": lfi_role,
            "seed": use_seed,
            "domain": info.get("domain") or "banking",
            "accountIds": rfx.get("accountIds", []),
            "policyIds": [],
            "quoteId": None,
            "customerId": parties_env.get("Data", {}).get("Party", {}).get("PartyId"),
            "specVersion": m["specVersion"],
            "specSha": m["specSha"],
            "version": m["version"],
            "endpoints": endpoints,
        }
    key = f"{persona}|{lfi}|{use_seed}"
    fx = m["fixtures"].get(key)
    if fx is None:
        raise KeyError(f"no fixture for {key}")
    endpoints = {
        ep: json.loads((_data_dir() / rel).read_text(encoding="utf-8"))
        for ep, rel in fx["endpoints"].items()
    }
    parties_env = endpoints.get("/parties", {})
    customer_id = parties_env.get("Data", {}).get("Party", {}).get("PartyId")
    return {
        "persona": persona,
        "lfi": lfi,
        "lfi_role": "primary",
        "seed": use_seed,
        "domain": info.get("domain") or "banking",
        "accountIds": fx.get("accountIds", []),
        "policyIds": fx.get("policyIds", []),
        "quoteId": fx.get("quoteId"),
        "customerId": customer_id,
        "specVersion": m["specVersion"],
        "specSha": m["specSha"],
        "version": m["version"],
        "endpoints": endpoints,
    }


def manifest() -> Dict[str, Any]:
    """Return the top-level manifest.json."""
    return _manifest()


def load_enrichment(persona: str, *, seed: Optional[int] = None) -> Dict[str, Any]:
    """Load the per-(persona, seed) enrichment sidecar.

    The bundle stays as the v2.1 envelope a real UAE core would serve over
    Open Finance (the "raw" view); the enrichment sidecar is what a TPP's
    enrichment engine produces after cleaning (merchant, corrected MCC,
    category taxonomy, logo slug/URL, brand colour, parent group,
    MCC-misrouting metadata). Join to transactions by TransactionId.
    LFI-independent — identical under rich/median/sparse. Mirrors the npm
    loader's ``loadEnrichment``.
    """
    info = _manifest()["personas"].get(persona)
    if info is None:
        raise KeyError(f"unknown persona: {persona}")
    use_seed = seed if seed is not None else info["default_seed"]
    files = info.get("enrichmentFiles") or {}
    rel = files.get(str(use_seed)) or info.get("enrichmentFile")
    if rel is None:
        raise KeyError(f"no enrichment sidecar published for {persona} seed={use_seed}")
    data = json.loads((_data_dir() / rel).read_text(encoding="utf-8"))
    if data.get("seed") != use_seed:
        raise ValueError(
            f"enrichment sidecar seed mismatch: file has {data.get('seed')}, requested {use_seed}"
        )
    return data


_BRAND_REGISTRY_CACHE: Optional[Dict[str, Any]] = None


def load_brand_registry() -> Dict[str, Any]:
    """Load the slug-keyed brand registry (Phase R4).

    Maps merchant slug → logo URL, primary colour, website, parent group,
    display variants. The ``logoSlug`` field on an enrichment record is the
    join key. Logos are algorithmically-generated placeholders — no real
    brand marks. Mirrors the npm loader's ``loadBrandRegistry``.
    """
    global _BRAND_REGISTRY_CACHE
    if _BRAND_REGISTRY_CACHE is None:
        _BRAND_REGISTRY_CACHE = json.loads(
            (_data_dir() / "brand-registry.json").read_text(encoding="utf-8")
        )
    return _BRAND_REGISTRY_CACHE


# --- Pagination — Open Finance v2.1 Links/Meta envelope ----------------------
#
# Mirrors the JS `paginateEnvelope` helper. Slices the single array-valued
# child of Data and emits spec-correct Links.{Self,First,Last,Next,Prev} +
# Meta.TotalPages. A `_pagination` sidecar exposes the resolved page state.
#
# Use `load_fixture_page` for the common "give me one page" workflow, or
# call `paginate_envelope` directly when you already have an envelope in
# memory (e.g. served over HTTP from your own gateway).

_PAGINATABLE_DATA_KEYS = (
    "Transaction",
    "StandingOrder",
    "DirectDebit",
    "Beneficiary",
    "ScheduledPayment",
    "Statements",
    "Policies",
    "Account",
    "Balance",
    "Product",
    "Party",
)
_ROOT_ARRAY_SENTINEL = "__root__"
PAGINATION_DEFAULT_LIMIT = 25
PAGINATION_MAX_LIMIT = 500


def _find_list_key(envelope: Dict[str, Any]) -> Optional[str]:
    if not isinstance(envelope, dict):
        return None
    data = envelope.get("Data")
    if isinstance(data, list):
        return _ROOT_ARRAY_SENTINEL
    if not isinstance(data, dict):
        return None
    for key in _PAGINATABLE_DATA_KEYS:
        if isinstance(data.get(key), list):
            return key
    return None


def is_paginatable_envelope(envelope: Dict[str, Any]) -> bool:
    """True if the envelope carries a single paginatable array under Data."""
    return _find_list_key(envelope) is not None


def _build_links(base_url: str, offset: int, limit: int, total: int) -> Dict[str, str]:
    from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse

    parsed = urlparse(base_url)
    qs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
          if k not in ("offset", "limit")]

    def with_params(off: int, lim: int) -> str:
        new_qs = qs + [("offset", str(off)), ("limit", str(lim))]
        return urlunparse(parsed._replace(query=urlencode(new_qs)))

    links: Dict[str, str] = {"Self": with_params(offset, limit)}
    links["First"] = with_params(0, limit)
    last_offset = 0 if total == 0 else max(0, ((total - 1) // limit) * limit)
    links["Last"] = with_params(last_offset, limit)
    if offset + limit < total:
        links["Next"] = with_params(offset + limit, limit)
    if offset > 0:
        links["Prev"] = with_params(max(0, offset - limit), limit)
    return links


def paginate_envelope(
    envelope: Dict[str, Any],
    *,
    offset: int = 0,
    limit: int = PAGINATION_DEFAULT_LIMIT,
    request_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Slice the listable array under Data and emit a spec-shaped paginated envelope.

    If the envelope is not paginatable (e.g. /accounts/{AccountId} returning a
    single record), the envelope is returned with Links.Self refreshed and no
    other changes.
    """
    key = _find_list_key(envelope)
    if key is None:
        # Non-paginatable — refresh Self if a request_url was supplied.
        if request_url:
            out = dict(envelope)
            out["Links"] = {**(envelope.get("Links") or {}), "Self": request_url}
            return out
        return dict(envelope)

    arr = envelope["Data"] if key == _ROOT_ARRAY_SENTINEL else envelope["Data"][key]
    total = len(arr)
    off = 0 if total == 0 else max(0, offset)
    lim = max(1, min(PAGINATION_MAX_LIMIT, limit))
    slice_ = arr[off:off + lim]
    if key == _ROOT_ARRAY_SENTINEL:
        new_data = slice_
    else:
        new_data = dict(envelope["Data"])
        new_data[key] = slice_
    total_pages = 1 if total == 0 else (total + lim - 1) // lim
    self_url = request_url or envelope.get("Links", {}).get("Self") or ""

    return {
        **envelope,
        "Data": new_data,
        "Links": _build_links(self_url, off, lim, total),
        "Meta": {**(envelope.get("Meta") or {}), "TotalPages": total_pages},
        "_pagination": {
            "offset": off,
            "limit": lim,
            "totalRecords": total,
            "totalPages": total_pages,
            "pageNumber": (off // lim) + 1,
            "hasNext": off + lim < total,
            "hasPrevious": off > 0,
        },
    }


def load_fixture_page(
    persona: str,
    *,
    endpoint: str,
    lfi: str = "median",
    seed: Optional[int] = None,
    offset: int = 0,
    limit: int = PAGINATION_DEFAULT_LIMIT,
    request_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Load one page of a paginatable fixture endpoint.

    Equivalent to ``paginate_envelope(load_fixture(...), offset=..., limit=...)``
    but synthesises a `sandbox:/fixtures/v1/...` `Links.Self` when no
    `request_url` is supplied so the paginated envelope is well-formed.
    """
    envelope = load_fixture(persona, lfi=lfi, seed=seed, endpoint=endpoint)
    if request_url is None:
        info = _manifest()["personas"].get(persona) or {}
        use_seed = seed if seed is not None else info.get("default_seed", 0)
        safe = endpoint.lstrip("/").replace("/", "__").replace("{", "").replace("}", "")
        request_url = f"sandbox:/fixtures/v1/bundles/{persona}/{lfi}/seed-{use_seed}/{safe}.json"
    return paginate_envelope(envelope, offset=offset, limit=limit, request_url=request_url)


__all__ = [
    "list_personas",
    "get_persona_info",
    "list_endpoints",
    "list_role_bundles",
    "load_fixture",
    "load_fixture_page",
    "load_journey",
    "load_spec",
    "load_persona_manifest",
    "load_enrichment",
    "load_brand_registry",
    "manifest",
    "paginate_envelope",
    "is_paginatable_envelope",
    "PAGINATION_DEFAULT_LIMIT",
    "PAGINATION_MAX_LIMIT",
]
