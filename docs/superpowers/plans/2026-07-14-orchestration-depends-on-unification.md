# Orchestration `depends_on` Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify awok orchestration on a single rule — `depends_on` orders, absence of an edge = parallel — by deleting the `parallel` construct, making a control block a *group* over one flat DAG, enforcing a scope-visibility rule on dependencies, and rendering an event-driven execution protocol into the SKILL.md.

**Architecture:** The block tree (`<name>.orchestration.yaml`) stops being an imperative sequential program and becomes a control-flow overlay (branches/loops only) over the content DAG. Ordering and concurrency come entirely from the content phases' `depends_on`. A block may carry an `id` so a phase can depend on the whole block; a lexical-scope visibility rule (`scope(dep)` must be an ancestor-or-equal prefix of `scope(source)`) forbids reaching into a block while allowing reaching out of one. The generator emits an explicit ready-set execution protocol so the LLM orchestrator parallelizes instead of serializing.

**Tech Stack:** Python 3 stdlib + PyYAML + Jinja2 + jsonschema; pytest. Single engine file `src/scripts/bb-workflow`; schema `src/workflow/orchestration.schema.json`; capabilities `src/workflow/orchestration-capabilities.yaml`.

## Global Constraints

- **Design source:** `docs/superpowers/specs/2026-07-14-orchestration-depends-on-unification-design.md`. Read it before starting.
- **Standard target only.** The `js` target (dynamic workflows) is out of scope; keep `validate_orchestration(target=...)` param intact but add no js behavior.
- **Backward compatibility:** orchestration absent ⇒ no `orchestration` key ⇒ byte-identical output. The rétro-compat golden test must stay green.
- **Never edit a generated `SKILL.md` by hand.** Regeneration + `awok check` green is the acceptance signal.
- **Ripple discipline (CLAUDE.md § "Patching the engine"):** any engine/template change → `awok generate` (all workflows) → commit regenerated artifacts in the same commit → `Regen:` trailer → `./install.sh`. `awok check` gates it.
- **Run tests from the repo root:** `pytest src/scripts/tests/ -v`. The `bbw_module` pytest fixture imports `src/scripts/bb-workflow` as a module (see `src/scripts/tests/conftest.py`).
- **Vocabulary:** the YAML/code still say `phase` for an action block; read "phase" as "action". A control block is a **group**, never an "action" (avoids the D1/D2 collision).

## Design decisions locked for this plan

These close the open questions in §11 of the spec. If the maintainer vetoes any, revise the affected task(s) before executing.

- **DL-1 — Block `id`.** Control blocks (`if`/`while`/`until`/`for_each`) MAY carry an optional string `id`. A phase's `depends_on` may name a block `id` → depends on the block-as-whole (block is "done" when its executed inner actions finish). Block ids must be unique and disjoint from phase ids. A block with no `id` simply cannot be depended upon from outside.
- **DL-2 — Visibility rule.** Define `scope(x)` = the tuple path of block containers enclosing `x` (root = `()`; a phase not referenced in orchestration has scope `()`). A `depends_on` edge from `X` to `D` is legal iff **`scope(D)` is a prefix of `scope(X)`** (equal, or an ancestor scope). This single rule yields: same-scope OK, inner→outer OK, outer→inner FORBIDDEN, outer→sibling-block OK, outer→nested-deeper-block FORBIDDEN.
- **DL-3 — Orchestration encodes only control-flow deviations.** A phase with no branch/loop gating need NOT appear in the orchestration file; its ordering comes from the content DAG. Migration flattens `onboard`'s `parallel` and drops the now-meaningless top-level `ref` enumeration, keeping only the `if` gate.
- **DL-4 — Loop output role.** A loop block MAY declare `output: { role: …, kind: dir|jsonl|… }`, validated exactly like a phase output (namespace resolvable). The body is expected to write it (dir = one file per iteration; jsonl = appended). Not mandatory. No new `collect` construct.
- **DL-5 — Execution-protocol render.** `render_orchestration` emits (a) a fixed "Execution protocol" prose block describing the event-driven ready-set algorithm, then (b) the control-flow program (branches/loops only), reframed away from "in this order".

---

### Task 1: Remove the `parallel` construct (schema + traversal)

**Files:**
- Modify: `src/workflow/orchestration.schema.json:21-44` (block definition)
- Modify: `src/scripts/bb-workflow:735-740` (`_iter_blocks`)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Produces: `parallel` is no longer a valid block key; `_iter_blocks` no longer recurses a `parallel` child list.

- [ ] **Step 1: Write the failing test**

Add to `src/scripts/tests/test_workflow_orchestration.py`:

```python
def test_parallel_block_rejected_by_schema(bbw_module):
    import jsonschema, pytest
    schema = bbw_module.load_orchestration_schema()
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate([{"parallel": [{"ref": "A"}]}], schema)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_parallel_block_rejected_by_schema -v`
Expected: FAIL (schema still accepts `parallel`).

- [ ] **Step 3: Remove `parallel` from the schema**

