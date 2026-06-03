# `bb-workflow edit` Web Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bb-workflow edit` subcommand that serves a local web editor for workflow YAMLs — a grid (rows = sequencing, columns = parallelism), phase/invocation/agent editing, create-from-scratch or clone — with validation gating every write.

**Architecture:** All Python lives inside the existing monolithic `claude-setup/scripts/bb-workflow` script (matching its current pattern): new pure helpers (canonical YAML dumper, level computation, model factory, validated save, agent scaffolding), an `http.server` request handler, and a `cmd_edit` entry point. The front-end is static files under `claude-setup/workflow/templates/webedit/` inlined at serve time. `depends_on` is the single source of truth; grid row index is always recomputed, never stored.

**Tech Stack:** Python 3 stdlib (`http.server`, `webbrowser`, `json`), PyYAML 6.0.1 (custom Dumper, no new deps), Jinja2 (reused for mermaid), vanilla JS/CSS (no build step), pytest.

---

## File Structure

- **Modify** `claude-setup/scripts/bb-workflow` — add helpers, HTTP handler, `cmd_edit`, argparse subparser.
- **Create** `claude-setup/workflow/templates/webedit/editor.html` — page shell (grid container, tabs, edit panel).
- **Create** `claude-setup/workflow/templates/webedit/editor.css` — reuses cartography theme tokens.
- **Create** `claude-setup/workflow/templates/webedit/editor.js` — grid render, drag&drop, fetch calls.
- **Create** `claude-setup/scripts/tests/test_workflow_edit.py` — tests for all new helpers + handler routes.
- **Modify** `docs/dev/bb-workflow.md` — document the `edit` subcommand.

Reused as-is: `validate_schema`, `validate_coherence`, `discover_workflows`, `resolve_workflow`, `DEFAULT_WORKFLOWS_DIR`, `DEFAULT_AGENTS_DIR`, `REPO_ROOT_GUESS`, `_resolve_group_colors`, the `bbw_module` pytest fixture.

---

## Task 1: Canonical YAML dumper

Produces stable, idempotent YAML matching the hand-written style: key order preserved, long `description`/`when` strings as folded block scalars, `io_ref` dicts inline (flow style).

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (add after `workflow_output_paths`, ~line 109)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

Create `claude-setup/scripts/tests/test_workflow_edit.py`:

```python
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
    # schema_version must appear before skill before groups
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
    src = (REPO_ROOT / "claude-setup" / "workflows" / "demo.yaml").read_text()
    model = yaml.safe_load(src)
    once = bbw_module.dump_workflow_yaml(model)
    twice = bbw_module.dump_workflow_yaml(yaml.safe_load(once))
    assert once == twice
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -v`
Expected: FAIL with `AttributeError: module 'bbw' has no attribute 'dump_workflow_yaml'`

- [ ] **Step 3: Implement the dumper**

Add to `claude-setup/scripts/bb-workflow` after `workflow_output_paths` (~line 109):

```python
# ============================================================================
# Web editor — canonical YAML serialization
# ============================================================================

_IO_REF_KEYS = {"path", "kind", "optional", "external", "terminal"}


class _FlowDict(dict):
    """Dict rendered in YAML flow style (inline braces)."""


class _BlockStr(str):
    """String rendered as a folded block scalar."""


class _CanonicalDumper(yaml.SafeDumper):
    pass


def _repr_flow_dict(dumper, data):
    return dumper.represent_mapping("tag:yaml.org,2002:map", data, flow_style=True)


def _repr_block_str(dumper, data):
    return dumper.represent_scalar("tag:yaml.org,2002:str", str(data), style=">")


_CanonicalDumper.add_representer(_FlowDict, _repr_flow_dict)
_CanonicalDumper.add_representer(_BlockStr, _repr_block_str)


def _to_yaml_dom(value, key=None):
    """Wrap io_ref dicts as flow, long strings as block scalars; recurse."""
    if isinstance(value, dict):
        if value and set(value.keys()) <= _IO_REF_KEYS:
            return _FlowDict({k: _to_yaml_dom(v) for k, v in value.items()})
        return {k: _to_yaml_dom(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_yaml_dom(v) for v in value]
    if isinstance(value, str) and (len(value) > 70 or "\n" in value):
        return _BlockStr(value)
    return value


def dump_workflow_yaml(model: dict) -> str:
    """Serialize a workflow model dict to canonical, idempotent YAML."""
    dom = _to_yaml_dom(model)
    return yaml.dump(dom, Dumper=_CanonicalDumper, sort_keys=False,
                     allow_unicode=True, width=80, default_flow_style=False)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): canonical YAML dumper for web editor"
```

