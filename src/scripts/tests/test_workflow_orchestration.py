"""Tests for the orchestration layer (block tree + merge)."""
import textwrap


def _write(dirpath, name, text):
    p = dirpath / name
    p.write_text(textwrap.dedent(text))
    return p


def test_load_workflow_without_orchestration(bbw_module, tmp_path):
    wf_path = _write(tmp_path, "w.yaml", """
        schema_version: 1
        skill: {name: w, description: x}
        groups: {g: {description: x}}
        phases: [{id: T1, name: a, group: g}]
    """)
    model = bbw_module.load_workflow(wf_path)
    assert "orchestration" not in model


def test_load_workflow_merges_orchestration(bbw_module, tmp_path):
    wf_path = _write(tmp_path, "w.yaml", """
        schema_version: 1
        skill: {name: w, description: x}
        groups: {g: {description: x}}
        phases: [{id: T1, name: a, group: g}]
    """)
    _write(tmp_path, "w.orchestration.yaml", """
        - ref: T1
    """)
    model = bbw_module.load_workflow(wf_path)
    assert model["orchestration"] == [{"ref": "T1"}]