In `src/workflow/orchestration.schema.json`, delete the `{ "required": ["parallel"] }` line from the block `oneOf` (line ~29) and the `"parallel": { "type": "array", "items": { "$ref": "#/definitions/block" } }` property (line ~42).

- [ ] **Step 4: Remove `parallel` from `_iter_blocks`**

In `src/scripts/bb-workflow`, change the recursion keys tuple:

```python
def _iter_blocks(blocks):
    """Yield every block in the tree, depth-first."""
    for b in blocks or []:
        yield b
        for key in ("then", "else", "body"):
            yield from _iter_blocks(b.get(key))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_parallel_block_rejected_by_schema -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/orchestration.schema.json src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): remove the parallel construct (schema + traversal)"
```

---

### Task 2: Block `id` — schema + uniqueness/disjointness validation (DL-1)

**Files:**
- Modify: `src/workflow/orchestration.schema.json` (add `id` property to block)
- Modify: `src/scripts/bb-workflow` (`validate_orchestration`, new helper `_validate_block_ids`)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `validate_orchestration(workflow, capabilities=None, target="standard") -> list[str]`
- Produces: `validate_orchestration` now also returns errors for a block `id` that duplicates another block id or a phase id.

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "block_id or duplicate_block" -v`
Expected: FAIL (no such validation yet).

- [ ] **Step 3: Add `id` to the schema**

In `src/workflow/orchestration.schema.json`, add to the block `properties`:

```json
        "id": { "type": "string" },
```

- [ ] **Step 4: Implement `_validate_block_ids` and call it**

In `src/scripts/bb-workflow`, add above `validate_orchestration`:

```python
def _validate_block_ids(orchestration, phase_ids):
    """Block ids must be unique and disjoint from phase ids."""
    errors = []
    seen = set()
    for b in _iter_blocks(orchestration):
        bid = b.get("id")
        if not bid:
            continue
        if bid in phase_ids:
            errors.append(f"orchestration: block id '{bid}' collides with a phase id")
        if bid in seen:
            errors.append(f"orchestration: duplicate block id '{bid}'")
        seen.add(bid)
    return errors
```

In `validate_orchestration`, after `known_pids = {...}` and before the `for b in _iter_blocks(...)` loop, insert:

```python
    errors.extend(_validate_block_ids(workflow["orchestration"], known_pids))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "block_id or duplicate_block" -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/orchestration.schema.json src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): optional block id (unique, disjoint from phases)"
```

---

### Task 3: Scope index + dependency-visibility validation (DL-2)

**Files:**
- Modify: `src/scripts/bb-workflow` (new helpers `_scope_index`, `_validate_dependencies`; call from `validate_orchestration`)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `workflow["orchestration"]` (block tree), `workflow["phases"]` (each with optional `depends_on`).
- Produces: `_scope_index(orchestration) -> (ref_scope: dict[str, tuple], block_scope: dict[str, tuple])`. `validate_orchestration` returns a visibility error string containing `"not visible from its scope"` for each illegal edge.

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "depend_on_inner or depend_on_outer or sibling_block or nested_block or cross_branch" -v`
Expected: FAIL (no visibility validation yet).

- [ ] **Step 3: Implement `_scope_index`**

In `src/scripts/bb-workflow`, add above `validate_orchestration`:

```python
def _scope_index(orchestration):
    """Map each referenced phase and each block id to its lexical scope.

    A scope is a tuple path of (block-token, branch-key) pairs from the root.
    ref_scope[phase_id] = scope the phase is referenced in.
    block_scope[block_id] = scope the block itself lives in (NOT its inner scope).
    """
    ref_scope = {}
    block_scope = {}

    def walk(blocks, scope):
        for i, b in enumerate(blocks or []):
            if "ref" in b:
                ref_scope.setdefault(b["ref"], scope)
            bid = b.get("id")
            if bid:
                block_scope[bid] = scope
            token = bid or f"@{i}"
            for key in ("then", "else", "body"):
                if b.get(key):
                    walk(b[key], scope + ((token, key),))

    walk(orchestration, ())
    return ref_scope, block_scope
```

- [ ] **Step 4: Implement `_validate_dependencies` and call it**

Add above `validate_orchestration`:

```python
def _validate_dependencies(workflow):
    """Enforce the scope-visibility rule (DL-2): scope(dep) must be a prefix of
    scope(source). A phase not referenced in orchestration has root scope ()."""
    orch = workflow.get("orchestration")
    if not orch:
        return []
    ref_scope, block_scope = _scope_index(orch)
    phase_ids = {p["id"] for p in workflow.get("phases", [])}
    errors = []

    def scope_of(name):
        if name in ref_scope:
            return ref_scope[name]
        if name in block_scope:
            return block_scope[name]
        if name in phase_ids:
            return ()          # pure-DAG phase: top-level scope
        return None            # unknown target: reported by other validators

    for p in workflow.get("phases", []):
        sx = scope_of(p["id"])
        if sx is None:
            sx = ()
        for dep in p.get("depends_on", []) or []:
            sd = scope_of(dep)
            if sd is None:
                continue
            if sx[:len(sd)] != sd:
                errors.append(
                    f"orchestration: '{p['id']}' depends on '{dep}' which is not "
                    f"visible from its scope — a dependency may only target the same "
                    f"scope, an ancestor scope, or a sibling block, never reach into "
                    f"another block (depend on the whole block instead)")
    return errors
```

