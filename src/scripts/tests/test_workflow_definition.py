import importlib.util, pathlib, copy
from importlib.machinery import SourceFileLoader
_loader = SourceFileLoader(
    "bbw", str(pathlib.Path(__file__).resolve().parents[1] / "bb-workflow"))
spec = importlib.util.spec_from_loader("bbw", _loader)
bbw = importlib.util.module_from_spec(spec); spec.loader.exec_module(bbw)

BASE = {
    "schema_version": 1,
    "skill": {"name": "demo", "description": "d"},
    "groups": {"g": {"description": "x"}},
    "phases": [{"id": "P0", "name": "p", "group": "g"}],
}

def _wf(**over):
    wf = copy.deepcopy(BASE); wf.update(over); return wf

def test_schema_accepts_minimal_definition():
    wf = _wf(definition={
        "params": [{"name": "question", "type": "string", "required": True}],
        "outputs": [{"role": "work:report", "kind": "md", "produced_by": "promote"}],
        "emits": [{"name": "status", "type": "string", "source": "promote", "from": "p0.status"}],
    })
    assert bbw.validate_schema(wf) == []

def test_schema_rejects_bad_param_name_and_bad_produced_by():
    wf = _wf(definition={"params": [{"name": "Bad", "type": "string"}],
                         "outputs": [{"role": "work:r", "kind": "md", "produced_by": "nope"}]})
    errs = bbw.validate_schema(wf)
    assert any("params" in e for e in errs)
    assert any("produced_by" in e or "outputs" in e for e in errs)

def test_schema_accepts_workflow_call_args():
    wf = _wf(phases=[{"id": "C1", "name": "call", "group": "g",
                      "type": "workflow_call", "workflow": "other",
                      "args": {"question": "hello", "mode": "signal:p0.status"}}])
    assert bbw.validate_schema(wf) == []

def test_params_rules():
    wf = _wf(definition={"params": [
        {"name": "ok", "type": "enum", "values": ["a"], "default": "a"},
        {"name": "bad_enum", "type": "enum", "values": []},
        {"name": "req_def", "type": "string", "required": True, "default": "x"},
        {"name": "dup", "type": "string"}, {"name": "dup", "type": "string"},
        {"name": "listp", "type": "list"},
    ]})
    errs = bbw.validate_definition(wf)
    assert any("bad_enum" in e and "values" in e for e in errs)
    assert any("req_def" in e and "default" in e for e in errs)
    assert any("duplicate" in e and "dup" in e for e in errs)
    assert any("listp" in e and "of" in e for e in errs)
    assert not any("'ok'" in e for e in errs)

def test_outputs_and_emits_rules():
    wf = _wf(
        phases=[{"id": "SYN", "name": "s", "group": "g", "type": "agent",
                 "invocations": [{"agent": "a", "outputs": [{"role": "work:draft", "kind": "json"}]}],
                 "emits": [{"name": "verdict", "type": "string", "source": "field",
                            "from": "work:draft", "field": "verdict"}]}],
        definition={
            "outputs": [
                {"role": "work:missing", "kind": "md", "produced_by": "promote"},
                {"role": "work:final", "kind": "md", "produced_by": "formatter"},
            ],
            "emits": [
                {"name": "ok", "type": "string", "source": "promote", "from": "syn.verdict"},
                {"name": "ghost", "type": "string", "source": "promote", "from": "syn.nope"},
                {"name": "len", "type": "number", "source": "create", "from": "work:final", "field": "n"},
            ],
            "formatter": {"enabled": True, "prompt": "x",
                          "invoke": {"type": "agent", "agent": "a"},
                          "inputs": [{"role": "work:draft", "kind": "json"}]},
        })
    errs = bbw.validate_definition(wf)
    # promote of a role not produced anywhere → error
    assert any("work:missing" in e for e in errs)
    # promote of an unknown internal signal → error
    assert any("ghost" in e and "syn.nope" in e for e in errs)
    # create emit reads a non-json output (md) → error (needs json + field)
    assert any("'len'" in e and "json" in e for e in errs)
    assert not any("'ok'" in e for e in errs)

def test_create_emit_requires_formatter():
    wf = _wf(definition={"emits": [
        {"name": "x", "type": "number", "source": "create", "from": "work:final", "field": "n"}]})
    errs = bbw.validate_definition(wf)
    assert any("'x'" in e and "formatter" in e for e in errs)