---

## Task 2: Topological level computation

Computes the grid row for each phase = longest path from a root via `depends_on`. Roots (no deps) are level 0.

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (add after `dump_workflow_yaml`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_workflow_edit.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k levels -v`
Expected: FAIL with `AttributeError ... compute_levels`

- [ ] **Step 3: Implement**

Add after `dump_workflow_yaml`:

```python
def compute_levels(workflow: dict) -> dict:
    """Map phase id -> grid row (longest dependency path from a root)."""
    phases = workflow.get("phases", [])
    deps = {p["id"]: [d for d in (p.get("depends_on") or []) if d] for p in phases}
    memo = {}

    def level(pid, seen):
        if pid in memo:
            return memo[pid]
        ds = [d for d in deps.get(pid, []) if d in deps and d not in seen]
        lvl = 0 if not ds else 1 + max(level(d, seen | {pid}) for d in ds)
        memo[pid] = lvl
        return lvl

    return {pid: level(pid, set()) for pid in deps}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k levels -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): topological level computation for grid rows"
```

---

## Task 3: Model factory — blank and clone

Create a new empty workflow, or clone an existing one under a new name.

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (add after `compute_levels`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_workflow_edit.py`:

```python
def test_blank_workflow_is_schema_valid(bbw_module):
    model = bbw_module.blank_workflow("my-flow")
    assert model["skill"]["name"] == "my-flow"
    assert bbw_module.validate_schema(model) == []


def test_clone_workflow_renames_skill(bbw_module):
    src = yaml.safe_load((REPO_ROOT / "claude-setup" / "workflows" / "demo.yaml").read_text())
    cloned = bbw_module.clone_workflow(src, "demo-copy")
    assert cloned["skill"]["name"] == "demo-copy"
    assert len(cloned["phases"]) == len(src["phases"])
    # deep copy: mutating clone must not touch source
    cloned["phases"].append({"id": "Z", "name": "z", "group": "setup"})
    assert len(cloned["phases"]) == len(src["phases"]) + 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k "blank or clone" -v`
Expected: FAIL with `AttributeError ... blank_workflow`

- [ ] **Step 3: Implement**

Add `import copy` to the imports block at the top of the script (near `import json`), then add after `compute_levels`:

```python
def blank_workflow(name: str) -> dict:
    """A minimal schema-valid workflow scaffold."""
    return {
        "schema_version": 1,
        "skill": {"name": name, "description": f"Workflow {name} (à compléter)."},
        "groups": {"setup": {"description": "Préparation", "risk": "none"}},
        "phases": [{"id": "P0", "name": "Première phase", "group": "setup",
                    "type": "main_agent", "description": "À compléter."}],
    }


def clone_workflow(model: dict, new_name: str) -> dict:
    """Deep-copy a workflow under a new skill name."""
    cloned = copy.deepcopy(model)
    cloned.setdefault("skill", {})["name"] = new_name
    return cloned
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k "blank or clone" -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): blank/clone workflow model factory"
```

---

## Task 4: Validated save

