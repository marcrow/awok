"""Dataflow warnings respect explicit external/terminal markers on I/O items.

An input declared `external: true` comes from outside the agent DAG (produced
by an external tool) and must not warn about a missing producer. An output declared
`terminal: true` is a final artifact (read by the hunter / report phase) and
must not warn about a missing consumer. Unmarked orphans still warn — that is
what catches genuinely-forgotten edges.
"""


def _wf(inputs=None, outputs=None):
    inv = {"agent": "a"}
    if inputs:
        inv["inputs"] = inputs
    if outputs:
        inv["outputs"] = outputs
    return {
        "schema_version": 1,
        "phases": [{"id": "T1", "name": "x", "group": "g", "invocations": [inv]}],
    }


def test_orphan_output_warns(bbw_module):
    wf = _wf(outputs=[{"path": "work/foo.json", "kind": "json"}])
    w = bbw_module.check_dataflow_warnings(wf)
    assert any("work/foo.json" in x and "no consumer" in x for x in w)


def test_terminal_output_suppressed(bbw_module):
    wf = _wf(outputs=[{"path": "work/foo.json", "kind": "json", "terminal": True}])
    w = bbw_module.check_dataflow_warnings(wf)
    assert not any("work/foo.json" in x for x in w)


def test_orphan_input_warns(bbw_module):
    wf = _wf(inputs=[{"path": "work/bar.json", "kind": "json"}])
    w = bbw_module.check_dataflow_warnings(wf)
    assert any("work/bar.json" in x and "no producer" in x for x in w)


def test_external_input_suppressed(bbw_module):
    wf = _wf(inputs=[{"path": "work/bar.json", "kind": "json", "external": True}])
    w = bbw_module.check_dataflow_warnings(wf)
    assert not any("work/bar.json" in x for x in w)


def _wf2(producer_outputs, consumer_inputs):
    """Two-phase workflow: T1 produces, T2 (depends on T1) consumes."""
    return {
        "schema_version": 1,
        "phases": [
            {"id": "T1", "name": "p", "group": "g",
             "invocations": [{"agent": "a", "outputs": producer_outputs}]},
            {"id": "T2", "name": "c", "group": "g", "depends_on": ["T1"],
             "invocations": [{"agent": "b", "inputs": consumer_inputs}]},
        ],
    }


def test_output_consumed_via_directory_input(bbw_module):
    """A file output is consumed when a downstream phase inputs its parent dir."""
    wf = _wf2(
        producer_outputs=[{"path": "work/x/a.json", "kind": "json"}],
        consumer_inputs=[{"path": "work/x/", "kind": "dir"}],
    )
    w = bbw_module.check_dataflow_warnings(wf)
    assert not any("work/x/a.json" in x for x in w)


def test_input_dir_satisfied_by_subfile_output(bbw_module):
    """A dir input has a producer when some output lives under it."""
    wf = _wf2(
        producer_outputs=[{"path": "work/x/a.json", "kind": "json"}],
        consumer_inputs=[{"path": "work/x/", "kind": "dir"}],
    )
    w = bbw_module.check_dataflow_warnings(wf)
    assert not any("work/x/" in x and "no producer" in x for x in w)


def test_input_satisfied_by_phase_level_output(bbw_module):
    """A phase-level output (e.g. a prep script) counts as a producer."""
    wf = {
        "schema_version": 1,
        "phases": [
            {"id": "T1", "name": "p", "group": "g",
             "outputs": [{"path": "work/x/chunks/", "kind": "dir"}], "invocations": []},
            {"id": "T2", "name": "c", "group": "g", "depends_on": ["T1"],
             "invocations": [{"agent": "a", "inputs": [{"path": "work/x/chunks/", "kind": "dir"}]}]},
        ],
    }
    w = bbw_module.check_dataflow_warnings(wf)
    assert not any("work/x/chunks/" in x and "no producer" in x for x in w)


def test_dataflow_warnings_work_on_derived_paths(bbw_module):
    wf = {
        "schema_version": 1,
        "namespaces": {"work": "work"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a",
                             "outputs": [{"role": "work:foo", "kind": "json"}]}],
        }],
    }
    w = bbw_module.check_dataflow_warnings(wf)
    assert any("work/foo.json" in x and "no consumer" in x for x in w)