def test_workflow_call_args_binding(tmp_path):
    # target workflow with a required param
    wfs = tmp_path / "workflows"; wfs.mkdir()
    (wfs / "target.yaml").write_text(
        "schema_version: 1\n"
        "skill: {name: target, description: d}\n"
        "groups: {g: {description: x}}\n"
        "phases: [{id: P0, name: p, group: g}]\n"
        "definition:\n  params:\n    - {name: question, type: string, required: true}\n")
    caller = _wf(phases=[{"id": "C1", "name": "c", "group": "g", "type": "workflow_call",
                          "workflow": "target", "args": {"unknown": "v"}}])
    errs = bbw.validate_coherence(caller, agents_dir=tmp_path, workflows_dir=wfs)
    assert any("question" in e and "unbound" in e for e in errs)
    assert any("unknown" in e for e in errs)

def test_synthesize_definition_phase():
    wf = _wf(definition={
        "outputs": [{"role": "work:final", "kind": "md", "produced_by": "formatter"}],
        "emits": [{"name": "ok", "type": "string", "source": "promote", "from": "p0.ok"}],
        "formatter": {"enabled": True, "prompt": "x",
                      "invoke": {"type": "agent", "agent": "summarizer", "model": "sonnet"},
                      "inputs": [{"role": "work:draft", "kind": "json"}]}})
    ph = bbw._synthesize_definition_phase(wf)
    assert ph["id"] == "DEFINITION"
    assert any(o["role"] == "work:final" for o in ph["outputs"])
    assert any(i["role"] == "work:draft" for i in ph["inputs"])
    assert wf["phases"] and wf["phases"][0]["id"] == "P0"  # phases NOT mutated

def test_synthesize_none_without_definition():
    assert bbw._synthesize_definition_phase(_wf()) is None

def test_dataflow_graph_ingests_definition_formatter_io():
    # DEFINITION acts as a terminal node: PRODUCER of its formatter's output
    # (produced_by: formatter) and CONSUMER of its formatter's input.
    wf = _wf(
        namespaces={"work": "work/demo"},
        definition={
            "outputs": [{"role": "work:final", "kind": "md", "produced_by": "formatter"}],
            "formatter": {"enabled": True, "prompt": "x",
                          "invoke": {"type": "agent", "agent": "summarizer", "model": "sonnet"},
                          "inputs": [{"role": "work:draft", "kind": "json"}]},
        })
    out_path = bbw.resolve_io_path({"role": "work:final", "kind": "md"}, wf["namespaces"])
    in_path = bbw.resolve_io_path({"role": "work:draft", "kind": "json"}, wf["namespaces"])
    # mode="all" — the definition's own I/O has no other producer/consumer in
    # this minimal workflow, so "internal" mode would filter the edges out.
    graph = bbw.build_dataflow_graph(wf, mode="all")
    assert any(e[0] == "DEFINITION" and e[3] == out_path for e in graph["producer_edges"]), \
        graph["producer_edges"]
    assert any(e[0] == "DEFINITION" and e[3] == in_path for e in graph["consumer_edges"]), \
        graph["consumer_edges"]

def test_dataflow_graph_workflow_call_produces_target_definition_outputs(tmp_path, monkeypatch):
    # A workflow_call phase "receives" its target's declared definition outputs,
    # so it must show up as their PRODUCER in the caller's dataflow graph.
    wfs = tmp_path / "workflows"; wfs.mkdir()
    (wfs / "target.yaml").write_text(
        "schema_version: 1\n"
        "skill: {name: target, description: d}\n"
        "groups: {g: {description: x}}\n"
        "phases: [{id: P0, name: p, group: g}]\n"
        "namespaces: {work: work/target}\n"
        "definition:\n"
        "  outputs:\n"
        "    - {role: work:final, kind: md, produced_by: promote}\n")
    monkeypatch.setattr(bbw, "DEFAULT_WORKFLOWS_DIR", wfs)

    caller = _wf(phases=[{"id": "C1", "name": "c", "group": "g",
                          "type": "workflow_call", "workflow": "target"}])
    graph = bbw.build_dataflow_graph(caller, mode="all")
    tgt_path = bbw.resolve_io_path({"role": "work:final", "kind": "md"}, {"work": "work/target"})
    assert any(e[0] == "C1" and e[3] == tgt_path for e in graph["producer_edges"]), \
        graph["producer_edges"]