Validate (schema + coherence) BEFORE writing. Reject invalid models; never write a broken YAML. Enforce slug + path confinement.

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (add after `clone_workflow`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_workflow_edit.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k "slug or save" -v`
Expected: FAIL with `AttributeError ... is_valid_slug`

- [ ] **Step 3: Implement**

Add after `clone_workflow`:

```python
_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")


def is_valid_slug(name: str) -> bool:
    """True for safe workflow/agent slugs (also blocks path traversal)."""
    return bool(isinstance(name, str) and _SLUG_RE.match(name))


def save_workflow(name: str, model: dict, workflows_dir: Path = None,
                  agents_dir: Path = None) -> list:
    """Validate then write. Returns [] on success, list of errors otherwise."""
    workflows_dir = workflows_dir or DEFAULT_WORKFLOWS_DIR
    agents_dir = agents_dir or DEFAULT_AGENTS_DIR
    if not is_valid_slug(name):
        return [f"invalid workflow name: {name!r}"]
    errors = validate_schema(model)
    if errors:
        return errors
    errors = validate_coherence(model, agents_dir=agents_dir,
                                workflows_dir=workflows_dir)
    if errors:
        return errors
    workflows_dir.mkdir(parents=True, exist_ok=True)
    (workflows_dir / f"{name}.yaml").write_text(dump_workflow_yaml(model),
                                                encoding="utf-8")
    return []
```

Note: add `import re` to the top imports block if not already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k "slug or save" -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): validated workflow save with slug guard"
```

---

## Task 5: Agent scaffolding

Create a new agent definition file + its invocation template from the GUI payload.

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (add after `save_workflow`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_workflow_edit.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k create_agent -v`
Expected: FAIL with `AttributeError ... create_agent`

- [ ] **Step 3: Implement**

Add after `save_workflow`:

```python
DEFAULT_INVOCATIONS_DIR = (REPO_ROOT_GUESS / "claude-setup" / "workflow"
                           / "templates" / "invocations")


def create_agent(name: str, description: str, tools: str, model: str,
                 prompt: str, agents_dir: Path = None,
                 invocations_dir: Path = None) -> list:
    """Scaffold claude-setup/agents/<name>.md + invocation template."""
    agents_dir = agents_dir or DEFAULT_AGENTS_DIR
    invocations_dir = invocations_dir or DEFAULT_INVOCATIONS_DIR
    if not is_valid_slug(name):
        return [f"invalid agent name: {name!r}"]
    agent_md = (
        f"---\nname: {name}\ndescription: {description}\n"
        f"tools: {tools}\nmodel: {model}\n---\n\n{prompt}\n"
    )
    invocation_md = (
        f"---\nagent: {name}\ngenerated: false\n---\n\n"
        f"**{{{{ agent }}}}** [{{{{ model }}}}] · {description}\n"
        f"{{{{ inputs_outputs_compact }}}}\n\n**Task** : {prompt}\n"
    )
    agents_dir.mkdir(parents=True, exist_ok=True)
    invocations_dir.mkdir(parents=True, exist_ok=True)
    (agents_dir / f"{name}.md").write_text(agent_md, encoding="utf-8")
    (invocations_dir / f"{name}.md").write_text(invocation_md, encoding="utf-8")
    return []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k create_agent -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): agent scaffolding for web editor"
```

---

## Task 6: Mermaid preview from in-memory model

Refactor the existing cartography renderer so it can render from a dict (no file IO), for the live preview endpoint.

**Files:**
- Modify: `claude-setup/scripts/bb-workflow:921-940` (`generate_mermaid_cartography`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing test**

Append to `test_workflow_edit.py`:

```python
def test_render_cartography_mermaid_from_dict(bbw_module):
    wf = yaml.safe_load((REPO_ROOT / "claude-setup" / "workflows" / "demo.yaml").read_text())
    out = bbw_module.render_cartography_mermaid(wf)
    assert "R0-LOAD" in out or "R0_LOAD" in out
    assert "graph" in out.lower() or "flowchart" in out.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k render_cartography -v`
Expected: FAIL with `AttributeError ... render_cartography_mermaid`

- [ ] **Step 3: Refactor + implement**

Replace `generate_mermaid_cartography` (lines 921-940) with:

```python
def render_cartography_mermaid(workflow: dict, templates_dir: Path = None) -> str:
    """Render the cartography mermaid string from a workflow dict."""
    templates_dir = templates_dir or (REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates")
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(templates_dir)),
        autoescape=False,
        keep_trailing_newline=True,
    )
    env.filters["node_id"] = _node_id_filter
    template = env.get_template("cartography.mermaid.jinja")
    return template.render(
        phases=workflow.get("phases", []),
        groups=workflow.get("groups", {}),
        group_colors=_resolve_group_colors(workflow),
    )


def generate_mermaid_cartography(workflow_path: Path, output_path: Path,
                                  templates_dir: Path = None) -> None:
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)
    output = render_cartography_mermaid(workflow, templates_dir=templates_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output, encoding="utf-8")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k render_cartography tests/test_workflow_generate.py -v`
Expected: PASS (new test + existing generate tests still green — confirms refactor is safe)

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "refactor(bb-workflow): render_cartography_mermaid from dict for preview"
```

---

## Task 7: HTTP handler + routing

