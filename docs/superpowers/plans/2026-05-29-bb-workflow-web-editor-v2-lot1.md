# bb-workflow web editor v2 — Lot 1 (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild the editor foundation: server-authoritative model logic (levels, columns, parallel_with, dependency edges), a `/api/view` endpoint, and an anti-XSS grid front-end that renders phases with **visible dependency links** and a position+refine drag model — with real front-end tests.

**Architecture:** All model math lives in Python (`claude-setup/scripts/bb-workflow`) and is exercised by pytest. The browser keeps the working model, posts it to `/api/view` after every structural edit, and re-renders from the returned `{levels, columns, parallel_with, edges, errors}`. Rendering builds DOM nodes (`createElement`/`textContent`/`addEventListener`) — never `innerHTML` of user data and no inline handlers — killing the v1 XSS hole. Dependency links are an SVG overlay drawn from `edges`.

**Tech Stack:** Python 3 stdlib (`http.server` → `ThreadingHTTPServer`), PyYAML, Jinja2 (reused), vanilla JS (no build), bun + linkedom for front-end tests, pytest.

**Spec:** `docs/superpowers/specs/2026-05-29-bb-workflow-web-editor-v2-design.md`

**Lot 2 (later):** full field coverage — io_refs, cmd, triggers, groups, skill.*, conditions, on_demand_agents.
**Lot 3 (later):** agent creation from GUI + non-blocking mermaid (ThreadingHTTPServer prefetch) + rendered Dataflow tab.

---

## File Structure

- **Modify** `claude-setup/scripts/bb-workflow` — add derivation helpers + `POST /api/view` route + switch to `ThreadingHTTPServer`.
- **Rewrite** `claude-setup/workflow/templates/webedit/editor.js` — anti-XSS DOM rendering, SVG edges, position+refine drag, `/api/view` round-trip.
- **Rewrite** `claude-setup/workflow/templates/webedit/editor.html` — grid + SVG overlay containers, panel.
- **Modify** `claude-setup/workflow/templates/webedit/editor.css` — edge overlay + grid styles.
- **Create** `claude-setup/scripts/tests/webedit/derive.test.js` — bun tests for client render helpers.
- **Create** `claude-setup/scripts/tests/webedit/package.json` — pins linkedom for bun.
- **Modify** `claude-setup/scripts/tests/test_workflow_edit.py` — pytest for derivation + `/api/view`.

Reused: `compute_levels`, `validate_schema`, `validate_coherence`, `render_dataflow_mermaid`, `render_cartography_mermaid`, `make_edit_handler`, `is_valid_slug`, `bbw_module` fixture.

---

## Task 1: `derive_columns` — stable column index within a level

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (after `compute_levels`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_workflow_edit.py`:

```python
def test_derive_columns_orders_within_level(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
        {"id": "C", "name": "c", "group": "g", "depends_on": ["A"]},
    ]}
    levels = bbw_module.compute_levels(wf)
    cols = bbw_module.derive_columns(wf, levels)
    # A alone on level 0; B,C share level 1 -> columns 0 and 1 in phase order
    assert cols["A"] == 0
    assert {cols["B"], cols["C"]} == {0, 1}
    assert cols["B"] == 0 and cols["C"] == 1  # preserves declaration order
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k derive_columns -v`
Expected: FAIL `AttributeError ... derive_columns`

- [ ] **Step 3: Implement** (after `compute_levels`):

```python
def derive_columns(workflow: dict, levels: dict) -> dict:
    """Column index of each phase within its level, in declaration order."""
    counters = {}
    cols = {}
    for p in workflow.get("phases", []):
        lvl = levels.get(p["id"], 0)
        cols[p["id"]] = counters.get(lvl, 0)
        counters[lvl] = counters.get(lvl, 0) + 1
    return cols
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k derive_columns -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): derive_columns for grid layout"
```

---

## Task 2: `derive_parallel_with` — same-level siblings

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (after `derive_columns`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k derive_parallel_with -v`
Expected: FAIL

