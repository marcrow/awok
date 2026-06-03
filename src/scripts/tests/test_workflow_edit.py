"""Tests for the bb-workflow web editor helpers and HTTP handler."""
import json
import yaml
import pytest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_dump_preserves_key_order(bbw_module):
    model = {"schema_version": 1, "skill": {"name": "x", "description": "d"},
             "groups": {"g": {"description": "x"}}, "phases": []}
    out = bbw_module.dump_workflow_yaml(model)
    assert out.index("schema_version") < out.index("skill")
    assert out.index("skill") < out.index("groups")


def test_dump_io_ref_is_flow_style(bbw_module):
    model = {"schema_version": 1, "skill": {"name": "x", "description": "d"},
             "groups": {"g": {"description": "x"}},
             "phases": [{"id": "P1", "name": "n", "group": "g",
                         "outputs": [{"path": "a/b.md", "kind": "md"}]}]}
    out = bbw_module.dump_workflow_yaml(model)
    assert "{ path: a/b.md, kind: md }" in out or "{path: a/b.md, kind: md}" in out


def test_dump_long_description_is_block_scalar(bbw_module):
    long = "word " * 40
    model = {"schema_version": 1, "skill": {"name": "x", "description": "d"},
             "groups": {"g": {"description": "x"}},
             "phases": [{"id": "P1", "name": "n", "group": "g", "description": long}]}
    out = bbw_module.dump_workflow_yaml(model)
    assert "description: >" in out or "description: |" in out


def test_dump_is_idempotent(bbw_module):
    src = (REPO_ROOT / "src" / "workflows" / "demo.yaml").read_text()
    model = yaml.safe_load(src)
    once = bbw_module.dump_workflow_yaml(model)
    twice = bbw_module.dump_workflow_yaml(yaml.safe_load(once))
    assert once == twice


def test_dump_multiline_string_uses_literal_block(bbw_module):
    # A string with embedded newlines must stay a literal `|` block so the
    # newlines survive the round-trip (folded `>` would collapse them).
    model = {"schema_version": 1,
             "skill": {"name": "x", "description": "line one\nline two\nline three"},
             "groups": {"g": {"description": "x"}}, "phases": []}
    out = bbw_module.dump_workflow_yaml(model)
    assert "description: |" in out
    assert ">" not in out.split("description:")[1].split("\n")[0]
    # newlines preserved on reload
    assert yaml.safe_load(out)["skill"]["description"] == "line one\nline two\nline three"


def test_dump_indents_block_sequences(bbw_module):
    # phases list must be indented under its key (`  - id:`), matching the
    # hand-written style rather than PyYAML's flush-left default.
    model = {"schema_version": 1, "skill": {"name": "x", "description": "d"},
             "groups": {"g": {"description": "x"}},
             "phases": [{"id": "P1", "name": "n", "group": "g"}]}
    out = bbw_module.dump_workflow_yaml(model)
    assert "\n  - id: P1" in out


def test_levels_roots_are_zero(bbw_module):
    wf = {"phases": [{"id": "A", "name": "a", "group": "g"},
                     {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]}]}
    levels = bbw_module.compute_levels(wf)
    assert levels == {"A": 0, "B": 1}


def test_levels_longest_path_wins(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
        {"id": "C", "name": "c", "group": "g", "depends_on": ["A", "B"]},
    ]}
    levels = bbw_module.compute_levels(wf)
    assert levels == {"A": 0, "B": 1, "C": 2}


def test_levels_parallel_share_level(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
        {"id": "C", "name": "c", "group": "g", "depends_on": ["A"]},
    ]}
    levels = bbw_module.compute_levels(wf)
    assert levels["B"] == 1 and levels["C"] == 1


def test_blank_workflow_is_schema_valid(bbw_module):
    model = bbw_module.blank_workflow("my-flow")
    assert model["skill"]["name"] == "my-flow"
    assert bbw_module.validate_schema(model) == []


