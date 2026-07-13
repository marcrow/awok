"""Tests for the JSON Schema validation of workflow.yaml."""
from pathlib import Path
import json
import yaml
import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "src" / "workflow" / "workflow.schema.json"
FIXTURES_DIR = Path(__file__).parent / "fixtures" / "workflows"


def test_schema_loads():
    """Schema file is valid JSON."""
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    assert schema["$schema"] == "http://json-schema.org/draft-07/schema#"


def test_minimal_workflow_validates(bbw_module):
    """Minimal valid workflow passes validation."""
    with open(FIXTURES_DIR / "minimal.yaml") as f:
        wf = yaml.safe_load(f)
    errors = bbw_module.validate_schema(wf)
    assert errors == [], f"Unexpected errors: {errors}"


def test_missing_schema_version_fails(bbw_module):
    """Workflow without schema_version fails."""
    wf = {"groups": {}, "phases": []}
    errors = bbw_module.validate_schema(wf)
    assert any("schema_version" in e for e in errors)


def test_invalid_phase_id_pattern_fails(bbw_module):
    """Phase IDs must match ^[A-Z][A-Z0-9-]*$."""
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "invalid-lowercase", "name": "X", "group": "g"}],
    }
    errors = bbw_module.validate_schema(wf)
    assert any("invalid-lowercase" in e or "pattern" in e for e in errors)


def test_orchestration_schema_accepts_valid_tree(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g"}],
        "orchestration": [
            {"ref": "T1"},
            {"if": {"op": "==", "left": "t1.status", "right": "ok"}, "then": [{"ref": "T1"}]},
        ],
    }
    assert bbw_module.validate_schema(wf) == []


def test_orchestration_schema_rejects_bad_operator(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g"}],
        "orchestration": [{"if": {"op": "~=", "left": "a", "right": "b"}, "then": [{"ref": "T1"}]}],
    }
    assert bbw_module.validate_schema(wf) != []


def test_phase_emits_accepted(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g",
                    "emits": [{"name": "verdict", "type": "enum", "source": "token"}]}],
    }
    assert bbw_module.validate_schema(wf) == []


def test_orchestration_schema_accepts_standalone_until(bbw_module):
    """A standalone `until` block (no sibling `while`) must validate — this is
    the 6th supported construct (ref/if/while/until/for_each/parallel)."""
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g",
                    "emits": [{"name": "v", "type": "string", "source": "token"}]}],
        "orchestration": [
            {"until": {"op": "==", "left": "t1.v", "right": "x"}, "cap": 3, "body": [{"ref": "T1"}]},
        ],
    }
    assert bbw_module.validate_schema(wf) == []


def test_orchestration_schema_accepts_for_each(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g"}],
        "orchestration": [
            {"for_each": "t1.items", "as": "item", "cap": 5, "body": [{"ref": "T1"}]},
        ],
    }
    assert bbw_module.validate_schema(wf) == []


def test_orchestration_schema_accepts_parallel(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g"}],
        "orchestration": [
            {"parallel": [{"ref": "T1"}, {"ref": "T1"}]},
        ],
    }
    assert bbw_module.validate_schema(wf) == []