- [ ] **Step 3: Implement** (after `derive_columns`):

```python
def derive_parallel_with(workflow: dict, levels: dict) -> dict:
    """Map phase id -> other phase ids sharing its level (declaration order)."""
    by_level = {}
    for p in workflow.get("phases", []):
        by_level.setdefault(levels.get(p["id"], 0), []).append(p["id"])
    out = {}
    for ids in by_level.values():
        for pid in ids:
            out[pid] = [x for x in ids if x != pid]
    return out
```

- [ ] **Step 4: Run to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): derive_parallel_with from levels"
```

---

## Task 3: `build_edges` + `default_depends_on_for_level`

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (after `derive_parallel_with`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_build_edges(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
    ]}
    edges = bbw_module.build_edges(wf)
    assert {"from": "A", "to": "B"} in edges
    # only edges between known phases
    assert all(e["from"] in {"A","B"} and e["to"] in {"A","B"} for e in edges)


def test_default_depends_on_for_level(bbw_module):
    wf = {"phases": [
        {"id": "A", "name": "a", "group": "g"},
        {"id": "B", "name": "b", "group": "g", "depends_on": ["A"]},
        {"id": "C", "name": "c", "group": "g", "depends_on": ["A"]},
    ]}
    levels = bbw_module.compute_levels(wf)
    # level 0 -> no deps ; level 1 -> all level-0 phases
    assert bbw_module.default_depends_on_for_level(wf, levels, 0) == []
    assert bbw_module.default_depends_on_for_level(wf, levels, 1) == ["A"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k "build_edges or default_depends_on" -v`
Expected: FAIL

- [ ] **Step 3: Implement** (after `derive_parallel_with`):

```python
def build_edges(workflow: dict) -> list:
    """List of {from, to} dependency edges between known phases."""
    ids = {p["id"] for p in workflow.get("phases", [])}
    edges = []
    for p in workflow.get("phases", []):
        for dep in (p.get("depends_on") or []):
            if dep in ids:
                edges.append({"from": dep, "to": p["id"]})
    return edges


def default_depends_on_for_level(workflow: dict, levels: dict, level: int) -> list:
    """Phase ids on the immediately-previous level (drop default)."""
    if level <= 0:
        return []
    return [p["id"] for p in workflow.get("phases", [])
            if levels.get(p["id"], 0) == level - 1]
```

