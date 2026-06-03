"""Tests for drift detection."""
import pytest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_check_no_drift(bbw_module, tmp_path):
    """Check returns [] if SKILL.md matches what would be generated."""
    import shutil
    # Setup tmp workspace
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"

    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "invocations" / "test-agent.md",
        invocations_dir / "test-agent.md",
    )
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )

    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    workflow = tmp_path / "wf.yaml"
    workflow.write_text("""schema_version: 1
skill:
  name: check-test
  description: Toy workflow used by check tests
groups: { g: { description: x } }
phases:
  - id: T1
    name: First
    group: g
    invocations:
      - agent: test-agent
""")
    skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(workflow, skill, templates_dir=templates_dir, agents_dir=agents_dir)
    drift = bbw_module.check_drift(workflow, skill, templates_dir=templates_dir, agents_dir=agents_dir)
    assert drift == []  # no drift


def test_check_drift_detected(bbw_module, tmp_path):
    import shutil
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"

    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "invocations" / "test-agent.md",
        invocations_dir / "test-agent.md",
    )
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )

    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    workflow = tmp_path / "wf.yaml"
    workflow.write_text("""schema_version: 1
skill:
  name: check-test
  description: Toy workflow used by check tests
groups: { g: { description: x } }
phases:
  - id: T1
    name: First
    group: g
    invocations:
      - agent: test-agent
""")
    skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(workflow, skill, templates_dir=templates_dir, agents_dir=agents_dir)
    # Tamper
    skill.write_text(skill.read_text() + "\n\n# Manually added\n")
    drift = bbw_module.check_drift(workflow, skill, templates_dir=templates_dir, agents_dir=agents_dir)
    assert drift != []
    assert any("differ" in d.lower() for d in drift)
