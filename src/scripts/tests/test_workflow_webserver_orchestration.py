"""Web-server orchestration wiring: GET merge, /api/view overlay, save split."""
import textwrap
from pathlib import Path


def _write(dirpath, name, text):
    p = dirpath / name
    p.write_text(textwrap.dedent(text))
    return p


def _base_wf(dirpath):
    return _write(dirpath, "w.yaml", """
        schema_version: 1
        skill: {name: w, description: x}
        groups: {g: {description: x}}
        phases:
          - {id: RECON, name: r, group: g, emits: [{name: endpoints, type: list, source: field, from: recon.json}]}
          - {id: SCAN, name: s, group: g}
    """)


def test_read_workflow_payload_merges_sibling(bbw_module, tmp_path):
    wf = _base_wf(tmp_path)
    _write(tmp_path, "w.orchestration.yaml", "- ref: RECON\n")
    payload = bbw_module.read_workflow_payload(wf)
    assert payload["model"]["orchestration"] == [{"ref": "RECON"}]
    assert "levels" in payload


def test_read_workflow_payload_no_sibling(bbw_module, tmp_path):
    wf = _base_wf(tmp_path)
    payload = bbw_module.read_workflow_payload(wf)
    assert "orchestration" not in payload["model"]


def _wf_with_orch(orchestration, emits_status_bad=False):
    phases = [
        {"id": "RECON", "name": "r", "group": "g",
         "emits": [{"name": "endpoints", "type": "list", "source": "field", "from": "recon.json"}]},
        {"id": "SCAN", "name": "s", "group": "g"},
    ]
    return {"schema_version": 1, "skill": {"name": "w", "description": "x"},
            "groups": {"g": {"description": "x"}}, "phases": phases,
            "orchestration": orchestration}


def test_view_payload_includes_overlay_and_warnings(bbw_module):
    # while-loop WITHOUT cap -> a semantic warning, but view still returns.
    model = _wf_with_orch([{"while": {"op": "==", "left": "recon.endpoints", "right": "x"},
                            "body": [{"ref": "SCAN"}]}])
    payload = bbw_module.build_view_payload(model)
    assert "orchestration_overlay" in payload
    assert any("cap" in w for w in payload["orchestration_warnings"])


def test_view_payload_no_orch_is_quiet(bbw_module):
    model = {"schema_version": 1, "skill": {"name": "w", "description": "x"},
             "groups": {"g": {"description": "x"}},
             "phases": [{"id": "T1", "name": "a", "group": "g"}]}
    payload = bbw_module.build_view_payload(model)
    assert payload["orchestration_overlay"] == {} or payload["orchestration_overlay"].get("branches") in (None, [], {})
    assert payload["orchestration_warnings"] == []


def test_save_splits_sibling_and_is_warning_only(bbw_module, tmp_path, restore_roots):
    import yaml
    agents = tmp_path / "agents"; agents.mkdir()
    wfs = tmp_path / "workflows"; wfs.mkdir()
    model = _wf_with_orch([{"while": {"op": "==", "left": "recon.endpoints", "right": "x"},
                            "body": [{"ref": "SCAN"}]}])  # capless loop -> warning
    res = bbw_module.save_workflow("w", model, wfs, agents)
    assert res["errors"] == []                     # NOT blocked despite capless loop
    assert any("cap" in w for w in res["warnings"])
    base = yaml.safe_load((wfs / "w.yaml").read_text())
    assert "orchestration" not in base             # stripped from base file
    sib = yaml.safe_load((wfs / "w.orchestration.yaml").read_text())
    assert sib and sib[0]["while"]                 # written to sibling


def test_save_without_orch_removes_stale_sibling(bbw_module, tmp_path, restore_roots):
    agents = tmp_path / "agents"; agents.mkdir()
    wfs = tmp_path / "workflows"; wfs.mkdir()
    (wfs / "w.orchestration.yaml").write_text("- ref: SCAN\n")   # stale
    model = {"schema_version": 1, "skill": {"name": "w", "description": "x"},
             "groups": {"g": {"description": "x"}},
             "phases": [{"id": "SCAN", "name": "s", "group": "g"}]}
    res = bbw_module.save_workflow("w", model, wfs, agents)
    assert res["errors"] == []
    assert not (wfs / "w.orchestration.yaml").exists()   # stale sibling removed


