"""@openfinance-os/sandbox-fixtures — Python loader.

Deterministic, v2.1-shaped UAE Open Finance synthetic fixtures.
10 personas × 3 LFI profiles × 12+ endpoints, plus the parsed v2.1
OpenAPI spec and the persona manifests. CC0 data, MIT loader code.

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


def _manifest() -> Dict[str, Any]:
    return json.loads((_data_dir() / "manifest.json").read_text(encoding="utf-8"))


def list_personas() -> List[str]:
    """Return the list of persona ids in the bundled fixture set."""
    return list(_manifest()["personas"].keys())


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
) -> Dict[str, Any]:
    """Load a v2.1-shaped envelope for a (persona, lfi, seed, endpoint) tuple.

    Returns the parsed JSON envelope including the watermark fields
    (_persona, _lfi, _seed, _specSha, _retrievedAt).
    """
    manifest = _manifest()
    info = manifest["personas"].get(persona)
    if info is None:
        raise KeyError(f"unknown persona: {persona}")
    use_seed = seed if seed is not None else info["default_seed"]
    key = f"{persona}|{lfi}|{use_seed}"
    fx = manifest["fixtures"].get(key)
    if fx is None:
        raise KeyError(f"no fixture for {key}")
    rel = fx["endpoints"].get(endpoint)
    if rel is None:
        raise KeyError(f"no fixture for endpoint {endpoint!r} in {key}")
    return json.loads((_data_dir() / rel).read_text(encoding="utf-8"))


def load_spec() -> Dict[str, Any]:
    """Load the parsed v2.1 OpenAPI spec — keyed by endpoint with field metadata."""
    return json.loads((_data_dir() / "spec.json").read_text(encoding="utf-8"))


def load_persona_manifest(persona_id: str) -> Dict[str, Any]:
    """Load a persona's full YAML-derived manifest (demographics, commitments, narrative)."""
    return json.loads((_data_dir() / "personas" / f"{persona_id}.json").read_text(encoding="utf-8"))


def load_journey(
    persona: str,
    *,
    lfi: str = "median",
    seed: Optional[int] = None,
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
        "seed": use_seed,
        "accountIds": fx.get("accountIds", []),
        "customerId": customer_id,
        "specVersion": m["specVersion"],
        "specSha": m["specSha"],
        "version": m["version"],
        "endpoints": endpoints,
    }


def manifest() -> Dict[str, Any]:
    """Return the top-level manifest.json."""
    return _manifest()


__all__ = [
    "list_personas",
    "get_persona_info",
    "list_endpoints",
    "load_fixture",
    "load_journey",
    "load_spec",
    "load_persona_manifest",
    "manifest",
]
