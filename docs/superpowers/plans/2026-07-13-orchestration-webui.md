# Orchestration layer in the awok web editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the awok orchestration layer (logic gates: `if`/`while`/`until`/`for_each`, signals, caps) fully usable from the `awok edit` web editor — read, edit, and persist `<name>.orchestration.yaml` — on top of the existing Grid, with no regression.

**Architecture:** Three phases executed in order. (1) Wire the Python server to the *existing* engine functions (`load_workflow`, `build_orchestration_overlay`, `validate_orchestration`) and split the `.orchestration.yaml` sibling on save. (2) A new front-end module `webedit/orchestration.js` renders the program (block tree) when a `◆ Orchestration` toggle is on; `editor.js` gains a thin seam. (3) The edit surface: gate creation, a gate panel in the existing drawer, signal declare/pick, drag-to-**move**, and warning-only live validation.

**Tech Stack:** Python 3 stdlib + PyYAML + jsonschema (server, `src/scripts/bb-workflow`); pytest (`src/scripts/tests/`); vanilla ES modules + DOM (`src/workflow/templates/webedit/`), no framework, no build step. Front-end verification is via the Chrome DevTools MCP browser (there is no JS unit-test runner).

## Global Constraints

- **Backward-compat floor:** no `<name>.orchestration.yaml` ⇒ no `orchestration` key ⇒ toggle defaults OFF ⇒ Grid, `/api/view` response, generated SKILL.md, and cartography are byte-identical to today. Every task must preserve this.
- **Warning-only save:** semantic `validate_orchestration` issues NEVER block save. Structural orchestration-schema validation (in `validate_schema`) stays blocking. (Spec Phase-1 §4.)
- **Never edit a `SKILL.md` by hand.** This plan touches the server + webedit templates, NOT the Jinja templates that render SKILL.md/cartography — so it does not re-render workflow artifacts. `awok check` must stay green throughout.
- **Reuse, don't reimplement engine logic:** the front-end client validation mirror is for instant feedback only; the server (`validate_orchestration`) is authoritative.
- **`model: inherit`** convention and all existing CLAUDE.md rules still apply.
- **Visual system (guide §2):** violet = control flow (`--violet:#a78bfa`, `--violet-2:#c4b5fd` — new tokens); sky `◈` = signal (existing `--accent:#38bdf8`); amber = literal & cap (existing `--warn:#fbbf24`/`--warn-2:#fcd34d`); green `then` (existing `--good`), neutral `else`.
- **Reference implementation for UX (committed in-repo):**
  `docs/superpowers/specs/2026-07-13-orchestration-refs/orchestration-prototype.dc.html`
  (behavioral spec — a React/`x-dc` prototype; translate its methods to vanilla DOM) and
  `docs/superpowers/specs/2026-07-13-orchestration-refs/ORCHESTRATION_INTEGRATION.md`
  (§1 do-not-regress, §2 features, §3 fixes, §4 decisions, §5 backend, §6 out-of-scope).
  Function names below in *(proto: X)* point at the prototype method to translate. The prototype's `Component` class (search for `class Component extends DCLogic`) holds every method named in this plan — `orchestratedBody`, `gateContainer`, `condPretty`, `renderList`, `paletteEl`, `gatePanel`, `operandCtrl`, `signalPicker`, `declareForm`, `setConstruct`, etc.

## Files

**Phase 1 (server):**
- Modify: `src/scripts/bb-workflow` — `_route_get` (~3131), `_route_post` `/api/view` (~3146), `save_workflow` (~389).
- Create: `src/scripts/tests/test_workflow_webserver_orchestration.py`.

**Phase 2–3 (front-end):**
- Create: `src/workflow/templates/webedit/orchestration.js` — the whole orchestration layer (render program, gates, palette/tray, gate panel, condition builder, signal picker/declare, client validation mirror).
- Modify: `src/workflow/templates/webedit/editor.js` — integration seam (state flags, toolbar buttons, `renderGrid` branch, action→block dep overlay, save wiring for warnings, signal-declare persistence).
- Modify: `src/workflow/templates/webedit/editor.html` — toolbar buttons (`◆ Orchestration`, `＋ Gate`, target selector) + toast host.
- Modify: `src/workflow/templates/webedit/editor.css` — violet tokens + gate/panel/toast/tray classes.
- Modify: `src/workflow/templates/webedit/render-helpers.js` — `emits` chips on `makeCard`.
- Modify (small): `src/workflow/templates/webedit/editlogic.js` — pure helpers reused by both client validation and rendering (`iterBlocks`, `signalsOf`, `orchestrationIssues`).

**How the server serves the JS** (confirmed at `bb-workflow` ~3107): `/editor/<file>.js` is read from `templates_dir` live, so editing `src/workflow/templates/webedit/*` and reloading `awok edit` picks up changes with no build. `editor.html` inlines `editor.css` via the `/*__EDITOR_CSS__*/` marker.

---

## PHASE 1 — Backend wiring

### Task 1: `GET /api/workflow/<name>` merges the orchestration sibling

**Files:**
- Modify: `src/scripts/bb-workflow:3124-3133` (the `if p.startswith("/api/workflow/")` block in `_route_get`)
- Test: `src/scripts/tests/test_workflow_webserver_orchestration.py` (create)

**Interfaces:**
- Consumes: existing `load_workflow(path) -> dict` (line 138), `compute_levels(model)`.
- Produces: the GET route returns `{"model": <merged model with "orchestration" when sibling exists>, "levels": ...}`.

The route builds a `_Handler` closure; to test it without HTTP, extract the read into a tiny module-level helper so pytest can call it directly.

- [ ] **Step 1: Write the failing test**

Create `src/scripts/tests/test_workflow_webserver_orchestration.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_webserver_orchestration.py -v`
Expected: FAIL — `AttributeError: module 'bbw' has no attribute 'read_workflow_payload'`.

- [ ] **Step 3: Add the helper and use it in the route**

Add a module-level helper near `load_workflow` (after line 152 in `src/scripts/bb-workflow`):

```python
def read_workflow_payload(path: Path) -> dict:
    """Editor GET payload: merged model (+ orchestration sibling) and levels."""
    model = load_workflow(path)
    return {"model": model, "levels": compute_levels(model)}
```

Then replace the body of the `/api/workflow/` GET block (lines ~3131-3133) so it uses the helper:

```python
                if not fp.exists():
                    return self._json(404, {"error": "not found"})
                return self._json(200, read_workflow_payload(fp))
```