def test_clone_workflow_renames_skill(bbw_module):
    src = yaml.safe_load((REPO_ROOT / "src" / "workflows" / "demo.yaml").read_text())
    cloned = bbw_module.clone_workflow(src, "demo-copy")
    assert cloned["skill"]["name"] == "demo-copy"
    assert len(cloned["phases"]) == len(src["phases"])
    cloned["phases"].append({"id": "Z", "name": "z", "group": "collect"})
    assert len(cloned["phases"]) == len(src["phases"]) + 1


import re


def test_slug_guard_rejects_traversal(bbw_module):
    assert bbw_module.is_valid_slug("demo") is True
    assert bbw_module.is_valid_slug("../etc") is False
    assert bbw_module.is_valid_slug("Foo") is False
    assert bbw_module.is_valid_slug("a b") is False


def test_save_rejects_invalid_schema(bbw_module, tmp_path):
    bad = {"schema_version": 1}  # missing required skill/groups/phases
    errors = bbw_module.save_workflow("bad", bad, workflows_dir=tmp_path,
                                      agents_dir=tmp_path)
    assert errors  # non-empty -> not written
    assert not (tmp_path / "bad.yaml").exists()


def test_save_writes_valid_workflow(bbw_module, tmp_path):
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    model = bbw_module.blank_workflow("ok-flow")
    errors = bbw_module.save_workflow("ok-flow", model, workflows_dir=tmp_path,
                                      agents_dir=agents_dir)
    assert errors == []
    written = (tmp_path / "ok-flow.yaml")
    assert written.exists()
    assert yaml.safe_load(written.read_text())["skill"]["name"] == "ok-flow"


def test_create_agent_writes_both_files(bbw_module, tmp_path):
    agents_dir = tmp_path / "agents"
    inv_dir = tmp_path / "invocations"
    agents_dir.mkdir(); inv_dir.mkdir()
    errors = bbw_module.create_agent(
        "my-agent", description="Does a thing", tools="Read, Grep",
        model="sonnet", prompt="You analyze things.",
        agents_dir=agents_dir, invocations_dir=inv_dir)
    assert errors == []
    agent_md = (agents_dir / "my-agent.md").read_text()
    assert "name: my-agent" in agent_md
    assert "You analyze things." in agent_md
    assert (inv_dir / "my-agent.md").exists()


def test_create_agent_rejects_bad_slug(bbw_module, tmp_path):
    errors = bbw_module.create_agent("../evil", description="x", tools="",
                                     model="inherit", prompt="p",
                                     agents_dir=tmp_path, invocations_dir=tmp_path)
    assert errors
    assert not (tmp_path / "..evil.md").exists()


def test_split_agent_md_preserves_rich_frontmatter(bbw_module):
    raw = (REPO_ROOT / "src" / "agents" / "summarizer.md").read_text()
    fm, body = bbw_module.split_agent_md(raw)
    assert "description: |" in fm          # literal block scalar kept
    assert "- Read" in fm                  # tools block-sequence kept
    assert body.startswith("Read work/")   # body is the prompt, not the frontmatter
    assert fm in raw                        # frontmatter taken verbatim
    # body-only round-trip is stable
    rebuilt = bbw_module.join_agent_md(fm, body)
    assert bbw_module.split_agent_md(rebuilt) == (fm, body)


def test_split_agent_md_no_frontmatter(bbw_module):
    fm, body = bbw_module.split_agent_md("just a body\nno fences")
    assert fm == ""
    assert body == "just a body\nno fences"


def test_render_cartography_mermaid_from_dict(bbw_module):
    wf = yaml.safe_load((REPO_ROOT / "src" / "workflows" / "demo.yaml").read_text())
    out = bbw_module.render_cartography_mermaid(wf)
    assert "D0-COLLECT" in out or "D0_COLLECT" in out
    assert "graph" in out.lower() or "flowchart" in out.lower()


import threading
import http.client
from http.server import HTTPServer


@pytest.fixture
def editor_server(bbw_module):
    handler = bbw_module.make_edit_handler(
        workflows_dir=REPO_ROOT / "src" / "workflows",
        agents_dir=REPO_ROOT / "src" / "agents",
        templates_dir=REPO_ROOT / "src" / "workflow" / "templates",
    )
    srv = HTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv.server_address
    srv.shutdown()


