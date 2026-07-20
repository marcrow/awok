# Workflow-level I/O contract (`definition:` block) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an awok workflow a first-class I/O contract — a phase-shaped `definition:` block (typed `params`, io_ref `outputs`, signal `emits`, optional `formatter`) — that `workflow_call` can bind and verify, plus a WebUI "Workflow definition" tab.

**Architecture:** `definition:` is a new top-level key, kept separate from `phases:` (never mutated into it, so the editor round-trip stays clean). The engine *synthesizes* a terminal phase (reserved id `DEFINITION`) from it for dataflow/rendering. Validation, signal-collection and dataflow reuse the existing helpers (`_check_values_form`, `_check_of_form`, `collect_signals`, `build_dataflow_graph`). The prompt-assist knobs compile to prose **in the engine** (`compile_style`), and the WebUI preview is server-rendered so there is one source of truth.

**Tech Stack:** Python stdlib + PyYAML + Jinja2 + jsonschema (`src/scripts/bb-workflow`); JSON Schema (`src/workflow/workflow.schema.json`); Jinja templates (`src/workflow/templates/*.jinja`); ES-module WebUI (`src/workflow/templates/webedit/*.js`); pytest (`src/scripts/tests/`).

**Reference documents (read before starting):**
- Spec: `docs/superpowers/specs/2026-07-17-workflow-io-contract-design.md` — the authority on every rule.
- WebUI mockup (vendored, complete component code to port): `docs/superpowers/specs/2026-07-17-workflow-io-contract-maquette.html` — React/Babel; unescape the bundled `<script>` to read the JSX (progressive `\"`→`"`, `\n`→newline).
- Signal & typed-payload conventions: `docs/superpowers/specs/2026-07-16-typed-signal-payloads-design.md` §6.
- CLAUDE.md § "Patching the engine or a template" (the ripple discipline) and § "effort/tools per-invocation".

## Global Constraints

- **Signal key convention**: `<phase_id_lowercase>.<name>` (e.g. `RECON` → `recon.endpoints`). Boundary emits are keyed `definition.<name>` internally; a caller re-keys to `<workflow_call phase id>.<name>`.
- **`model: inherit`** always in agent frontmatter; model/effort/tools are per-invocation in the YAML. Never pin a model in an agent `.md`.
- **Never edit a generated `SKILL.md` by hand** — regenerate from YAML.
- **Ripple**: any engine/template change re-renders every workflow. After such a change: `awok generate` (all), commit the regenerated `src/skills/*/SKILL.md` + `docs/architecture-cartography/*` in the same commit, add a `Regen:` trailer, and `./install.sh`. `awok check` gates it.
- **`of` shape** (lists): a scalar keyword `string|number|bool|enum` **or** a flat object map `field→spec` (no nesting) — identical everywhere, validated by the existing `_check_of_form`.
- **Reserved id**: `DEFINITION` — no user phase may use it.
- **Test command**: `pytest src/scripts/tests/test_workflow_*.py -v`. Deploy for manual WebUI: `./install.sh` then `awok edit`.

---

## File Structure

