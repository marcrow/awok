"""Tests for the orchestration layer (block tree + merge)."""
import textwrap
from pathlib import Path

FIX = Path(__file__).parent / "fixtures" / "workflows"


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


def test_block_id_collides_with_phase(bbw_module):
    wf = {
        "phases": [{"id": "A"}, {"id": "B"}],
        "orchestration": [{"id": "A", "if": {"op": "exists", "left": "b.x"},
                           "then": [{"ref": "B"}]}],
    }
    errs = bbw_module.validate_orchestration(wf)
    assert any("block id 'A'" in e and "phase" in e for e in errs)


def test_duplicate_block_id(bbw_module):
    wf = {
        "phases": [{"id": "A"}],
        "orchestration": [
            {"id": "G", "if": {"op": "exists", "left": "a.x"}, "then": [{"ref": "A"}]},
            {"id": "G", "while": {"op": "exists", "left": "a.x"}, "cap": 2, "body": [{"ref": "A"}]},
        ],
    }
    errs = bbw_module.validate_orchestration(wf)
    assert any("duplicate block id 'G'" in e for e in errs)


def test_loop_requires_cap(bbw_module):
    wf = _wf([{"while": {"op": "==", "left": "t1.v", "right": "x"}, "body": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("cap" in e.lower() for e in errs)


def test_condition_references_unknown_signal(bbw_module):
    wf = _wf([{"if": {"op": "==", "left": "ghost.v", "right": "x"}, "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("ghost.v" in e for e in errs)


def test_condition_unknown_signal_on_hyphenated_phase(bbw_module):
    wf = _wf(
        [{"if": {"op": "==", "left": "o2-deps.ghost", "right": "x"}, "then": [{"ref": "O2-DEPS"}]}],
        phases=[{"id": "O2-DEPS", "name": "d", "group": "g"}],
    )
    errs = bbw_module.validate_orchestration(wf)
    assert any("o2-deps.ghost" in e for e in errs)


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


def test_and_or_not_valid_condition(bbw_module):
    wf = _wf(
        [{"if": {"or": [
            {"and": [{"op": "==", "left": "t1.waf", "right": "true"},
                     {"op": ">", "left": "t1.risk", "right": 7}]},
            {"not": {"op": "==", "left": "t1.status", "right": "open"}},
        ]}, "then": [{"ref": "T1"}]}],
        emits=[{"name": "waf", "type": "bool", "source": "token"},
               {"name": "risk", "type": "number", "source": "token"},
               {"name": "status", "type": "string", "source": "token"}],
    )
    assert bbw_module.validate_orchestration(wf) == []


def test_nested_unknown_signal_is_caught(bbw_module):
    wf = _wf([{"if": {"and": [{"op": "==", "left": "t1.v", "right": "x"},
                              {"op": "==", "left": "ghost.v", "right": "y"}]},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("ghost.v" in e for e in errs)


def test_incomplete_leaf_missing_right_is_error(bbw_module):
    wf = _wf([{"if": {"op": "==", "left": "t1.v", "right": ""},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("incomplete" in e.lower() or "missing" in e.lower() for e in errs)


def test_builtin_missing_argument_is_error(bbw_module):
    wf = _wf([{"if": {"op": "exists", "left": {"file_exists": ""}},
               "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("argument" in e.lower() and "file_exists" in e for e in errs)


def test_group_with_single_member_warns_not_blocks(bbw_module):
    wf = _wf([{"if": {"and": [{"op": "==", "left": "t1.v", "right": "x"}]},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    # non-blocking: no ERROR, but a warning string is present
    assert any("at least 2" in e.lower() or "single member" in e.lower() for e in errs)
    assert all(e.lower().startswith("orchestration:") for e in errs)


def test_escape_hatch_inside_group_rejected_in_js(bbw_module):
    wf = _wf([{"if": {"or": [{"op": "exists", "left": "t1.v"},
                             "some free predicate"]},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "bool", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf, target="js")
    assert any("escape-hatch" in e.lower() for e in errs)


def test_parallel_block_rejected_by_schema(bbw_module):
    import jsonschema, pytest
    schema = bbw_module.load_orchestration_schema()
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate([{"parallel": [{"ref": "A"}]}], schema)


def test_schema_accepts_and_or_not(bbw_module):
    import jsonschema
    schema = bbw_module.load_orchestration_schema()
    block = {"if": {"or": [
        {"and": [{"op": "==", "left": "recon.waf", "right": "true"},
                 {"op": ">", "left": "scan.risk", "right": "7"}]},
        {"not": {"and": [{"op": "==", "left": "scan.status", "right": "open"},
                         {"op": "exists", "left": {"file_exists": "/etc/passwd"}}]}},
    ]}, "then": [{"ref": "A"}]}
    jsonschema.validate([block], schema)  # must not raise


def test_schema_rejects_unknown_connector(bbw_module):
    import jsonschema, pytest
    schema = bbw_module.load_orchestration_schema()
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate([{"if": {"xor": [{"op": "exists", "left": "a.x"}]},
                              "then": [{"ref": "A"}]}], schema)


def test_until_missing_cap_message_names_the_loop(bbw_module):
    wf = _wf([{"until": {"op": "==", "left": "t1.v", "right": "x"}, "body": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    cap_errs = [e for e in errs if "cap" in e.lower()]
    assert cap_errs, "expected a missing-cap error"
    assert not any("None" in e for e in cap_errs)


def test_for_each_missing_cap(bbw_module):
    wf = _wf([{"for_each": "t1.items", "body": [{"ref": "T1"}]}],
             emits=[{"name": "items", "type": "list", "source": "field"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("cap" in e.lower() for e in errs)


def test_for_each_unknown_signal(bbw_module):
    wf = _wf([{"for_each": "ghost.items", "cap": 5, "body": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("ghost.items" in e for e in errs)


def test_for_each_non_list_signal(bbw_module):
    wf = _wf([{"for_each": "t1.items", "cap": 5, "body": [{"ref": "T1"}]}],
             emits=[{"name": "items", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("list" in e.lower() for e in errs)


def test_for_each_valid(bbw_module):
    wf = _wf([{"for_each": "t1.items", "cap": 5, "body": [{"ref": "T1"}]}],
             emits=[{"name": "items", "type": "list", "source": "field"}])
    assert bbw_module.validate_orchestration(wf) == []


def test_fixture_validates_and_renders(bbw_module):
    model = bbw_module.load_workflow(FIX / "orchestrated.yaml")
    assert bbw_module.validate_schema(model) == []
    assert bbw_module.validate_orchestration(model) == []
    md = bbw_module.render_orchestration(model)
    assert "For each" in md and "recon.endpoints" in md


def test_render_emits_execution_protocol(bbw_module):
    model = bbw_module.load_workflow(FIX / "orchestrated.yaml")
    md = bbw_module.render_orchestration(model)
    assert "## Execution protocol" in md
    assert "in one message" in md            # explicit concurrency instruction
    assert "in this order" not in md         # old imperative framing gone


def test_render_no_parallel_keyword(bbw_module):
    model = bbw_module.load_workflow(FIX / "orchestrated.yaml")
    md = bbw_module.render_orchestration(model)
    assert "In parallel" not in md


def test_discover_workflows_excludes_orchestration_sibling(bbw_module, tmp_path):
    """An <name>.orchestration.yaml is a sibling of <name>.yaml, never a
    workflow of its own — enumerating it as one crashes the grafting."""
    _write(tmp_path, "w.yaml", """
        schema_version: 1
        skill: {name: w, description: x}
        groups: {g: {description: x}}
        phases: [{id: T1, name: a, group: g}]
    """)
    _write(tmp_path, "w.orchestration.yaml", "- ref: T1\n")
    names = [name for name, _ in bbw_module.discover_workflows(tmp_path)]
    assert names == ["w"]
    assert "w.orchestration" not in names


def test_depends_on_block_id_accepted_by_coherence(bbw_module):
    """A phase may depend on a logic-block id; coherence resolves it to the
    block's members instead of rejecting it as an unknown phase (spec §3:
    depend on the whole block, not an action reaching inside it)."""
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [
            {"id": "A", "name": "a", "group": "g",
             "emits": [{"name": "flag", "type": "bool", "source": "token"}]},
            {"id": "B", "name": "b", "group": "g"},
            {"id": "Z", "name": "z", "group": "g", "depends_on": ["GATE"]},
        ],
        "orchestration": [
            {"id": "GATE", "if": {"op": "==", "left": "a.flag", "right": True},
             "then": [{"ref": "A"}], "else": [{"ref": "B"}]},
        ],
    }
    errs = bbw_module.validate_coherence(wf)
    assert not any("GATE" in e for e in errs), errs


def test_render_condition_renders_bool_literal_lowercase(bbw_module):
    """A YAML `true`/`false` operand loads as a Python bool; render it
    YAML/JS-style, not as Python's capitalized `True`/`False`."""
    rendered = bbw_module._render_condition(
        {"op": "==", "left": "t1.flag", "right": True})
    assert "`true`" in rendered and "True" not in rendered


def _wf_dep(phases, orchestration):
    return {"phases": phases, "orchestration": orchestration}


def test_outsider_cannot_depend_on_inner_action(bbw_module):
    # Z (root) depends on A which lives inside an if-branch -> forbidden
    wf = _wf_dep(
        [{"id": "COND_SRC"}, {"id": "A"}, {"id": "Z", "depends_on": ["A"]}],
        [{"if": {"op": "exists", "left": "cond_src.x"}, "then": [{"ref": "A"}]},
         {"ref": "Z"}],
    )
    errs = bbw_module.validate_orchestration(wf)
    assert any("'Z' depends on 'A'" in e and "not visible" in e for e in errs)


def test_inner_can_depend_on_outer_action(bbw_module):
    # A (inside if) depends on RECON (root) -> allowed
    wf = _wf_dep(
        [{"id": "RECON"}, {"id": "A", "depends_on": ["RECON"]}],
        [{"ref": "RECON"},
         {"if": {"op": "exists", "left": "recon.x"}, "then": [{"ref": "A"}]}],
    )
    errs = bbw_module.validate_orchestration(wf)
    assert not any("not visible" in e for e in errs)


def test_outsider_can_depend_on_sibling_block(bbw_module):
    # Z depends on the if-block G (sibling scope) -> allowed
    wf = _wf_dep(
        [{"id": "A"}, {"id": "Z", "depends_on": ["G"]}],
        [{"id": "G", "if": {"op": "exists", "left": "a.x"}, "then": [{"ref": "A"}]},
         {"ref": "Z"}],
    )
    errs = bbw_module.validate_orchestration(wf)
    assert not any("not visible" in e for e in errs)


def test_outsider_cannot_depend_on_nested_block(bbw_module):
    # Z depends on inner block H nested inside outer block G -> forbidden
    wf = _wf_dep(
        [{"id": "A"}, {"id": "Z", "depends_on": ["H"]}],
        [{"id": "G", "if": {"op": "exists", "left": "a.x"},
          "then": [{"id": "H", "if": {"op": "exists", "left": "a.y"}, "then": [{"ref": "A"}]}]},
         {"ref": "Z"}],
    )
    errs = bbw_module.validate_orchestration(wf)
    assert any("'Z' depends on 'H'" in e and "not visible" in e for e in errs)


def test_cross_branch_dependency_forbidden(bbw_module):
    # B in else depends on A in then -> different scopes, forbidden
    wf = _wf_dep(
        [{"id": "S"}, {"id": "A"}, {"id": "B", "depends_on": ["A"]}],
        [{"if": {"op": "exists", "left": "s.x"},
          "then": [{"ref": "A"}], "else": [{"ref": "B"}]}],
    )
    errs = bbw_module.validate_orchestration(wf)
    assert any("'B' depends on 'A'" in e and "not visible" in e for e in errs)


def test_phase_referenced_twice_is_error(bbw_module):
    wf = {
        "phases": [{"id": "S"}, {"id": "A"}],
        "orchestration": [
            {"ref": "A"},
            {"if": {"op": "exists", "left": "s.x"}, "then": [{"ref": "A"}]},
        ],
    }
    errs = bbw_module.validate_orchestration(wf)
    assert any("'A'" in e and "referenced more than once" in e for e in errs)


def test_block_completion_cycle_detected(bbw_module):
    # A is inside block G; Z depends on G; A depends on Z -> cycle through G-completion
    wf = {
        "phases": [{"id": "S"}, {"id": "A", "depends_on": ["Z"]},
                   {"id": "Z", "depends_on": ["G"]}],
        "orchestration": [
            {"id": "G", "if": {"op": "exists", "left": "s.x"}, "then": [{"ref": "A"}]},
            {"ref": "Z"},
        ],
    }
    errs = bbw_module.validate_orchestration(wf)
    assert any("cycle" in e.lower() for e in errs)


def test_loop_output_unknown_namespace(bbw_module):
    wf = {
        "namespaces": {"work": "work/x"},
        "phases": [{"id": "SRC", "emits": [{"name": "items", "type": "list",
                    "source": "field", "from": "src.json"}]},
                   {"id": "BODY"}],
        "orchestration": [
            {"for_each": "src.items", "as": "it", "cap": 10,
             "output": {"role": "nope:results", "kind": "dir"},
             "body": [{"ref": "BODY"}]},
        ],
    }
    errs = bbw_module.validate_orchestration(wf)
    assert any("output" in e and "namespace" in e for e in errs)


def test_loop_output_valid_namespace(bbw_module):
    wf = {
        "namespaces": {"work": "work/x"},
        "phases": [{"id": "SRC", "emits": [{"name": "items", "type": "list",
                    "source": "field", "from": "src.json"}]},
                   {"id": "BODY"}],
        "orchestration": [
            {"for_each": "src.items", "as": "it", "cap": 10,
             "output": {"role": "work:results", "kind": "dir"},
             "body": [{"ref": "BODY"}]},
        ],
    }
    errs = bbw_module.validate_orchestration(wf)
    assert not any("output" in e for e in errs)


def test_overlay_carries_block_id_and_loop_output(bbw_module):
    wf = {
        "namespaces": {"work": "work/x"},
        "phases": [{"id": "SRC", "emits": [{"name": "items", "type": "list",
                    "source": "field", "from": "src.json"}]}, {"id": "BODY"}],
        "orchestration": [
            {"id": "LOOP1", "for_each": "src.items", "as": "it", "cap": 5,
             "output": {"role": "work:results", "kind": "dir"},
             "body": [{"ref": "BODY"}]},
        ],
    }
    ov = bbw_module.build_orchestration_overlay(wf)
    assert ov["loops"][0]["id"] == "LOOP1"
    assert ov["loops"][0]["output"] == "work:results"