def _get(addr, path):
    c = http.client.HTTPConnection(*addr); c.request("GET", path)
    r = c.getresponse(); return r.status, r.read().decode()


def _send(addr, method, path, payload):
    c = http.client.HTTPConnection(*addr)
    body = json.dumps(payload)
    c.request(method, path, body, {"Content-Type": "application/json"})
    r = c.getresponse(); return r.status, r.read().decode()


def test_get_index_returns_html(editor_server):
    status, body = _get(editor_server, "/")
    assert status == 200
    assert 'id="grid"' in body


def test_get_workflows_list(editor_server):
    status, body = _get(editor_server, "/api/workflows")
    assert status == 200
    names = json.loads(body)
    assert "demo" in names


def test_get_workflow_includes_levels(editor_server):
    status, body = _get(editor_server, "/api/workflow/demo")
    assert status == 200
    data = json.loads(body)
    assert data["model"]["skill"]["name"] == "demo"
    assert data["levels"]["D0-COLLECT"] == 0


def test_put_invalid_workflow_is_rejected(editor_server, tmp_path):
    status, body = _send(editor_server, "PUT", "/api/workflow/demo",
                         {"schema_version": 1})
    assert status == 422
    assert json.loads(body)["errors"]


def test_preview_returns_mermaid(editor_server):
    model = json.loads(_get(editor_server, "/api/workflow/demo")[1])["model"]
    status, body = _send(editor_server, "POST", "/api/preview", model)
    assert status == 200
    j = json.loads(body)
    assert "mermaid" in j and "dataflow" in j


def test_render_dataflow_mermaid_from_dict(bbw_module):
    wf = yaml.safe_load((REPO_ROOT / "src" / "workflows" / "demo.yaml").read_text())
    out = bbw_module.render_dataflow_mermaid(wf, mode="all")
    assert "graph" in out.lower() or "flowchart" in out.lower()
    # the demo's terminal artifact work/demo/digest.md must appear as a node
    assert "digest" in out


@pytest.fixture
def editor_server_tmp(bbw_module, tmp_path):
    """Editor server backed by a writable temp workflows dir (for create/clone)."""
    import threading
    from http.server import HTTPServer
    wf_dir = tmp_path / "workflows"; wf_dir.mkdir()
    ag_dir = tmp_path / "agents"; ag_dir.mkdir()
    # seed one workflow to clone from
    (wf_dir / "seed.yaml").write_text(bbw_module.dump_workflow_yaml(
        bbw_module.blank_workflow("seed")))
    handler = bbw_module.make_edit_handler(
        workflows_dir=wf_dir, agents_dir=ag_dir,
        templates_dir=REPO_ROOT / "src" / "workflow" / "templates")
    srv = HTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    yield srv.server_address, wf_dir
    srv.shutdown()


@pytest.fixture
def editor_server_agents(bbw_module, tmp_path):
    """Editor server with a writable agents dir seeded with one rich-frontmatter agent."""
    wf_dir = tmp_path / "workflows"; wf_dir.mkdir()
    ag_dir = tmp_path / "agents"; ag_dir.mkdir()
    (ag_dir / "ag1.md").write_text(
        "---\nname: ag1\ndescription: |\n  Multi\n  line desc\n"
        "model: inherit\ntools:\n  - Read\n  - Grep\n---\n\nOriginal body line.\n")
    handler = bbw_module.make_edit_handler(
        workflows_dir=wf_dir, agents_dir=ag_dir,
        templates_dir=REPO_ROOT / "src" / "workflow" / "templates")
    srv = HTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    yield srv.server_address, ag_dir
    srv.shutdown()


def test_get_agent_returns_body(editor_server):
    status, body = _get(editor_server, "/api/agent/summarizer")
    assert status == 200
    j = json.loads(body)
    assert "Read work/" in j["body"]
    assert "description: |" in j["frontmatter"]


def test_get_agent_unknown_is_404(editor_server):
    status, _ = _get(editor_server, "/api/agent/does-not-exist-xyz")
    assert status == 404


