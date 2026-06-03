"""Tests for the rename-agent utility."""
from pathlib import Path
import yaml


def test_rename_agent_updates_yaml(bbw_module, tmp_path):
    workflow = tmp_path / "workflow.yaml"
    workflow.write_text("""schema_version: 1
groups: { g: { description: x } }
phases:
  - id: T1
    name: x
    group: g
    invocations:
      - agent: old-name
""")
    snippets_dir = tmp_path / "snippets"
    snippets_dir.mkdir()
    (snippets_dir / "old-name.md").write_text("---\nagent: old-name\n---\nbody")
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "old-name.md").write_text("---\nname: old-name\n---\nx")

    bbw_module.rename_agent("old-name", "new-name",
                            workflow_path=workflow,
                            snippets_dir=snippets_dir,
                            agents_dir=agents_dir)

    wf = yaml.safe_load(workflow.read_text())
    assert wf["phases"][0]["invocations"][0]["agent"] == "new-name"
    assert (snippets_dir / "new-name.md").exists()
    assert not (snippets_dir / "old-name.md").exists()
    assert (agents_dir / "new-name.md").exists()
    assert not (agents_dir / "old-name.md").exists()
    snippet_content = (snippets_dir / "new-name.md").read_text()
    assert "agent: new-name" in snippet_content
