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


def _wf(orchestration, phases=None, emits=None):
    phases = phases or [{"id": "T1", "name": "a", "group": "g"}]
    if emits:
        phases[0]["emits"] = emits
    return {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": phases,
        "orchestration": orchestration,
    }


def test_block_ref_unknown_phase(bbw_module):
    errs = bbw_module.validate_orchestration(_wf([{"ref": "NOPE"}]))
    assert any("NOPE" in e for e in errs)


def test_loop_requires_cap(bbw_module):
    wf = _wf([{"while": {"op": "==", "left": "t1.v", "right": "x"}, "body": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("cap" in e.lower() for e in errs)


def test_condition_references_unknown_signal(bbw_module):
    wf = _wf([{"if": {"op": "==", "left": "ghost.v", "right": "x"}, "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("ghost.v" in e for e in errs)


def test_numeric_operator_on_string_signal(bbw_module):
    wf = _wf([{"if": {"op": "<", "left": "t1.v", "right": 3}, "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("t1.v" in e and "number" in e for e in errs)


def test_file_exists_rejected_in_js_target(bbw_module):
    wf = _wf([{"if": {"op": "exists", "left": {"file_exists": "x.txt"}}, "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf, target="js")
    assert any("file_exists" in e for e in errs)


def test_escape_hatch_ok_in_standard(bbw_module):
    wf = _wf([{"if": "le rapport mentionne un CVE", "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf, target="standard")
    assert errs == []
