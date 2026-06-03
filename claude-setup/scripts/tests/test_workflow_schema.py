"""Tests for the JSON Schema validation of workflow.yaml."""
from pathlib import Path
import json
import yaml
import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "claude-setup" / "workflow" / "workflow.schema.json"
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
