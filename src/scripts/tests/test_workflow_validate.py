"""Tests for coherence validation beyond the JSON schema."""
from pathlib import Path
import yaml
import pytest


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "workflows"


def load_fixture(name):
    with open(FIXTURES_DIR / name) as f:
        return yaml.safe_load(f)


def test_minimal_passes_coherence(bbw_module, tmp_path):
    """Minimal workflow has no coherence errors."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    wf = load_fixture("minimal.yaml")
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert errors == []


def test_unknown_agent_fails(bbw_module, tmp_path):
    """Agent referenced but not in agents/ dir."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()

    wf = load_fixture("minimal.yaml")
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("test-agent" in e and "not found" in e for e in errors)


def test_cycle_detection(bbw_module, tmp_path):
    """Cyclic depends_on detected."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    wf = load_fixture("invalid-cycle.yaml")
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("cycle" in e.lower() for e in errors)


def test_orphan_dependency_detected(bbw_module, tmp_path):
    """depends_on references a phase that doesn't exist."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    wf = load_fixture("invalid-orphan.yaml")
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("T999" in e for e in errors)


def test_unknown_group_fails(bbw_module, tmp_path):
    """Phase references a group not declared."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "x", "group": "undeclared-group", "invocations": []}],
    }
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("undeclared-group" in e for e in errors)


def test_unknown_condition_fails(bbw_module, tmp_path):
    """skip_if references a condition not declared."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "conditions": {},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "test-agent", "skip_if": "no_such_condition"}],
        }],
    }
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("no_such_condition" in e for e in errors)


def test_skill_name_mismatch_warns(bbw_module, tmp_path):
    """Warn when the file stem differs from skill.name (outputs are named after
    skill.name, so reporter.yaml + skill.name:test silently makes test.html)."""
    wf = {"skill": {"name": "test"}}
    warns = bbw_module.check_skill_name_matches_filename(wf, tmp_path / "reporter.yaml")
    assert warns
    assert "test" in warns[0] and "reporter" in warns[0]


def test_skill_name_match_no_warn(bbw_module, tmp_path):
    wf = {"skill": {"name": "reporter"}}
    assert bbw_module.check_skill_name_matches_filename(wf, tmp_path / "reporter.yaml") == []
