"""Guard tests on every REAL workflow under claude-setup/workflows/ + its
generated SKILL.md.

The other workflow tests run against toy/fixture workflows. These lock the
shipped pipelines against regressions when a phase/agent is added and the
artifacts regenerated. They mirror what `bb-workflow validate` and the
pre-commit `check` hook enforce, but in pytest so CI catches them too.

Warnings (check_dataflow_warnings) are intentionally left advisory and not
asserted here.
"""
from pathlib import Path
import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS_DIR = REPO_ROOT / "claude-setup" / "workflows"
AGENTS_DIR = REPO_ROOT / "claude-setup" / "agents"
SKILLS_DIR = REPO_ROOT / "claude-setup" / "skills"


def _workflow_files():
    return sorted(WORKFLOWS_DIR.glob("*.yaml"))


def _skill_path_for(workflow_path: Path) -> Path:
    with open(workflow_path) as f:
        wf = yaml.safe_load(f)
    skill_name = (wf.get("skill") or {}).get("name") or workflow_path.stem
    return SKILLS_DIR / skill_name / "SKILL.md"


@pytest.mark.parametrize("workflow_path", _workflow_files(),
                          ids=lambda p: p.stem)
def test_real_workflow_passes_schema(bbw_module, workflow_path):
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)
    errors = bbw_module.validate_schema(workflow)
    assert errors == [], f"[{workflow_path.stem}] schema errors: {errors}"


@pytest.mark.parametrize("workflow_path", _workflow_files(),
                          ids=lambda p: p.stem)
def test_real_workflow_passes_coherence(bbw_module, workflow_path):
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)
    errors = bbw_module.validate_coherence(workflow, agents_dir=AGENTS_DIR)
    assert errors == [], f"[{workflow_path.stem}] coherence errors: {errors}"


@pytest.mark.parametrize("workflow_path", _workflow_files(),
                          ids=lambda p: p.stem)
def test_real_skill_has_no_drift(bbw_module, workflow_path):
    skill_path = _skill_path_for(workflow_path)
    drift = bbw_module.check_drift(workflow_path, skill_path)
    assert drift == [], (
        f"[{workflow_path.stem}] drift (run bb-workflow generate "
        f"--workflow {workflow_path.stem}): {drift}"
    )