def test_roundtrip_load_edit_save(bbw_module, tmp_path, restore_roots):
    import yaml
    agents = tmp_path / "agents"; agents.mkdir()
    wfs = tmp_path / "workflows"; wfs.mkdir()
    _write(wfs, "w.yaml", """
        schema_version: 1
        skill: {name: w, description: x}
        groups: {g: {description: x}}
        phases:
          - {id: RECON, name: r, group: g, emits: [{name: endpoints, type: list, source: field, from: recon.json}]}
          - {id: SCAN, name: s, group: g}
          - {id: EXPLOIT, name: e, group: g}
    """)
    _write(wfs, "w.orchestration.yaml", """
        - ref: RECON
        - for_each: recon.endpoints
          as: ep
          cap: 100
          body:
            - ref: SCAN
    """)
    payload = bbw_module.read_workflow_payload(wfs / "w.yaml")
    model = payload["model"]
    assert model["orchestration"][1]["for_each"] == "recon.endpoints"
    model["orchestration"][1]["cap"] = 50           # edit the cap
    res = bbw_module.save_workflow("w", model, wfs, agents)
    assert res["errors"] == [] and res["warnings"] == []
    reload = bbw_module.read_workflow_payload(wfs / "w.yaml")["model"]
    assert reload["orchestration"][1]["cap"] == 50
    assert "orchestration" not in yaml.safe_load((wfs / "w.yaml").read_text())


def test_save_with_null_cap_is_warning_only_and_cap_absent_on_disk(bbw_module, tmp_path, restore_roots):
    # Pins the fix: the web-editor client used to encode "no cap yet" as
    # `cap: null` (addGate/setConstruct/setCap in orchestration.js). That
    # literal null fails validate_schema's blocking structural check
    # ({"cap": {"type": "integer", "minimum": 1}} -> None is not an integer),
    # so save_workflow used to return a schema error and write nothing. The
    # server-side sanitize (_sanitize_orchestration) now coerces cap=None to
    # absent BEFORE validate_schema runs, so this is warning-only like the
    # canonical capless case, and the value written to disk has no cap key at
    # all (never a literal `cap: null`).
    import yaml
    agents = tmp_path / "agents"; agents.mkdir()
    wfs = tmp_path / "workflows"; wfs.mkdir()
    model = _wf_with_orch([{"while": {"op": "==", "left": "recon.endpoints", "right": "x"},
                            "cap": None, "body": [{"ref": "SCAN"}]}])
    res = bbw_module.save_workflow("w", model, wfs, agents)
    assert res["errors"] == []
    assert any("cap" in w for w in res["warnings"])
    sib = yaml.safe_load((wfs / "w.orchestration.yaml").read_text())
    assert "cap" not in sib[0]                      # absent, not null, on disk


def test_save_with_absent_cap_is_warning_only(bbw_module, tmp_path, restore_roots):
    # The canonical unset-cap encoding (no `cap` key at all) must behave the
    # same as the null-cap case above: warning-only, not blocked.
    import yaml
    agents = tmp_path / "agents"; agents.mkdir()
    wfs = tmp_path / "workflows"; wfs.mkdir()
    model = _wf_with_orch([{"while": {"op": "==", "left": "recon.endpoints", "right": "x"},
                            "body": [{"ref": "SCAN"}]}])   # no cap key
    res = bbw_module.save_workflow("w", model, wfs, agents)
    assert res["errors"] == []
    assert any("cap" in w for w in res["warnings"])
    sib = yaml.safe_load((wfs / "w.orchestration.yaml").read_text())
    assert "cap" not in sib[0]


def test_save_persists_block_id_and_loop_output(bbw_module, tmp_path, restore_roots):
    # Task 10: the web editor can now author a block `id` (all gate kinds) and
    # a loop `output` ({role, kind}); both must round-trip through save_workflow
    # into the sibling <name>.orchestration.yaml untouched.
    import yaml
    agents = tmp_path / "agents"; agents.mkdir()
    wfs = tmp_path / "workflows"; wfs.mkdir()
    model = _wf_with_orch([{"id": "DEPS_GATE", "cap": 5,
                            "while": {"op": "==", "left": "recon.endpoints", "right": "x"},
                            "output": {"role": "work:results", "kind": "dir"},
                            "body": [{"ref": "SCAN"}]}])
    res = bbw_module.save_workflow("w", model, wfs, agents)
    assert res["errors"] == []
    sib = yaml.safe_load((wfs / "w.orchestration.yaml").read_text())
    assert sib[0]["id"] == "DEPS_GATE"
    assert sib[0]["output"] == {"role": "work:results", "kind": "dir"}


def test_save_rejects_parallel_block(bbw_module, tmp_path, restore_roots):
    # A `parallel` block is no longer an authorable/valid construct (the
    # editor's add-menu never offered it, and orchestration.schema.json's
    # block `oneOf` only lists ref/if/while/until/for_each) — save_workflow
    # must reject it as a structural (blocking) error, not silently accept it.
    agents = tmp_path / "agents"; agents.mkdir()
    wfs = tmp_path / "workflows"; wfs.mkdir()
    model = _wf_with_orch([{"parallel": [{"ref": "SCAN"}, {"ref": "RECON"}]}])
    res = bbw_module.save_workflow("w", model, wfs, agents)
    assert res["errors"] != []
    assert not (wfs / "w.orchestration.yaml").exists()