(Remove the old `model = yaml.safe_load(fp.read_text())` / inline dict.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/scripts/tests/test_workflow_webserver_orchestration.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_webserver_orchestration.py
git commit -m "feat(orchestration): GET /api/workflow merges the orchestration sibling"
```

---

### Task 2: `POST /api/view` returns overlay + orchestration warnings

**Files:**
- Modify: `src/scripts/bb-workflow:3146-3155` (`/api/view` block in `_route_post`)
- Test: `src/scripts/tests/test_workflow_webserver_orchestration.py`

**Interfaces:**
- Consumes: existing `build_orchestration_overlay(model) -> dict` (line 1570), `validate_orchestration(model) -> list[str]` (line 704).
- Produces: `/api/view` response gains keys `orchestration_overlay` (dict) and `orchestration_warnings` (list). Both empty/no-op without an `orchestration` key. Extract a `build_view_payload(model) -> dict` helper for direct testing.

- [ ] **Step 1: Write the failing test**

Append to the test file:

```python
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
```

(If `build_orchestration_overlay({})` returns a specific empty shape, adjust the first assertion in step 3 review; the intent is "no branches/loops".)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_webserver_orchestration.py -k view -v`
Expected: FAIL — `AttributeError: ... 'build_view_payload'`.

- [ ] **Step 3: Add the helper and use it in the route**

Add a module-level helper (place it near `build_orchestration_overlay`, after line ~1600):

```python
def build_view_payload(model: dict) -> dict:
    """Editor /api/view payload: levels/columns/edges/opportunistic (as today)
    plus the orchestration overlay and SEMANTIC orchestration warnings.
    Both orchestration keys are empty when the model has no 'orchestration'."""
    levels = compute_levels(model)
    return {
        "levels": levels,
        "columns": derive_columns(model, levels),
        "parallel_with": derive_parallel_with(model, levels),
        "edges": build_edges(model),
        "errors": validate_schema(model),
        "opportunistic": build_opportunistic_view(model),
        "orchestration_overlay": build_orchestration_overlay(model),
        "orchestration_warnings": validate_orchestration(model),
    }
```

Replace the `/api/view` route body (lines ~3147-3155) with:

```python
            if p == "/api/view":
                return self._json(200, build_view_payload(data))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/scripts/tests/test_workflow_webserver_orchestration.py -k view -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_webserver_orchestration.py
git commit -m "feat(orchestration): /api/view returns overlay + semantic warnings"
```

---

### Task 3: `save_workflow` splits the sibling; save is warning-only for semantics

**Files:**
- Modify: `src/scripts/bb-workflow:389-407` (`save_workflow`)
- Modify: `src/scripts/bb-workflow:3187-3196` (`PUT /api/workflow/<name>`) — thread warnings into the response
- Test: `src/scripts/tests/test_workflow_webserver_orchestration.py`

**Interfaces:**
- Consumes: `orchestration_path_for(path)` (line 133), `dump_workflow_yaml`, `validate_schema`, `validate_coherence`, `validate_orchestration`.
- Produces: `save_workflow(name, model, ...) -> dict` **changes return type** from `list` to `{"errors": list, "warnings": list}`. **All callers must be updated** (grep `save_workflow(` — the two web routes at ~3175 and ~3194, plus any CLI use). Base `<name>.yaml` never contains `orchestration`; the sibling holds the block tree (deleted when empty).

- [ ] **Step 1: Write the failing test**

Append:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_webserver_orchestration.py -k save -v`
Expected: FAIL — `save_workflow` returns a list (`res["errors"]` → `TypeError: list indices must be integers`).

- [ ] **Step 3: Rewrite `save_workflow`**

Replace `save_workflow` (lines 389-407) with:

```python
def save_workflow(name: str, model: dict, workflows_dir: Path = None,
                  agents_dir: Path = None) -> dict:
    """Validate then write. Returns {"errors": [...], "warnings": [...]}.
    Structural errors (schema/coherence) block the write. Semantic
    orchestration issues are WARNINGS — the files are still written so the
    author never loses in-progress work. The 'orchestration' key is split off
    the base <name>.yaml into the <name>.orchestration.yaml sibling."""
    workflows_dir = workflows_dir or DEFAULT_WORKFLOWS_DIR
    agents_dir = agents_dir or DEFAULT_AGENTS_DIR
    if not is_valid_slug(name):
        return {"errors": [f"invalid workflow name: {name!r}"], "warnings": []}
    apply_parallel_with(model, compute_levels(model))
    errors = validate_schema(model)                 # includes orchestration SCHEMA (structural)
    if errors:
        return {"errors": errors, "warnings": []}
    errors = validate_coherence(model, agents_dir=agents_dir,
                                workflows_dir=workflows_dir)
    if errors:
        return {"errors": errors, "warnings": []}
    warnings = validate_orchestration(model)        # semantic -> warning-only

    base = {k: v for k, v in model.items() if k != "orchestration"}
    orch = model.get("orchestration")
    workflows_dir.mkdir(parents=True, exist_ok=True)
    (workflows_dir / f"{name}.yaml").write_text(dump_workflow_yaml(base),
                                                encoding="utf-8")
    sibling = orchestration_path_for(workflows_dir / f"{name}.yaml")
    if orch:
        sibling.write_text(yaml.dump(orch, sort_keys=False, allow_unicode=True,
                                     default_flow_style=False), encoding="utf-8")
    elif sibling.exists():
        sibling.unlink()
    return {"errors": errors, "warnings": warnings}   # errors == [] here
```

- [ ] **Step 4: Update the three `save_workflow` callers (routes)**

`POST /api/workflow` (~3175):

```python
                res = save_workflow(name, model, workflows_dir, agents_dir)
                return self._json(200 if not res["errors"] else 422,
                                  {"errors": res["errors"], "warnings": res["warnings"], "name": name})
```

`PUT /api/workflow/<name>` (~3194):

```python
                res = save_workflow(name, data.get("model", {}),
                                    workflows_dir, agents_dir)
                return self._json(200 if not res["errors"] else 422,
                                  {"errors": res["errors"], "warnings": res["warnings"]})
```

Grep for any other caller and adapt: `grep -n "save_workflow(" src/scripts/bb-workflow`. (The `awok generate`/CLI path reads via `load_workflow` and does not call `save_workflow`; if a CLI command does, update it to read `res["errors"]`.)

- [ ] **Step 5: Run tests + full suite**

Run: `pytest src/scripts/tests/test_workflow_webserver_orchestration.py -v && pytest src/scripts/tests/ -q`
Expected: PASS. Watch for any legacy test asserting `save_workflow(...) == []` — update it to `== {"errors": [], "warnings": []}` or `["errors"] == []` (grep: `save_workflow` in tests).

- [ ] **Step 6: `awok check` regression**

Run: `awok check`
Expected: green (no artifact drift — server-only change).

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/
git commit -m "feat(orchestration): save splits the sibling; semantic issues are warning-only"
```

---

### Task 4: End-to-end round-trip through the fixture

**Files:**
- Test: `src/scripts/tests/test_workflow_webserver_orchestration.py`

**Interfaces:** consumes `read_workflow_payload`, `save_workflow` from Tasks 1 & 3. No new production code — this is the acceptance test proving load→edit→save is lossless.

- [ ] **Step 1: Write the round-trip test**

```python
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
```

- [ ] **Step 2: Run it**

Run: `pytest src/scripts/tests/test_workflow_webserver_orchestration.py::test_roundtrip_load_edit_save -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/tests/test_workflow_webserver_orchestration.py
git commit -m "test(orchestration): server load->edit->save round-trip"
```

**Phase 1 gate:** `pytest src/scripts/tests/ -q` all green; `awok check` green. The editor now *receives* `model.orchestration` and *persists* it, with zero visible change (front-end ignores the key until Phase 2). Verify manually: `awok edit`, open a workflow, Save — confirm no `.orchestration.yaml` appears for a plain workflow and the base YAML is unchanged.

---

## PHASE 2 — Front-end read-path

Shared pure helpers first (Task 5), then the toggle + state seam (Task 6), then rendering (Tasks 7–9). No JS unit runner — each task's "test" is a Chrome DevTools MCP verification with explicit expected observations. Boot once: `awok edit` (note the URL, default `http://localhost:8000`).

### Task 5: Pure orchestration helpers in `editlogic.js`

**Files:**
- Modify: `src/workflow/templates/webedit/editlogic.js` (append exports)

**Interfaces:**
- Produces (imported by `orchestration.js` and `editor.js`):
  - `iterBlocks(blocks, fn)` — depth-first walk; `fn(block, parentArray, index)`. Recurses `then`/`else`/`body`.
  - `findBlock(blocks, id) -> {block, parent, index} | null`.
  - `containerArray(blocks, containerId, slot) -> array` — `"root"` ⇒ `blocks`; else the block's `slot` array (created if absent).
  - `signalsOf(model) -> [{key, name, type, phase}]` — from every phase's `emits`; `key = phase.id.toLowerCase()+"."+emit.name`.
  - `isLoopBlock(b) -> bool` (`while`/`until`/`for_each` key present).
  - `blockConstruct(b) -> "if"|"while"|"until"|"for_each"|"ref"|"parallel"` (first recognised key).
  - `orchestrationIssues(model) -> [{id, kind, msg}]` — client mirror of `validate_orchestration` (capless loop, incomplete condition, missing `for_each` list, cross-block dep). Used for instant feedback only.

> **Block shape note:** the engine's on-disk block uses the construct name as the key (`{if: {..cond..}, then: [...], else: [...]}`, `{for_each: "sig", as, cap, body}`, `{while: {..cond..}, cap, body}`, `{ref: "PHASE"}`) — confirmed in `orchestrated.orchestration.yaml` and `orchestration.schema.json`. The proto used `{type:'if', cond, ...}`; **translate to the engine shape** so no serialization mapping is needed. `iterBlocks`/`findBlock` add a synthetic stable `id` at load if absent (see Task 6, `hydrateBlockIds`).

- [ ] **Step 1: Write the helpers**

Append to `editlogic.js`:

```javascript
// ---- orchestration (block tree) pure helpers -----------------------------
const _SLOTS = ["then", "else", "body"];
export function blockConstruct(b) {
  for (const k of ["ref", "if", "while", "until", "for_each", "parallel"]) if (k in b) return k;
  return "ref";
}
export function isLoopBlock(b) { return "while" in b || "until" in b || "for_each" in b; }
export function iterBlocks(blocks, fn) {
  (blocks || []).forEach((b, i) => { fn(b, blocks, i); _SLOTS.forEach(s => { if (Array.isArray(b[s])) iterBlocks(b[s], fn); }); });
}
export function findBlock(blocks, id) {
  let found = null; iterBlocks(blocks, (b, parent, i) => { if (b._id === id) found = { block: b, parent, index: i }; }); return found;
}
export function containerArray(blocks, containerId, slot) {
  if (containerId === "root") return blocks;
  const f = findBlock(blocks, containerId); if (!f) return null;
  if (!Array.isArray(f.block[slot])) f.block[slot] = []; return f.block[slot];
}
export function signalsOf(model) {
  const out = [];
  for (const p of (model && model.phases) || [])
    for (const e of p.emits || []) out.push({ key: p.id.toLowerCase() + "." + e.name, name: e.name, type: e.type, phase: p.id });
  return out;
}
export function condOf(b) { const k = blockConstruct(b); return (k === "if" || k === "while" || k === "until") ? b[k] : null; }
export function orchestrationIssues(model) {
  const out = []; const sigKeys = new Set(signalsOf(model).map(s => s.key));
  const sigType = k => (signalsOf(model).find(s => s.key === k) || {}).type;
  // map each ref'd phase -> its top-level block id, to detect cross-block deps
  const topOf = {}; (model.orchestration || []).forEach(tb => iterBlocks([tb], b => { if (blockConstruct(b) === "ref" && !(b.ref in topOf)) topOf[b.ref] = tb._id; }));
  iterBlocks(model.orchestration || [], (b) => {
    if (isLoopBlock(b) && !(Number.isInteger(b.cap) && b.cap > 0)) out.push({ id: b._id, kind: blockConstruct(b), msg: "cap required (integer > 0)" });
    if ("for_each" in b && !b.for_each) out.push({ id: b._id, kind: "for_each", msg: "list signal required" });
    if ("for_each" in b && b.for_each && sigType(b.for_each) !== "list") out.push({ id: b._id, kind: "for_each", msg: "signal is not a list" });
    const c = condOf(b);
    if (c && typeof c === "object") {
      if (!c.left) out.push({ id: b._id, kind: blockConstruct(b), msg: "condition incomplete (left operand)" });
      else if (c.op !== "exists" && (c.right === undefined || c.right === "")) out.push({ id: b._id, kind: blockConstruct(b), msg: "condition incomplete (right operand)" });
      if (typeof c.left === "string" && c.left.includes(".") && !sigKeys.has(c.left)) out.push({ id: b._id, kind: blockConstruct(b), msg: "unknown signal " + c.left });
    }
  });
  // cross-block action->action dependency
  for (const p of (model && model.phases) || [])
    for (const d of p.depends_on || [])
      if (topOf[p.id] && topOf[d] && topOf[p.id] !== topOf[d]) out.push({ id: topOf[p.id], kind: "dep", msg: p.id + " depends on " + d + " across a gate boundary (expressed action→block)" });
  return out;
}
```

- [ ] **Step 2: Verify it parses (no runtime yet)**

Run: `node --check src/workflow/templates/webedit/editlogic.js`
Expected: no output (exit 0). (Node can syntax-check an ES module file.)

- [ ] **Step 3: Commit**

```bash
git add src/workflow/templates/webedit/editlogic.js
git commit -m "feat(orchestration): pure block-tree + signal + issue helpers"
```

---

### Task 6: State seam, toolbar, and block-id hydration in `editor.js`

**Files:**
- Modify: `src/workflow/templates/webedit/editor.html:50-57` (grid toolbar) + header target selector + toast host at end of `<body>`
- Modify: `src/workflow/templates/webedit/editor.js` (state, imports, boot wiring, `refreshView`, `renderGrid` branch stub)
- Modify: `src/workflow/templates/webedit/editor.css` (violet tokens + button/toast base)

**Interfaces:**
- Produces: `state.showOrch` (bool, default from `!!model.orchestration`), `state.selectedGate` (block `_id`|null), `state.view.orchestration_overlay`, `state.view.orchestration_warnings`. `hydrateBlockIds(model)` stamps a stable `_id` on every block after load (stripped again on save — Task 3 already drops non-schema keys? No: `_id` is not schema; strip it in `modelForSave`). A new `import * as orch from "./orchestration.js"` seam; `renderGrid` calls `orch.renderProgram(...)` when `state.showOrch`.

- [ ] **Step 1: Add violet tokens + toolbar/toast CSS**

In `editor.css`, extend `:root` (line 5-7 area) with violet + add classes at the end of the file:

```css
:root{ --violet:#a78bfa; --violet-2:#c4b5fd; --violet-soft:rgba(167,139,250,0.14); }
/* orchestration toolbar */
#toggle-orch.on{background:var(--violet-soft);color:var(--violet-2);border-color:var(--violet)}
.target-pill{display:inline-flex;align-items:center;gap:6px;background:var(--well);border:1px solid var(--border);
  border-radius:7px;padding:5px 9px;font:11px/1 var(--mono);color:var(--accent)}
.target-pill[data-disabled=dynamic]{opacity:.6}
/* spontaneous warning toast (top-right) */
#orch-toast{position:fixed;top:14px;right:16px;z-index:80;display:flex;align-items:center;gap:9px;
  background:#2a2008;border:1px solid var(--warn);border-radius:10px;padding:10px 13px;
  box-shadow:0 16px 40px rgba(0,0,0,0.5);cursor:pointer;animation:toastIn .18s ease}
#orch-toast[hidden]{display:none}
#orch-toast .t{font-size:12.5px;font-weight:700;color:var(--warn-2)}
#orch-toast .s{font-size:10.5px;color:var(--muted);margin-top:1px}
@keyframes toastIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
```

- [ ] **Step 2: Add the toolbar buttons + toast host to `editor.html`**

In `#grid-toolbar .tb-right` (line 53-56), before `⤳ Dependencies`, add the target pill; after `+ Action`, add `◆ Orchestration` and `＋ Gate`:

```html
        <div class="tb-right">
          <span class="target-pill" id="target-pill" title="Compile target — dynamic (JS) coming soon">
            <span id="target-val">standard</span><span style="color:var(--muted);font-size:9px">▾</span>
          </span>
          <button id="toggle-orch" class="btn-ghost" title="Show the orchestration program (logic gates)">◆ Orchestration</button>
          <button id="add-gate" class="btn-ghost" hidden title="Add a gate (condition / loop)">＋ Gate</button>
          <button id="toggle-links" class="btn-ghost" title="Show dependency links">⤳ Dependencies</button>
          <button id="add-phase" class="btn-ghost">+ Action</button>
        </div>
```

Just before `</body>` (after `#edit-panel`), add the toast host:

```html
  <div id="orch-toast" hidden><span style="font-size:15px">⚠</span><div><div class="t"></div><div class="s">Click to see details</div></div></div>
```

- [ ] **Step 3: Wire state + imports + boot in `editor.js`**

Add import (top, near other webedit imports):

```javascript
import * as orch from "./orchestration.js";
import { iterBlocks } from "./editlogic.js";   // add to the existing editlogic import list
```

Extend the `state` object literal (line 30-34) with:

```javascript
  showOrch: false, selectedGate: null,
```

In `loadWorkflow` (after `state = { ...state, name, model: j.model, ... }`, ~line 69) hydrate ids + default the toggle:

```javascript
  hydrateBlockIds(state.model);
  state.showOrch = !!(state.model.orchestration && state.model.orchestration.length);
  state.selectedGate = null;
```

Add the helper (module scope):

```javascript
let _blkSeq = 0;
function hydrateBlockIds(model) {
  _blkSeq = 0;
  if (!model || !model.orchestration) return;
  iterBlocks(model.orchestration, b => { if (!b._id) b._id = "b" + (++_blkSeq); });
}
```

In `refreshView` (after `state.view = j;`, ~line 78) the view now carries the new keys automatically. In `modelForSave` (line 735) strip transient ids:

```javascript
  const m = JSON.parse(JSON.stringify(state.model)); delete m.files;
  (function strip(bs){ (bs||[]).forEach(b=>{ delete b._id; ["then","else","body"].forEach(s=>strip(b[s])); }); })(m.orchestration);
  return m;
```

Boot wiring (in `DOMContentLoaded`, near line 794):

```javascript
  $("#toggle-orch").addEventListener("click", () => {
    state.showOrch = !state.showOrch; state.selectedGate = null;
    $("#toggle-orch").classList.toggle("on", state.showOrch);
    $("#add-gate").hidden = !state.showOrch;
    if (!state.showOrch && state.selected == null) $("#edit-panel").hidden = true;
    renderGrid(); applyDrawerLayout();
  });
```

- [ ] **Step 4: Branch `renderGrid` (stub the program render)**

At the top of `renderGrid()` (line 113), before building rows:

```javascript
  if (state.showOrch) { orch.renderProgram({ state, refreshView, selectPhase, resolveGroupColors }); renderLegend(resolveGroupColors(state.model)); schedulePaint(); return; }
```

Create a minimal `orchestration.js` so the import resolves (real render in Task 7):

```javascript
// awok orchestration layer — program (block-tree) view + gate editor.
// Rendered ONLY when state.showOrch is on; the classic grid is untouched otherwise.
export function renderProgram(ctx) {
  const grid = document.querySelector("#grid"); grid.replaceChildren();
  const note = document.createElement("div"); note.className = "help-note";
  note.textContent = "Orchestration view — rendering in Task 7."; grid.appendChild(note);
}
```

- [ ] **Step 5: MCP browser verification**

Boot `awok edit`. With Chrome DevTools MCP: navigate to the editor, select the `orchestrated` workflow (deploy the fixture first or open one that has a sibling — see note). Observe:
1. `◆ Orchestration` button is present and toggles the `.on` violet style.
2. Toggling ON replaces the grid with the placeholder note; `＋ Gate` appears; toggling OFF restores the **exact** classic grid (levels, cards, legend).
3. The header/tabs/selector/Save are unchanged (guide §1).
Take a screenshot of ON and OFF.

> To have a workflow with a sibling in the live editor, copy the fixture into `src/workflows/` temporarily, or `awok --workdir <tmp> ...`; simplest: `cp src/scripts/tests/fixtures/workflows/orchestrated*.yaml src/workflows/` then `awok edit` (remove after testing so it doesn't ship).

- [ ] **Step 6: Commit**

```bash
git add src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.html src/workflow/templates/webedit/editor.css src/workflow/templates/webedit/orchestration.js
git commit -m "feat(orchestration): toggle + state seam + program-render stub"
```

---

### Task 7: Render the program (gates + `{ref}` cards + tray)

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (real `renderProgram`)
- Modify: `src/workflow/templates/webedit/editor.css` (gate + tray + palette classes)

**Interfaces:**
- Consumes: `makeCard` (render-helpers), `iterBlocks`/`findBlock`/`isLoopBlock`/`blockConstruct`/`condOf`/`signalsOf`/`orchestrationIssues` (editlogic), `ctx.resolveGroupColors`, `ctx.state`, `ctx.selectPhase`.
- Produces: DOM under `#grid`: a rail-numbered list of **top-level** blocks; gates as nested containers; `{ref}` → `makeCard` vignette; a "Library / unused actions" tray + a "drag into a gate" palette strip. Also exports `renderPalette(ctx)` used by the toolbar area. Selecting a gate sets `state.selectedGate` and calls back into `editor.js`'s `selectGateExternal` (Task 10 provides the panel; Task 7 wires the click to a no-op `ctx.onSelectGate`).

The **behavioral reference is the proto** — translate these methods to vanilla DOM with the classes below:
- `orchestratedBody()` → `renderProgram` (rail + rows).
- `gateContainer(b, depth)` → `gateEl(b, depth)`: violet solid border + ◆ for `if`; dashed + ↻ + amber `cap N`/`cap required` chip for loops; header = icon + keyword + condition (via `condPretty`) + `✎`. `if` → two lanes (`then` green, `else` neutral) each with a drop zone; loop/`for_each` → single `body` + drop zone. `for_each` header shows `◈ list as <name>`.
- `condPretty(cond)` → `condEl(cond)`: `◈ signal` (sky) · op · literal (amber) / builtin (violet); escape-hatch string → ⚡ italic.
- `renderList(arr, depth)` → `listEl(arr, depth)`: `ref` → draggable vignette; gate → `gateEl`.
- `paletteEl()` → `renderPalette` (draggable phase chips).
- The "unused actions" tray = phases whose id is referenced by no `ref` block (compute via `iterBlocks`), rendered as the same draggable chips under a "Library" heading.

- [ ] **Step 1: Add gate/tray/palette CSS**

Append to `editor.css`:

```css
/* orchestration program view */
.orch-rows{position:relative;display:flex;flex-direction:column;gap:6px}
.orch-row{display:flex;gap:14px;align-items:stretch}
.gate{border:1.5px solid rgba(167,139,250,0.55);border-left:3px solid var(--violet);border-radius:13px;
  background:rgba(167,139,250,0.055);cursor:pointer}
.gate.loop{border-style:dashed}
.gate.selected{box-shadow:0 0 0 2px var(--accent),0 0 22px rgba(56,189,248,0.22)}
.gate-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 13px;border-bottom:1px solid rgba(167,139,250,0.22)}
.gate.loop .gate-head{border-bottom-style:dashed}
.gate-kw{font:11px/1 var(--mono);font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--violet-2)}
.gate-icon-if{width:16px;height:16px;background:var(--violet);transform:rotate(45deg);border-radius:3px}
.gate-icon-loop{width:19px;height:19px;border-radius:50%;border:2px solid var(--violet);color:var(--violet-2);
  display:inline-flex;align-items:center;justify-content:center;font-size:11px}
.gate-body{padding:12px 13px;display:flex;flex-direction:column;gap:9px}
.gate-body.branches{flex-direction:row;gap:10px}
.lane{flex:1;min-width:0;background:var(--bg-2,#0b1120);border:1px solid var(--border);border-radius:10px;padding:9px;
  display:flex;flex-direction:column;gap:8px}
.lane.then{border-color:rgba(134,239,172,0.3)}
.lane-label{font:9.5px/1 var(--mono);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.lane.then .lane-label{color:var(--good-2)}
.cond-pill{display:inline-flex;align-items:center;gap:7px;font:11px/1 var(--mono);background:var(--well);
  border:1px solid var(--border);border-radius:7px;padding:5px 9px}
.cond-sig{color:var(--accent)} .cond-lit{color:var(--warn-2)} .cond-builtin{color:var(--violet-2)} .cond-op{color:var(--muted)}
.cap-chip{font:10px/1 var(--mono);font-weight:700;color:var(--warn-2);background:rgba(251,191,36,0.12);
  border:1px solid rgba(251,191,36,0.35);border-radius:5px;padding:3px 7px}
.cap-chip.bad{color:var(--bad);background:rgba(248,113,113,0.12);border:1px dashed rgba(248,113,113,0.5)}
.gate-edit{margin-left:auto;color:var(--muted);font-size:11px;cursor:pointer;font-weight:600}
.gate.selected .gate-edit{color:var(--accent)}
.drop-slot{border:1.5px dashed var(--border-2);border-radius:10px;padding:9px;display:flex;align-items:center;
  justify-content:center;gap:8px;color:var(--muted);font-size:11px}
.drop-slot.hover{border-color:var(--accent);color:#7dd3fc;background:rgba(56,189,248,0.08)}
.orch-rail{flex:0 0 54px;display:flex;flex-direction:column;align-items:center}
.orch-rail .node{width:28px;height:28px;border-radius:50%;background:var(--bg-2,#0b1120);border:2px solid var(--accent);
  display:flex;align-items:center;justify-content:center;font:13px/1 var(--mono);font-weight:700}
.orch-tray,.orch-palette{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:8px 0}
.tray-head{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.phase-chip{display:inline-flex;align-items:center;gap:7px;padding:5px 10px;border-radius:8px;background:var(--well);
  border:1px solid var(--border);border-left:3px solid var(--accent);cursor:grab;font:11.5px/1 var(--mono);font-weight:700}
.emits-chip{font:9px/1.3 var(--mono);color:var(--accent);background:rgba(56,189,248,0.08);
  border:1px solid rgba(56,189,248,0.22);border-radius:4px;padding:2px 6px}
```

- [ ] **Step 2: Implement `renderProgram` + helpers**

Replace `orchestration.js`'s `renderProgram` with a full translation of the proto's `orchestratedBody`/`gateContainer`/`condPretty`/`renderList`/`paletteEl` into vanilla DOM using the classes above and `makeCard` for `ref` vignettes. Key structure (write the full bodies during execution; this is the skeleton the implementer fills, following the proto behavior exactly):

```javascript
import { makeCard } from "./render-helpers.js";
import { iterBlocks, findBlock, isLoopBlock, blockConstruct, condOf, signalsOf } from "./editlogic.js";

let CTX = null;   // set each render so drag/drop handlers can reach state + callbacks

export function renderProgram(ctx) {
  CTX = ctx; const { state } = ctx;
  const grid = document.querySelector("#grid"); grid.replaceChildren();
  grid.appendChild(renderPalette(ctx));            // "drag into a gate" strip
  const rows = document.createElement("div"); rows.className = "orch-rows";
  (state.model.orchestration || []).forEach((b, i) => rows.appendChild(topRow(b, i)));
  grid.appendChild(rows);
  grid.appendChild(renderTray(ctx));               // unused-actions library
}
// topRow(b,i): .orch-row = rail(node i+1) + (ref? vignette : gateEl(b,0))
// gateEl(b, depth): container per the CSS; header via condEl/keyword/cap chip; body lanes/body + dropSlot
// condEl(cond): .cond-pill with sky/amber/violet operands
// listEl(arr, depth): ref -> draggable makeCard vignette (click -> ctx.selectPhase(b.ref)); gate -> gateEl
// dropSlot(containerId, slot): dashed target; dragover/drop -> ctx.onDrop(containerId, slot, e) (Task 8)
// vignette click on a gate's ✎ or the gate body -> ctx.onSelectGate(b._id) (Task 10)
export function renderPalette(ctx) { /* phase chips, draggable, dataTransfer text/phase = id */ }
export function renderTray(ctx) { /* phases not referenced by any ref block, as draggable chips */ }
```

Provide `ctx` from `editor.js`'s `renderGrid` call: `{ state, refreshView, selectPhase, resolveGroupColors, onDrop: orchDrop, onSelectGate: selectGate }` — add `onDrop`/`onSelectGate` as no-ops for now (real in Tasks 8 & 10):

```javascript
  if (state.showOrch) { orch.renderProgram({ state, refreshView, selectPhase, resolveGroupColors,
      onDrop: () => {}, onSelectGate: () => {} }); renderLegend(resolveGroupColors(state.model)); schedulePaint(); return; }
```

- [ ] **Step 3: MCP browser verification**

Reload the editor on the `orchestrated` fixture with the toggle ON. Observe:
1. Top-level blocks numbered on the rail (RECON ref, then the `for_each` gate).
2. The `for_each` gate: dashed violet border, ↻ icon, `◈ recon.endpoints as ep`, amber `cap 100` chip; its body shows the SCAN vignette and the nested `if` gate (solid violet, ◆) with a green `then` lane containing EXPLOIT.
3. `{ref}` cards are the same `makeCard` vignettes as the classic grid.
4. The "Library" tray lists any unreferenced phase; the palette strip shows all phases as draggable chips.
Screenshot it.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js src/workflow/templates/webedit/editor.css
git commit -m "feat(orchestration): render the program — gates, ref vignettes, tray"
```

---

### Task 8: `emits` chips + action→block dependency overlay

**Files:**
- Modify: `src/workflow/templates/webedit/render-helpers.js` (`makeCard` — append emits chips)
- Modify: `src/workflow/templates/webedit/editor.js` (`paintDepLinks` — action→block variant when `showOrch`)

**Interfaces:**
- Consumes: `state.showOrch`, the program DOM (gate elements carry `data-block-id`; ref vignettes carry `data-id`).
- Produces: `emits ◈ name · type` chips on every card that has `phase.emits`; dependency arrows in the ON view route action→gate when the dependency crosses a block boundary.

- [ ] **Step 1: emits chips in `makeCard`**

In `render-helpers.js`, inside `makeCard`, in the chips section (after the `out` chips loop, before `if (chips.children.length)`):

```javascript
  for (const e of phase.emits || []) addChip("emits", "emits ◈ " + e.name + " · " + e.type);
```

Add the CSS (already added `.emits-chip` in Task 7; align class): use `addChip("emits", ...)` → the chip class becomes `chip emits`; add to `editor.css`:

```css
.chip.emits{color:var(--accent);background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.22)}
```

- [ ] **Step 2: action→block overlay**

In `paintDepLinks` (editor.js line 202), when `state.showOrch`, resolve each phase's rendered position to its **enclosing top-level gate** element if the endpoints are in different blocks; draw the arrow to the gate. Add, after computing `rects`:

```javascript
  if (state.showOrch) {
    // map phase id -> the DOM element to point at: its ref vignette if same block, else the enclosing top-level gate
    const topEl = {}; document.querySelectorAll("#grid [data-block-top]").forEach(el => topEl[el.dataset.blockTop] = el);
    // build phase -> top block id from the model
    const topOf = {}; (state.model.orchestration || []).forEach(tb => iterBlocks([tb], b => { if (blockConstruct(b) === "ref" && !(b.ref in topOf)) topOf[b.ref] = tb._id; }));
    // ...for each dep (from,to): if topOf[from] !== topOf[to], target rect = topEl[topOf[to]] bounding box
  }
```

(Requires: `gateEl`/top rows tag their outermost element with `data-block-top="<block _id>"` — add that in Task 7's `topRow`. Import `iterBlocks, blockConstruct` in editor.js.) Keep the existing same-block action→action routing untouched.

- [ ] **Step 3: MCP browser verification**

With `⤳ Dependencies` AND `◆ Orchestration` both ON on a workflow where a `depends_on` crosses gates: confirm the arrow points at the **gate**, not into it; with both refs in one block, the arrow is action→action as before. Toggle Dependencies OFF → no arrows. Confirm emits chips show on RECON/SCAN cards. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/render-helpers.js src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.css
git commit -m "feat(orchestration): emits chips + action->block dependency overlay"
```

**Phase 2 gate:** toggle OFF is byte-identical to today (re-verify the §1 list via MCP); toggle ON renders the fixture program faithfully. No save path touched yet beyond Phase 1.

---

## PHASE 3 — Front-end edit-path

### Task 9: `＋ Gate` creation (condition / loop)

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (`addGate`, gate menu)
- Modify: `src/workflow/templates/webedit/editor.js` (wire `#add-gate`)

**Interfaces:**
- Produces: `orch.addGate(ctx, kind)` where `kind ∈ {"if","loop"}`; pushes a new block onto `model.orchestration` with a fresh `_id`, sets `state.selectedGate`, re-renders. New `if` = `{_id, if:{op:"==",left:"",right:""}, then:[], else:[]}`; new loop = `{_id, while:{op:"==",left:"",right:""}, cap:null, body:[]}`.

- [ ] **Step 1: Implement the gate menu + `addGate`**

In `orchestration.js`:

```javascript
let _seq = 1000;
const newId = () => "b" + (++_seq);
export function addGate(ctx, kind) {
  const m = ctx.state.model; m.orchestration = m.orchestration || [];
  const b = kind === "loop"
    ? { _id: newId(), while: { op: "==", left: "", right: "" }, cap: null, body: [] }
    : { _id: newId(), if: { op: "==", left: "", right: "" }, then: [], else: [] };
  m.orchestration.push(b); ctx.state.selectedGate = b._id; ctx.state.selected = null;
  ctx.rerender();
}
```

Add a small popover menu (Condition / Loop) opened by `#add-gate` — reuse the `.gate` styling; or, simplest for v1, two menu items via a native flow: clicking `＋ Gate` shows a 2-item menu (`buildGateMenu`) positioned under the button.

- [ ] **Step 2: Wire it in `editor.js`**

`ctx` passed to `renderProgram` must include `rerender: () => { renderGrid(); applyDrawerLayout(); }`. Boot wiring:

```javascript
  $("#add-gate").addEventListener("click", (e) => orch.openGateMenu({ state, rerender: () => { renderGrid(); applyDrawerLayout(); } }, e.currentTarget));
```

- [ ] **Step 3: MCP browser verification**

Toggle ON, click `＋ Gate` → Condition: a new empty `if` gate appears, selected (accent ring), with an empty condition and empty lanes. `＋ Gate` → Loop: a dashed loop gate with `cap required` (red) chip. Screenshot both.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js src/workflow/templates/webedit/editor.js
git commit -m "feat(orchestration): + Gate creates condition/loop blocks"
```

---

### Task 10: Gate edit panel in the drawer (construct, condition builder, cap, for_each)

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (`gatePanel`, `operandCtrl`, `setConstruct`, cap/list/as setters)
- Modify: `src/workflow/templates/webedit/editor.js` (`selectGate`, panel routing in the drawer)
- Modify: `src/workflow/templates/webedit/editor.css` (operand tint boxes, segmented reuse)

**Interfaces:**
- Consumes: existing drawer `#edit-panel`, `formfields.js` builders, `signalsOf`.
- Produces: `orch.gatePanel(ctx, block) -> HTMLElement` rendered into `#edit-panel` when `state.selectedGate` is set. Selecting an **action** still opens the existing phase drawer (`selectPhase`). Editing mutates `block` in-place + `refreshView()`. Behavioral reference: proto `gatePanel`, `operandCtrl`, `signalPicker`, `setConstruct`, `setOp`, `setOperand`, `setCap`, `setList`, `setAs`, `toggleEscape` — translate to the **engine block shape** (key = construct name, condition under that key).

- [ ] **Step 1: `selectGate` + drawer routing in `editor.js`**

```javascript
function selectGate(id) {
  state.selectedGate = id; state.selected = null;
  const f = findBlock(state.model.orchestration || [], id); if (!f) return;
  const panel = $("#edit-panel"); panel.hidden = false; panel.replaceChildren();
  panel.style.width = state.panelWidth + "px"; ensureResizeGrip(panel);
  panel.appendChild(orch.gatePanel({ state, refreshView, rerender: () => { renderGrid(); }, close: closeGate }, f.block));
  applyDrawerLayout(); renderGrid();
}
function closeGate() { state.selectedGate = null; $("#edit-panel").hidden = true; applyDrawerLayout(); renderGrid(); }
```

Wire `onSelectGate: selectGate` in the `renderProgram` ctx (replace the Task 7 no-op). `applyDrawerLayout` (line 325) must treat a selected gate as "open": change its `open` computation to `const open = (!!state.selected || !!state.selectedGate) && state.tab === "grid";`.

- [ ] **Step 2: `gatePanel` + `operandCtrl`**

Translate the proto `gatePanel`/`operandCtrl` into vanilla DOM: header (icon + "Condition/Loop block" + ✕→`close`); **Construct** segmented (`if`/`while`/`until`/`for each`) → `setConstruct(block, kind)` reshaping keys per the engine shape; for `for_each` a list-signal `<select>` (only `type==="list"` signals) + `as` input; for `if`/`while`/`until` the condition builder = `operandCtrl(left)` + op `<select>` (`OPS = ["==","!=","<",">","<=",">=","contains","matches","exists"]`) + `operandCtrl(right)` (hidden when op `exists`), plus an escape-hatch toggle (sets the condition value to a string; label "standard-only"); loops get the **required cap** number field with live red validation. Footer: "Delete gate" (`removeBlock`) + "Done" (`close`).

`operandCtrl(side)`: kind segmented (`◈ signal`/`literal`/`builtin`; right side has no `builtin`); signal kind → a picker button opening `signalPicker` (Task 11); literal → amber text input; builtin → violet text input. Colour the wrapper via tint classes:

```css
.op-box{border-radius:9px;padding:9px;border:1px solid var(--border)}
.op-box.signal{border-color:rgba(56,189,248,0.4);background:rgba(56,189,248,0.06)}
.op-box.literal{border-color:rgba(251,191,36,0.4);background:rgba(251,191,36,0.06)}
.op-box.builtin{border-color:rgba(167,139,250,0.4);background:rgba(167,139,250,0.06)}
```

> Condition data model on disk: `{op, left, right}` where `left`/`right` are **strings** — a signal operand is the signal key string (e.g. `"recon.endpoints"`), a literal is its text, a builtin is e.g. `"file_exists: path"`. The editor needs to know an operand's *kind* to render the right control; derive it heuristically (contains `.` and matches a known signal key ⇒ signal; starts with `file_exists`/`dir_exists` ⇒ builtin; else literal) OR store kind in a transient `_leftKind`/`_rightKind` on the block (stripped on save like `_id`). **Use the transient-kind approach** for reliable UI, stripping `_leftKind`/`_rightKind` in `modelForSave`'s block strip (extend the strip list). Confirm against `orchestration.schema.json` that `left`/`right` are plain scalars.

- [ ] **Step 3: MCP browser verification**

Select the fixture's `if` gate → panel shows Construct=if, condition `◈ scan.status == vuln` with sky signal box + amber literal box; switch op to `exists` → right operand hides. Select the `for_each` gate → list-signal select shows `recon.endpoints`, `as=ep`, cap=100. Edit cap to 50 → gate chip updates live. Switch a gate's construct if→while → shape changes to a single body + cap field. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.css
git commit -m "feat(orchestration): gate edit panel — construct, condition builder, cap"
```

---

### Task 11: Signal picker + "Declare a new signal" (emits write-back)

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (`signalPicker`, `declareForm`)
- Modify: `src/workflow/templates/webedit/editor.js` (persist emits via the model → save path)

**Interfaces:**
- Consumes: `signalsOf(model)`, the model's phases.
- Produces: `signalPicker(ctx, side)` grouped by phase; `＋ Declare a new signal` form (phase / name / type / source / from) that pushes an `emits` entry onto `model.phases[i]` and selects it. Name must match `^[a-z][a-z0-9_]*$`. Persistence is automatic: `emits` rides in `<name>.yaml` via the Phase-1 save path. Signal key = `<phase>.<name>` lowercased.

- [ ] **Step 1: Implement picker + declare form**

Translate proto `signalPicker`/`declareForm`/`openDeclare`/`submitDeclare`. On submit:

```javascript
function submitDeclare(ctx, side, form) {
  if (!/^[a-z][a-z0-9_]*$/.test(form.name)) { ctx.setStatus("signal name must match ^[a-z][a-z0-9_]*$"); return; }
  const ph = ctx.state.model.phases.find(p => p.id === form.phaseId);
  ph.emits = ph.emits || [];
  ph.emits.push({ name: form.name, type: form.type, source: form.source, ...(form.source === "field" ? { from: form.from || "output.json" } : {}) });
  const key = form.phaseId.toLowerCase() + "." + form.name;
  setOperand(ctx.block, side, key);       // wire it straight into the condition
  ctx.refreshView().then(ctx.reselectGate);
}
```

- [ ] **Step 2: MCP browser verification**

On a gate condition, open the left operand signal picker → signals grouped by phase (RECON: endpoints; SCAN: status). Click `＋ Declare a new signal` → declare `verdict` (type enum, source token) on EXPLOIT → the operand becomes `◈ exploit.verdict`, and the EXPLOIT card gains an `emits ◈ verdict · enum` chip. Save, reload → the emit persisted in `src/workflows/<wf>.yaml`. Screenshot + confirm the YAML.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js src/workflow/templates/webedit/editor.js
git commit -m "feat(orchestration): signal picker + declare-signal (emits write-back)"
```

---

### Task 12: Drag = MOVE (fix the proto copy bug) + palette/tray reference

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (`orchDrop`, drag sources)
- Modify: `src/workflow/templates/webedit/editor.js` (`onDrop` ctx callback)

**Interfaces:**
- Produces: two explicit gestures (guide §3.1):
  - **palette/tray → gate slot** = *reference* → push `{_id, ref: <phaseId>}` into the target `containerArray`.
  - **existing ref vignette → another slot** = *move* → remove the source `{ref}` block by `_id`, insert into target. No duplicate.
  Drag payload distinguishes them: palette chips set `dataTransfer["text/phase"]=id`; ref vignettes set `dataTransfer["text/refid"]=block._id`.

- [ ] **Step 1: Implement `orchDrop`**

```javascript
export function orchDrop(ctx, containerId, slot, ev) {
  ev.preventDefault();
  const refId = ev.dataTransfer.getData("text/refid");
  const phase = ev.dataTransfer.getData("text/phase");
  const bs = ctx.state.model.orchestration;
  const target = containerArray(bs, containerId, slot); if (!target) return;
  if (refId) {                                   // MOVE existing ref
    const f = findBlock(bs, refId); if (!f) return;
    const [moved] = f.parent.splice(f.index, 1); target.push(moved);
  } else if (phase) {                            // REFERENCE from palette/tray
    target.push({ _id: newId(), ref: phase });
  }
  ctx.refreshView().then(() => ctx.rerender());
}
```

Set drag payloads: ref vignette `dragstart` → `e.dataTransfer.setData("text/refid", b._id)`; palette/tray chip → `setData("text/phase", id)`. Drop slots call `ctx.onDrop(containerId, slot, e)`.

- [ ] **Step 2: MCP browser verification**

Drag SCAN from the palette into the `if` gate's `else` lane → a SCAN ref appears in `else` (original palette chip stays — palette is a source, not a slot). Drag that new `else` SCAN ref into the loop `body` → it **moves** (disappears from `else`), no duplicate. Confirm the model has exactly one SCAN ref in `body`. Screenshot before/after.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js src/workflow/templates/webedit/editor.js
git commit -m "fix(orchestration): drag existing ref = move (not copy); palette = reference"
```

---

### Task 13: Live validation — inline markers, issues popover, warning toast

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (inline gate markers from `orchestrationIssues`)
- Modify: `src/workflow/templates/webedit/editor.js` (merge into `#issues-badge`; toast on new warning)
- Modify: `src/workflow/templates/webedit/editor.css` (already has toast; add popover if needed)

**Interfaces:**
- Consumes: `orchestrationIssues(model)` (client mirror) + `state.view.orchestration_warnings` (server authority).
- Produces: inline `cap required` / `condition incomplete` markers on gates; the `#issues-badge` amber counter includes orchestration warnings; a spontaneous top-right `#orch-toast` when the warning count increases; clicking badge/toast opens a popover listing issues, each jumping to its gate (`selectGate`).

- [ ] **Step 1: Merge orchestration warnings into `renderIssues`**

In `editor.js` `renderIssues` (line 95), after computing `validateModel` warnings, add orchestration warnings (prefer the server list `state.view.orchestration_warnings`, fall back to the client `orchestrationIssues` for instant feedback between views):

```javascript
  const ov = (state.view && state.view.orchestration_warnings) || [];
  const extraWarn = ov.length ? ov : orchestrationIssues(state.model).map(i => i.msg);
  const warnCount = v.warnings.length + extraWarn.length;
  // ...render the amber ⚠ span with warnCount; title includes extraWarn joined
```

- [ ] **Step 2: Toast on a newly-appearing warning**

Track `let _lastOrchWarn = 0;` module-scope. In `refreshView` after render, compute the current orchestration-warning count; if it increased, show `#orch-toast` with the count + auto-hide after 4.5s; clicking it opens the issues popover. Wire `#orch-toast` click → the same handler as `#issues-badge`.

- [ ] **Step 3: Inline gate markers**

In `orchestration.js` `gateEl`, for a loop without valid cap render the `cap-chip bad` "cap required"; for an incomplete condition add a small amber `⚠ condition incomplete` marker in the header (from `orchestrationIssues` filtered to this block `_id`).

- [ ] **Step 4: MCP browser verification**

Create a loop gate (cap empty) → the amber `⚠` badge count rises, a top-right toast appears ("1 orchestration warning"), the gate shows a red `cap required` chip. Click the toast → popover lists the issue → clicking it selects/scrolls the gate. Set a valid cap → the badge/toast/marker clear. Confirm **Save still succeeds** with the capless loop present (warning-only). Screenshot the toast + popover.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.css
git commit -m "feat(orchestration): warning-only live validation — markers, popover, toast"
```

---

### Task 14: Action selection inside a gate opens the FULL phase drawer + breadcrumb; save warnings surfaced

**Files:**
- Modify: `src/workflow/templates/webedit/editor.js` (`selectPhase` breadcrumb; `save` surfaces warnings)
- Modify: `src/workflow/templates/webedit/orchestration.js` (ref click → `ctx.selectPhase(phaseId)`)

**Interfaces:**
- Produces: clicking a `{ref}` vignette (even nested) opens the **existing** phase drawer (Wiring/Autonomy/Invocations/Triggers) via `selectPhase` — no forked editor (guide §3.2); an optional breadcrumb ("in for_each › body") at the drawer head. `save()` shows returned `warnings` prominently (badge already covers it; also append to status without blocking).

- [ ] **Step 1: ref click → full drawer**

In `orchestration.js` `listEl`, the ref vignette `click` handler calls `CTX.selectPhase(b.ref)` (not a gate-select). `selectPhase` already renders the full drawer. Add a breadcrumb: pass the enclosing gate context; in `selectPhase`, if `state.showOrch`, prepend a `.drawer-crumb` line naming the path (compute via `findBlock` parent chain). Keep `state.selectedGate = null` when an action is selected.

- [ ] **Step 2: save surfaces warnings (not blocking)**

In `save()` (line 751):

```javascript
  const { status, j } = await api("PUT", "/api/workflow/" + state.name, { model: modelForSave() });
  const warn = (j.warnings || []).length ? " · ⚠ " + j.warnings.length + " orchestration warning(s)" : "";
  setStatus(status === 200 ? "✓ saved · " + new Date().toLocaleTimeString() + warn
                           : "✗ " + ((j.errors || []).join("; ") || "error"));
  if (status === 200) loadWorkflow(state.name);
```

- [ ] **Step 3: MCP browser verification**

Click EXPLOIT inside the `if`/`then` lane → the full phase drawer opens (all four tabs present), with a breadcrumb "in if › then". Edit its description → persists. Save a workflow with a capless loop → status shows "✓ saved … · ⚠ 1 orchestration warning" AND the file is written. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/orchestration.js
git commit -m "feat(orchestration): nested action opens full drawer + breadcrumb; save warnings surfaced"
```

---

### Task 15: Target selector, ⓘ tracker, and final regression sweep

**Files:**
- Modify: `src/workflow/templates/webedit/editor.js` (target pill; ⓘ list)
- Modify: `src/workflow/templates/webedit/editor.html` (ⓘ button)

**Interfaces:**
- Produces: the `standard | dynamic` selector (dynamic disabled/"soon"); an ⓘ popover listing what is NOT yet implemented (guide §2.10 — JS target, gate drag-reorder/re-nest, etc.) so the maintainer's manual pass knows the boundary.

- [ ] **Step 1: Target pill (dynamic disabled)**

Wire `#target-pill` to a 2-item menu; `dynamic` is disabled with a "soon" note. State: `state.target = "standard"` (no functional effect yet — reserved for the JS frontier).

- [ ] **Step 2: ⓘ demo/tracker popover**

Add an `ⓘ` button near the toolbar with a popover listing (verbatim-ish from guide §6 / proto `NOT_DONE`, trimmed to what's actually deferred): JS/dynamic target + capability greying; gate drag-reorder/re-nest; parallel construct (intentionally omitted — confirm). Keep it accurate to the shipped state.

- [ ] **Step 3: Full regression sweep (MCP)**

Systematically re-verify the guide §1 do-not-regress list with the toggle OFF and ON:
- Workflow selector + subtitle; tab bar Grid/Dataflow/Settings/YAML; Dataflow wiring; explicit levels; drag-to-reassign + new-level zones + same-level; dependency overlay (adjacent/same/skip); full phase card + drawer (all four tabs); groups legend (rename/risk/desc/palette); issues badge; resizable drawer.
- Confirm: no `.orchestration.yaml` for a plain workflow after Save; a workflow with orchestration round-trips.
Screenshot the OFF view beside the classic editor for parity.

- [ ] **Step 4: Backend + check green**

Run: `pytest src/scripts/tests/ -q && awok check`
Expected: all green.

- [ ] **Step 5: Deploy for the maintainer's manual pass**

Run: `./install.sh`
Then hand off: the maintainer runs their own click-test session.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.html
git commit -m "feat(orchestration): target selector + not-implemented tracker; regression sweep"
```

---

## Self-Review notes (coverage map)

- Guide §1 (do-not-regress): Tasks 6/7 keep the classic grid untouched behind `showOrch`; Task 15 §3 sweeps the whole list. ✔
- Guide §2.1 toggle: Task 6. §2.2 target selector: Task 15. §2.3 gates: Task 7. §2.4 ＋Gate: Task 9. §2.5 palette/drop-zones: Tasks 7 & 12. §2.6 gate panel/condition builder/cap: Task 10. §2.7 expose-signal: Task 11. §2.8 live validation/popover/toast: Task 13. §2.9 dependency rule: Task 8 (+ client flag in Task 5). §2.10 ⓘ tracker: Task 15. ✔
- Guide §3 fixes: §3.1 move-not-copy: Task 12. §3.2 no forked editor: Task 14. §3.3 delete from drawer: existing drawer (Task 14 keeps it). §3.5 real levels: Task 6 preserves derived levels (OFF view). §3.6 dep routing reuse: Task 8. §3.7 real groups/palette: uses `resolveGroupColors` (Task 7). §3.8 real save/＋Action: Phase 1 + existing. ✔
- Guide §4 decisions: §4.1 program-as-layout: Task 7. §4.2 backward-compat: Phase 1 gate + Task 6 default. §4.3 dep rule enforce+express: Tasks 5 (`orchestrationIssues` cross-block) + 8 (overlay) + 12 (move keeps data). §4.4 one drawer: Tasks 10 & 14. ✔
- Guide §5 backend: Tasks 1–4. §6 out-of-scope: honored (dynamic disabled, no doctor/create-workflow changes). ✔
- Spec warning-only save: Task 3. Prominent on-brand warning: Task 13. Module split: whole Phase 2–3 in `orchestration.js`. ✔

## Open confirmations (non-blocking, resolve in-flight)
- ~~condition operand shape~~ **RESOLVED** — `orchestration.schema.json` defines `condition` as `{op, left, right}` with `left`/`right` unconstrained (`{}`), i.e. plain scalars, plus a string escape-hatch. Task 10's transient-`_leftKind`/`_rightKind` approach is correct; write scalars on disk, strip the transient kinds on save (same list as `_id`).
- `parallel` construct: it IS in the schema (`block.parallel`), but guide §3.9 says omit it from the UX (awok is parallel-by-default via deps). Task 15 ⓘ notes it as deferred; do NOT remove it from the schema. Confirm with maintainer before exposing an editor for it.
- Target selector placement (header vs toolbar): Task 6/15 put it in the grid toolbar; move to the header band if preferred.
- Target selector placement (header vs toolbar): Task 6/15 put it in the grid toolbar; move to the header band if preferred.
