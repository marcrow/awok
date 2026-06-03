"""Tests for the engine/content root split (--workdir)."""
from pathlib import Path


def test_default_content_equals_engine(bbw_module):
    """With no workdir, content paths sit on the engine root — unchanged behaviour."""
    eng = bbw_module.ENGINE_ROOT
    assert bbw_module.CONTENT_ROOT == eng
    assert bbw_module.DEFAULT_WORKFLOWS_DIR == eng / "src" / "workflows"
    assert bbw_module.DEFAULT_AGENTS_DIR == eng / "src" / "agents"
    assert bbw_module.DEFAULT_INVOCATIONS_DIR == eng / "src" / "workflow" / "templates" / "invocations"
    assert bbw_module.DEFAULT_SCHEMA_PATH == eng / "src" / "workflow" / "workflow.schema.json"
    assert bbw_module.REPO_ROOT_GUESS == eng


def test_apply_roots_splits_engine_and_content(bbw_module, tmp_path, restore_roots):
    """A workdir moves content paths; templates + schema stay on the engine."""
    eng = bbw_module.ENGINE_ROOT
    content = tmp_path / "wd"
    bbw_module._apply_roots(eng, content)
    # content side
    assert bbw_module.DEFAULT_WORKFLOWS_DIR == content / "src" / "workflows"
    assert bbw_module.DEFAULT_AGENTS_DIR == content / "src" / "agents"
    assert bbw_module.DEFAULT_INVOCATIONS_DIR == content / "src" / "workflow" / "templates" / "invocations"
    # engine side — unchanged
    assert bbw_module.DEFAULT_SCHEMA_PATH == eng / "src" / "workflow" / "workflow.schema.json"
    assert bbw_module.REPO_ROOT_GUESS == eng


import shutil

REPO_ROOT = Path(__file__).resolve().parents[3]
ENGINE_INVOCATIONS = REPO_ROOT / "src" / "workflow" / "templates" / "invocations"


def _scaffold_workdir(content: Path):
    """Create a minimal, self-sufficient workdir: one workflow + its agent + snippet."""
    (content / "src" / "workflows").mkdir(parents=True)
    (content / "src" / "agents").mkdir(parents=True)
    inv = content / "src" / "workflow" / "templates" / "invocations"
    inv.mkdir(parents=True)
    # reuse the shared test-agent snippet so render works
    shutil.copy(ENGINE_INVOCATIONS / "test-agent.md", inv / "wd-agent.md")
    (inv / "wd-agent.md").write_text(
        (inv / "wd-agent.md").read_text().replace("agent: test-agent", "agent: wd-agent"))
    (content / "src" / "agents" / "wd-agent.md").write_text(
        "---\nname: wd-agent\nmodel: inherit\ntools:\n  - Read\n  - Write\n---\n\nWrite the result.\n")
    (content / "src" / "workflows" / "wf.yaml").write_text("""schema_version: 1
skill:
  name: wf
  description: Workdir smoke workflow
groups:
  g: { description: x }
phases:
  - id: P1
    name: Only
    group: g
    invocations:
      - agent: wd-agent
""")


def test_generate_writes_into_workdir_not_engine(bbw_module, tmp_path, restore_roots):
    eng = bbw_module.ENGINE_ROOT
    content = tmp_path / "priv"
    _scaffold_workdir(content)
    bbw_module._apply_roots(eng, content)

    class Args:  # minimal argparse.Namespace stand-in
        workflow = "wf"
        output_skill = None
    rc = bbw_module.cmd_generate(Args())

    assert rc == 0
    # SKILL + cartography land under the WORKDIR, never under the engine repo
    assert (content / "src" / "skills" / "wf" / "SKILL.md").is_file()
    assert (content / "docs" / "architecture-cartography" / "wf.html").is_file()
    assert (content / "docs" / "architecture-cartography" / "index.html").is_file()
    assert not (eng / "src" / "skills" / "wf").exists()
