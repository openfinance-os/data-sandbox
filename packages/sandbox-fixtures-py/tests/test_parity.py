"""E-04 — npm ↔ PyPI parity suite.

Asserts the Python loader serves the SAME fixture corpus as the npm package
by reading packages/sandbox-fixtures/manifest.json (the npm package's own
index) directly and comparing it with what the Python API returns.

Run from the repo root (or this package dir) after `npm run build:fixtures`:

    python3 -m pytest packages/sandbox-fixtures-py/tests/

Skips cleanly when the fixture packages have not been built yet (same
FIXTURES_BUILT gating pattern as tests/fixture-package.test.mjs on the JS
side).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]          # packages/sandbox-fixtures-py
REPO_ROOT = PKG_ROOT.parents[1]                          # repo root
NPM_PKG = REPO_ROOT / "packages" / "sandbox-fixtures"    # the npm package tree
SRC_DIR = PKG_ROOT / "src"
DATA_DIR = SRC_DIR / "openfinance_os_sandbox_fixtures" / "data"

FIXTURES_BUILT = (NPM_PKG / "manifest.json").exists() and (DATA_DIR / "manifest.json").exists()

pytestmark = pytest.mark.skipif(
    not FIXTURES_BUILT,
    reason="fixture packages not built — run `npm run build:fixtures` first",
)

# Import the package from src/ without requiring an editable install.
sys.path.insert(0, str(SRC_DIR))

import openfinance_os_sandbox_fixtures as fx  # noqa: E402


@pytest.fixture(scope="module")
def npm_manifest():
    return json.loads((NPM_PKG / "manifest.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Module surface
# ---------------------------------------------------------------------------


def test_module_imports_and_exports():
    for name in fx.__all__:
        assert hasattr(fx, name), f"__all__ names missing attribute: {name}"
    # E-04 additions must be part of the public surface.
    for name in (
        "list_role_bundles",
        "load_enrichment",
        "load_brand_registry",
    ):
        assert name in fx.__all__


def test_py_typed_marker_present():
    assert (SRC_DIR / "openfinance_os_sandbox_fixtures" / "py.typed").exists()


# ---------------------------------------------------------------------------
# Persona-set parity with the npm manifest
# ---------------------------------------------------------------------------


def test_list_personas_matches_npm_manifest(npm_manifest):
    assert set(fx.list_personas()) == set(npm_manifest["personas"].keys())


def _npm_ids_for_domain(npm_manifest, domain):
    out = set()
    for pid, info in npm_manifest["personas"].items():
        ds = info.get("domains") or [info.get("domain") or "banking"]
        if domain in ds:
            out.add(pid)
    return out


@pytest.mark.parametrize("domain", ["banking", "insurance", "atm"])
def test_domain_filter_matches_npm_manifest(npm_manifest, domain):
    assert set(fx.list_personas(domain=domain)) == _npm_ids_for_domain(npm_manifest, domain)


def test_multi_domain_personas_appear_under_both_filters(npm_manifest):
    multi = {
        pid
        for pid, info in npm_manifest["personas"].items()
        if len(info.get("domains") or []) > 1
    }
    assert multi, "expected at least one multi-domain persona in the corpus"
    banking = set(fx.list_personas(domain="banking"))
    insurance = set(fx.list_personas(domain="insurance"))
    assert multi <= banking
    assert multi <= insurance


def test_unfiltered_equals_union_of_domain_filters(npm_manifest):
    union = set()
    for d in npm_manifest["domains"]:
        union |= set(fx.list_personas(domain=d))
    assert union == set(fx.list_personas())


# ---------------------------------------------------------------------------
# Journey parity
# ---------------------------------------------------------------------------


def _sample_banking_persona(npm_manifest):
    # Deterministic pick: first banking-labelled persona with accounts.
    for pid in sorted(npm_manifest["personas"]):
        info = npm_manifest["personas"][pid]
        key = f"{pid}|median|{info['default_seed']}"
        entry = npm_manifest["fixtures"].get(key)
        if entry and entry.get("accountIds") and "/parties" in entry["endpoints"]:
            return pid, info, key, entry
    pytest.fail("no banking persona with accounts found in the npm manifest")


def test_load_journey_matches_npm_manifest_entry(npm_manifest):
    pid, info, key, entry = _sample_banking_persona(npm_manifest)
    journey = fx.load_journey(persona=pid, lfi="median")
    assert journey["seed"] == info["default_seed"]
    assert journey["lfi_role"] == "primary"
    assert journey["accountIds"] == entry["accountIds"]
    # customerId must equal the npm fixture tree's /parties PartyId.
    parties_rel = entry["endpoints"]["/parties"]
    npm_parties = json.loads((NPM_PKG / parties_rel).read_text(encoding="utf-8"))
    expected_customer = npm_parties["Data"]["Party"]["PartyId"]
    assert journey["customerId"] == expected_customer
    assert journey["specSha"] == npm_manifest["specSha"]
    assert journey["version"] == npm_manifest["version"]


def test_fixture_bytes_match_npm_package(npm_manifest):
    # The mirrored envelope must be byte-identical to the npm copy.
    pid, info, key, entry = _sample_banking_persona(npm_manifest)
    rel = entry["endpoints"]["/accounts"]
    npm_bytes = (NPM_PKG / rel).read_bytes()
    py_bytes = (DATA_DIR / rel).read_bytes()
    assert npm_bytes == py_bytes


def test_role_bundles_match_npm_manifest(npm_manifest):
    role_fixtures = npm_manifest.get("roleFixtures") or {}
    assert role_fixtures, "expected roleFixtures in the npm manifest"
    by_persona = {}
    for rkey in role_fixtures:
        pid, slot = rkey.split("|")[:2]
        by_persona.setdefault(pid, [])
        if slot not in by_persona[pid]:
            by_persona[pid].append(slot)
    for pid, slots in sorted(by_persona.items()):
        assert fx.list_role_bundles(pid) == slots


# ---------------------------------------------------------------------------
# Spec selection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("domain", "npm_file"),
    [("banking", "spec.json"), ("insurance", "spec.insurance.json"), ("atm", "spec.atm.json")],
)
def test_load_spec_domains(npm_manifest, domain, npm_file):
    spec = fx.load_spec(domain=domain)
    npm_spec = json.loads((NPM_PKG / npm_file).read_text(encoding="utf-8"))
    assert spec == npm_spec


def test_load_spec_rejects_unknown_domain():
    with pytest.raises(KeyError):
        fx.load_spec(domain="wealth")


# ---------------------------------------------------------------------------
# Enrichment + brand registry
# ---------------------------------------------------------------------------


def test_load_enrichment_matches_npm_sidecar(npm_manifest):
    for pid in sorted(npm_manifest["personas"]):
        info = npm_manifest["personas"][pid]
        files = info.get("enrichmentFiles") or {}
        if files:
            seed = info["default_seed"]
            rel = files[str(seed)]
            side = fx.load_enrichment(pid)
            npm_side = json.loads((NPM_PKG / rel).read_text(encoding="utf-8"))
            assert side == npm_side
            assert side["personaId"] == pid
            assert side["seed"] == seed
            return
    pytest.fail("no persona with an enrichment sidecar found in the npm manifest")


def test_load_brand_registry_matches_npm():
    registry = fx.load_brand_registry()
    npm_registry = json.loads((NPM_PKG / "brand-registry.json").read_text(encoding="utf-8"))
    assert registry == npm_registry
    assert registry["records"], "brand registry must not be empty"


# ---------------------------------------------------------------------------
# Pagination parity with the JS engine
# ---------------------------------------------------------------------------


def _js_pagination_defaults():
    src = (NPM_PKG / "lib" / "shared" / "pagination.js").read_text(encoding="utf-8")
    default_limit = re.search(r"defaultLimit:\s*(\d+)", src)
    max_limit = re.search(r"maxLimit:\s*(\d+)", src)
    assert default_limit and max_limit, "could not parse PAGINATION_DEFAULTS from pagination.js"
    return int(default_limit.group(1)), int(max_limit.group(1))


def test_pagination_constants_match_js():
    default_limit, max_limit = _js_pagination_defaults()
    assert fx.PAGINATION_DEFAULT_LIMIT == default_limit
    assert fx.PAGINATION_MAX_LIMIT == max_limit


def test_load_fixture_page_behaviour(npm_manifest):
    # Find a persona/endpoint with enough transactions to need paging.
    for pid in sorted(npm_manifest["personas"]):
        info = npm_manifest["personas"][pid]
        key = f"{pid}|median|{info['default_seed']}"
        entry = npm_manifest["fixtures"].get(key) or {}
        for ep in entry.get("endpoints", {}):
            if not ep.endswith("/transactions") or "{" in ep:
                continue
            full = fx.load_fixture(pid, lfi="median", endpoint=ep)
            txs = full.get("Data", {}).get("Transaction")
            if not isinstance(txs, list) or len(txs) <= 5:
                continue
            page = fx.load_fixture_page(pid, endpoint=ep, lfi="median", offset=0, limit=5)
            assert len(page["Data"]["Transaction"]) == 5
            assert page["Meta"]["TotalPages"] == (len(txs) + 4) // 5
            assert "Next" in page["Links"]
            assert "Prev" not in page["Links"]
            assert page["_pagination"]["totalRecords"] == len(txs)
            assert page["_pagination"]["hasNext"] is True
            # Page slice must equal the corresponding slice of the full array.
            assert page["Data"]["Transaction"] == txs[0:5]
            return
    pytest.fail("no paginatable transactions fixture found")
