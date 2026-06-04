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
