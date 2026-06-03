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
