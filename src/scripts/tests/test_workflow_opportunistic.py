"""Tests for the `opportunistic` field: schema, resolution, validation, rendering."""
from pathlib import Path
import shutil
import yaml
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
TEMPLATES_DIR = REPO_ROOT / "src" / "workflow" / "templates"
SNIPPETS_DIR = TEMPLATES_DIR / "invocations"


def _base_wf(**top):
    wf = {
        "schema_version": 1,
        "skill": {"name": "demo", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "First", "group": "g"}],
    }
    wf.update(top)
    return wf


# --- Task 1: schema acceptance ---

def test_schema_accepts_opportunistic_bool_toplevel(bbw_module):
    wf = _base_wf(opportunistic=True)
    assert bbw_module.validate_schema(wf) == []


def test_schema_accepts_opportunistic_object_toplevel(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True, "when": "w", "examples": ["e"]})
    assert bbw_module.validate_schema(wf) == []


def test_schema_accepts_opportunistic_on_phase(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = {"when": "w"}
    assert bbw_module.validate_schema(wf) == []


def test_schema_accepts_opportunistic_false_on_phase(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = False
    assert bbw_module.validate_schema(wf) == []


def test_schema_rejects_unknown_key_in_object(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True, "bogus": 1})
    errors = bbw_module.validate_schema(wf)
    assert errors != []


def test_schema_rejects_wrong_type(bbw_module):
    wf = _base_wf(opportunistic=123)
    errors = bbw_module.validate_schema(wf)
    assert errors != []


# --- Task 2: resolution / precedence ---

def _resolved(bbw_module, wf):
    """Run resolve_opportunistic and return (global_dict, {phase_id: _opp})."""
    g = bbw_module.resolve_opportunistic(wf)
    return g, {p["id"]: p["_opp"] for p in wf["phases"]}


def test_resolve_global_off_phase_absent(bbw_module):
    wf = _base_wf()
    g, opp = _resolved(bbw_module, wf)
    assert g["enabled"] is False
    assert opp["T1"]["enabled"] is False
    assert opp["T1"]["mark"] is None
    assert opp["T1"]["note_kind"] is None


def test_resolve_global_on_phase_inherits(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True, "when": "gw", "examples": ["ge"]})
    g, opp = _resolved(bbw_module, wf)
    assert g["enabled"] is True
    assert opp["T1"]["enabled"] is True
    assert opp["T1"]["mark"] is None          # inherited, no own content → unmarked
    assert opp["T1"]["note_kind"] is None
    assert opp["T1"]["when"] == "gw"           # inherited guidance available


def test_resolve_global_off_phase_enables_standalone(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = True
    g, opp = _resolved(bbw_module, wf)
    assert opp["T1"]["enabled"] is True
    assert opp["T1"]["needs_full_grant"] is True
    assert opp["T1"]["mark"] == "opportunistic"
    assert opp["T1"]["note_kind"] == "full"


def test_resolve_global_on_phase_override_guidance(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True})
    wf["phases"][0]["opportunistic"] = {"when": "pw", "examples": ["pe"]}
    g, opp = _resolved(bbw_module, wf)
    assert opp["T1"]["mark"] == "opportunistic"
    assert opp["T1"]["note_kind"] == "short"
    assert opp["T1"]["when"] == "pw"
    assert opp["T1"]["examples"] == ["pe"]


def test_resolve_global_on_phase_locked(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True})
    wf["phases"][0]["opportunistic"] = False
    g, opp = _resolved(bbw_module, wf)
    assert opp["T1"]["explicitly_disabled"] is True
    assert opp["T1"]["mark"] == "locked"
    assert opp["T1"]["note_kind"] == "locked"


def test_resolve_global_off_phase_false_is_inert(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = False
    g, opp = _resolved(bbw_module, wf)
    assert opp["T1"]["mark"] is None           # nothing to lock when global off
    assert opp["T1"]["note_kind"] is None