def test_put_agent_body_preserves_frontmatter(editor_server_agents):
    addr, ag_dir = editor_server_agents
    status, _ = _send(addr, "PUT", "/api/agent/ag1",
                      {"body": "Brand new body.\nSecond line."})
    assert status == 200
    text = (ag_dir / "ag1.md").read_text()
    assert "description: |\n  Multi\n  line desc" in text   # rich YAML intact
    assert "  - Read" in text and "  - Grep" in text
    assert "Brand new body.\nSecond line." in text          # body replaced
    assert "Original body line." not in text


def test_put_agent_unknown_is_404(editor_server_agents):
    addr, _ = editor_server_agents
    status, _ = _send(addr, "PUT", "/api/agent/nope", {"body": "x"})
    assert status == 404


def test_post_create_blank_workflow(editor_server_tmp):
    addr, wf_dir = editor_server_tmp
    status, body = _send(addr, "POST", "/api/workflow", {"name": "fresh-flow"})
    assert status == 200, body
    assert json.loads(body)["errors"] == []
    assert (wf_dir / "fresh-flow.yaml").exists()


def test_post_clone_workflow(editor_server_tmp):
    addr, wf_dir = editor_server_tmp
    status, body = _send(addr, "POST", "/api/workflow",
                         {"name": "seed-copy", "from": "seed"})
    assert status == 200, body
    assert (wf_dir / "seed-copy.yaml").exists()
    import yaml as _y
    assert _y.safe_load((wf_dir / "seed-copy.yaml").read_text())["skill"]["name"] == "seed-copy"


def test_get_mermaid_lib_is_served(editor_server):
    status, body = _get(editor_server, "/editor/mermaid.min.js")
    if status != 200:
        pytest.skip("mermaid lib unavailable (offline)")
    assert len(body) > 100_000  # the real minified lib is ~3 MB


# ============================================================================
# v2 — layout derivation (Lot 1)
# ============================================================================

def test_derive_columns_orders_within_level(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
        {"id": "C", "name": "c", "group": "g", "depends_on": ["A"]},
    ]}
    levels = bbw_module.compute_levels(wf)
    cols = bbw_module.derive_columns(wf, levels)
    assert cols["A"] == 0
    assert {cols["B"], cols["C"]} == {0, 1}
    assert cols["B"] == 0 and cols["C"] == 1


def test_derive_parallel_with(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
        {"id": "C", "name": "c", "group": "g", "depends_on": ["A"]},
    ]}
    levels = bbw_module.compute_levels(wf)
    pw = bbw_module.derive_parallel_with(wf, levels)
    assert pw["B"] == ["C"] and pw["C"] == ["B"]
    assert pw["A"] == []


def test_build_edges(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
    ]}
    edges = bbw_module.build_edges(wf)
    assert {"from": "A", "to": "B"} in edges
    assert all(e["from"] in {"A", "B"} and e["to"] in {"A", "B"} for e in edges)


def test_default_depends_on_for_level(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
        {"id": "C", "name": "c", "group": "g", "depends_on": ["A"]},
    ]}
    levels = bbw_module.compute_levels(wf)
    assert bbw_module.default_depends_on_for_level(wf, levels, 0) == []
    assert bbw_module.default_depends_on_for_level(wf, levels, 1) == ["A"]


def test_apply_parallel_with_sets_and_clears(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
        {"id": "C", "name": "c", "group": "g", "depends_on": ["A"],
         "parallel_with": ["STALE"]},
    ]}
    levels = bbw_module.compute_levels(wf)
    bbw_module.apply_parallel_with(wf, levels)
    byid = {p["id"]: p for p in wf["phases"]}
    assert byid["B"]["parallel_with"] == ["C"]
    assert byid["C"]["parallel_with"] == ["B"]
    assert "parallel_with" not in byid["A"]


def test_view_endpoint_returns_layout(editor_server):
    model = json.loads(_get(editor_server, "/api/workflow/demo")[1])["model"]
    status, body = _send(editor_server, "POST", "/api/view", model)
    assert status == 200
    j = json.loads(body)
    for key in ("levels", "columns", "parallel_with", "edges", "errors"):
        assert key in j
    assert j["levels"]["D0-COLLECT"] == 0
    assert any(e["to"] == "D1-SUMMARIZE" for e in j["edges"])