- [ ] **Step 4: Run to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): build_edges + default_depends_on_for_level"
```

---

## Task 4: `apply_parallel_with` — write derived parallel_with into model

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (after `build_edges`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

```python
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
    assert byid["C"]["parallel_with"] == ["B"]   # stale value replaced
    # solo phase: parallel_with absent (not empty list noise)
    assert "parallel_with" not in byid["A"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k apply_parallel_with -v`
Expected: FAIL

- [ ] **Step 3: Implement** (after `build_edges`):

```python
def apply_parallel_with(model: dict, levels: dict) -> None:
    """Write derived parallel_with onto each phase (in place); drop when solo."""
    pw = derive_parallel_with(model, levels)
    for p in model.get("phases", []):
        peers = pw.get(p["id"], [])
        if peers:
            p["parallel_with"] = peers
        else:
            p.pop("parallel_with", None)
```

- [ ] **Step 4: Run to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): apply_parallel_with writes derived peers"
```

---

## Task 5: `POST /api/view` endpoint + ThreadingHTTPServer

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (`_route_post` in `make_edit_handler`; `cmd_edit`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_view_endpoint_returns_layout(editor_server):
    model = json.loads(_get(editor_server, "/api/workflow/demo")[1])["model"]
    status, body = _send(editor_server, "POST", "/api/view", model)
    assert status == 200
    j = json.loads(body)
    for key in ("levels", "columns", "parallel_with", "edges", "errors"):
        assert key in j
    assert j["levels"]["R0-LOAD"] == 0
    assert any(e["to"] == "R1-BOT-SIM" for e in j["edges"])


def test_view_endpoint_reports_errors_without_500(editor_server):
    # a model missing required fields -> errors listed, still HTTP 200
    status, body = _send(editor_server, "POST", "/api/view", {"schema_version": 1})
    assert status == 200
    assert json.loads(body)["errors"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k "view_endpoint" -v`
Expected: FAIL (404 / missing keys)

- [ ] **Step 3: Implement.**

In `_route_post`, add before the `/api/preview` branch:

```python
            if p == "/api/view":
                levels = compute_levels(data)
                errors = validate_schema(data)
                return self._json(200, {
                    "levels": levels,
                    "columns": derive_columns(data, levels),
                    "parallel_with": derive_parallel_with(data, levels),
                    "edges": build_edges(data),
                    "errors": errors,
                })
```

In `cmd_edit`, change the server class to threading:

```python
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k "view_endpoint" -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): POST /api/view (layout+edges) + threading server"
```

---

## Task 6: save writes derived parallel_with

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (`save_workflow`)
- Test: `claude-setup/scripts/tests/test_workflow_edit.py`

- [ ] **Step 1: Write the failing test**

```python
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
    import yaml as _y
    saved = _y.safe_load((tmp_path / "pw-flow.yaml").read_text())
    byid = {p["id"]: p for p in saved["phases"]}
    assert byid["B"].get("parallel_with") == ["C"]
    assert "parallel_with" not in byid["A"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k save_writes_parallel_with -v`
Expected: FAIL (parallel_with not written)

- [ ] **Step 3: Implement.** In `save_workflow`, immediately after the slug check and before `validate_schema`, derive and apply parallel_with so it is validated and persisted:

```python
    if not is_valid_slug(name):
        return [f"invalid workflow name: {name!r}"]
    apply_parallel_with(model, compute_levels(model))
    errors = validate_schema(model)
```

- [ ] **Step 4: Run to verify it passes**

Run the new test (PASS) **and** the existing save tests to ensure no regression:
`cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py -k "save" -v`
Expected: all PASS. Then re-confirm round-trip idempotence test still green:
`... -k idempotent -v`

- [ ] **Step 5: Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_edit.py
git commit -m "feat(bb-workflow): save derives and writes parallel_with"
```

---

## Task 7: bun + linkedom test harness for the front-end

**Files:**
- Create: `claude-setup/scripts/tests/webedit/package.json`
- Create: `claude-setup/scripts/tests/webedit/render.test.js`

This task sets up front-end testing (the v1 gap) with a tiny pure helper so the
harness is proven before the full rewrite depends on it.

- [ ] **Step 1: Create the package.json**

`claude-setup/scripts/tests/webedit/package.json`:

```json
{
  "name": "webedit-tests",
  "private": true,
  "devDependencies": { "linkedom": "^0.18.0" }
}
```

- [ ] **Step 2: Install linkedom with bun**

Run: `cd claude-setup/scripts/tests/webedit && bun install`
Expected: linkedom installed, `bun.lockb` created.

- [ ] **Step 3: Write a failing test against a helper that does not exist yet**

`claude-setup/scripts/tests/webedit/render.test.js`:

```js
import { test, expect } from "bun:test";
import { parseHTML } from "linkedom";
import { makeCard } from "./helpers.js";

test("makeCard renders id/name as inert text (no XSS)", () => {
  const { document } = parseHTML("<!DOCTYPE html><body></body>");
  globalThis.document = document;
  const card = makeCard({ id: "X');alert(1)//", name: "<img src=x onerror=alert(2)>", type: "agent" });
  document.body.appendChild(card);
  // the dangerous payload must appear only as text, never as an element/attr
  expect(document.querySelector("img")).toBeNull();
  expect(card.textContent).toContain("X');alert(1)//");
  expect(card.getAttribute("data-id")).toBe("X');alert(1)//");
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd claude-setup/scripts/tests/webedit && bun test`
Expected: FAIL — `Cannot find module "./helpers.js"`.

- [ ] **Step 5: Create the helper module under test**

`claude-setup/scripts/tests/webedit/helpers.js` (this is the canonical, testable
card builder; `editor.js` in Task 8 imports the same pattern — here we keep a
standalone copy the test pins, and Task 8 reuses it inline):

```js
// Pure DOM builders — no innerHTML of user data, no inline handlers.
export function makeCard(phase) {
  const el = document.createElement("div");
  el.className = "phase-card";
  el.draggable = true;
  el.dataset.id = phase.id;
  const pid = document.createElement("div");
  pid.className = "pid";
  pid.textContent = phase.id + " ";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = phase.type || "agent";
  pid.appendChild(badge);
  const name = document.createElement("div");
  name.textContent = phase.name || "";
  el.appendChild(pid);
  el.appendChild(name);
  return el;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd claude-setup/scripts/tests/webedit && bun test`
Expected: 1 PASS

- [ ] **Step 7: Commit**

```bash
git add claude-setup/scripts/tests/webedit/
git commit -m "test(bb-workflow): bun+linkedom front-end harness + anti-XSS card test"
```

---

## Task 8: Rewrite the front-end — anti-XSS grid with visible dependency links

**Files:**
- Rewrite: `claude-setup/workflow/templates/webedit/editor.html`
- Rewrite: `claude-setup/workflow/templates/webedit/editor.js`
- Modify: `claude-setup/workflow/templates/webedit/editor.css`
- Test: `claude-setup/scripts/tests/webedit/render.test.js` (extend)

- [ ] **Step 1: Write the failing front-end tests** (extend `render.test.js`):

```js
import { renderEdges, computeDropDepends } from "./editlogic.js";

test("renderEdges draws one line per edge", () => {
  const { document } = parseHTML("<!DOCTYPE html><body><svg id='ov'></svg></body>");
  globalThis.document = document;
  const svg = document.getElementById("ov");
  // fake positions: edges A->B, A->C
  const pos = { A:{x:10,y:10}, B:{x:50,y:60}, C:{x:90,y:60} };
  renderEdges(svg, [{from:"A",to:"B"},{from:"A",to:"C"}], pos);
  expect(svg.querySelectorAll("line").length).toBe(2);
});

test("computeDropDepends: level 0 clears, level N = previous-row ids", () => {
  const rows = [["A"], ["B","C"], ["D"]];
  expect(computeDropDepends(rows, 0, "D")).toEqual([]);
  expect(computeDropDepends(rows, 2, "D")).toEqual(["B","C"]);
  // dropping a card onto its own row excludes itself
  expect(computeDropDepends(rows, 1, "B")).toEqual(["A"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-setup/scripts/tests/webedit && bun test`
Expected: FAIL — `Cannot find module "./editlogic.js"`.

- [ ] **Step 3: Create `editlogic.js`** (pure, testable logic shared by the page):

`claude-setup/scripts/tests/webedit/editlogic.js`:

```js
// Pure logic used by editor.js (imported in the browser as a module too).
export function computeDropDepends(rows, level, draggedId) {
  if (level <= 0) return [];
  return rows[level - 1].filter(id => id !== draggedId);
}

export function renderEdges(svg, edges, pos) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const NS = "http://www.w3.org/2000/svg";
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) continue;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
    line.setAttribute("class", "dep-edge");
    svg.appendChild(line);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-setup/scripts/tests/webedit && bun test`
Expected: all PASS (card + edges + drop-depends).

- [ ] **Step 5: Rewrite `editor.html`** with grid + SVG overlay + panel + modals.

`claude-setup/workflow/templates/webedit/editor.html`:

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
    <button id="add-phase">+ phase</button>
    <button id="wf-save">💾 enregistrer</button>
    <span id="status"></span>
  </header>
  <nav id="tabs">
    <button class="tab active" data-tab="grid">Grille</button>
    <button class="tab" data-tab="yaml">YAML</button>
  </nav>
  <main>
    <section id="panel-grid" class="panel active">
      <div id="grid-wrap">
        <svg id="edge-overlay"></svg>
        <div id="grid"></div>
      </div>
    </section>
    <section id="panel-yaml" class="panel"><pre id="yaml-src"></pre></section>
  </main>
  <aside id="edit-panel" hidden></aside>
<script type="module">/*__EDITOR_JS__*/</script>
</body>
</html>
```

- [ ] **Step 6: Rewrite `editor.js`** — anti-XSS DOM, `/api/view` round-trip, SVG edges, position+refine drag, basic panel (id/name/type/group/depends_on refine; full fields are Lot 2).

`claude-setup/workflow/templates/webedit/editor.js`:

```js
const $ = s => document.querySelector(s);
const api = (m, p, b) => fetch(p, {method:m, headers:{'Content-Type':'application/json'},
  body: b ? JSON.stringify(b) : undefined}).then(async r => ({status:r.status, j:await r.json()}));

// ---- pure logic (mirrors editlogic.js; kept inline for the single-file serve) ----
function computeDropDepends(rows, level, draggedId){
  if(level <= 0) return [];
  return rows[level-1].filter(id => id !== draggedId);
}
function renderEdges(svg, edges, pos){
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  const NS="http://www.w3.org/2000/svg";
  for(const e of edges){
    const a=pos[e.from], b=pos[e.to]; if(!a||!b) continue;
    const line=document.createElementNS(NS,"line");
    line.setAttribute("x1",a.x); line.setAttribute("y1",a.y);
    line.setAttribute("x2",b.x); line.setAttribute("y2",b.y);
    line.setAttribute("class","dep-edge");
    svg.appendChild(line);
  }
}
function makeCard(phase){
  const el=document.createElement("div");
  el.className="phase-card"; el.draggable=true; el.dataset.id=phase.id;
  const pid=document.createElement("div"); pid.className="pid"; pid.textContent=phase.id+" ";
  const badge=document.createElement("span"); badge.className="badge"; badge.textContent=phase.type||"agent";
  pid.appendChild(badge);
  const name=document.createElement("div"); name.textContent=phase.name||"";
  el.appendChild(pid); el.appendChild(name);
  return el;
}

let state={name:null, model:null, view:null, selected:null};

async function loadList(){
  const {j}=await api('GET','/api/workflows');
  const sel=$('#wf-select'); sel.replaceChildren();
  j.forEach(n=>{ const o=document.createElement('option'); o.textContent=n; sel.appendChild(o); });
  if(!j.length) return;
  const want=new URLSearchParams(location.search).get('workflow');
  const initial=(want && j.includes(want))?want:j[0];
  sel.value=initial; await loadWorkflow(initial);
}
async function loadWorkflow(name){
  const {j}=await api('GET','/api/workflow/'+name);
  state={name, model:j.model, view:null, selected:null};
  $('#edit-panel').hidden=true;
  await refreshView();
}
async function refreshView(){
  const {j}=await api('POST','/api/view',state.model);
  state.view=j;
  renderGrid(); renderYaml();
  if(j.errors && j.errors.length) setStatus('⚠ '+j.errors.length+' problème(s) de validation');
  else setStatus('');
}
function setStatus(t){ $('#status').textContent=t; }

function rowsFromView(){
  const lv=state.view.levels, max=Math.max(0,...Object.values(lv));
  const rows=[]; for(let i=0;i<=max;i++) rows.push([]);
  (state.model.phases||[]).forEach(p=>rows[lv[p.id]||0].push(p.id));
  return rows;
}
function renderGrid(){
  const grid=$('#grid'); grid.replaceChildren();
  const rows=rowsFromView();
  const byId={}; (state.model.phases||[]).forEach(p=>byId[p.id]=p);
  rows.forEach((ids,i)=>grid.appendChild(makeRow(ids,i,byId)));
  grid.appendChild(makeRow([],rows.length,byId,true)); // trailing new-level drop
  // edges after layout settles
  requestAnimationFrame(drawEdges);
}
function makeRow(ids,i,byId,isNew){
  const row=document.createElement("div");
  row.className="row"+(isNew?" new-level":"");
  row.dataset.level=i;
  row.addEventListener("dragover",e=>{e.preventDefault();row.classList.add("drop-hover");});
  row.addEventListener("dragleave",()=>row.classList.remove("drop-hover"));
  row.addEventListener("drop",e=>onDrop(e,i));
  const label=document.createElement("div"); label.className="row-label";
  label.textContent = isNew ? `Niv. ${i+1} (déposer ici)` : `Niv. ${i+1}`;
  row.appendChild(label);
  ids.forEach(id=>{
    const card=makeCard(byId[id]);
    if(id===state.selected) card.classList.add("selected");
    card.addEventListener("dragstart",e=>e.dataTransfer.setData("text/plain",id));
    card.addEventListener("click",()=>selectPhase(id));
    row.appendChild(card);
  });
  return row;
}
function cardCenter(id){
  const el=[...document.querySelectorAll('.phase-card')].find(c=>c.dataset.id===id);
  const wrap=$('#grid-wrap').getBoundingClientRect();
  if(!el) return null;
  const r=el.getBoundingClientRect();
  return {x:r.left-wrap.left+r.width/2, y:r.top-wrap.top+r.height/2};
}
function drawEdges(){
  const svg=$('#edge-overlay');
  const wrap=$('#grid-wrap').getBoundingClientRect();
  svg.setAttribute("width",wrap.width); svg.setAttribute("height",wrap.height);
  const pos={}; (state.model.phases||[]).forEach(p=>{const c=cardCenter(p.id); if(c) pos[p.id]=c;});
  renderEdges(svg, state.view.edges||[], pos);
}
async function onDrop(ev,level){
  ev.preventDefault();
  const id=ev.dataTransfer.getData("text/plain");
  const p=(state.model.phases||[]).find(x=>x.id===id); if(!p) return;
  const rows=rowsFromView();
  p.depends_on=computeDropDepends(rows, level, id);
  await refreshView();
}

function selectPhase(id){
  state.selected=id;
  const p=(state.model.phases||[]).find(x=>x.id===id); if(!p) return;
  const lvl=state.view.levels[id]||0;
  const candidates=(state.model.phases||[]).filter(o=>o.id!==id && (state.view.levels[o.id]||0)<lvl);
  const panel=$('#edit-panel'); panel.hidden=false; panel.replaceChildren();
  const mk=(label,node)=>{const l=document.createElement("label"); l.textContent=label; panel.appendChild(l); panel.appendChild(node);};
  const idIn=document.createElement("input"); idIn.value=p.id;
  idIn.addEventListener("change",()=>renamePhase(idIn.value)); mk("id",idIn);
  const nameIn=document.createElement("input"); nameIn.value=p.name||"";
  nameIn.addEventListener("change",()=>{p.name=nameIn.value; refreshView();}); mk("name",nameIn);
  const typeSel=document.createElement("select");
  ["agent","script","external","main_agent","workflow_call"].forEach(t=>{const o=document.createElement("option"); o.textContent=t; if((p.type||"agent")===t)o.selected=true; typeSel.appendChild(o);});
  typeSel.addEventListener("change",()=>{p.type=typeSel.value; refreshView(); selectPhase(id);}); mk("type",typeSel);
  const grpSel=document.createElement("select");
  Object.keys(state.model.groups||{}).forEach(g=>{const o=document.createElement("option"); o.textContent=g; if(p.group===g)o.selected=true; grpSel.appendChild(o);});
  grpSel.addEventListener("change",()=>{p.group=grpSel.value; refreshView();}); mk("group",grpSel);
  const depLabel=document.createElement("label"); depLabel.textContent="depends_on (niveaux précédents)"; panel.appendChild(depLabel);
  if(!candidates.length){const m=document.createElement("div"); m.className="muted"; m.textContent="racine — glisse cette carte sous une autre pour créer une dépendance"; panel.appendChild(m);}
  candidates.forEach(o=>{
    const wrap=document.createElement("label"); wrap.style.textTransform="none";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=(p.depends_on||[]).includes(o.id);
    cb.addEventListener("change",()=>toggleDep(o.id,cb.checked));
    wrap.appendChild(cb); wrap.appendChild(document.createTextNode(" "+o.id+" (niv. "+((state.view.levels[o.id]||0)+1)+")"));
    panel.appendChild(wrap);
  });
  const del=document.createElement("button"); del.textContent="🗑 supprimer la phase";
  del.addEventListener("click",deletePhase); panel.appendChild(del);
  const close=document.createElement("button"); close.textContent="fermer";
  close.addEventListener("click",()=>{panel.hidden=true;}); panel.appendChild(close);
  renderGrid();
}
function cur(){ return (state.model.phases||[]).find(x=>x.id===state.selected); }
function toggleDep(dep,on){ const p=cur(); if(!p)return; p.depends_on=p.depends_on||[];
  if(on){ if(!p.depends_on.includes(dep)) p.depends_on.push(dep);} else p.depends_on=p.depends_on.filter(d=>d!==dep);
  refreshView().then(()=>selectPhase(state.selected)); }
function renamePhase(newId){ const p=cur(); if(!p||!newId||newId===p.id)return;
  const old=p.id; (state.model.phases||[]).forEach(x=>{if(x.depends_on)x.depends_on=x.depends_on.map(d=>d===old?newId:d);});
  p.id=newId; state.selected=newId; refreshView().then(()=>selectPhase(newId)); }
function uniqueId(base){ const ids=new Set((state.model.phases||[]).map(p=>p.id));
  if(!ids.has(base))return base; let n=2; while(ids.has(base+"-"+n))n++; return base+"-"+n; }
function addPhase(){ if(!state.model)return;
  const id=uniqueId("NEW-PHASE"); const group=Object.keys(state.model.groups||{})[0]||"setup";
  state.model.phases=state.model.phases||[]; state.model.phases.push({id,name:"Nouvelle phase",group,type:"agent",depends_on:[]});
  refreshView().then(()=>selectPhase(id)); }
function deletePhase(){ const p=cur(); if(!p)return; if(!confirm("Supprimer "+p.id+" ?"))return;
  const id=p.id; state.model.phases=state.model.phases.filter(x=>x.id!==id);
  (state.model.phases||[]).forEach(x=>{if(x.depends_on)x.depends_on=x.depends_on.filter(d=>d!==id);});
  state.selected=null; $('#edit-panel').hidden=true; refreshView(); }

function renderYaml(){ $('#yaml-src').textContent=JSON.stringify(state.model,null,2); }

async function save(){
  const {status,j}=await api('PUT','/api/workflow/'+state.name,{model:state.model});
  setStatus(status===200?'✓ enregistré':'✗ '+((j.errors||[]).join('; ')||'erreur'));
  if(status===200) loadWorkflow(state.name);
}
async function newWf(){ const name=prompt('Nom du workflow (slug):'); if(!name)return;
  const {status,j}=await api('POST','/api/workflow',{name});
  if(status===200){await loadList(); $('#wf-select').value=name; loadWorkflow(name);} else alert((j.errors||['erreur']).join('; ')); }
async function cloneWf(){ const {j:list}=await api('GET','/api/workflows');
  const from=prompt('Dupliquer depuis ?\n('+list.join(', ')+')',state.name); if(!from)return;
  const name=prompt('Nom de la copie (slug):'); if(!name)return;
  const {status,j}=await api('POST','/api/workflow',{name,from});
  if(status===200){await loadList(); $('#wf-select').value=name; loadWorkflow(name);} else alert((j.errors||['erreur']).join('; ')); }

window.addEventListener("resize",()=>{ if(state.view) drawEdges(); });
document.addEventListener('DOMContentLoaded',()=>{
  loadList();
  $('#wf-select').addEventListener('change',e=>loadWorkflow(e.target.value));
  $('#wf-new').addEventListener('click',newWf);
  $('#wf-clone').addEventListener('click',cloneWf);
  $('#add-phase').addEventListener('click',addPhase);
  $('#wf-save').addEventListener('click',save);
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active'); $('#panel-'+t.dataset.tab).classList.add('active');
    if(t.dataset.tab==='grid' && state.view) drawEdges();
  }));
});
```

- [ ] **Step 7: Update `editor.css`** — add grid-wrap + overlay + edge styling. Append:

```css
#grid-wrap{position:relative}
#edge-overlay{position:absolute;inset:0;pointer-events:none;z-index:0}
#grid{position:relative;z-index:1}
.dep-edge{stroke:var(--accent);stroke-width:1.5;opacity:.5}
.row.new-level{opacity:.6;font-style:italic}
.grid-actions{margin-bottom:10px}
.muted{color:#667;font-size:11px;margin-top:4px}
```

- [ ] **Step 8: Run the front-end tests + the index test**

Run: `cd claude-setup/scripts/tests/webedit && bun test`
Expected: all PASS.
Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/test_workflow_edit.py::test_get_index_returns_html -v`
Expected: PASS (`id="grid"` present after inlining).

- [ ] **Step 9: Commit**

```bash
git add claude-setup/workflow/templates/webedit/ claude-setup/scripts/tests/webedit/
git commit -m "feat(bb-workflow): v2 grid front-end — anti-XSS DOM, visible dep links, /api/view"
```

---

## Task 9: full suite + install + live validation gate

**Files:** none (verification + install)

- [ ] **Step 1: Run the full pytest suite**

Run: `cd claude-setup/scripts && /home/marc-antoine/python3-venv/bin/python -m pytest tests/ -q`
Expected: all green (new derivation + view tests + existing).

- [ ] **Step 2: Run the bun suite**

Run: `cd claude-setup/scripts/tests/webedit && bun test`
Expected: all green.

- [ ] **Step 3: Update the installed CLI**

Run: `cp claude-setup/scripts/bb-workflow ~/.local/bin/bb-workflow`
(so the hunter's `bb-workflow edit` runs Lot 1).

- [ ] **Step 4: Live validation (hunter relaunches server; agent drives Chrome)**

Ask the hunter to relaunch `bb-workflow edit`. Then via Chrome verify on `demo` and `demo`:
1. Grid shows levels + multiple cards per row (parallelism).
2. **Dependency links are visible** (SVG lines between cards).
3. Click a phase → panel shows depends_on candidates from earlier levels only.
4. Drag a card to another row → its depends_on updates, edges redraw, no clobber of unrelated phases.
5. YAML tab reflects changes including derived `parallel_with`.
6. Save → `git diff` on the workflow is valid; `bb-workflow validate` passes; then `git checkout` to discard the test edit.

Report each step's result explicitly. Do not mark Lot 1 done until the hunter confirms the live checks.

- [ ] **Step 5: Commit any fixes from live validation, then write the Lot 2 plan.**

---

## Self-Review Notes

- **Spec coverage (Lot 1 scope):** server model logic (T1-T4), `/api/view` + threading (T5), parallel_with persisted (T6), front-end test harness (T7), anti-XSS grid + visible links + position-refine drag (T8), verification + live gate (T9). Field coverage (io_refs/cmd/triggers/groups/skill/conditions), agent creation, and mermaid Dataflow are explicitly deferred to Lots 2-3 per the agreed delivery split.
- **Duplication note:** `computeDropDepends`/`renderEdges`/`makeCard` exist both in `editlogic.js`/`helpers.js` (tested) and inline in `editor.js` (served). This is a deliberate, documented duplication for the single-file inline-serve model; the test copies pin the behavior. If it drifts, Lot 2 should switch the server to inline `editlogic.js` from disk (one source). Flagged so it is not mistaken for an accident.
- **Type consistency:** `/api/view` returns `{levels, columns, parallel_with, edges, errors}` consumed by `refreshView`; `build_edges` emits `{from,to}` consumed by `renderEdges`; `computeDropDepends(rows, level, id)` signature identical in test and editor.