**Modified:**
- `src/workflow/workflow.schema.json` — the `definition` block; `produced_by` on its outputs; `args` on a `workflow_call` phase.
- `src/scripts/bb-workflow` — new: `validate_definition`, `_synthesize_definition_phase`, `compile_style`, `_definition_signal_keys`; edits to `validate_coherence`, `build_dataflow_graph`, `build_view_payload`, the skill render context, `cmd_generate`.
- `src/workflow/templates/skill-skeleton.md.jinja` — render the `DEFINITION` closing phase.
- `src/workflow/templates/cartography.mermaid.jinja` — the boundary node.
- `src/workflow/templates/webedit/editor.js` — register the `definition` top-level tab/view; identity fields delegate to the shared model.
- `src/workflow/templates/webedit/editor.css` — tab styles (or keep the mockup's inline styles).

**Created:**
- `src/workflow/templates/webedit/definition.js` — the tab module (ported from the mockup + deltas).
- `src/scripts/tests/test_workflow_definition.py` — all engine tests for this feature.
- `src/scripts/tests/fixtures/workflows/definition_demo.(yaml)` + a caller fixture using `workflow_call` with `args`.

---

## Data model (agreed shapes — all tasks depend on these)

```yaml
definition:
  params:
    - { name: str(^[a-z][a-z0-9_]*$), type: number|string|bool|enum|list,
        values?: [str], of?: <scalar|objmap>, required?: bool, default?: any, description?: str }
  outputs:                      # SINGLE contract list (spec §4a)
    - { role|path, kind, produced_by: promote|formatter, terminal?: bool, optional?: bool }
  emits:
    - { name, type(+values/of), source: promote|create,
        from: <phase.signal (promote) | output-role (create)>, field?: <json field, create only> }
  formatter:                    # optional; presence ⇒ format mode
    enabled: bool
    prompt: str                 # "how", never lists files
    invoke: { type: main_agent|agent, agent?, model?, effort?, tools?[] }
    inputs: [ io_ref ]          # EDITABLE wired inputs (spec §4c / pitfall #6)
    style: { length, tone, format, language, audience?, mustInclude?[], avoid?[], stance?, toneCustom? }
```
A `workflow_call` phase gains: `args: { <target-param-name>: <literal | "signal:<key>"> }`.

---

### Task 1: Schema for the `definition` block + `workflow_call` `args`

**Files:**
- Modify: `src/workflow/workflow.schema.json`
- Test: `src/scripts/tests/test_workflow_definition.py`

**Interfaces:**
- Produces: a `definition` top-level property and a `definition` `$ref` used by `validate_schema`; `args` property on `phase`.

- [ ] **Step 1: Write the failing test**

```python
# src/scripts/tests/test_workflow_definition.py
import importlib.util, pathlib, copy
spec = importlib.util.spec_from_file_location(
    "bbw", pathlib.Path(__file__).resolve().parents[1] / "bb-workflow")
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
```

- [ ] **Step 2: Run test — expect FAIL** (`produced_by`/`definition`/`args` unknown or not enforced)

Run: `pytest src/scripts/tests/test_workflow_definition.py -v`
Expected: FAIL (definition accepted with bad values / args unknown key allowed but name-pattern not enforced).

- [ ] **Step 3: Add the schema.** In `src/workflow/workflow.schema.json`, under top-level `properties` (next to `opportunistic`), add:

```json
"definition": { "$ref": "#/definitions/definition" },
```

Add to the `phase` definition `properties` (next to `workflow`):

```json
"args": { "type": "object", "additionalProperties": { "type": ["string", "number", "boolean"] },
  "description": "For type=workflow_call: bind the target workflow's params. Value is a literal or 'signal:<key>'." },
```

Add these `definitions` entries:

```json
"definition": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "params": { "type": "array", "items": { "$ref": "#/definitions/def_param" } },
    "outputs": { "type": "array", "items": { "$ref": "#/definitions/def_output" } },
    "emits": { "type": "array", "items": { "$ref": "#/definitions/def_emit" } },
    "formatter": { "$ref": "#/definitions/def_formatter" }
  }
},
"def_param": {
  "type": "object", "required": ["name", "type"],
  "properties": {
    "name": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "type": { "enum": ["number", "string", "bool", "enum", "list"] },
    "values": { "type": "array", "items": { "type": "string" } },
    "of": { "$ref": "#/definitions/of_spec" },
    "required": { "type": "boolean" },
    "default": {},
    "description": { "type": "string" }
  }
},
"def_output": {
  "allOf": [
    { "$ref": "#/definitions/io_ref" },
    { "type": "object", "required": ["produced_by"],
      "properties": { "produced_by": { "enum": ["promote", "formatter"] } } }
  ]
},
"def_emit": {
  "type": "object", "required": ["name", "type", "source"],
  "properties": {
    "name": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "type": { "enum": ["number", "string", "bool", "enum", "list"] },
    "values": { "type": "array", "items": { "type": "string" } },
    "of": { "$ref": "#/definitions/of_spec" },
    "source": { "enum": ["promote", "create"] },
    "from": { "type": "string" },
    "field": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" }
  }
},
"def_formatter": {
  "type": "object",
  "properties": {
    "enabled": { "type": "boolean" },
    "prompt": { "type": "string" },
    "invoke": { "type": "object", "properties": {
      "type": { "enum": ["main_agent", "agent"] },
      "agent": { "type": "string" },
      "model": { "enum": ["haiku", "sonnet", "opus", "inherit"] },
      "effort": { "enum": ["low", "medium", "high", "xhigh", "max", "inherit"] },
      "tools": { "type": "array", "items": { "type": "string" } } } },
    "inputs": { "type": "array", "items": { "$ref": "#/definitions/io_ref" } },
    "style": { "type": "object" }
  }
},
"of_spec": {
  "oneOf": [
    { "enum": ["string", "number", "bool", "enum"] },
    { "type": "object", "additionalProperties": {
      "oneOf": [ { "enum": ["string", "number", "bool"] },
                 { "type": "object", "required": ["enum"],
                   "properties": { "enum": { "type": "array", "items": { "type": "string" } } },
                   "additionalProperties": false } ] } }
  ]
}
```

> Note: reuse `of_spec` to replace the inline `of` in the existing `emits` block later if desired, but do NOT change existing emits behavior in this task.

- [ ] **Step 4: Run test — expect PASS**

Run: `pytest src/scripts/tests/test_workflow_definition.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/workflow.schema.json src/scripts/tests/test_workflow_definition.py
git commit -m "feat(schema): definition block + workflow_call args"
```

---

### Task 2: `validate_definition` — params rules

**Files:**
- Modify: `src/scripts/bb-workflow` (new function near `_validate_signals`, ~line 889; call site in `validate_coherence` ~line 1474)
- Test: `src/scripts/tests/test_workflow_definition.py`

**Interfaces:**
- Produces: `validate_definition(workflow) -> list[str]`. Consumes existing `_check_values_form`, `_check_of_form`, `_OF_SCALARS`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run — expect FAIL** (`validate_definition` not defined).

Run: `pytest src/scripts/tests/test_workflow_definition.py::test_params_rules -v`

- [ ] **Step 3: Implement.** Insert after `_validate_signals` (after ~line 968):

```python
def validate_definition(workflow: dict) -> list:
    """Blocking rules for the workflow-level `definition` contract (spec 2026-07-17).
    Params, outputs (produced_by + promote/formatter), emits (promote/create),
    reserved id DEFINITION. Signal keys are lowercase <pid>.<name>."""
    d = workflow.get("definition")
    if not d:
        return []
    errors = []

    # reserved id
    if any(p.get("id") == "DEFINITION" for p in workflow.get("phases", [])):
        errors.append("phase id 'DEFINITION' is reserved for the workflow definition block")

    # --- params ---
    seen = set()
    for p in d.get("params", []) or []:
        name = p.get("name", "?")
        tag = f"definition param '{name}'"
        ptype = p.get("type")
        if name in seen:
            errors.append(f"{tag}: duplicate param name")
        seen.add(name)
        if ptype == "enum":
            errors.extend(_check_values_form(p.get("values"), tag))
        if ptype == "list":
            if not p.get("of"):
                errors.append(f"{tag}: type 'list' requires an 'of' element type")
            else:
                errors.extend(_check_of_form(p.get("of"), p.get("values"), tag))
        if p.get("required") and p.get("default") not in (None, ""):
            errors.append(f"{tag}: a required param cannot declare a default")
        default = p.get("default")
        if default not in (None, ""):
            if ptype == "number" and not isinstance(default, (int, float)):
                errors.append(f"{tag}: default must be a number")
            if ptype == "bool" and not isinstance(default, bool):
                errors.append(f"{tag}: default must be a bool")
            if ptype == "enum" and default not in (p.get("values") or []):
                errors.append(f"{tag}: default must be one of the enum values")
            if ptype == "list":
                errors.append(f"{tag}: a list param cannot declare a default")
    return errors
```

- [ ] **Step 4: Wire the call.** In `validate_coherence`, right after `errors.extend(_validate_signals(workflow))` (~line 1474) add:

```python
    errors.extend(validate_definition(workflow))
```

- [ ] **Step 5: Run — expect PASS**

Run: `pytest src/scripts/tests/test_workflow_definition.py::test_params_rules -v`

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_definition.py
git commit -m "feat(validate): definition params rules"
```

---

### Task 3: `validate_definition` — outputs & emits rules

**Files:**
- Modify: `src/scripts/bb-workflow` (extend `validate_definition`)
- Test: `src/scripts/tests/test_workflow_definition.py`

**Interfaces:**
- Consumes: `collect_signals(workflow)` (keys `<pid_lower>.<name>`), the phase `outputs`/invocation `outputs` roles.
- Produces: `_all_produced_roles(workflow) -> set[str]` helper + `_output_kind_for_role(workflow, role) -> str|None`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `pytest src/scripts/tests/test_workflow_definition.py -k "outputs_and_emits or create_emit" -v`

- [ ] **Step 3: Implement.** Add helpers above `validate_definition`:

```python
def _all_produced_roles(workflow: dict) -> dict:
    """role (namespace-stripped of trailing .field) -> kind, for every output an
    internal phase/invocation produces. Used to check definition promote-outputs."""
    roles = {}
    for phase in workflow.get("phases", []):
        for out in phase.get("outputs", []) or []:
            roles[out.get("role", "")] = out.get("kind")
        for inv in phase.get("invocations", []) or []:
            for out in inv.get("outputs", []) or []:
                roles[out.get("role", "")] = out.get("kind")
    return roles
```

Then extend `validate_definition` before `return errors`:

```python
    # --- outputs ---
    produced = _all_produced_roles(workflow)
    fmt = (d.get("formatter") or {})
    has_formatter = bool(fmt.get("enabled"))
    fmt_output_roles = {o.get("role"): o.get("kind")
                        for o in d.get("outputs", []) or [] if o.get("produced_by") == "formatter"}
    for o in d.get("outputs", []) or []:
        role = o.get("role") or o.get("path") or "?"
        pb = o.get("produced_by")
        if pb == "promote" and o.get("role") and o["role"] not in produced:
            errors.append(f"definition output '{role}' is produced_by promote but no internal phase produces role '{o['role']}'")
        if pb == "formatter" and not has_formatter:
            errors.append(f"definition output '{role}' is produced_by formatter but no formatter is enabled")

    # --- emits ---
    signals = collect_signals(workflow)
    seen_e = set()
    for e in d.get("emits", []) or []:
        name = e.get("name", "?")
        tag = f"definition emit '{name}'"
        if name in seen_e:
            errors.append(f"{tag}: duplicate emit name")
        seen_e.add(name)
        if e.get("type") == "enum":
            errors.extend(_check_values_form(e.get("values"), tag))
        if e.get("type") == "list":
            if not e.get("of"):
                errors.append(f"{tag}: type 'list' requires 'of'")
            else:
                errors.extend(_check_of_form(e.get("of"), e.get("values"), tag))
        src = e.get("source")
        if src == "promote":
            key = e.get("from")
            if not key:
                errors.append(f"{tag}: promote requires a 'from' internal signal key")
            elif key not in signals:
                errors.append(f"{tag}: promote 'from' {key!r} is not a declared signal")
            else:
                st = signals[key].get("type")
                if st and st != e.get("type"):
                    errors.append(f"{tag}: type '{e.get('type')}' differs from promoted signal {key} ('{st}')")
        elif src == "create":
            if not has_formatter:
                errors.append(f"{tag}: source 'create' requires a formatter")
            role = e.get("from")
            if not role or role not in fmt_output_roles:
                errors.append(f"{tag}: create 'from' must read a formatter output role")
            elif fmt_output_roles.get(role) != "json":
                errors.append(f"{tag}: create reads role '{role}' which must be kind 'json' to carry a field")
            if not e.get("field"):
                errors.append(f"{tag}: create requires a 'field' selector")
    return errors
```

- [ ] **Step 4: Run — expect PASS.**

Run: `pytest src/scripts/tests/test_workflow_definition.py -v`

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_definition.py
git commit -m "feat(validate): definition outputs & emits rules"
```

---

### Task 4: `workflow_call` args-binding validation

**Files:**
- Modify: `src/scripts/bb-workflow` (`validate_coherence`, the `workflow_call` branch ~line 1407)
- Test: `src/scripts/tests/test_workflow_definition.py`

**Interfaces:**
- Consumes: the target workflow's `definition.params` (loaded from `src/workflows/<target>.yaml` via `load_workflow`).
- Produces: binding errors (required param unbound; unknown param bound).

- [ ] **Step 1: Write the failing test**

```python
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
```

> The test passes `agents_dir=tmp_path` so the (irrelevant) agent-existence check has a dir; the `workflow_call` branch doesn't need agents.

- [ ] **Step 2: Run — expect FAIL.**

Run: `pytest src/scripts/tests/test_workflow_definition.py::test_workflow_call_args_binding -v`

- [ ] **Step 3: Implement.** In the `if ptype == "workflow_call":` branch, after the existing "references unknown workflow" `elif` (~line 1423), add:

```python
                else:
                    # bind args against the target's definition.params
                    target_path = workflows_dir / f"{target}.yaml"
                    try:
                        target_wf = load_workflow(target_path)
                    except Exception:
                        target_wf = None
                    if target_wf is not None:
                        tparams = (target_wf.get("definition") or {}).get("params", []) or []
                        tnames = {p.get("name") for p in tparams}
                        required = {p.get("name") for p in tparams if p.get("required")}
                        bound = set((phase.get("args") or {}).keys())
                        for miss in sorted(required - bound):
                            errors.append(f"phase '{pid}' (workflow_call {target}) required param '{miss}' is unbound")
                        for extra in sorted(bound - tnames):
                            errors.append(f"phase '{pid}' (workflow_call {target}) binds unknown param '{extra}'")
```

- [ ] **Step 4: Run — expect PASS.**

Run: `pytest src/scripts/tests/test_workflow_definition.py::test_workflow_call_args_binding -v`

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_definition.py
git commit -m "feat(validate): workflow_call args binding against target definition"
```

---

### Task 5: Synthetic `DEFINITION` phase + dataflow producers

**Files:**
- Modify: `src/scripts/bb-workflow` (new `_synthesize_definition_phase`; edit `build_dataflow_graph` ~line 2470)
- Test: `src/scripts/tests/test_workflow_definition.py`

**Interfaces:**
- Produces: `_synthesize_definition_phase(workflow) -> dict | None` — a phase dict `{id:"DEFINITION", name, group, type, invocations?, inputs, outputs, emits, depends_on}`. Never mutates `workflow["phases"]`.
- Consumes: `build_dataflow_graph` iterates phases; it must additionally include the synthetic phase (formatter outputs = producers; formatter inputs = consumers) and mark `workflow_call` phases as producers of their target's `definition.outputs`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `pytest src/scripts/tests/test_workflow_definition.py -k synthesize -v`

- [ ] **Step 3: Implement.** Add near `build_dataflow_graph`:

```python
def _synthesize_definition_phase(workflow: dict) -> dict:
    """Build the terminal DEFINITION phase from the definition block, WITHOUT
    mutating workflow['phases']. depends_on is derived from the phases that
    produce its promoted signals, promote-outputs and formatter inputs."""
    d = workflow.get("definition")
    if not d:
        return None
    fmt = d.get("formatter") or {}
    has_fmt = bool(fmt.get("enabled"))
    inv = fmt.get("invoke") or {}
    phase = {
        "id": "DEFINITION", "name": "Workflow output", "group": "handoff",
        "type": (inv.get("type") or "main_agent") if has_fmt else "main_agent",
        "inputs": list(fmt.get("inputs") or []),
        "outputs": list(d.get("outputs") or []),
        "emits": list(d.get("emits") or []),
        "depends_on": _derive_definition_depends_on(workflow, d),
    }
    if has_fmt and inv.get("type") == "agent" and inv.get("agent"):
        io = {"inputs": list(fmt.get("inputs") or []),
              "outputs": [o for o in (d.get("outputs") or []) if o.get("produced_by") == "formatter"]}
        phase["invocations"] = [dict(agent=inv["agent"], model=inv.get("model"),
                                     effort=inv.get("effort"), tools=inv.get("tools"),
                                     description=fmt.get("prompt", ""), **io)]
    return phase


def _derive_definition_depends_on(workflow: dict, d: dict) -> list:
    """Phases the DEFINITION node waits on: producers of promoted signals, of
    promote-output roles, and of formatter input roles."""
    deps = set()
    # promoted signals -> emitting phase
    sig_phase = {f"{p['id'].lower()}.{e['name']}": p["id"]
                 for p in workflow.get("phases", []) for e in (p.get("emits") or [])}
    for e in d.get("emits", []) or []:
        if e.get("source") == "promote" and e.get("from") in sig_phase:
            deps.add(sig_phase[e["from"]])
    # role -> producing phase
    role_phase = {}
    for p in workflow.get("phases", []):
        for out in (p.get("outputs") or []):
            role_phase[out.get("role")] = p["id"]
        for inv in (p.get("invocations") or []):
            for out in (inv.get("outputs") or []):
                role_phase[out.get("role")] = p["id"]
    for o in d.get("outputs", []) or []:
        if o.get("produced_by") == "promote" and o.get("role") in role_phase:
            deps.add(role_phase[o["role"]])
    for i in (d.get("formatter") or {}).get("inputs", []) or []:
        if i.get("role") in role_phase:
            deps.add(role_phase[i["role"]])
    return sorted(deps)
```

- [ ] **Step 4: Teach dataflow.** In `build_dataflow_graph`, after it processes `workflow["phases"]`, include the synthetic phase and `workflow_call` producers. Locate the phase-iteration loop and add, after it:

```python
    # workflow-level definition acts as a terminal producer/consumer node
    _defp = _synthesize_definition_phase(workflow)
    if _defp:
        _ingest_phase_into_dataflow(_defp)   # reuse the same per-phase logic the loop uses
    # a workflow_call phase produces its target's declared outputs
    for phase in workflow.get("phases", []):
        if phase.get("type") == "workflow_call":
            tgt = phase.get("workflow")
            tpath = DEFAULT_WORKFLOWS_DIR / f"{tgt}.yaml"
            if tpath.exists():
                try:
                    tw = load_workflow(tpath)
                    for out in (tw.get("definition") or {}).get("outputs", []) or []:
                        _register_producer(phase["id"], out)   # mark caller phase as producer
                except Exception:
                    pass
```

> Implementation note for the subagent: `build_dataflow_graph` currently inlines its per-phase producer/consumer registration. Extract that inner logic into a local closure (`_ingest_phase_into_dataflow` / `_register_producer`) first, then reuse it for the two additions above. Keep the existing return shape unchanged. If extraction is too invasive, replicate the minimal producer registration for the synthetic phase's outputs and the workflow_call target outputs.

- [ ] **Step 5: Run — expect PASS** (synthesize tests) and existing dataflow tests still green:

Run: `pytest src/scripts/tests/test_workflow_definition.py -k synthesize -v && pytest src/scripts/tests/ -k dataflow -v`

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_definition.py
git commit -m "feat(dataflow): synthetic DEFINITION phase + workflow_call producers"
```

---

### Task 6: `compile_style` — engine-owned prompt-assist

**Files:**
- Modify: `src/scripts/bb-workflow` (new `compile_style`; `_format_io_compact` already exists ~line 1886)
- Test: `src/scripts/tests/test_workflow_definition.py`

**Interfaces:**
- Produces: `compile_style(style: dict) -> list[str]` (prose lines) and `compose_formatter_prompt(workflow, phase) -> str` (io listing + compiled knobs + free prompt).

- [ ] **Step 1: Write the failing test**

```python
def test_compile_style():
    lines = bbw.compile_style({"length": "brief", "tone": "didactic",
                               "format": "bullets", "language": "French",
                               "mustInclude": ["TL;DR"], "avoid": ["preamble"], "stance": "recommend"})
    joined = " ".join(lines)
    assert "brief" in joined and "didactic" in joined and "bullet" in joined.lower()
    assert "French" in joined and "TL;DR" in joined and "preamble" in joined
    assert bbw.compile_style({"tone": "custom", "toneCustom": "like a pirate"}) == ["like a pirate"]
    assert bbw.compile_style({}) == []
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Add:

```python
_LEN_HINT = {"terse": "~40 words", "brief": "~150 words", "standard": "~400 words",
             "detailed": "~800 words", "exhaustive": "as long as needed"}
_FMT_PROSE = {"prose": "Write as flowing prose.", "bullets": "Structure as bullet points.",
              "table": "Present as a table.", "sections": "Organize under section headers.",
              "tldr": "Lead with a TL;DR, then the detail."}

def compile_style(style: dict) -> list:
    """Prompt-assist knobs -> deterministic prose lines (single source of truth;
    the WebUI preview renders these verbatim). Free prompt is concatenated after."""
    st = style or {}
    parts = []
    if st.get("length"):
        parts.append(f"Keep the answer {st['length']} ({_LEN_HINT.get(st['length'], 'appropriate length')}).")
    if st.get("tone") == "custom":
        if st.get("toneCustom"):
            parts.append(st["toneCustom"])
    elif st.get("tone"):
        parts.append(f"Write in a {st['tone']} tone.")
    if st.get("format") in _FMT_PROSE:
        parts.append(_FMT_PROSE[st["format"]])
    if st.get("language") and st["language"] != "inherit":
        parts.append(f"Respond in {st['language']}.")
    if st.get("audience"):
        parts.append(f"Written for a {st['audience']}.")
    for m in st.get("mustInclude", []) or []:
        parts.append(f"Always include: {m}.")
    for a in st.get("avoid", []) or []:
        parts.append(f"Avoid: {a}.")
    if st.get("stance") == "present":
        parts.append("Present options rather than a single pick.")
    elif st.get("stance") == "recommend":
        parts.append("Give a clear recommendation.")
    return parts


def compose_formatter_prompt(workflow: dict, def_phase: dict) -> str:
    """Full formatter prompt = io listing (inputs_outputs_compact) + compiled
    style + free prompt. Files are listed HERE, never by the author (pitfall #5)."""
    fmt = (workflow.get("definition") or {}).get("formatter") or {}
    io_line = _format_io_compact(workflow, def_phase.get("inputs", []), def_phase.get("outputs", []))
    style_lines = compile_style(fmt.get("style") or {})
    blocks = []
    if io_line:
        blocks.append(io_line)
    if style_lines:
        blocks.append("\n".join(style_lines))
    if fmt.get("prompt"):
        blocks.append(fmt["prompt"])
    return "\n\n".join(blocks)
```

> Check the real `_format_io_compact` signature at ~line 1886 and adapt the call; if it takes the workflow + io lists differently, match it. The goal: the same helper that renders per-invocation "in: … · out: …" produces the formatter's file listing.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_definition.py
git commit -m "feat(render): compile_style + formatter prompt composition"
```

---

### Task 7: Render the `DEFINITION` phase in SKILL.md + cartography

**Files:**
- Modify: `src/scripts/bb-workflow` (skill render context ~line 1882/2013; pass `definition_phase` + composed prompt)
- Modify: `src/workflow/templates/skill-skeleton.md.jinja` (~after the phases loop, line 169)
- Modify: `src/workflow/templates/cartography.mermaid.jinja` (~line 16)
- Test: `src/scripts/tests/test_workflow_definition.py`

**Interfaces:**
- Consumes: `_synthesize_definition_phase`, `compose_formatter_prompt`.
- Produces: SKILL.md contains a "## Workflow output" section; cartography contains a `DEFINITION` node.

- [ ] **Step 1: Write the failing test**

```python
def test_generate_renders_definition(tmp_path):
    # Minimal end-to-end: build the skill for a workflow with a definition and
    # assert the rendered markdown mentions the boundary + the composed prompt.
    wf = _wf(definition={
        "outputs": [{"role": "work:final", "kind": "md", "produced_by": "formatter"}],
        "emits": [{"name": "ok", "type": "string", "source": "promote", "from": "p0.ok"}],
        "formatter": {"enabled": True, "prompt": "Write the final summary.",
                      "invoke": {"type": "main_agent"},
                      "style": {"length": "brief", "format": "tldr"}}})
    md = bbw.render_skill_markdown(wf)   # see note
    assert "Workflow output" in md
    assert "Write the final summary." in md
    assert "TL;DR" in md   # compiled style injected
```

> Note: use whatever function actually renders the SKILL.md string (find it around the `env.get_template("skill-skeleton.md.jinja")` call, ~line 2121). If it only writes to a file, add/reuse a thin `render_skill_markdown(workflow) -> str` used by both the file writer and the test.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement context.** Where the skill context dict is built (~line 1882) and phases get `rendered_invocations` (~2013-2037), add:

```python
    _defp = _synthesize_definition_phase(workflow)
    if _defp is not None:
        _defp["composed_prompt"] = compose_formatter_prompt(workflow, _defp)
    context["definition_phase"] = _defp
```

- [ ] **Step 4: Implement SKILL template.** After the `{% endfor %}` that closes the phases loop (line 169) in `skill-skeleton.md.jinja`, add:

```jinja
{% if definition_phase %}
---

## Workflow output — the contract callers bind

> 🎯 This is the workflow's **definition** (reserved terminal action `DEFINITION`).
{% if definition_phase.type == 'main_agent' %}
The **main agent** produces the final answer:
{% elif definition_phase.invocations %}
{% for inv in definition_phase.invocations %}**{{ inv.agent }}** [{{ inv.model or 'inherit' }}] produces the final answer:
{% endfor %}
{% endif %}

{{ definition_phase.composed_prompt }}

{% if definition_phase.emits %}
**Return signals** (a caller reads them as `‹caller_phase›.<name>`):
{% for e in definition_phase.emits %}- `{{ e.name }}` ({{ e.type }}){% if e.source == 'promote' %} — promoted from `{{ e.from }}`{% else %} — from output `{{ e.from }}`.`{{ e.field }}`{% endif %}
{% endfor %}
{% endif %}
{% endif %}
```

- [ ] **Step 5: Implement cartography node.** In `cartography.mermaid.jinja`, after the phase-node block, ensure a definition node is emitted. Add near the top-level node loop (the engine must pass `definition_phase` into the mermaid context too — mirror Step 3 in the cartography render function, `render_cartography_mermaid` ~line 2661):

```jinja
{%- if definition_phase %}
    DEFINITION[["`🎯 **Workflow output**
_returns: {{ definition_phase.emits | map(attribute='name') | join(', ') or '—' }}_`"]]:::definition
{%- for dep in definition_phase.depends_on %}
    {{ dep }} --> DEFINITION
{%- endfor %}
{%- endif %}
```

Add a `classDef definition fill:#0b2a1e,stroke:#4ade80,stroke-width:2px,color:#dcfce7` next to the existing `classDef workflow_call` (line 60).

- [ ] **Step 6: Run — expect PASS.**

Run: `pytest src/scripts/tests/test_workflow_definition.py::test_generate_renders_definition -v`

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/workflow/templates/skill-skeleton.md.jinja src/workflow/templates/cartography.mermaid.jinja src/scripts/tests/test_workflow_definition.py
git commit -m "feat(render): DEFINITION phase in SKILL.md + cartography"
```

---

### Task 8: Fixture workflow + regenerate all + ripple

**Files:**
- Create: `src/scripts/tests/fixtures/workflows/definition_demo.yaml` (+ a caller fixture if the harness supports it)
- Modify: regenerated `src/skills/*/SKILL.md`, `docs/architecture-cartography/*` (produced by `awok generate`)
- Test: `src/scripts/tests/test_workflow_definition.py` (a golden-substring test on the fixture)

- [ ] **Step 1: Write the fixture** `definition_demo.yaml` — a small workflow with `params`, promote + create emits, a formatter with `style` and editable `inputs`, exercising every §8 rule positively. Model it on the mockup's example state (params `channel/tone/max_items/labels`, outputs `report:summary`+`report:action_items`, emits `sentiment` promote + `summary_len` create, formatter `summarizer`).

- [ ] **Step 2: Validate + generate the fixture**

Run: `python src/scripts/bb-workflow validate --workflow src/scripts/tests/fixtures/workflows/definition_demo.yaml`
Expected: no errors.

- [ ] **Step 3: Regenerate ALL real workflows (ripple)** — engine/template changed, so every SKILL.md must be rebuilt:

Run: `awok generate`
Then: `awok check`
Expected: `awok check` clean (all artifacts match).

- [ ] **Step 4: Run the whole suite**

Run: `pytest src/scripts/tests/ -q`
Expected: all green (295+ existing + new).

- [ ] **Step 5: Commit (regenerated artifacts + fixture together)** with the ripple trailer:

```bash
git add src/scripts/tests/fixtures/workflows/definition_demo.yaml src/skills docs/architecture-cartography src/scripts/tests/test_workflow_definition.py
git commit -m "feat(definition): demo fixture + regenerate all artifacts

Regen: all SKILL.md + cartography (definition block rendering);
       workdir owners run \`awok generate && awok deploy\`."
```

- [ ] **Step 6: Redeploy**

Run: `./install.sh`

---

### Task 9: Server — expose the definition preview in the view payload

**Files:**
- Modify: `src/scripts/bb-workflow` (`build_view_payload` ~line 2359; optionally a `/api/preview`-style branch ~line 3941)
- Test: `src/scripts/tests/test_workflow_definition.py`

**Interfaces:**
- Produces: `build_view_payload(model)` gains a `definition_preview` key: `{ prompt: str, compiled: [str], io_line: str }` computed by the engine (so the WebUI never recompiles).

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** In `build_view_payload`, before `return`, add:

```python
    _defp = _synthesize_definition_phase(model)
    definition_preview = None
    if _defp is not None:
        fmt = (model.get("definition") or {}).get("formatter") or {}
        definition_preview = {
            "prompt": compose_formatter_prompt(model, _defp),
            "compiled": compile_style(fmt.get("style") or {}),
            "io_line": _format_io_compact(model, _defp.get("inputs", []), _defp.get("outputs", [])),
        }
```

and add `"definition_preview": definition_preview,` to the returned dict. Wrap in try/except like `_safe_dataflow_warnings` so a mid-edit model never 500s.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_definition.py
git commit -m "feat(editor): server-rendered definition preview in view payload"
```

---

### Task 10: WebUI — the `definition.js` tab module (port the mockup + deltas)

**Files:**
- Create: `src/workflow/templates/webedit/definition.js`
- Reference: `docs/superpowers/specs/2026-07-17-workflow-io-contract-maquette.html` (unescape the bundled script; the JSX component is the complete source)
- Test: manual (`awok edit`) + Task 12 webedit tests

**Interfaces:**
- Exports: `renderDefinition(root, ctx)` where `ctx = { getModel, setModel, refreshView, view }` (mirror `settings.js`'s `renderSettings(root, ctx)` signature — read it first).
- Consumes: `ctx.view.definition_preview` (Task 9); the shared model's `definition`, `namespaces`, `phases`; `collect_signals`-equivalent list from the view.

- [ ] **Step 1: Port the component.** Translate the mockup's `React.createElement` component into a plain-DOM (or the project's existing render idiom — match `settings.js`) module. Keep the section structure: §1 hero/identity, §2 params, §3 return, §4 formatter + prompt-assist, §5 caller preview, §6 stats, §7 validation banner.

- [ ] **Step 2: Apply the pitfall deltas (these differ from the mockup):**
  - **D1 (pitfall #1):** ONE output list. Remove the mockup's independent `formatter.outputs`. The "Outputs" surface in §4 edits `definition.outputs` filtered to `produced_by === "formatter"`; §3a edits the `promote` ones. Every output row has a `produced_by` control.
  - **D2 (pitfall #2):** a `create` emit's editor picks a **formatter output of kind json** and requires a **`field`** input. Persist as `{source:"create", from:<role>, field:<name>}` (rename the mockup's `createOutput` → `from`). Disable/error when the chosen output is not json.
  - **D3 (pitfall #3):** the "seen by a caller as" line uses the placeholder token `‹caller_phase›.<name>` (no hardcoded `summarize.`).
  - **D4 (pitfall #4):** the internal-signal list (`from` for promote) uses **lowercase** keys (`classify.sentiment`), sourced from the view, not a local uppercase array.
  - **D5 (pitfall #5/#5bis):** the Prompt preview is **server-rendered** — read `ctx.view.definition_preview` (`io_line` + `compiled` + `prompt`); do NOT recompute `compileStyle` in JS. The preview must show the input/output file listing (`io_line`).
  - **D6 (pitfall #6/#6bis):** the formatter "Wired inputs" surface is **editable** (io_ref inputs: role/kind add/remove), persisted to `definition.formatter.inputs`.
  - **D7 (pitfall #7):** identity fields write the shared `model.skill.{name,description,title}` (same fields Settings uses) and read `model.namespaces` live.
  - **D8 (pitfall #9):** the `of` control offers `string|number|bool|enum` + an object-map builder (not a bare `object`), matching typed-payloads.
  - **D9 (pitfall #12):** the "external inputs" stat counts `external:true` io_refs across all phases (from the view), not the formatter's wired inputs.
  - **D10 (pitfall #13):** effort/tools only for `invoke.type==='agent'`; surface the shared-agent/haiku-effort caveat as a ⓘ note.

- [ ] **Step 3: Persistence.** Every edit mutates `ctx.getModel().definition` and calls `ctx.refreshView()` (server round-trip → validation banner + preview refresh), mirroring how `settings.js` mutates and calls `ctx.refreshView`.

- [ ] **Step 4: Manual smoke.** `./install.sh && awok edit`, open the fixture `definition_demo`, switch to the Definition tab, verify: params conditional fields, promote/create emits, editable formatter inputs, server preview updates on knob change, validation banner mirrors `awok validate`.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/templates/webedit/definition.js
git commit -m "feat(editor): Workflow definition tab module"
```

---

### Task 11: WebUI — register the top-level `definition` tab

**Files:**
- Modify: `src/workflow/templates/webedit/editor.js` (top-level tab list ~line 706 area is the drawer; the *view* tabs are grid/dataflow/orchestration — find where `state.tab` view switching happens, ~line 119/198)
- Modify: `src/workflow/templates/webedit/editor.css` (tab button)
- Test: manual + Task 12

- [ ] **Step 1:** Import the module: `import * as definition from "./definition.js";` at the top of `editor.js` (next to `import * as dataflow`).

- [ ] **Step 2:** Add a `definition` entry to the top-level view tab bar (mirror how `dataflow`/`orchestration` tabs are declared and switched). In the render dispatch (where `if (state.tab === "dataflow") dataflow.render();` lives, ~line 119), add:

```js
  if (state.tab === "definition") definition.renderDefinition(definitionRoot, ctx);
```

Wire a container element for the definition view in `editor.html` (mirror the dataflow container) and a `ctx` object exposing `{ getModel, setModel, refreshView, view: state.view }`.

- [ ] **Step 3:** Manual smoke: the tab button appears between Orchestration and Settings; clicking it renders the module; other tabs unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/editor.js src/workflow/templates/webedit/editor.html src/workflow/templates/webedit/editor.css
git commit -m "feat(editor): register Workflow definition top-level tab"
```

---

### Task 12: WebUI tests + full green + final ripple check

**Files:**
- Modify/Create: the webedit test file (find the existing 73-webedit-test file under `src/scripts/tests/`)
- Test: the whole suite

- [ ] **Step 1:** Add webedit tests: (a) `renderDefinition` mounts without throwing on the fixture model; (b) editing a param calls `refreshView`; (c) a `create` emit without a json output surfaces the error; (d) the preview reads `view.definition_preview` (no client-side compile). Match the existing webedit test harness style.

- [ ] **Step 2: Run the full suite**

Run: `pytest src/scripts/tests/ -q`
Expected: all green (295+ engine, 73+ webedit, plus the new tests).

- [ ] **Step 3: Final ripple gate**

Run: `awok check`
Expected: clean. If red, `awok generate` and re-commit artifacts.

- [ ] **Step 4: Redeploy + final manual pass**

Run: `./install.sh` then `awok edit` — full walkthrough of the Definition tab on `onboard` (promote-only) and `definition_demo` (format mode).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/tests
git commit -m "test(editor): Workflow definition tab coverage"
```

---

## Self-Review (done at authoring)

**Spec coverage:** §2 model → Tasks 1,5,7; §3 params → Tasks 1,2; §4a outputs → Tasks 1,3,10(D1); §4b emits → Tasks 1,3,10(D2); §4c formatter/editable inputs → Tasks 5,10(D6); §4d compile/preview → Tasks 6,9,10(D5); §5 workflow_call → Tasks 1,4,5; §6 rendering → Task 7; §7 WebUI tab → Tasks 9–12; §8 validation → Tasks 2,3,4; §9 scope (dynamic deferred) → out of plan by design; §10 testing/ripple → Tasks 8,12. All 14 pitfalls mapped (D1–D10 + #8 Task4, #10 Task2, #11 Task2, #14 Task3-warning).

**Placeholder scan:** engine code is complete; WebUI tasks point at the vendored mockup (complete code) + explicit deltas — no "TBD".

**Type consistency:** `validate_definition`, `_synthesize_definition_phase`, `compile_style`, `compose_formatter_prompt`, `build_view_payload.definition_preview`, `renderDefinition(root, ctx)` are named identically across the tasks that produce and consume them. Signal keys are lowercase everywhere. Emit persistence uses `{source, from, field}` (not `createOutput`) consistently after D2.

## Open notes for the executor
- **S3/S4 seams:** the conditional-emitter reachability (Task 3 warning) is a lite version of S3; the full `emits → JSON Schema` derivation (S4) is out of scope. Don't over-build.
- **A2:** the formatter's shared-agent effort/tools inherit the known cross-workflow blind spot — surface it, don't fix A2 here.
- If `build_dataflow_graph` refactor (Task 5 Step 4) proves risky, prefer the minimal-replication fallback noted there over a large rewrite.
