# Signals declared on the producing action — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare a signal on the action that produces it (a "Signals" section in the action Wiring), let the `emits` `source` be `exit_code` as well as `field`/`token`, auto-generate the emission instruction per action nature into the generated SKILL.md, and make the gate condition a selection-only picker of already-declared signals.

**Architecture:** `emits` stays a list on the phase (source of truth). The engine (`src/scripts/bb-workflow`) gains: an `exit_code` source + optional `by` field in the schema; blocking semantic validation (exit_code⇒script+bool, list⇒field, field's role produced by the action, token/exit_code-on-multi-agent⇒`by`); an emitter-resolution helper (from the dataflow producers); and an emission-instruction renderer wired into `generate_skill_md` (into the emitting invocation's snippet for agents, into the phase section for script/main_agent). The web editor (`src/workflow/templates/webedit`) gains a Signals section in the Wiring drawer, a titled invocation-prompt field, and loses the in-condition "declare a new signal" (select-only).

**Tech Stack:** Python 3 stdlib + PyYAML + jsonschema (engine); pytest (`src/scripts/tests/`); Jinja2 templates (`src/workflow/templates/*.jinja`); vanilla ES modules + DOM (`src/workflow/templates/webedit/`), no build step. Front-end verification is via the Chrome DevTools MCP browser (there is no JS unit-test runner).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-14-signals-declaration-on-action-design.md` — the authoritative source; every task implements part of it.
- **Separate branch / worktree, off `main`.** The orchestration + authorable-editor work is now **merged to `main`** (merge `2e20a7e`); implement in an isolated git worktree (via `superpowers:using-git-worktrees`) OFF **`main`**. The Phase-3 line anchors below drifted with the merge — the implementer must locate the REAL anchors (`tabWiring` ≈ editor.js:725, phase inputs ≈ :783, outputs ≈ :786; `renderSignalList` ≈ orchestration.js:579; `signalsOf` ≈ editlogic.js:394). Structure is unchanged; only line numbers moved.
- **English only** for all web-UI strings and documentation.
- **`emits` is the source of truth** — the concrete signal key is `<phase_id lowercased>.<name>`; never move declarations out of the phase's `emits`.
- **Never edit a generated `SKILL.md` by hand.** After any engine/template change: `awok generate` (all), commit the regenerated artifacts, and `awok check` must be green. Add the `Regen:` commit trailer per CLAUDE.md when generated output changes.
- **Warning-only vs blocking:** the new validation rules are **blocking** (schema/coherence). What awok cannot prove (a script actually writes the field / prints the token) is NOT enforced here — it is a deferred workflow-doctor warning (TODO B4).
- **`model: inherit`** and all existing CLAUDE.md conventions still apply.
- **Run tests with the venv:** `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/ -q` (system python lacks PyYAML). Parse-check JS with `node --check <file>`.
- **Source enum today** (`workflow.schema.json`, `definitions.phase.properties.emits.items`): `source ∈ {field, token}`, `type ∈ {number,string,bool,enum,list}`, `name` matches `^[a-z][a-z0-9_]*$`. Action `type ∈ {agent, script, external, main_agent, workflow_call}` (default `agent`).

## Files

**Phase 1 — engine declaration + validation:**
- Modify: `src/workflow/workflow.schema.json` (emits items: `source` enum, add `by`).
- Modify: `src/scripts/bb-workflow` — `validate_coherence` (~973) add a `_validate_signals` call; new helpers `_validate_signals`, `resolve_signal_emitter` near `collect_signals` (~710) and `build_dataflow_graph` (~1919).
- Test: `src/scripts/tests/test_workflow_signals.py` (create).

**Phase 2 — engine generation + migration:**
- Modify: `src/scripts/bb-workflow` — new `render_signal_emission`; wire into `generate_skill_md` (`rendered_invocations` build ~1504-1525, plus a phase-level block for script/main_agent).
- Modify: `src/workflows/onboard.yaml` (drop the hand-written emission prose).
- Regenerate: `src/skills/*/SKILL.md`, `docs/architecture-cartography/*` (via `awok generate`).
- Test: `src/scripts/tests/test_workflow_signals.py`, plus the golden regression already in the suite.

**Phase 3 — web editor** (anchors are post-merge `main`; verify before editing):
- Modify: `src/workflow/templates/webedit/formfields.js` — new `signalsEditor(label, items, phase, onChange)` builder.
- Modify: `src/workflow/templates/webedit/editor.js` — `tabWiring` (~725) mounts the Signals editor after Outputs (~786); `tabInvocations` titles the prompt field.
- Modify: `src/workflow/templates/webedit/editlogic.js` — `signalsOf` (~394) enriched with `phaseName`/`group`/`source` (Task 9).
- Modify: `src/workflow/templates/webedit/orchestration.js` — `renderSignalList` (~579) drops the declare button + identifies the emitter; delete `renderDeclareForm`/`submitDeclare`; keep selection.
- Modify: `src/workflow/templates/webedit/editor.css` — Signals-editor + prompt-title classes.

**How the server serves the JS:** `/editor/<file>.js` is read live from `templates_dir`, so editing `src/workflow/templates/webedit/*` and reloading `awok edit` picks up changes with no build.

---

## PHASE 1 — Engine: declaration model + validation

### Task 1: Schema — `exit_code` source + optional `by`

**Files:**
- Modify: `src/workflow/workflow.schema.json` (emits items, ~line 88-100)
- Test: `src/scripts/tests/test_workflow_signals.py` (create)

**Interfaces:**
- Produces: the emits item schema accepts `source: "exit_code"` and an optional `by: <string>`; `validate_schema(model)` no longer rejects them.

- [ ] **Step 1: Write the failing test**

Create `src/scripts/tests/test_workflow_signals.py`:

```python
"""Signals-on-action: schema, validation, emitter resolution, generation."""

def _wf(phases):
    return {"schema_version": 1, "skill": {"name": "w", "description": "x"},
            "groups": {"g": {"description": "x"}}, "phases": phases}


def test_schema_accepts_exit_code_and_by(bbw_module):
    model = _wf([
        {"id": "SCAN", "name": "s", "group": "g", "type": "script",
         "emits": [{"name": "found", "type": "bool", "source": "exit_code"}]},
        {"id": "A", "name": "a", "group": "g",
         "emits": [{"name": "status", "type": "string", "source": "token", "by": "recon"}],
         "invocations": [{"agent": "recon"}]},
    ])
    assert bbw_module.validate_schema(model) == []


def test_schema_rejects_unknown_source(bbw_module):
    model = _wf([{"id": "SCAN", "name": "s", "group": "g",
                  "emits": [{"name": "x", "type": "bool", "source": "nope"}]}])
    assert any("source" in e or "nope" in e for e in bbw_module.validate_schema(model))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py::test_schema_accepts_exit_code_and_by -v`
Expected: FAIL (schema rejects `exit_code` / `by`).

- [ ] **Step 3: Edit the schema**

In `src/workflow/workflow.schema.json`, in `definitions.phase.properties.emits.items.properties`:
- change `"source": { "enum": ["field", "token"] }` → `"source": { "enum": ["field", "token", "exit_code"] }`
- add after `from`:

```json
              "by": { "type": "string", "description": "For source token/exit_code on a multi-agent block: the agent whose output carries the signal. Omit for single-producer actions and for source=field." }
```

- [ ] **Step 4: Run both tests to verify they pass**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/workflow.schema.json src/scripts/tests/test_workflow_signals.py
git commit -m "feat(signals): schema accepts exit_code source + optional by"
```

---

### Task 2: Emitter resolution helper

**Files:**
- Modify: `src/scripts/bb-workflow` — add `resolve_signal_emitter` near `collect_signals` (~710)
- Test: `src/scripts/tests/test_workflow_signals.py`

**Interfaces:**
- Consumes: `build_dataflow_graph(workflow, mode="all")` (line 1919) → `producer_edges` = set of `(pid, agent, node_id, path)`; `resolve_io_path` for role→path.
- Produces: `resolve_signal_emitter(workflow, phase, emit) -> dict` returning `{"kind": "invocation", "agent": <agent>}` or `{"kind": "phase", "nature": <type>}` or `{"kind": "unresolved", "reason": <str>}`.

- [ ] **Step 1: Write the failing test**

Append:

```python
def test_emitter_field_resolves_to_role_producer(bbw_module):
    model = _wf([
        {"id": "SRC", "name": "s", "group": "g",
         "invocations": [{"agent": "a1", "outputs": [{"role": "work:data", "kind": "json"}]}],
         "emits": [{"name": "n", "type": "number", "source": "field", "from": "work:data.n"}]},
    ])
    model["namespaces"] = {"work": "work/w"}
    ph = model["phases"][0]
    em = bbw_module.resolve_signal_emitter(model, ph, ph["emits"][0])
    assert em["kind"] == "invocation" and em["agent"] == "a1"


def test_emitter_token_single_agent_is_that_agent(bbw_module):
    model = _wf([
        {"id": "P", "name": "p", "group": "g",
         "invocations": [{"agent": "a1"}],
         "emits": [{"name": "s", "type": "string", "source": "token"}]},
    ])
    ph = model["phases"][0]
    em = bbw_module.resolve_signal_emitter(model, ph, ph["emits"][0])
    assert em["kind"] == "invocation" and em["agent"] == "a1"


def test_emitter_script_is_phase_level(bbw_module):
    model = _wf([{"id": "S", "name": "s", "group": "g", "type": "script",
                  "emits": [{"name": "f", "type": "bool", "source": "exit_code"}]}])
    ph = model["phases"][0]
    em = bbw_module.resolve_signal_emitter(model, ph, ph["emits"][0])
    assert em["kind"] == "phase" and em["nature"] == "script"
```

- [ ] **Step 2: Run to verify it fails**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -k emitter -v`
Expected: FAIL — `AttributeError: ... 'resolve_signal_emitter'`.

- [ ] **Step 3: Implement the helper**

Add after `collect_signals` (~line 728):

```python
def _role_path(workflow, io_ref):
    """Concrete path an io_ref (role or path) resolves to (mirrors resolve_io_path)."""
    if io_ref.get("path"):
        return io_ref["path"]
    return resolve_io_path(io_ref, workflow.get("namespaces", {}))


def resolve_signal_emitter(workflow: dict, phase: dict, emit: dict) -> dict:
    """Which producer emits this signal.

    - source=field: the invocation/producer of the `from` role (via dataflow).
    - source=token/exit_code: the action itself — the single invocation, the
      `by`-named invocation, or the phase (script/main_agent).
    Returns {"kind": "invocation", "agent": ...} | {"kind": "phase", "nature": ...}
    | {"kind": "unresolved", "reason": ...}."""
    nature = phase.get("type", "agent")
    invs = phase.get("invocations", []) or []
    src = emit.get("source")

    if src == "field":
        role = (emit.get("from") or "").split(".")[0]
        if not role:
            return {"kind": "unresolved", "reason": "field signal has no from-role"}
        # find the invocation of THIS phase whose outputs produce that role
        for inv in invs:
            for out in inv.get("outputs", []) or []:
                if (out.get("role", "").split(".")[0] == role):
                    return {"kind": "invocation", "agent": inv["agent"]}
        for out in phase.get("outputs", []) or []:
            if out.get("role", "").split(".")[0] == role:
                return {"kind": "phase", "nature": nature}
        return {"kind": "unresolved", "reason": f"role {role!r} not produced by this action"}

    # token / exit_code
    if nature in ("script", "main_agent"):
        return {"kind": "phase", "nature": nature}
    if len(invs) == 1:
        return {"kind": "invocation", "agent": invs[0]["agent"]}
    by = emit.get("by")
    if by and any(i.get("agent") == by for i in invs):
        return {"kind": "invocation", "agent": by}
    return {"kind": "unresolved", "reason": "multi-agent token needs `by`"}
```

- [ ] **Step 4: Run to verify it passes**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -k emitter -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_signals.py
git commit -m "feat(signals): resolve_signal_emitter (field via dataflow, token via action)"
```

---

### Task 3: Blocking semantic validation

**Files:**
- Modify: `src/scripts/bb-workflow` — add `_validate_signals`; call it from `validate_coherence` (~973)
- Test: `src/scripts/tests/test_workflow_signals.py`

**Interfaces:**
- Consumes: `resolve_signal_emitter` (Task 2), `phase.get("type")`.
- Produces: `_validate_signals(workflow) -> list[str]`; `validate_coherence` appends its errors.

- [ ] **Step 1: Write the failing tests**

Append:

```python
def _errs(bbw, phases):
    return bbw.validate_coherence(_wf(phases),
                                  agents_dir=None, workflows_dir=None)


def test_rule_exit_code_requires_script_and_bool(bbw_module):
    e = _errs(bbw_module, [{"id": "A", "name": "a", "group": "g",
        "invocations": [{"agent": "x"}],
        "emits": [{"name": "f", "type": "bool", "source": "exit_code"}]}])
    assert any("exit_code" in m and "script" in m for m in e)
    e2 = _errs(bbw_module, [{"id": "S", "name": "s", "group": "g", "type": "script",
        "emits": [{"name": "f", "type": "string", "source": "exit_code"}]}])
    assert any("exit_code" in m and "bool" in m for m in e2)


def test_rule_list_requires_field(bbw_module):
    e = _errs(bbw_module, [{"id": "P", "name": "p", "group": "g",
        "invocations": [{"agent": "x"}],
        "emits": [{"name": "items", "type": "list", "source": "token"}]}])
    assert any("list" in m and "field" in m for m in e)


def test_rule_field_role_must_be_produced(bbw_module):
    e = _errs(bbw_module, [{"id": "P", "name": "p", "group": "g",
        "invocations": [{"agent": "x"}],
        "emits": [{"name": "n", "type": "number", "source": "field", "from": "work:ghost.n"}]}])
    assert any("ghost" in m or "not produced" in m for m in e)


def test_valid_signals_pass(bbw_module):
    e = _errs(bbw_module, [{"id": "S", "name": "s", "group": "g", "type": "script",
        "emits": [{"name": "f", "type": "bool", "source": "exit_code"}]}])
    assert not any("signal" in m or "exit_code" in m for m in e)
```

- [ ] **Step 2: Run to verify it fails**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -k rule -v`
Expected: FAIL (no signal validation yet).

- [ ] **Step 3: Implement `_validate_signals` and wire it in**

Add near `collect_signals`:

```python
def _validate_signals(workflow: dict) -> list:
    errors = []
    for phase in workflow.get("phases", []):
        nature = phase.get("type", "agent")
        pid = phase["id"]
        for emit in phase.get("emits", []) or []:
            name = emit.get("name", "?")
            src = emit.get("source")
            typ = emit.get("type")
            tag = f"signal {pid}.{name}"
            if src == "exit_code":
                if nature != "script":
                    errors.append(f"{tag}: source 'exit_code' is only valid on a 'script' action")
                if typ != "bool":
                    errors.append(f"{tag}: source 'exit_code' requires type 'bool'")
            if typ == "list" and src != "field":
                errors.append(f"{tag}: type 'list' requires source 'field'")
            em = resolve_signal_emitter(workflow, phase, emit)
            if em["kind"] == "unresolved":
                errors.append(f"{tag}: {em['reason']}")
    return errors
```

Then in `validate_coherence`, before its `return errors`, add:

```python
    errors.extend(_validate_signals(workflow))
```

(Find the final `return errors` of `validate_coherence`; append just before it. `resolve_signal_emitter` for a `field` whose role isn't produced returns `unresolved` → the "not produced" rule is covered by the same append.)

- [ ] **Step 4: Run to verify it passes + full suite**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -v && /home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/ -q`
Expected: PASS (watch for any existing workflow whose signals now fail — none should, but investigate if the suite reddens).

- [ ] **Step 5: `awok check`**

Run: `awok check` — green (no generation change yet).

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_signals.py
git commit -m "feat(signals): blocking validation (exit_code=script+bool, list=field, field role produced)"
```

**Phase 1 gate:** full suite green; `awok check` green. The engine now *validates* signals but does not yet *generate* emission instructions.

---

## PHASE 2 — Engine: generation + migration

### Task 4: Emission-instruction renderer

**Files:**
- Modify: `src/scripts/bb-workflow` — add `render_signal_emission`
- Test: `src/scripts/tests/test_workflow_signals.py`

**Interfaces:**
- Consumes: `resolve_signal_emitter` (Task 2).
- Produces: `render_signal_emission(phase, emit) -> str` — one markdown line describing how the emitter must produce the signal, phrased per nature/source. Empty string if unresolved.

- [ ] **Step 1: Write the failing test**

Append:

```python
def test_render_emission_agent_token(bbw_module):
    ph = {"id": "P", "name": "p", "group": "g", "invocations": [{"agent": "a"}]}
    s = bbw_module.render_signal_emission(ph, {"name": "status", "type": "string", "source": "token"})
    assert "SIGNALS status=" in s


def test_render_emission_agent_field(bbw_module):
    ph = {"id": "P", "name": "p", "group": "g",
          "invocations": [{"agent": "a", "outputs": [{"role": "work:o", "kind": "json"}]}]}
    s = bbw_module.render_signal_emission(ph, {"name": "n", "type": "number", "source": "field", "from": "work:o.n"})
    assert "field" in s and "`n`" in s


def test_render_emission_script_exit_code(bbw_module):
    ph = {"id": "S", "name": "s", "group": "g", "type": "script"}
    s = bbw_module.render_signal_emission(ph, {"name": "found", "type": "bool", "source": "exit_code"})
    assert "exit" in s.lower() and "found" in s
```

- [ ] **Step 2: Run to verify it fails**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -k render_emission -v`
Expected: FAIL — no `render_signal_emission`.

- [ ] **Step 3: Implement the renderer**

```python
def _value_spec(emit):
    t = emit.get("type")
    if t == "bool":
        return "<true|false>"
    if t == "enum":
        return "<one of the allowed values>"
    return f"<{t}>"


def render_signal_emission(phase: dict, emit: dict) -> str:
    """One instruction line telling the emitter how to produce this signal.
    Phrased for the emitter's nature (agent snippet vs orchestrator-facing)."""
    name = emit["name"]
    src = emit.get("source")
    key = f"{phase['id'].lower()}.{name}"
    role = (emit.get("from") or "").split(".")[0] if src == "field" else None
    nature = phase.get("type", "agent")

    if nature in ("agent",):
        if src == "token":
            return f"- **Emit signal `{key}`**: end your output with a compact line `SIGNALS {name}={_value_spec(emit)}`."
        if src == "field":
            return f"- **Emit signal `{key}`**: your `{role}` json output MUST contain a field `{name}` of type `{emit.get('type')}`."
    if nature == "script":
        if src == "exit_code":
            return f"- **Signal `{key}`** = this script's exit code (`0` ⇒ `true`, non-zero ⇒ `false`)."
        if src == "token":
            return f"- **Signal `{key}`** = the `SIGNALS {name}=…` line the script prints on stdout."
        if src == "field":
            return f"- **Signal `{key}`** = the field `{name}` of the script's `{role}` json output."
    if nature == "main_agent":
        if src == "token":
            return f"- **Produce signal `{key}`** as you do this step: state a line `SIGNALS {name}={_value_spec(emit)}`."
        if src == "field":
            return f"- **Produce signal `{key}`**: write a field `{name}` ({emit.get('type')}) into `{role}`."
    return ""
```

- [ ] **Step 4: Run to verify it passes**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -k render_emission -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_signals.py
git commit -m "feat(signals): render_signal_emission (per-nature emission instruction)"
```

---

### Task 5: Wire emission into `generate_skill_md`

**Files:**
- Modify: `src/scripts/bb-workflow` — `generate_skill_md`, the `rendered_invocations` build (~1504-1525) + a phase-level emission block for script/main_agent.
- Test: `src/scripts/tests/test_workflow_signals.py`

**Interfaces:**
- Consumes: `resolve_signal_emitter`, `render_signal_emission`.
- Produces: the generated SKILL.md carries each signal's emission instruction next to its emitter — appended to the emitting invocation's block (agent), or exposed to the template as `phase["signal_emissions"]` (script/main_agent) so the skeleton renders them under the phase.

- [ ] **Step 1: Write the failing test**

Append — a clean unit test of the pure `_attach_signal_emissions` helper (which
routes each signal's emission to its emitter without needing the full Jinja render):

```python
def test_attach_routes_agent_token_to_invocation(bbw_module):
    model = _wf([{"id": "P", "name": "p", "group": "g",
                  "invocations": [{"agent": "a", "description": "do"}],
                  "emits": [{"name": "status", "type": "string", "source": "token"}]}])
    bbw_module._attach_signal_emissions(model)
    ph = model["phases"][0]
    # agent emitter -> line goes under _agent_emissions[agent], not the phase list
    assert ph["signal_emissions"] == []
    assert any("SIGNALS status=" in ln for ln in ph["_agent_emissions"]["a"])


def test_attach_routes_script_to_phase_list(bbw_module):
    model = _wf([{"id": "S", "name": "s", "group": "g", "type": "script",
                  "emits": [{"name": "found", "type": "bool", "source": "exit_code"}]}])
    bbw_module._attach_signal_emissions(model)
    ph = model["phases"][0]
    # phase-level emitter (script) -> line goes to phase["signal_emissions"]
    assert ph["_agent_emissions"] == {}
    assert any("exit" in ln.lower() and "found" in ln for ln in ph["signal_emissions"])
```

> Step 6 additionally greps the regenerated onboard SKILL.md for the SIGNALS
> line — an end-to-end check on top of these unit tests.

- [ ] **Step 2: Run to verify it fails**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -k injects -v`
Expected: FAIL — no `_attach_signal_emissions`.

- [ ] **Step 3: Implement `_attach_signal_emissions` + call it in `generate_skill_md`**

Add a helper that, for each phase, routes each signal's rendered emission to its emitter:

```python
def _attach_signal_emissions(workflow: dict) -> None:
    """For each phase, attach signal-emission instructions to the right emitter:
    agent-emitter -> appended into that invocation's rendered block later;
    phase-emitter (script/main_agent) -> phase['signal_emissions'] (a list of
    markdown lines the skeleton renders under the phase)."""
    for phase in workflow.get("phases", []):
        phase.setdefault("signal_emissions", [])
        phase["_agent_emissions"] = {}   # agent -> [lines]
        for emit in phase.get("emits", []) or []:
            line = render_signal_emission(phase, emit)
            if not line:
                continue
            em = resolve_signal_emitter(workflow, phase, emit)
            if em["kind"] == "invocation":
                phase["_agent_emissions"].setdefault(em["agent"], []).append(line)
            else:  # phase-level (script / main_agent)
                phase["signal_emissions"].append(line)
```

In `generate_skill_md`, call `_attach_signal_emissions(workflow)` BEFORE the `rendered_invocations` loop (before line ~1502). Then, inside the loop, after building `block` for an invocation, append its agent emissions:

```python
            extra = phase.get("_agent_emissions", {}).get(inv["agent"], [])
            if extra:
                block = block.rstrip("\n") + "\n\n" + "\n".join(extra) + "\n"
            rendered_invocations.append(block)
```

Render `phase["signal_emissions"]` in the skeleton: in `src/workflow/templates/skill-skeleton.md.jinja`, right after the phase description block (~line 95), add:

```jinja
{% if phase.signal_emissions %}
**Signals emitted by this action:**
{% for line in phase.signal_emissions %}{{ line }}
{% endfor %}
{% endif %}
```

- [ ] **Step 4: Run to verify it passes**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/test_workflow_signals.py -k injects -v`
Expected: PASS.

- [ ] **Step 5: Regenerate + full suite (expect the golden test to move)**

Run: `awok generate` then `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/ -q`
Expected: PASS. The golden regression (byte-identical legacy SKILL.md) will change ONLY for workflows that declare `emits` (onboard). Update that golden fixture/assertion to the regenerated content if the test pins onboard; leave the 3 signal-free workflows byte-identical.

- [ ] **Step 6: Commit the code + regenerated artifacts**

```bash
git add src/scripts/bb-workflow src/workflow/templates/skill-skeleton.md.jinja src/scripts/tests/ src/skills/ docs/architecture-cartography/
git commit -m "feat(signals): generate emission instruction next to the emitter

Regen: all SKILL.md (signal-emitting phases gain an emission block);
       workdir owners run \`awok generate && awok deploy\`."
```

---

### Task 6: Migrate onboard off hand-written emission prose

**Files:**
- Modify: `src/workflows/onboard.yaml` (O0-INVENTORY description)
- Regenerate: `src/skills/onboard/SKILL.md`, `docs/architecture-cartography/onboard*`

**Interfaces:** none new — this removes the now-duplicated hand-written line and lets Task 5's generation produce it.

- [ ] **Step 1: Edit onboard.yaml**

In O0-INVENTORY's `description`, keep the *what* (decide whether the repo declares a manifest) but delete the hand-written emission clause (the sentence instructing to end output with `SIGNALS has_manifest=…`) — the generated emission block now says it. Ensure the `emits: [{name: has_manifest, type: bool, source: token}]` stays.

- [ ] **Step 2: Regenerate + verify the emission line is present once**

Run: `awok generate && grep -c "SIGNALS has_manifest=" src/skills/onboard/SKILL.md`
Expected: `1` (generated once, no hand-written duplicate).

- [ ] **Step 3: `awok check`**

Run: `awok check`
Expected: green (onboard regenerated; the other 3 unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/workflows/onboard.yaml src/skills/onboard/ docs/architecture-cartography/
git commit -m "refactor(signals): onboard emits has_manifest via generation, drop hand-written prose"
```

**Phase 2 gate:** full suite green; `awok check` green; onboard's SKILL.md shows the emission instruction exactly once.

---

## PHASE 3 — Web editor

Boot once for MCP verification: `awok edit` (default `http://localhost:8000`). No JS unit runner — each task's test is a Chrome DevTools MCP verification with explicit expected observations, plus `node --check`.

### Task 7: Signals editor in the Wiring drawer

**Files:**
- Modify: `src/workflow/templates/webedit/formfields.js` — add `signalsEditor`
- Modify: `src/workflow/templates/webedit/editor.js` — `tabWiring` (~684) mounts it
- Modify: `src/workflow/templates/webedit/editor.css` — signal-row classes

**Interfaces:**
- Consumes: `p.emits` (the phase's signals), `p.type` (nature), `p.outputs`/invocation outputs (for the `field` role dropdown).
- Produces: `signalsEditor(label, items, phase, onChange)` returns an HTMLElement editing `phase.emits`; a row = name · type · source (filtered by nature) · conditional from-role/field or `by`.

- [ ] **Step 1: Implement `signalsEditor` in formfields.js**

Mirror the existing `stringListEditor`/`ioRefEditor` idiom (rows + "＋ add"). Per row:
- `name` text input (`^[a-z][a-z0-9_]*$`, trim);
- `type` select (`number/string/bool/enum/list`);
- `source` select whose options depend on `phase.type`: `agent` → `token,field`; `script` → `exit_code,token,field`; `main_agent` → `token,field`; other → none (render a read-only "signals not supported for this action type");
- when `source==="field"`: a `from` control = a select of the action's output roles (collect from `phase.outputs` + each `phase.invocations[].outputs[].role`) + an optional `.field` text;
- when `source∈{token,exit_code}` and the phase has ≥2 invocations: a `by` select of the invocation agents;
- a "✕ remove" per row; a "＋ add signal" button.
On any change, rebuild `items` and call `onChange(items)`.

Export it. Run `node --check src/workflow/templates/webedit/formfields.js`.

- [ ] **Step 2: Mount it in `tabWiring`**

In `editor.js` `tabWiring` (after the Outputs block, ~line 713), add:

```javascript
  const sigWrap = document.createElement("div"); sigWrap.className = "wire-block";
  sigWrap.appendChild(signalsEditor("signals", p.emits || [], p, next => {
    if (next.length) p.emits = next; else delete p.emits; refreshView();
  }));
  body.appendChild(sigWrap);
```

Add `signalsEditor` to the `formfields.js` import at the top of editor.js. Run `node --check src/workflow/templates/webedit/editor.js`.

- [ ] **Step 3: MCP browser verification**

Boot `awok edit`; open `onboard`; select O0-INVENTORY → Wiring tab. Observe: a **Signals** section shows a row `has_manifest · bool · token`. Change source to `field` → a from-role select appears listing O0-INVENTORY's output role(s). Add a second signal, then remove it. Select a `script` action (e.g. onboard OG-GITSTATS) → its Signals source select offers `exit_code`. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/formfields.js src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.css
git commit -m "feat(signals): Signals editor in the action Wiring drawer"
```

---

### Task 8: Title the invocation-prompt field

**Files:**
- Modify: `src/workflow/templates/webedit/editor.js` — `tabInvocations` (~771), the prompt-editing field
- Modify: `src/workflow/templates/webedit/editor.css` — a `.field-title` class if needed

**Interfaces:** none new — cosmetic label above the existing invocation prompt textarea.

- [ ] **Step 1: Add the titled header**

In `tabInvocations`, immediately above the control that edits the invocation snippet/prompt (the element populated from `GET /api/invocation/<agent>`, ~line 908 area), insert a header element:

```javascript
  const promptTitle = document.createElement("div"); promptTitle.className = "field-title";
  promptTitle.textContent = "Instruction sent to the agent at launch (via Task)";
```

Append it before the prompt control in the DOM. Run `node --check src/workflow/templates/webedit/editor.js`.

- [ ] **Step 2: MCP browser verification**

Open `onboard`; select an agent action → Invocations tab → expand an invocation. Observe the title **"Instruction sent to the agent at launch (via Task)"** directly above the prompt field. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.css
git commit -m "feat(signals): title the invocation prompt field (launch instruction)"
```

---

### Task 9: Gate condition = selection-only + unambiguous emitter identification

**Files:**
- Modify: `src/workflow/templates/webedit/editlogic.js` — `signalsOf` (~394): enrich each signal with the producing phase's human `name` and `group`.
- Modify: `src/workflow/templates/webedit/orchestration.js` — `renderSignalList` (~579): drop the in-condition declare; make the group header identify the emitter (`<name> (<id>)`) and each item show `name · type · source`. Delete `renderDeclareForm` and `submitDeclare`.

**Interfaces:**
- Consumes: `signalsOf(model)` → now `{key, name, type, source, phase, phaseName, group}`.
- Produces: the picker lists declared signals grouped by producing phase, each group headed by the phase's **human name + id** (so two identical action blocks emitting a same-named signal at different places are distinguishable), each item showing `name · type · source`, with **no** "＋ Declare a new signal". Selecting still wires the operand to the fully-qualified `<phase_id>.<name>` key.

> **Why the emitter must be identifiable (spec §3.4):** in the merged unified model a gate's
> evaluation point follows its condition's **signal producer**. Two similar/identical blocks
> (same agent used twice) emit distinct keys (`RECON1.status` ≠ `RECON2.status`) but a bare
> id is easy to mis-pick; showing `<name> (<id>)` + source makes the right emitter obvious,
> because the choice determines *where* the branch/loop is evaluated.

- [ ] **Step 1: Enrich `signalsOf`**

In `editlogic.js` `signalsOf` (~394), carry the phase's human name, group, and the emit source:

```javascript
export function signalsOf(model) {
  const out = [];
  for (const p of (model && model.phases) || [])
    for (const e of p.emits || [])
      out.push({ key: p.id.toLowerCase() + "." + e.name, name: e.name, type: e.type,
                 source: e.source, phase: p.id, phaseName: p.name || p.id, group: p.group || "" });
  return out;
}
```

Run `node --check src/workflow/templates/webedit/editlogic.js`. (Consumers reading only `key`/`name`/`type`/`phase` keep working — the new fields are additive.)

- [ ] **Step 2: Rewrite `renderSignalList` — identify the emitter, drop declare**

In `renderSignalList` (~579): keep the group-by-phase, but head each group with the emitter identity and show the source per item; remove the separator + `declareBtn`:

```javascript
  phaseIds.forEach(phaseId => {
    const s0 = groups[phaseId][0];
    const head = document.createElement("div"); head.className = "sig-pop-group";
    head.textContent = (s0.phaseName && s0.phaseName !== phaseId)
      ? `${s0.phaseName} (${phaseId})` : phaseId;      // emitter: human name + id
    pop.appendChild(head);
    groups[phaseId].forEach(s => {
      const item = document.createElement("button"); item.type = "button"; item.className = "sig-pop-item";
      if (cond && cond[side] === s.key) item.classList.add("active");
      item.textContent = `${s.name} · ${s.type}` + (s.source ? ` · ${s.source}` : "");  // + how it's produced
      item.addEventListener("click", e => {
        e.stopPropagation(); setOperand(block, side, s.key); closeSigPopover(); applyGateEdit(ctx);
      });
      pop.appendChild(item);
    });
  });
  // NO "＋ Declare a new signal" — declaration lives on the producing action's Wiring.
```

Reword the empty-state and delete `renderDeclareForm` / `submitDeclare` (and any helper only they used — grep `EMIT_TYPES`/`EMIT_SOURCES` first; if the Wiring Signals editor from Task 7 reuses them, keep them there):

```javascript
    empty.textContent = "No signals declared. Declare one in the producing action's Wiring → Signals.";
```

Run `node --check src/workflow/templates/webedit/orchestration.js`; grep to confirm no remaining reference to `renderDeclareForm`/`submitDeclare`.

- [ ] **Step 3: MCP browser verification**

Build a repro with **two same-agent blocks emitting a same-named signal**: temporarily add to a workflow two phases using the same agent, each with `emits: [{name: status, type: string, source: token}]` and distinct ids/names (e.g. `RECON1`/"Recon pass A", `RECON2`/"Recon pass B"). Open a gate → condition → signal operand → picker. Observe: **two groups**, headed `Recon pass A (RECON1)` and `Recon pass B (RECON2)`, each item `status · string · token`; **no** "＋ Declare a new signal". Pick one → the operand shows `◈ recon1.status` (fully-qualified, unambiguous). Remove the temp phases after. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/editlogic.js src/workflow/templates/webedit/orchestration.js
git commit -m "feat(signals): condition picks declared signals only; picker identifies the emitter (name+id+source)"
```

---

### Task 10: Final regression sweep + deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Full backend gate**

Run: `/home/marc-antoine/Desktop/awok/.venv/bin/python -m pytest src/scripts/tests/ -q && awok check`
Expected: all green.

- [ ] **Step 2: JS parse gate**

Run: `for f in src/workflow/templates/webedit/*.js; do node --check "$f"; done`
Expected: all parse clean.

- [ ] **Step 3: MCP sweep (both editor states)**

Re-verify with `awok edit`: the Signals section round-trips (add a signal, Save, reload → it persists in `src/workflows/<wf>.yaml` under `emits`); a `field` signal shows its role dropdown; the gate picker is select-only; the invocation prompt is titled. Confirm a signal-free workflow's Wiring shows an empty Signals section and Save writes no `emits`.

- [ ] **Step 4: Deploy for the maintainer's manual pass**

Run: `./install.sh` — then hand off.

- [ ] **Step 5: Commit any final fixups**

```bash
git add -A
git commit -m "chore(signals): final regression sweep + deploy"
```

**Phase 3 gate:** full suite + `awok check` green; all webedit JS parse-clean; the Signals declaration round-trips through Save; the gate condition is select-only.

---

## Self-Review notes (spec coverage map)

- Spec §1 data model (source enum + exit_code + `by`): Task 1 (schema), Task 2 (emitter), Task 3 (validation). ✔
- Spec §2 generation (per-nature emission, never the shared agent file): Tasks 4 & 5. ✔
- Spec §3 UX (Signals in Wiring, invocation title, select-only condition, remove in-condition declare, emitter identification, English): Tasks 7, 8, 9 (§3.4 emitter identification = Task 9: enriched `signalsOf` + `<name> (<id>)` group header + `source` per item + two-same-agent repro). ✔
- Spec §4 validation (exit_code=script+bool, list=field, field role produced, multi-agent `by`): Task 3. ✔
- Spec §5 migration (drop hand-written prose, onboard, awok check green): Task 6. ✔
- Spec §6 deferred (B4 doctor, B8 file, B1 js): out of scope — tracked in TODO, no task. ✔
- Spec §7 out-of-scope (overlay render untouched, workflow_call/external no emit, D1): respected — no task touches the overlay render. ✔
- Spec §8 open points: (1) exact wording lives in `render_signal_emission` (Task 4); (2) bare-`role` meaning resolved as "a field named `<name>`" in Task 4's `field` branch; (3) separate branch — Global Constraints. ✔