def test_view_endpoint_reports_errors_without_500(editor_server):
    status, body = _send(editor_server, "POST", "/api/view", {"schema_version": 1})
    assert status == 200
    assert json.loads(body)["errors"]


def test_save_writes_parallel_with(bbw_module, tmp_path):
    agents_dir = tmp_path / "agents"; agents_dir.mkdir()
    model = {"schema_version": 1, "skill": {"name": "pw-flow", "description": "d"},
             "groups": {"g": {"description": "x"}},
             "phases": [
                 {"id": "A", "name": "a", "group": "g", "type": "main_agent"},
                 {"id": "B", "name": "b", "group": "g", "type": "main_agent", "depends_on": ["A"]},
                 {"id": "C", "name": "c", "group": "g", "type": "main_agent", "depends_on": ["A"]},
             ]}
    errs = bbw_module.save_workflow("pw-flow", model, workflows_dir=tmp_path, agents_dir=agents_dir)
    assert errs == []
    saved = yaml.safe_load((tmp_path / "pw-flow.yaml").read_text())
    byid = {p["id"]: p for p in saved["phases"]}
    assert byid["B"].get("parallel_with") == ["C"]
    assert "parallel_with" not in byid["A"]


def test_save_roundtrips_full_fields(bbw_module, tmp_path):
    agents_dir = tmp_path / "agents"; agents_dir.mkdir()
    (agents_dir / "a1.md").write_text("---\nname: a1\n---\n")
    model = {"schema_version": 1, "skill": {"name": "full-flow", "description": "d", "title": "T"},
             "groups": {"g": {"description": "x", "risk": "low"}},
             "conditions": {"ready": {"check": "file_exists", "path": "x.md"}},
             "on_demand_agents": [{"agent": "a1", "description": "od"}],
             "phases": [
                 {"id": "P0", "name": "p0", "group": "g", "type": "main_agent"},
                 {"id": "P1", "name": "p1", "group": "g", "type": "agent", "depends_on": ["P0"],
                  "description": "does things",
                  "invocations": [{"agent": "a1", "model": "sonnet", "description": "inv",
                                   "background": True, "skip_if": "ready",
                                   "inputs": [{"path": "in.md", "kind": "md"}],
                                   "outputs": [{"path": "out/", "kind": "dir", "terminal": True}]}],
                  "inputs": [{"path": "src.json", "kind": "json", "external": True}]},
             ]}
    errs = bbw_module.save_workflow("full-flow", model, workflows_dir=tmp_path, agents_dir=agents_dir)
    assert errs == [], errs
    saved = yaml.safe_load((tmp_path / "full-flow.yaml").read_text())
    p1 = [p for p in saved["phases"] if p["id"] == "P1"][0]
    assert p1["invocations"][0]["skip_if"] == "ready"
    assert p1["invocations"][0]["outputs"][0]["terminal"] is True
    assert p1["inputs"][0]["external"] is True
    assert saved["conditions"]["ready"]["check"] == "file_exists"
    assert saved["on_demand_agents"][0]["agent"] == "a1"


def test_editor_js_modules_are_served(editor_server):
    # the module graph loaded by editor.html must be reachable over HTTP
    for name in ("editor.js", "editlogic.js", "formfields.js", "render-helpers.js"):
        status, body = _get(editor_server, "/editor/" + name)
        assert status == 200, name
        assert len(body) > 50, name
    # shared modules expose ES exports
    assert "export" in _get(editor_server, "/editor/formfields.js")[1]
    # editor.html references the module entry and no longer inlines JS
    _, index = _get(editor_server, "/")
    assert '/editor/editor.js' in index
    assert "__EDITOR_JS__" not in index


def test_editor_js_route_rejects_traversal(editor_server):
    status, _ = _get(editor_server, "/editor/..%2f..%2fbb-workflow.js")
    assert status == 404