A `BaseHTTPRequestHandler` subclass dispatching the REST API. Bound to `127.0.0.1`. Tested in-process with `http.client`.

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (add after `create_agent`, before `main`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_workflow_edit.py`:

```python
import threading
import http.client
from http.server import HTTPServer


@pytest.fixture
def editor_server(bbw_module):
    handler = bbw_module.make_edit_handler(
        workflows_dir=REPO_ROOT / "claude-setup" / "workflows",
        agents_dir=REPO_ROOT / "claude-setup" / "agents",
        templates_dir=REPO_ROOT / "claude-setup" / "workflow" / "templates",
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
    assert data["levels"]["R0-LOAD"] == 0


def test_put_invalid_workflow_is_rejected(editor_server, tmp_path):
    # demo exists but we send a broken model -> 422, file untouched
    status, body = _send(editor_server, "PUT", "/api/workflow/demo",
                         {"schema_version": 1})
    assert status == 422
    assert json.loads(body)["errors"]


def test_preview_returns_mermaid(editor_server):
    model = json.loads(_get(editor_server, "/api/workflow/demo")[1])["model"]
    status, body = _send(editor_server, "POST", "/api/preview", model)
    assert status == 200
    assert "mermaid" in json.loads(body)
```

Note: `test_put_invalid_workflow_is_rejected` must not overwrite the real file — the handler rejects before writing, so this is safe. Do NOT add a test that PUTs a valid model to the real `demo` (it would rewrite the repo file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -k "editor_server or index or workflows_list or includes_levels or rejected or preview" -v`
Expected: FAIL with `AttributeError ... make_edit_handler`

- [ ] **Step 3: Implement the handler**

Add these imports to the top block: `import http.server`, `import urllib.parse`. Then add before `main()`:

```python
def _read_static(templates_dir: Path) -> str:
    """Assemble the editor HTML with CSS and JS inlined."""
    base = templates_dir / "webedit"
    html = (base / "editor.html").read_text(encoding="utf-8")
    css = (base / "editor.css").read_text(encoding="utf-8")
    js = (base / "editor.js").read_text(encoding="utf-8")
    return (html.replace("/*__EDITOR_CSS__*/", css)
                .replace("/*__EDITOR_JS__*/", js))


def make_edit_handler(workflows_dir: Path, agents_dir: Path,
                      templates_dir: Path):
    """Build a request handler class bound to the given dirs."""

    class _Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):  # silence per-request logging
            pass

        def _json(self, code, obj):
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _html(self, code, text):
            body = text.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}")

        def do_GET(self):
            p = urllib.parse.urlparse(self.path).path
            if p == "/":
                return self._html(200, _read_static(templates_dir))
            if p == "/api/workflows":
                return self._json(200, [n for n, _ in
                                        discover_workflows(workflows_dir)])
            if p == "/api/agents":
                return self._json(200, sorted(_all_agent_names(agents_dir)))
            if p.startswith("/api/workflow/"):
                name = p.rsplit("/", 1)[-1]
                if not is_valid_slug(name):
                    return self._json(400, {"error": "bad name"})
                fp = workflows_dir / f"{name}.yaml"
                if not fp.exists():
                    return self._json(404, {"error": "not found"})
                model = yaml.safe_load(fp.read_text())
                return self._json(200, {"model": model,
                                        "levels": compute_levels(model)})
            if p.startswith("/api/invocation/"):
                agent = p.rsplit("/", 1)[-1]
                if not is_valid_slug(agent):
                    return self._json(400, {"error": "bad name"})
                fp = (templates_dir / "invocations" / f"{agent}.md")
                text = fp.read_text() if fp.exists() else ""
                return self._json(200, {"prompt": text})
            return self._json(404, {"error": "unknown route"})

        def do_POST(self):
            p = urllib.parse.urlparse(self.path).path
            data = self._body()
            if p == "/api/preview":
                return self._json(200,
                    {"mermaid": render_cartography_mermaid(data, templates_dir)})
            if p == "/api/workflow":
                name = data.get("name", "")
                if not is_valid_slug(name):
                    return self._json(400, {"errors": ["bad name"]})
                src = data.get("from")
                if src and is_valid_slug(src) and (workflows_dir / f"{src}.yaml").exists():
                    base = yaml.safe_load((workflows_dir / f"{src}.yaml").read_text())
                    model = clone_workflow(base, name)
                else:
                    model = blank_workflow(name)
                errs = save_workflow(name, model, workflows_dir, agents_dir)
                return self._json(200 if not errs else 422,
                                  {"errors": errs, "name": name})
            if p == "/api/agent":
                errs = create_agent(
                    data.get("name", ""), data.get("description", ""),
                    data.get("tools", ""), data.get("model", "inherit"),
                    data.get("prompt", ""), agents_dir,
                    templates_dir / "invocations")
                return self._json(200 if not errs else 400, {"errors": errs})
            return self._json(404, {"error": "unknown route"})

        def do_PUT(self):
            p = urllib.parse.urlparse(self.path).path
            if p.startswith("/api/workflow/"):
                name = p.rsplit("/", 1)[-1]
                data = self._body()
                errs = save_workflow(name, data.get("model", {}),
                                     workflows_dir, agents_dir)
                return self._json(200 if not errs else 422, {"errors": errs})
            if p.startswith("/api/invocation/"):
                agent = p.rsplit("/", 1)[-1]
                if not is_valid_slug(agent):
                    return self._json(400, {"error": "bad name"})
                (templates_dir / "invocations" / f"{agent}.md").write_text(
                    self._body().get("prompt", ""), encoding="utf-8")
                return self._json(200, {"ok": True})
            return self._json(404, {"error": "unknown route"})

    return _Handler
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py -v`
Expected: all PASS (the index test needs Task 8 static files; if running before Task 8, expect only `test_get_index_returns_html` to fail with FileNotFoundError — implement Task 8 next).

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): HTTP handler + REST routes for web editor"
```

---

## Task 8: Front-end static files

The grid UI, edit panel, tabs, drag&drop. Reuses cartography theme tokens. No build step.

**Files:**
- Create: `claude-setup/workflow/templates/webedit/editor.html`
- Create: `claude-setup/workflow/templates/webedit/editor.css`
- Create: `claude-setup/workflow/templates/webedit/editor.js`

- [ ] **Step 1: Create `editor.html`**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>bb-workflow editor</title>
<style>/*__EDITOR_CSS__*/</style>
</head>
<body>
  <header id="topbar">
    <select id="wf-select"></select>
    <button id="wf-new">+ nouveau</button>
    <button id="wf-clone">dupliquer</button>
    <button id="wf-save">💾 enregistrer</button>
    <span id="status"></span>
  </header>
  <nav id="tabs">
    <button class="tab active" data-tab="grid">Grille</button>
    <button class="tab" data-tab="dataflow">Dataflow</button>
    <button class="tab" data-tab="yaml">YAML</button>
  </nav>
  <main>
    <section id="panel-grid" class="panel active">
      <div id="grid"></div>
      <button id="add-row">+ ligne (niveau)</button>
    </section>
    <section id="panel-dataflow" class="panel"><pre id="dataflow-src"></pre></section>
    <section id="panel-yaml" class="panel"><pre id="yaml-src"></pre></section>
  </main>
  <aside id="edit-panel" hidden></aside>
<script>/*__EDITOR_JS__*/</script>
</body>
</html>
```

- [ ] **Step 2: Create `editor.css`**

```css
:root{--bg:#0c1117;--panel:#0a1a15;--accent:#4a9;--border:#2b3440;--text:#cdd6e0}
*{box-sizing:border-box}
body{margin:0;font:13px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--text)}
#topbar{display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid var(--border)}
#topbar select,#topbar button{background:#121a24;color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;cursor:pointer}
#status{margin-left:auto;font-size:11px;color:#8a9}
#tabs{display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid var(--border)}
.tab{background:none;border:none;color:#8a9;padding:4px 10px;cursor:pointer;border-radius:4px}
.tab.active{background:var(--accent);color:#012}
.panel{display:none;padding:12px}
.panel.active{display:block}
.row{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;min-height:60px;border:1px dashed var(--border);border-radius:6px;padding:6px}
.row-label{flex:0 0 70px;font-size:11px;color:#8a9;text-transform:uppercase}
.phase-card{flex:0 0 170px;border:1px solid var(--border);border-radius:5px;padding:6px;cursor:grab;background:#121a24}
.phase-card.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.phase-card .pid{font-weight:700}
.phase-card .badge{font-size:9px;padding:1px 4px;border-radius:3px;background:#345}
.row.drop-hover{background:rgba(68,170,153,.12)}
#edit-panel{position:fixed;top:0;right:0;width:300px;height:100%;background:var(--panel);border-left:1px solid var(--accent);padding:12px;overflow:auto}
#edit-panel label{display:block;font-size:11px;margin-top:8px;color:#8a9}
#edit-panel input,#edit-panel select,#edit-panel textarea{width:100%;background:#121a24;color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px}
#edit-panel button{margin-top:8px}
pre{white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace}
```

- [ ] **Step 3: Create `editor.js`**

```javascript
const $ = s => document.querySelector(s);
const api = (m, p, b) => fetch(p, {method:m, headers:{'Content-Type':'application/json'},
  body: b ? JSON.stringify(b) : undefined}).then(r => r.json().then(j => ({status:r.status, j})));

let state = {name:null, model:null, levels:{}, selected:null};

async function loadList(){
  const {j} = await api('GET','/api/workflows');
  $('#wf-select').innerHTML = j.map(n=>`<option>${n}</option>`).join('');
  if(j.length) await loadWorkflow(j[0]);
}
async function loadWorkflow(name){
  const {j} = await api('GET','/api/workflow/'+name);
  state = {name, model:j.model, levels:j.levels, selected:null};
  renderGrid(); refreshPreview();
}
function phasesByLevel(){
  const byId = {}; (state.model.phases||[]).forEach(p=>byId[p.id]=p);
  const max = Math.max(0, ...Object.values(state.levels));
  const rows = []; for(let i=0;i<=max;i++) rows.push([]);
  (state.model.phases||[]).forEach(p=>rows[state.levels[p.id]||0].push(p));
  return rows;
}
function renderGrid(){
  const rows = phasesByLevel();
  $('#grid').innerHTML = rows.map((ps,i)=>`
    <div class="row" data-level="${i}" ondragover="event.preventDefault();this.classList.add('drop-hover')"
         ondragleave="this.classList.remove('drop-hover')" ondrop="onDrop(event,${i})">
      <div class="row-label">Niv. ${i+1}</div>
      ${ps.map(p=>`<div class="phase-card" draggable="true" data-id="${p.id}"
          ondragstart="event.dataTransfer.setData('id',this.dataset.id)"
          onclick="selectPhase('${p.id}')">
          <div class="pid">${p.id} <span class="badge">${p.type||'agent'}</span></div>
          <div>${p.name||''}</div></div>`).join('')}
    </div>`).join('');
}
function onDrop(ev, level){
  ev.preventDefault();
  const id = ev.dataTransfer.getData('id');
  const p = state.model.phases.find(x=>x.id===id);
  if(!p) return;
  if(level===0){ p.depends_on=[]; }
  else { p.depends_on = phasesByLevel()[level-1].filter(x=>x.id!==id).map(x=>x.id); }
  recompute();
}
async function recompute(){
  // levels are recomputed server-side authority; locally approximate then refetch on save
  const {j} = await api('POST','/api/preview', state.model); // cheap validation of renderability
  // recompute levels locally:
  state.levels = localLevels(state.model);
  renderGrid(); $('#dataflow-src').textContent = j.mermaid || ''; refreshYaml();
}
function localLevels(model){
  const deps={}; (model.phases||[]).forEach(p=>deps[p.id]=(p.depends_on||[]).filter(Boolean));
  const memo={};
  const lvl=(id,seen)=>{ if(id in memo)return memo[id];
    const ds=(deps[id]||[]).filter(d=>d in deps && !seen.has(d));
    const v=ds.length?1+Math.max(...ds.map(d=>lvl(d,new Set([...seen,id])))):0;
    return memo[id]=v; };
  const out={}; Object.keys(deps).forEach(id=>out[id]=lvl(id,new Set())); return out;
}
function selectPhase(id){
  state.selected=id;
  const p = state.model.phases.find(x=>x.id===id);
  const others = state.model.phases.filter(x=>x.id!==id);
  $('#edit-panel').hidden=false;
  $('#edit-panel').innerHTML = `
    <label>id</label><input value="${p.id}" onchange="setField('id',this.value)">
    <label>name</label><input value="${p.name||''}" onchange="setField('name',this.value)">
    <label>type</label><select onchange="setField('type',this.value)">
      ${['agent','script','external','main_agent','workflow_call']
        .map(t=>`<option ${(p.type||'agent')===t?'selected':''}>${t}</option>`).join('')}</select>
    <label>group</label><select onchange="setField('group',this.value)">
      ${Object.keys(state.model.groups||{}).map(g=>`<option ${p.group===g?'selected':''}>${g}</option>`).join('')}</select>
    <label>depends_on</label>
    ${others.map(o=>`<label style="text-transform:none"><input type="checkbox"
        ${(p.depends_on||[]).includes(o.id)?'checked':''}
        onchange="toggleDep('${o.id}',this.checked)"> ${o.id}</label>`).join('')}
    <button onclick="document.getElementById('edit-panel').hidden=true">fermer</button>`;
  renderGrid();
  document.querySelectorAll('.phase-card').forEach(c=>c.classList.toggle('selected',c.dataset.id===id));
}
function setField(k,v){ const p=state.model.phases.find(x=>x.id===state.selected); p[k]=v; recompute(); }
function toggleDep(dep,on){ const p=state.model.phases.find(x=>x.id===state.selected);
  p.depends_on=p.depends_on||[]; if(on){if(!p.depends_on.includes(dep))p.depends_on.push(dep);}
  else p.depends_on=p.depends_on.filter(d=>d!==dep); recompute(); }
async function refreshPreview(){ const {j}=await api('POST','/api/preview',state.model);
  $('#dataflow-src').textContent=j.mermaid||''; refreshYaml(); }
function refreshYaml(){ $('#yaml-src').textContent = JSON.stringify(state.model,null,2); }
async function save(){
  const {status,j}=await api('PUT','/api/workflow/'+state.name,{model:state.model});
  $('#status').textContent = status===200 ? '✓ enregistré' : '✗ '+(j.errors||[]).join('; ');
  if(status===200) loadWorkflow(state.name);
}
async function newWf(){ const name=prompt('Nom du workflow (slug):'); if(!name)return;
  const {status,j}=await api('POST','/api/workflow',{name}); if(status===200){await loadList(); loadWorkflow(name);} else alert(j.errors.join('; ')); }
async function cloneWf(){ const name=prompt('Nom de la copie (slug):'); if(!name)return;
  const {status,j}=await api('POST','/api/workflow',{name,from:state.name}); if(status===200){await loadList(); loadWorkflow(name);} else alert(j.errors.join('; ')); }
function addRow(){ /* a new row materializes when a card is dropped onto the empty trailing area */
  alert("Glissez une phase vers le bas pour créer un niveau, ou ajoutez une phase puis ajustez ses dépendances."); }

document.addEventListener('DOMContentLoaded',()=>{
  loadList();
  $('#wf-select').onchange=e=>loadWorkflow(e.target.value);
  $('#wf-new').onclick=newWf; $('#wf-clone').onclick=cloneWf; $('#wf-save').onclick=save;
  $('#add-row').onclick=addRow;
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active'); $('#panel-'+t.dataset.tab).classList.add('active');
  });
});
```

- [ ] **Step 4: Run the index test to verify the page assembles**

Run: `cd claude-setup/scripts && python -m pytest tests/test_workflow_edit.py::test_get_index_returns_html -v`
Expected: PASS (`id="grid"` present after CSS/JS inlining)

- [ ] **Step 5: Commit**

```bash
git add claude-setup/workflow/templates/webedit/
git commit -m "feat(bb-workflow): web editor front-end (grid, panel, tabs)"
```

---

## Task 9: `cmd_edit` entry point + argparse wiring

Launch the server, open the browser, serve until Ctrl-C.

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (add `cmd_edit` before `main`; add subparser in `main`)
- Test: manual (documented below)

- [ ] **Step 1: Implement `cmd_edit`**

Add `import webbrowser` to the imports block. Add before `main()`:

```python
def cmd_edit(args):
    """Serve the local web editor."""
    workflows_dir = DEFAULT_WORKFLOWS_DIR
    agents_dir = DEFAULT_AGENTS_DIR
    templates_dir = REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates"
    handler = make_edit_handler(workflows_dir, agents_dir, templates_dir)
    srv = http.server.HTTPServer(("127.0.0.1", args.port), handler)
    host, port = srv.server_address
    url = f"http://{host}:{port}/"
    print(f"bb-workflow editor on {url}  (Ctrl-C pour arrêter)")
    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\narrêt.")
    finally:
        srv.server_close()
    return 0
```

- [ ] **Step 2: Wire the subparser**

In `main()`, after the `p_new` block (~line 2062) and before `args = parser.parse_args()`:

```python
    p_edit = sub.add_parser("edit", help="Serve the local web editor")
    p_edit.add_argument("--workflow", default=None,
                        help="Workflow to open first (optional)")
    p_edit.add_argument("--port", type=int, default=0,
                        help="Port (0 = auto)")
    p_edit.add_argument("--no-browser", action="store_true")
    p_edit.set_defaults(func=cmd_edit)
```

- [ ] **Step 3: Smoke test the launch (manual)**

Run: `python claude-setup/scripts/bb-workflow edit --port 8765 --no-browser`
Then in another shell: `curl -s localhost:8765/api/workflows`
Expected: JSON array including `"demo"` and `"demo"`. Then Ctrl-C.

- [ ] **Step 4: Browser test (manual, REQUIRED — this is a UI feature)**

Run `python claude-setup/scripts/bb-workflow edit` and in the browser:
1. Select `demo` — grid shows R0-LOAD at Niv.1, R1/R2/R3 sharing Niv.3.
2. Click R1-BOT-SIM — edit panel opens with depends_on checkboxes (R0-LOAD, R0B checked).
3. Drag R3-POLISH to Niv.2 — its depends_on updates, row recomputes.
4. Switch to YAML tab — model reflects the change.
5. Click 💾 — status shows `✓ enregistré`; confirm `git diff claude-setup/workflows/demo.yaml` is a clean, minimal diff.
6. `git checkout claude-setup/workflows/demo.yaml` to discard the test edit.

Report explicitly whether each step worked. If the grid/drag/save does not behave, fix before claiming done.

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow
git commit -m "feat(bb-workflow): edit subcommand serves the web editor"
```

---

## Task 10: Pre-commit hook compatibility + docs + full suite

The repo has `claude-setup/hooks/pre-commit-bb-workflow-check.sh`. Ensure editing a YAML via the GUI then committing won't trip drift checks unexpectedly, and document the command.

**Files:**
- Modify: `docs/dev/bb-workflow.md`
- Read: `claude-setup/hooks/pre-commit-bb-workflow-check.sh`

- [ ] **Step 1: Check the hook interaction**

Run: `cat claude-setup/hooks/pre-commit-bb-workflow-check.sh`
Confirm it runs `bb-workflow check` (drift between YAML and SKILL.md). After a GUI edit, the user must run `bb-workflow generate --workflow <name>` to regenerate SKILL.md/cartography. Document this; do NOT auto-generate on save (keeps save fast and side-effect-free).

- [ ] **Step 2: Document the subcommand**

Add a section to `docs/dev/bb-workflow.md`:

```markdown
## `bb-workflow edit` — éditeur web local

Lance un éditeur web (http.server local, 127.0.0.1) pour les workflows :

    bb-workflow edit [--workflow NAME] [--port N] [--no-browser]

- Grille : lignes = enchaînement (niveaux `depends_on`), colonnes = parallélisme.
- Glisser une carte vers une ligne fixe `depends_on` = phases de la ligne
  précédente ; affiner via les cases à cocher du panneau.
- Onglets : Grille / Dataflow / YAML. Bouton 💾 valide (schema + cohérence)
  puis écrit le YAML — rien n'est écrit si invalide.
- Création : « + nouveau » (vierge) ou « dupliquer » (clone du courant).
- Ajout d'agent : scaffolde `claude-setup/agents/<nom>.md` + le template
  d'invocation.

**Après une édition**, régénérer les artefacts dérivés :

    bb-workflow generate --workflow NAME

(sinon le hook pre-commit signalera une dérive SKILL.md ↔ YAML).
```

- [ ] **Step 3: Run the full test suite**

Run: `cd claude-setup/scripts && python -m pytest tests/ -q`
Expected: all green (new `test_workflow_edit.py` + all pre-existing workflow/candidates tests).

- [ ] **Step 4: Commit**

```bash
git add docs/dev/bb-workflow.md
git commit -m "docs(bb-workflow): document the edit web editor subcommand"
```

---

## Self-Review Notes

- **Spec coverage:** CLI entry (T9), REST routes incl. create/clone (T7), preview (T6), grid+drag Option 1 (T8/T9), validated save (T4), agent scaffolding (T5), PyYAML custom dumper (T1), level computation (T2), security/slug guard (T4), tests (T1-T7,T10). Dataflow tab reuses the cartography mermaid for now; a dedicated dataflow render can reuse `generate_mermaid_dataflow` later (out of MVP scope).
- **Known simplification:** the front-end recomputes levels locally (`localLevels`) mirroring `compute_levels`; server remains the authority on save (T7 returns recomputed levels on reload). Sub-panels for `conditions`/`brainstormings`/`manual_sections`/`on_demand_agents` are editable only via the raw model in MVP (YAML tab is read-only; full sub-panels are a follow-up). Flag to user if full coverage of those rare sections is required in v1.
- **Type consistency:** `make_edit_handler(workflows_dir, agents_dir, templates_dir)`, `save_workflow(name, model, workflows_dir, agents_dir)`, `create_agent(name, description, tools, model, prompt, agents_dir, invocations_dir)`, `compute_levels(workflow)`, `render_cartography_mermaid(workflow, templates_dir)`, `dump_workflow_yaml(model)` — names used consistently across handler and tests.