In `validate_orchestration`, after the `errors.extend(_validate_block_ids(...))` line, insert:

```python
    errors.extend(_validate_dependencies(workflow))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "depend_on_inner or depend_on_outer or sibling_block or nested_block or cross_branch" -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): scope-visibility rule for depends_on (no reaching into blocks)"
```

---

### Task 4: Reject a phase referenced more than once in orchestration

**Files:**
- Modify: `src/scripts/bb-workflow` (`validate_orchestration`)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Produces: `validate_orchestration` returns an error containing `"referenced more than once"` when a phase id appears in ≥2 `ref` blocks (scope resolution assumes one scope per phase).

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_phase_referenced_twice_is_error -v`
Expected: FAIL.

- [ ] **Step 3: Implement the check**

In `src/scripts/bb-workflow`, inside `validate_orchestration` after the `_validate_dependencies` call, add:

```python
    _ref_seen = set()
    for b in _iter_blocks(workflow["orchestration"]):
        if "ref" in b:
            if b["ref"] in _ref_seen:
                errors.append(f"orchestration: phase '{b['ref']}' is referenced more than once")
            _ref_seen.add(b["ref"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_phase_referenced_twice_is_error -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): a phase may be referenced at most once"
```

---

### Task 5: Cycle detection includes the implicit block-completion edge (DL-2)

**Files:**
- Modify: `src/scripts/bb-workflow` (`_validate_dependencies` — augment with a cycle check over phases + block-ids)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: existing `detect_cycle(graph)` (returns a cycle string or `None`; graph is `{node: set(deps)}`).
- Produces: a `"orchestration: dependency cycle"` error when a phase inside block `B` depends (transitively) on something that depends on block `B`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_block_completion_cycle_detected -v`
Expected: FAIL (note: `A depends on Z` and `Z depends on G` where `A` is *inside* `G`; the plain phase graph has no cycle because `G` is not a phase).

- [ ] **Step 3: Augment `_validate_dependencies` with a block-aware cycle check**

At the end of `_validate_dependencies`, before `return errors`, add:

```python
    # Cycle check over an augmented graph: phases + block ids. A block id depends
    # on every phase referenced inside it (block is "done" only when its inner
    # actions are). Reuse detect_cycle.
    graph = {}
    for p in workflow.get("phases", []):
        graph.setdefault(p["id"], set()).update(p.get("depends_on", []) or [])
    # block-completion edges
    def _inner_refs(blocks):
        out = set()
        for b in blocks or []:
            if "ref" in b:
                out.add(b["ref"])
            for key in ("then", "else", "body"):
                out |= _inner_refs(b.get(key))
        return out
    for b in _iter_blocks(orch):
        bid = b.get("id")
        if bid:
            graph.setdefault(bid, set()).update(
                _inner_refs(b.get("then")) | _inner_refs(b.get("else")) | _inner_refs(b.get("body")))
    # ensure every referenced node exists as a key
    for deps in list(graph.values()):
        for d in deps:
            graph.setdefault(d, set())
    cycle = detect_cycle(graph)
    if cycle:
        errors.append(f"orchestration: dependency cycle through a block — {cycle}")
```

> Note: `orch` is already bound at the top of `_validate_dependencies`. Confirm `detect_cycle` accepts a `{node: set}` graph (it does — see the `for pid in graph` loop). If `detect_cycle` expects a specific shape, adapt the graph construction to match.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_block_completion_cycle_detected -v`
Expected: PASS.

- [ ] **Step 5: Run the whole orchestration suite (no regressions)**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): detect dependency cycles through block-completion edges"
```

---

### Task 6: Loop `output` role — schema + validation (DL-4)

**Files:**
- Modify: `src/workflow/orchestration.schema.json` (add `output` to block)
- Modify: `src/scripts/bb-workflow` (`validate_orchestration` — validate the loop output role's namespace)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: the existing io_ref role→path resolution (namespaces map on the workflow). Find the helper that resolves/validates a role's namespace (search `def ` for `namespace` / `resolve_io` / `role`); reuse it.
- Produces: `validate_orchestration` returns an error when a loop `output.role` uses a namespace not declared in `workflow["namespaces"]`.

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "loop_output" -v`
Expected: FAIL.

- [ ] **Step 3: Add `output` to the schema**

In `src/workflow/orchestration.schema.json`, add to block `properties`:

```json
        "output": {
          "type": "object",
          "required": ["role", "kind"],
          "properties": {
            "role": { "type": "string" },
            "kind": { "type": "string" }
          }
        },
```

- [ ] **Step 4: Validate the output namespace**

In `src/scripts/bb-workflow`, inside `validate_orchestration`'s `for b in _iter_blocks(...)` loop, add a branch (only loops may declare `output`):

```python
        # loop output role: its namespace must be declared
        if "output" in b:
            if not ("while" in b or "until" in b or "for_each" in b):
                errors.append("orchestration: 'output' is only valid on a loop block")
            role = (b["output"] or {}).get("role", "")
            ns = role.split(":", 1)[0] if ":" in role else None
            declared = set(workflow.get("namespaces", {}) or {})
            if ns is None or ns not in declared:
                errors.append(
                    f"orchestration: loop output role '{role}' uses a namespace "
                    f"not declared in 'namespaces'")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "loop_output" -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/orchestration.schema.json src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): optional loop output role (validated namespace)"
```

---

### Task 7: Render the execution protocol + control-flow-only program (DL-5)

**Files:**
- Modify: `src/scripts/bb-workflow` (`render_orchestration:1614-1631`, `_render_blocks:1585-1611`)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `render_orchestration(workflow) -> str` (returns "" when no orchestration).
- Produces: output containing the literal heading `## Execution protocol`, the ready-set rules (including the phrase `in one message` and the batch-freeze rule), and NO occurrence of the old `in this order` framing.

- [ ] **Step 1: Write the failing tests**

```python
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
```

> These use the existing fixture `orchestrated.yaml` (Task 9 migrates it if needed; the fixture has no `parallel` block today, so it loads fine).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "execution_protocol or no_parallel_keyword" -v`
Expected: FAIL.

- [ ] **Step 3: Rewrite `render_orchestration`**

Replace the body of `render_orchestration` (the `out = [...]` preamble and assembly) with:

```python
def render_orchestration(workflow: dict) -> str:
    """Render the control-flow overlay as (a) an event-driven execution protocol
    and (b) the branch/loop program. Ordering & concurrency come from depends_on."""
    if "orchestration" not in workflow:
        return ""
    signals = collect_signals(workflow)
    out = [
        "## Execution protocol", "",
        "Drive the pipeline by data dependency, not by list order. Track each "
        "action as pending / running / done.", "",
        "1. An action is **ready** when every action in its `depends_on` is **done**.",
        "2. Launch **all currently ready actions together, in one message** — that is "
        "where parallelism comes from; there is no explicit parallel construct.",
        "3. When a launched batch returns, mark **every** action in that batch **done** "
        "*before* recomputing readiness. Never react to one completion at a time: if two "
        "finish together you must see both as done, or you will skip an action whose two "
        "dependencies just completed, or stall the run.",
        "4. Then re-examine only the **dependents** of the just-finished actions and launch "
        "any that became ready. Repeat until nothing is left.",
        "5. **Branches / loops** below gate *which* actions enter the ready set:",
        "",
        "### Control flow", "",
    ]
    out += _render_blocks(workflow["orchestration"])
    if signals:
        out += ["", "**Signals** (how to read each condition operand):", ""]
        for key, meta in signals.items():
            how = ("read the ending `SIGNALS` line of its output"
                   if meta["source"] == "token"
                   else f"read field `{key.split('.',1)[1]}` of the action's json output")
            out.append(f"- `{key}` ({meta['type']}, from **{meta['phase']}**) — {how}.")
    return "\n".join(out) + "\n"
```

- [ ] **Step 4: Rewrite `_render_blocks` (drop `parallel`, reframe refs)**

Replace `_render_blocks` with:

```python
def _render_blocks(blocks, depth=0):
    lines = []
    pad = "  " * depth
    for b in blocks or []:
        if "ref" in b:
            lines.append(f"{pad}- Action **{b['ref']}** participates (in its depends_on position).")
        elif "if" in b:
            gid = f" [{b['id']}]" if b.get("id") else ""
            lines.append(f"{pad}- **If**{gid} {_render_condition(b['if'])}:")
            lines += _render_blocks(b.get("then"), depth + 1)
            if b.get("else"):
                lines.append(f"{pad}- **Else**:")
                lines += _render_blocks(b["else"], depth + 1)
        elif "for_each" in b:
            var = b.get("as", "item")
            gid = f" [{b['id']}]" if b.get("id") else ""
            out_note = (f" Aggregated output → `{b['output']['role']}`."
                        if b.get("output") else "")
            lines.append(f"{pad}- **For each**{gid} `{var}` in signal `{b['for_each']}` "
                         f"(cap {b.get('cap')}): run the body once per `{var}`; independent "
                         f"iterations launch together in one message.{out_note}")
            lines += _render_blocks(b.get("body"), depth + 1)
        elif "while" in b or "until" in b:
            kw = "While" if "while" in b else "Until"
            cond = b.get("while") or b.get("until")
            gid = f" [{b['id']}]" if b.get("id") else ""
            out_note = (f" Aggregated output → `{b['output']['role']}`."
                        if b.get("output") else "")
            lines.append(f"{pad}- **{kw}**{gid} {_render_condition(cond)} "
                         f"(max {b.get('cap')} iterations): re-run the body and re-check "
                         f"the condition after each pass.{out_note}")
            lines += _render_blocks(b.get("body"), depth + 1)
    return lines
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "execution_protocol or no_parallel_keyword or fixture" -v`
Expected: PASS (including the existing `test_fixture_validates_and_renders`).

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): render event-driven execution protocol, drop imperative framing"
```

---

### Task 8: Cartography — block becomes a collapsible cluster; expose loop output

**Files:**
- Modify: `src/scripts/bb-workflow` (`build_orchestration_overlay:1642-1660`)
- Test: `src/scripts/tests/test_workflow_orchestration.py` (or the cartography test file if overlay is asserted there)

**Interfaces:**
- Consumes: `build_orchestration_overlay(workflow) -> {"branches": [...], "loops": [...]}`.
- Produces: each loop overlay entry now also carries `id` (or `None`) and `output` (role string or `None`); each branch entry carries `id`. Downstream mermaid rendering can label the cluster and draw the output node. (Rendering the mermaid subgraph itself is left to the existing template consumer; this task only enriches the overlay data so the cluster label + output are available.)

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_overlay_carries_block_id_and_loop_output -v`
Expected: FAIL (overlay has no `id`/`output` keys).

- [ ] **Step 3: Enrich `build_orchestration_overlay`**

Update the two `.append(...)` calls:

```python
        if "if" in b:
            overlay["branches"].append({
                "id": b.get("id"),
                "cond": _render_condition(b["if"]),
                "then_ids": _collect_ref_ids(b.get("then")),
                "else_ids": _collect_ref_ids(b.get("else")),
            })
        if "while" in b or "until" in b or "for_each" in b:
            label = (b.get("for_each") and f"for each {b['for_each']}") or \
                    _render_condition(b.get("while") or b.get("until"))
            overlay["loops"].append({
                "id": b.get("id"),
                "label": label,
                "cap": b.get("cap"),
                "body_ids": _collect_ref_ids(b.get("body")),
                "output": (b.get("output") or {}).get("role"),
            })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_overlay_carries_block_id_and_loop_output -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): overlay carries block id + loop output for cartography"