def test_compile_style():
    lines = bbw.compile_style({"length": "brief", "tone": "didactic",
                               "format": "bullets", "language": "French",
                               "mustInclude": ["TL;DR"], "avoid": ["preamble"], "stance": "recommend"})
    joined = " ".join(lines)
    assert "brief" in joined and "didactic" in joined and "bullet" in joined.lower()
    assert "French" in joined and "TL;DR" in joined and "preamble" in joined
    assert bbw.compile_style({"tone": "custom", "toneCustom": "like a pirate"}) == ["like a pirate"]
    assert bbw.compile_style({}) == []

def test_generate_renders_definition(tmp_path):
    # Minimal end-to-end: build the skill for a workflow with a definition and
    # assert the rendered markdown mentions the boundary + the composed prompt.
    wf = _wf(definition={
        "outputs": [{"role": "work:final", "kind": "md", "produced_by": "formatter"}],
        "emits": [{"name": "ok", "type": "string", "source": "promote", "from": "p0.ok"}],
        "formatter": {"enabled": True, "prompt": "Write the final summary.",
                      "invoke": {"type": "main_agent"},
                      "style": {"length": "brief", "format": "tldr"}}})
    md = bbw.render_skill_markdown(wf)
    assert "Workflow output" in md
    assert "Write the final summary." in md
    assert "TL;DR" in md   # compiled style injected


def test_dataflow_graph_workflow_call_missing_target_does_not_crash(tmp_path, monkeypatch):
    # Crash-guard: a workflow_call whose target .yaml doesn't exist must be a
    # silent no-op for dataflow (no crash, no spurious producer edge).
    wfs = tmp_path / "workflows"; wfs.mkdir()
    monkeypatch.setattr(bbw, "DEFAULT_WORKFLOWS_DIR", wfs)

    caller = _wf(phases=[{"id": "C1", "name": "c", "group": "g",
                          "type": "workflow_call", "workflow": "ghost"}])
    graph = bbw.build_dataflow_graph(caller, mode="all")
    assert not any(e[0] == "C1" for e in graph["producer_edges"])


FIXTURE_DIR = pathlib.Path(__file__).resolve().parent / "fixtures" / "workflows"


def test_definition_demo_fixture_validates_clean():
    # The demo fixture exercises every §8 rule POSITIVELY: params (mixed
    # string/enum/number/list-of), a promote emit off an internal signal, a
    # create emit off a formatter json output + field, and both
    # produced_by kinds on the outputs list. It must validate with zero errors.
    wf = bbw.load_workflow(FIXTURE_DIR / "definition_demo.yaml")
    assert bbw.validate_schema(wf) == []
    assert bbw.validate_coherence(wf, agents_dir=pathlib.Path(__file__).resolve().parents[2] / "agents") == []
    assert bbw.validate_definition(wf) == []


def test_definition_demo_fixture_renders_golden_substrings():
    # Golden-substring test (not a full golden file): render the fixture's
    # SKILL.md and check the DEFINITION boundary section + composed prompt +
    # both emit flavors (promote and create) show up.
    wf = bbw.load_workflow(FIXTURE_DIR / "definition_demo.yaml")
    md = bbw.render_skill_markdown(wf)

    # boundary section header + reserved terminal action
    assert "Workflow output — the contract callers bind" in md
    assert "`DEFINITION`" in md

    # composed prompt: io listing (formatter reads/writes) + compiled style + free prompt
    assert "work:highlights" in md and "work:summary" in md
    assert "Keep the answer brief" in md
    assert "Write in a professional tone." in md
    assert "Structure as bullet points." in md
    assert "Compose the final channel summary from the gathered highlights" in md

    # both emit flavors on the return-signals line
    assert "`sentiment` (enum) — promoted from `analyze.sentiment`" in md
    assert "`summary_len` (number) — from output `work:summary`.`length`" in md


def test_view_payload_has_definition_preview():
    wf = _wf(definition={
        "outputs": [{"role": "work:final", "kind": "md", "produced_by": "formatter"}],
        "formatter": {"enabled": True, "prompt": "Do it.",
                      "invoke": {"type": "main_agent"}, "style": {"length": "terse"},
                      "inputs": [{"role": "work:draft", "kind": "json"}]}})
    view = bbw.build_view_payload(wf)
    assert "definition_preview" in view
    assert "Do it." in view["definition_preview"]["prompt"]
    assert any("terse" in c for c in view["definition_preview"]["compiled"])