```

---

### Task 9: Migrate `onboard.orchestration.yaml` + regenerate all artifacts (DL-3)

**Files:**
- Modify: `src/workflows/onboard.orchestration.yaml`
- Regenerate (do not hand-edit): `src/skills/*/SKILL.md`, `docs/architecture-cartography/*`
- Test: full suite + `awok check`

**Interfaces:**
- Consumes: the migrated orchestration must still gate `O2-DEPS` on `o0-inventory.has_manifest`.

- [ ] **Step 1: Rewrite the onboard orchestration to control-flow-only**

Replace `src/workflows/onboard.orchestration.yaml` content (keep the top comment, update it) with:

```yaml
# Orchestration overlay for onboard — one logic gate over the pure DAG.
#
# Ordering and parallelism come entirely from onboard.yaml's depends_on (the
# content DAG). This file encodes only the deviation: the dependency audit
# (O2-DEPS) runs only when the repo declares a dependency manifest, so
# deps-auditor isn't spent on a repo with nothing to audit. O4-ARCHITECTURE
# tolerates a missing work:deps (marked optional in onboard.yaml).
- if: { op: "==", left: o0-inventory.has_manifest, right: true }
  then:
    - ref: O2-DEPS
```

- [ ] **Step 2: Validate + verify the gate is intact**

Run: `awok validate --workflow onboard`
Expected: no errors (and no "not visible" — O2-DEPS is in the if-scope; nothing outside depends on it: O4-ARCHITECTURE's `work:deps` input is `optional` and its `depends_on` must NOT list O2-DEPS after migration — verify in `onboard.yaml`).

> If `onboard.yaml` has `O4-ARCHITECTURE depends_on: [O2-DEPS]`, that is now an outer→inner edge (O4 at root, O2-DEPS inside the if) and will fail the visibility rule. Correct fix: O4 should not hard-depend on the gated O2-DEPS. Remove O2-DEPS from O4's `depends_on` (its `work:deps` input is already `optional`), or, if the ordering is genuinely needed, give the `if` block an `id` and make O4 depend on that block id. Choose removal unless the ordering matters.

- [ ] **Step 3: Regenerate everything**

Run: `awok generate`
Expected: rewrites all SKILL.md + cartography; `onboard` SKILL.md now shows the Execution protocol section.

- [ ] **Step 4: Run the full test suite**

Run: `pytest src/scripts/tests/ -v`
Expected: all PASS. Fix any fixture-based assertions that hard-coded the old "in this order" text.

- [ ] **Step 5: Drift check**

Run: `awok check`
Expected: exit 0 (all committed SKILL.md match the generator).

- [ ] **Step 6: Commit (regenerated artifacts in the same commit)**

```bash
git add src/workflows/onboard.orchestration.yaml src/skills docs/architecture-cartography
git commit -m "$(cat <<'EOF'
feat(orchestration): migrate onboard off parallel; regenerate all artifacts

Regen: all SKILL.md + cartography (execution-protocol render, parallel removed);
       workdir owners run `awok generate && awok deploy`.
EOF
)"
```

---

### Task 10: Web editor — drop `parallel`, add block `id` + loop `output` fields

The orchestration web editor (`awok edit`) was built on this branch. Its add-menu already offers only **Condition** and **Loop** (no way to *create* a `parallel`), but legacy `parallel` handling lingers in the renderer, the edit panel, and the block-walker — and the new model's `id`/`output` are not authorable. Make the editor consistent and testable.

> **No JS test harness exists** — verification is (a) the Python webserver test suite stays green, and (b) manual steps via `awok edit`. This task's steps therefore pair each change with a concrete manual check.

**Files:**
- Modify: `src/workflow/templates/webedit/editlogic.js` (`_SLOTS`, `blockConstruct`)
- Modify: `src/workflow/templates/webedit/orchestration.js` (`renderProgram`/block rendering, `gatePanel`)
- Test: `src/scripts/tests/test_workflow_webserver_orchestration.py` (must stay green; add one persistence assertion)

**Interfaces:**
- Consumes: a gate block `{_id, if|while|until|for_each, …}`; `_id` is the UI-internal handle (stripped on save by `_ORCH_TRANSIENT_KEYS`), `id` (no underscore) is the persisted YAML block id from Task 2.
- Produces: the editor never renders/serializes a `parallel` block; a gate panel can set an optional `id` (all kinds) and, for loops, an optional `output: {role, kind}`.

- [ ] **Step 1: Remove `parallel` from the block-walker (`editlogic.js`)**

Change the two lines (~298, ~300):

```javascript
const _SLOTS = ["then", "else", "body"];
```
```javascript
  for (const k of ["ref", "if", "while", "until", "for_each"]) if (k in b) return k;
```

- [ ] **Step 2: Remove `parallel` rendering branches (`orchestration.js`)**

In the block-rendering code (~170-235), delete every `kind === "parallel"` branch:
- `gate.className = "gate" + (loop ? " loop" : "") + (kind === "parallel" ? " parallel" : "");` → `gate.className = "gate" + (loop ? " loop" : "");`
- Delete the line `if (kind === "parallel") { icon.className = "gate-icon-parallel"; icon.textContent = "⇉"; }`
- Delete the `else if (kind === "parallel") { … body.classList.add("parallel-body"); listEl(b.parallel, …) … dropSlot(b._id, "parallel"); }` branch (≈lines 227-232).

- [ ] **Step 3: Remove the `parallel` panel branch in `gatePanel` (`orchestration.js`)**

In `gatePanel`'s `draw()` (~711-759): delete `const isParallel = kind === "parallel";` (line 716); simplify the icon/title to drop the parallel case:

```javascript
    const icon = document.createElement("span");
    icon.className = loop ? "gate-icon-loop" : "gate-icon-if"; if (loop) icon.textContent = "↻";
    top.appendChild(icon);
    const title = document.createElement("span"); title.style.cssText = "font-weight:700;font-size:13.5px";
    title.textContent = loop ? "Loop block" : "Condition block";
```

Then delete the entire `if (isParallel) { … return; }` block (≈lines 744-759).

- [ ] **Step 4: Add a "Block id" field (all gate kinds)**

In `gatePanel`'s `draw()`, immediately after `body.appendChild(seg);` (the Construct segmented control, ~769), insert:

```javascript
    // Block id — lets a phase depend on this whole block (via depends_on).
    body.appendChild(sub("Block id (optional)"));
    const idInp = document.createElement("input"); idInp.type = "text";
    idInp.value = block.id || ""; idInp.placeholder = "e.g. DEPS_GATE";
    idInp.addEventListener("change", () => {
      const v = idInp.value.trim();
      if (v) block.id = v; else delete block.id;
      applyGateEdit(ctx);
    });
    body.appendChild(idInp);
```

- [ ] **Step 5: Add a loop "Aggregated output" field (loop kinds only)**

Right after the block-id field, insert:

```javascript
    if (loop) {
      body.appendChild(sub("Aggregated output (optional)"));
      const outRow = document.createElement("div"); outRow.className = "row-2";
      const roleCol = document.createElement("div");
      const roleLbl = document.createElement("label"); roleLbl.textContent = "role"; roleCol.appendChild(roleLbl);
      const roleInp = document.createElement("input"); roleInp.type = "text";
      roleInp.value = (block.output && block.output.role) || ""; roleInp.placeholder = "work:results";
      roleCol.appendChild(roleInp);
      const kindCol = document.createElement("div");
      const kindLbl = document.createElement("label"); kindLbl.textContent = "kind"; kindCol.appendChild(kindLbl);
      const kindSel = document.createElement("select");
      ["", "dir", "jsonl", "json", "md"].forEach(k => {
        const o = document.createElement("option"); o.value = k; o.textContent = k || "(none)";
        if (((block.output && block.output.kind) || "") === k) o.selected = true;
        kindSel.appendChild(o);
      });
      kindCol.appendChild(kindSel);
      const saveOut = () => {
        const role = roleInp.value.trim(); const kind = kindSel.value;
        if (role && kind) block.output = { role, kind }; else delete block.output;
        applyGateEdit(ctx);
      };
      roleInp.addEventListener("change", saveOut); kindSel.addEventListener("change", saveOut);
      outRow.appendChild(roleCol); outRow.appendChild(kindCol);
      body.appendChild(outRow);
    }
```

- [ ] **Step 6: Add a persistence assertion (Python webserver test)**

In `src/scripts/tests/test_workflow_webserver_orchestration.py`, add a test that a saved orchestration with a block `id` and a loop `output` round-trips through the save endpoint into the sibling `.orchestration.yaml`. Mirror the existing save-test's setup (find the test that POSTs a model and reads the written sibling file); assert the written block keeps `id` and `output` and that a `parallel` block is rejected/stripped. If the existing test file has no save round-trip helper, assert instead that `load_orchestration_schema` accepts a block with `id`+`output` and rejects one with `parallel` (reuse Task 1/2/6 schema).

- [ ] **Step 7: Run the Python suite**

Run: `pytest src/scripts/tests/test_workflow_webserver_orchestration.py src/scripts/tests/test_workflow_orchestration.py -v`
Expected: all PASS.

- [ ] **Step 8: Manual smoke test**

Run: `awok edit --workflow onboard` (or any workflow). In the browser:
1. Open the gate menu → confirm only **Condition** and **Loop** are offered (no Parallel).
2. Add a Condition gate, set its **Block id** to `TESTGATE`, Save. Confirm the `.orchestration.yaml` sibling gains `id: TESTGATE`.
3. Add a Loop gate, set **Aggregated output** role `work:results` kind `dir`, Save. Confirm `output: {role: work:results, kind: dir}` is written.
4. Confirm no console errors and the program view renders.

- [ ] **Step 9: Commit**

```bash
git add src/workflow/templates/webedit/editlogic.js src/workflow/templates/webedit/orchestration.js src/scripts/tests/test_workflow_webserver_orchestration.py
git commit -m "feat(webedit): drop parallel from the block editor, add block id + loop output fields"
```

---

### Task 11: Deploy, docs sync (English + dev), and capabilities/spec alignment

Update the whole documentation surface. **English docs** (`CLAUDE.md`, `README.md`) are first-class — the maintainer explicitly wants the English doc updated, not only the French dev docs.

**Files:**
- Modify (English): `CLAUDE.md` (§ Orchestration — six→five constructs, visibility rule, execution protocol)
- Modify (English): `README.md` (clarify the "parallel phases" wording; add a short "Logic gates" note)
- Modify (French dev): `docs/dev/bb-workflow.md` (§ "Orchestration : portes logiques" — the "6 constructs" table lists `parallel`)
- Modify (French dev): `docs/dev/execution-model.md` (verify the `parallel_with`/`∥` hint text still reads correctly — it is DAG-level, unrelated to the deleted construct; touch only if it now misleads)
- Modify: `src/workflow/orchestration-capabilities.yaml` (comment: concurrency is edge-absence, not a construct)
- Modify: `docs/superpowers/specs/2026-07-13-portes-logiques-orchestration-design.md` (one-line pointer to the 2026-07-14 revision)

**Interfaces:**
- Consumes: nothing new. Doc-only + deploy.

- [ ] **Step 1: Update CLAUDE.md (English) orchestration section**

In `CLAUDE.md` § "Orchestration (portes logiques)": change "**Six constructs**" to "**Five constructs**" and remove `parallel` from the list; add three sentences — (a) concurrency now comes from `depends_on` (no explicit parallel construct); (b) the scope-visibility rule (a dependency may target the same scope, an ancestor scope, or a **sibling** block — never reach into a block; depend on the whole block instead, via its `id`); (c) a loop may declare an `output:` role (dir for `for_each` fan-out, appended jsonl for `while`/`until`) that downstream reads. Reference `docs/superpowers/specs/2026-07-14-orchestration-depends-on-unification-design.md`.

- [ ] **Step 2: Update README.md (English)**

Two edits:
1. Line ~142 ("parallel phases sit side by side"): reword to avoid implying a `parallel` construct — e.g. "phases with no dependency between them sit side by side (they run concurrently)".
2. Under "## How to use it" (after the `completeness-critic` subsection, before "### Edit visually"), add a short subsection:

```markdown
### Branch and loop — logic gates

A workflow's DAG says *what can run once its deps finish*; it can't express a
branch or a loop. Add an optional sibling `src/workflows/<name>.orchestration.yaml`
(absent = pure DAG, unchanged). It carries only the control-flow deviations —
`if/else`, `while`, `until`, `for_each` — over the content DAG. Ordering and
concurrency stay in `depends_on` (there is no `parallel` construct: independent
actions run together by default). A gated action lives in its branch/loop; from
outside you depend on the **whole block** (via its `id`), never on an action
inside it. Loops bound iterations with a mandatory `cap`, and may expose an
aggregated `output` file the next action reads.
```

- [ ] **Step 3: Update docs/dev/bb-workflow.md (French dev)**

In § "Orchestration : portes logiques", change "**Les 6 constructs**" to "**Les 5 constructs**" and delete the `| parallel | Liste de blocs à lancer ensemble |` table row. Add: la concurrence vient de l'absence de `depends_on` (plus de construct `parallel`) ; la **loi de visibilité** des dépendances (même scope / ancêtre / bloc sœur — jamais entrer dans un bloc ; dépendre du bloc entier via son `id`) ; l'`id` de bloc ; l'`output` de boucle ; la section "Execution protocol". Update the fixture example if it showed `parallel` (it does not — it uses `for_each`/`if`). Point to the 2026-07-14 spec.

- [ ] **Step 4: Sanity-check docs/dev/execution-model.md (French dev)**

Read the lines mentioning `parallel_with`/`∥` (≈130-133). These describe DAG-level sibling parallelism (a hint), which is **unchanged** by this work. Edit only if the wording now reads as if a `parallel` orchestration construct exists; otherwise leave as-is and note "no change needed" when committing.

- [ ] **Step 5: Update the capabilities comment**

In `src/workflow/orchestration-capabilities.yaml`, add one line under `operands:` noting concurrency is expressed by the absence of `depends_on`, not a construct. (No structural change — `parallel` was never in this file.)

- [ ] **Step 6: Add a revision pointer to the 2026-07-13 spec**

In `docs/superpowers/specs/2026-07-13-portes-logiques-orchestration-design.md`, at the "Catalogue des constructs" section, add: `> **Révisé 2026-07-14** : \`parallel\` supprimé, modèle unifié sur \`depends_on\`. Voir 2026-07-14-orchestration-depends-on-unification-design.md.`

- [ ] **Step 7: Deploy**

Run: `./install.sh`
Expected: wrappers + skills/agents deployed; restart Claude Code to pick up the regenerated `onboard` skill.

- [ ] **Step 8: Final full verification**

Run: `pytest src/scripts/tests/ -v && awok check && awok validate`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md README.md docs/dev/bb-workflow.md docs/dev/execution-model.md src/workflow/orchestration-capabilities.yaml docs/superpowers/specs
git commit -m "docs(orchestration): document depends_on unification in English + dev docs (5 constructs, visibility rule)"
```

---

## Self-Review

**Spec coverage (design note §2–§10):**
- §2 delete `parallel`, block = group → Tasks 1, 7, 8. ✓
- §3 dependency rules (visibility, sibling-block, cycle) → Tasks 2, 3, 4, 5. ✓
- §4 execution protocol render → Task 7. ✓
- §5 loop body per-iteration (lexical) → rendered in Task 7 (`for_each`/`while` wording); no code beyond render. ✓
- §6 loop aggregated output → Tasks 6, 8. ✓
- §7 engine changes (schema/validate/render/overlay/dataflow) → Tasks 1–8. Dataflow node for loop output beyond the overlay label is **not** separately built — the `output` role is declared and validated (Task 6) and surfaced in the overlay (Task 8); a full dataflow producer/consumer edge for it is deferred (noted below). 
- §8 migration → Task 9. ✓
- §9 backlog impact → web editor consistency (drop `parallel`, add `id`/`output` fields) is **in-plan Task 10**; docs Task 11. ✓
- §10 deferred items respected (no `collect` construct, no js target). ✓

**Known gaps deliberately deferred — tracked in the durable backlog `TODO.md` (not just here):**
- **Web UI grid-wiring**: Task 10 makes the editor consistent and lets an author *type* a block `id` + loop `output`, but wiring a phase's `depends_on` **to a block id** by drawing an edge on the DAG grid is the deeper B2 feature — **still tracked in TODO B2**. Until then, a phase→block dependency is authored in YAML by hand.
- **Loop-output dataflow edge**: `build_dataflow_graph` is not taught that a loop `output` is a producer and a downstream reader is its consumer; the orphan-io warning may fire on that role. **Tracked in TODO B7.** If it fires during Task 9's `awok validate`, mark the downstream input `external: true` as a stopgap (onboard has no loop, so it won't appear there; the fixture `orchestrated` has a `for_each` but no declared `output`, so also safe for now).
- **`onboard.yaml` O4→O2-DEPS edge**: NOT deferred — Task 9 Step 2 handles the one realistic visibility violation the migration can surface.

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" — every code step shows the code. ✓

**Type consistency:** `_scope_index` returns `(ref_scope, block_scope)` used consistently in `_validate_dependencies` (Task 3) and the cycle check reuses `orch`/`_iter_blocks` (Task 5). `build_orchestration_overlay` keys `id`/`output` match the Task 8 test. `render_orchestration`/`_render_blocks` signatures unchanged. ✓
