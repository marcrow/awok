# Typed Signal Payloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two typing holes in awok signals — an `enum` signal that declares no vocabulary, and a `list` signal that declares no element type — so both the standard target (prose instructions) and the future dynamic (JS) target (JSON Schema) get a closed, verifiable contract.

**Architecture:** Two optional fields are added inline to each `emits` entry: `values` (already partly shipped by concurrent work — the closed vocabulary of an `enum`) and `of` (new — the element type of a `list`). The compiler (`bb-workflow`, a single Python script) validates them, renders them into emission/consumption instructions, and the web editor (`formfields.js`, ES modules) grows the matching inputs. No new file is created; every change extends an existing function next to its siblings.

**Tech Stack:** Python 3 (no framework — `bb-workflow` is one script), `pytest` for the compiler, `bun test` + `linkedom` for the web-editor ES modules, JSON Schema (draft-07) for `workflow.schema.json`.

## Global Constraints

- One block = the design in `docs/superpowers/specs/2026-07-16-typed-signal-payloads-design.md` — read it first; it is the source of truth for every rule below.
- **Strictness (spec §2.2):** `values` is REQUIRED when `type: enum` (blocking error). `of` is OPTIONAL in the standard target (default `string`, soft warning) and REQUIRED in the `js` target (error).
- **Declaration is inline** on each `emits` entry (spec §2.3) — no shared `types:` section, no `values_ref`.
- **`of` nesting is forbidden (spec §3):** `of` is a scalar keyword (`string|number|bool|enum`) or a flat map `field → scalar-spec`; a field spec is a scalar keyword or `{enum: [...]}`. No list-in-field, no object-in-field. All declared object fields are required.
- **Additive, no `schema_version` bump (spec §8).** The only content that must change is the test fixture `orchestrated.yaml`.
- **Coordinate with concurrent work (spec §10):** commits `b58f5a5`/`18393d7` already shipped the `values` schema field, `collect_signals` carrying `values`, the `==`/`!=` enum-literal check, and the web-editor `values` chips + enum literal dropdown. Do NOT re-create those. This plan builds the *delta*: enum-strict, `values` form checks, `contains`, the whole `of` axis, emission rendering, `for_each` body contract, and the list `of` editor. If another agent is actively editing `bb-workflow`/`formfields.js`, rebase onto their work before starting.
- **Run the full suite green before every commit:** `pytest src/scripts/tests/test_workflow_*.py -q` and (for web-editor tasks) `cd src/scripts/tests/webedit && bun test`.
- Reference files: validation `src/scripts/bb-workflow` (`_validate_signals` ~L840, `validate_orchestration` ~L1067, `_validate_condition` ~L1122, `collect_signals` ~L776, `_value_spec`/`render_signal_emission` ~L870, `_render_blocks` ~L2091, `_validate_one` ~L2930). Tests `src/scripts/tests/test_workflow_orchestration.py` (helper `_wf` at L39), `test_workflow_generate.py`. Web editor `src/workflow/templates/webedit/formfields.js` (`signalsEditor` ~L195, `stringListEditor` ~L132), bun tests `src/scripts/tests/webedit/formfields.test.js`.

---

### Task 1: Enum-strict + `values` form validation

Make `type: enum` without `values` a blocking error, and validate the shape of `values` (non-empty, unique strings). This lives in `_validate_signals` (the emit-declaration validator, run inside `validate_coherence`), NOT in `validate_orchestration` — the rule is about the declaration, not its use in a condition.

**Files:**
- Modify: `src/scripts/bb-workflow` — `_validate_signals` (~L840), add helper `_check_values_form`.
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `_validate_signals(workflow: dict) -> list[str]` (existing), the `_wf` test helper (existing).
- Produces: `_check_values_form(values, tag) -> list[str]` — form errors for a `values` list; reused by Task 2 for `of: enum` and object enum fields.

- [ ] **Step 1: Write the failing tests**

Add to `src/scripts/tests/test_workflow_orchestration.py`:

```python
def test_enum_without_values_is_blocking(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "status", "type": "enum", "source": "token"}])
    errs = bbw_module._validate_signals(wf)
    assert any("status" in e and "values" in e for e in errs)

def test_enum_with_values_ok(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "status", "type": "enum", "source": "token",
                     "values": ["ok", "degraded", "failed"]}])
    assert bbw_module._validate_signals(wf) == []

def test_enum_values_must_be_nonempty(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "status", "type": "enum", "source": "token", "values": []}])
    errs = bbw_module._validate_signals(wf)
    assert any("status" in e and "values" in e for e in errs)

def test_enum_values_must_be_unique_strings(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "status", "type": "enum", "source": "token",
                     "values": ["ok", "ok"]}])
    errs = bbw_module._validate_signals(wf)
    assert any("status" in e and "duplicate" in e.lower() for e in errs)

def test_values_rejected_on_non_enum(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "n", "type": "number", "source": "token", "values": ["1"]}])
    errs = bbw_module._validate_signals(wf)
    assert any("n" in e and "values" in e for e in errs)
```

Also **repurpose the concurrent-work test** `test_enum_values_optional` (added in commit `b58f5a5`) — it asserted enum-without-values yields no error via `validate_orchestration`, which now contradicts enum-strict. Replace its body so it documents the surviving truth (the *condition-literal* check has nothing to compare against when `values` is absent, so it stays silent — the blocking error comes from `_validate_signals`, tested above):

```python
def test_condition_literal_check_skipped_without_values(bbw_module):
    # No declared `values` → the ==/contains literal check has no vocabulary to
    # check against, so validate_orchestration stays silent. (The missing-values
    # blocking error is raised by _validate_signals, see enum-strict tests.)
    wf = _wf([{"if": {"op": "==", "left": "t1.status", "right": "whatever"},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "status", "type": "enum", "source": "token"}])
    assert bbw_module.validate_orchestration(wf) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "enum_without_values or enum_with_values or values_must or values_rejected" -v`
Expected: FAIL (no missing-values / form errors emitted yet).

- [ ] **Step 3: Add the helper and the enum-strict checks**

In `src/scripts/bb-workflow`, add above `_validate_signals`:

```python
def _check_values_form(values, tag):
    """Form errors for a declared enum `values` list: must be a non-empty list
    of unique strings. Returns a list of error strings (empty if well-formed)."""
    errs = []
    if not isinstance(values, list) or not values:
        errs.append(f"{tag}: 'values' must be a non-empty list of strings")
        return errs
    if any(not isinstance(v, str) for v in values):
        errs.append(f"{tag}: 'values' entries must all be strings")
    if len(set(values)) != len(values):
        errs.append(f"{tag}: 'values' contains duplicate entries")
    return errs
```

Then inside `_validate_signals`, in the per-emit loop (after the existing `type: list requires source field` check, before `resolve_signal_emitter`), add:

```python
            values = emit.get("values")
            if typ == "enum":
                if values is None:
                    errors.append(f"{tag}: type 'enum' requires a non-empty 'values' list (the closed vocabulary)")
                else:
                    errors.extend(_check_values_form(values, tag))
            elif values is not None and not (typ == "list" and emit.get("of") == "enum"):
                # values is only meaningful for an enum, or for a list whose
                # elements are enums (Task 2 handles the list case).
                errors.append(f"{tag}: 'values' is only valid for type 'enum' (or a list of enums)")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "enum or values or literal_check_skipped" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(signals): enum-strict — require a well-formed values vocabulary"
```

---

### Task 2: `of` schema field, carry in `collect_signals`, form validation

Add the `of` field to the JSON schema, carry it through `collect_signals` (so conditions can see element types), and validate its form in `_validate_signals`.

**Files:**
- Modify: `src/workflow/workflow.schema.json` — `emits` item properties (~L88-98).
- Modify: `src/scripts/bb-workflow` — `collect_signals` (~L785), `_validate_signals`, add helper `_check_of_form`.
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `_check_values_form` (Task 1), `collect_signals(workflow) -> dict` (existing), `_validate_signals` (Task 1).
- Produces: signal meta dicts now carry `"of"` (the raw `of` value: a string keyword or a flat dict). Consumed by Tasks 3 and 6.

- [ ] **Step 1: Add the schema field**

In `src/workflow/workflow.schema.json`, inside the `emits` array item `properties` (next to `values`), add:

```json
              "of": {
                "description": "For type=list: the element type — a scalar keyword ('string'|'number'|'bool'|'enum') or a flat object map field->spec. No nesting.",
                "oneOf": [
                  { "enum": ["string", "number", "bool", "enum"] },
                  {
                    "type": "object",
                    "additionalProperties": {
                      "oneOf": [
                        { "enum": ["string", "number", "bool"] },
                        { "type": "object", "required": ["enum"],
                          "properties": { "enum": { "type": "array", "items": { "type": "string" } } },
                          "additionalProperties": false }
                      ]
                    }
                  }
                ]
              }
```

- [ ] **Step 2: Write the failing tests**

Add to `test_workflow_orchestration.py`:

```python
def test_collect_signals_carries_of(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "hits", "type": "list", "source": "field",
                     "from": "t1.json", "of": "string"}])
    sigs = bbw_module.collect_signals(wf)
    assert sigs["t1.hits"]["of"] == "string"

def test_of_on_non_list_is_error(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "n", "type": "number", "source": "token", "of": "string"}])
    errs = bbw_module._validate_signals(wf)
    assert any("n" in e and "'of'" in e for e in errs)

def test_of_unknown_scalar_keyword_is_error(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "hits", "type": "list", "source": "field",
                     "from": "t1.json", "of": "widget"}])
    errs = bbw_module._validate_signals(wf)
    assert any("hits" in e and "widget" in e for e in errs)

def test_of_enum_requires_values(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "v", "type": "list", "source": "field",
                     "from": "t1.json", "of": "enum"}])
    errs = bbw_module._validate_signals(wf)
    assert any("v" in e and "values" in e for e in errs)

def test_of_enum_with_values_ok(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "v", "type": "list", "source": "field",
                     "from": "t1.json", "of": "enum", "values": ["a", "b"]}])
    assert bbw_module._validate_signals(wf) == []

def test_of_object_flat_ok(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "f", "type": "list", "source": "field", "from": "t1.json",
                     "of": {"path": "string", "severity": {"enum": ["low", "high"]}}}])
    assert bbw_module._validate_signals(wf) == []

def test_of_object_nested_is_error(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "f", "type": "list", "source": "field", "from": "t1.json",
                     "of": {"bad": {"nested": "string"}}}])
    errs = bbw_module._validate_signals(wf)
    assert any("f" in e and "bad" in e for e in errs)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "of_" -v`
Expected: FAIL.

- [ ] **Step 4: Carry `of` and validate its form**

In `collect_signals` (the dict built per emit ~L787), add the `of` key:

```python
            signals[key] = {
                "type": emit.get("type"),
                "source": emit.get("source"),
                "phase": pid,
                "values": emit.get("values"),
                "of": emit.get("of"),
            }
```

Add a helper above `_validate_signals`:

```python
_OF_SCALARS = ("string", "number", "bool", "enum")

def _check_of_form(of, values, tag):
    """Form errors for a list's `of` element type. `of` is a scalar keyword or a
    flat object map. `values` is the emit's top-level values (element vocab when
    of == 'enum'). Returns a list of error strings."""
    errs = []
    if isinstance(of, str):
        if of not in _OF_SCALARS:
            errs.append(f"{tag}: 'of' must be one of {list(_OF_SCALARS)}, got '{of}'")
        elif of == "enum":
            if values is None:
                errs.append(f"{tag}: 'of: enum' requires a non-empty 'values' list (the element vocabulary)")
            else:
                errs.extend(_check_values_form(values, tag))
        return errs
    if isinstance(of, dict):
        if not of:
            errs.append(f"{tag}: 'of' object must declare at least one field")
        for field, spec in of.items():
            ftag = f"{tag}: field '{field}'"
            if isinstance(spec, str):
                if spec not in ("string", "number", "bool"):
                    errs.append(f"{ftag}: type must be one of ['string', 'number', 'bool'] or {{enum: [...]}}, got '{spec}'")
            elif isinstance(spec, dict) and set(spec.keys()) == {"enum"}:
                errs.extend(_check_values_form(spec["enum"], ftag))
            else:
                errs.append(f"{ftag}: must be a scalar type or {{enum: [...]}} (no nesting)")
        return errs
    errs.append(f"{tag}: 'of' must be a scalar keyword or a flat object map")
    return errs
```

In `_validate_signals`, after the enum/values block from Task 1, add the list/`of` handling:

```python
            of = emit.get("of")
            if typ == "list":
                if of is not None:
                    errors.extend(_check_of_form(of, values, tag))
            elif of is not None:
                errors.append(f"{tag}: 'of' is only valid for type 'list'")
```

Note: the `elif values is not None and not (typ == "list" and emit.get("of") == "enum")` guard from Task 1 already lets `values` coexist with `of: enum`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "of_ or collect_signals_carries" -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/workflow.schema.json src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(signals): list 'of' element type — schema, collect_signals, form checks"
```

---

### Task 3: Extend condition checks — `contains` on enum, block ops on object lists

Two condition-level rules (spec §4, blocking): the enum-literal vocabulary check must also cover `contains` against a `list of: enum`; and any operator other than `exists` against a `list` whose `of` is an object must error (a condition cannot reach into item fields).

**Files:**
- Modify: `src/scripts/bb-workflow` — `_validate_condition` (~L1198-1222).
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: signal meta with `type`, `values`, `of` (Tasks 1-2); `_validate_condition(cond, signals, caps, target)` (existing).
- Produces: nothing new (extends existing validation output).

- [ ] **Step 1: Write the failing tests**

```python
def test_contains_literal_not_in_enum_list_values(bbw_module):
    wf = _wf([{"if": {"op": "contains", "left": "t1.tags", "right": "ghost"},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "tags", "type": "list", "source": "field", "from": "t1.json",
                     "of": "enum", "values": ["a", "b"]}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("tags" in e and "ghost" in e for e in errs)

def test_contains_literal_in_enum_list_values_ok(bbw_module):
    wf = _wf([{"if": {"op": "contains", "left": "t1.tags", "right": "a"},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "tags", "type": "list", "source": "field", "from": "t1.json",
                     "of": "enum", "values": ["a", "b"]}])
    assert bbw_module.validate_orchestration(wf) == []

def test_non_exists_op_on_object_list_is_error(bbw_module):
    wf = _wf([{"if": {"op": "contains", "left": "t1.findings", "right": "x"},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "findings", "type": "list", "source": "field", "from": "t1.json",
                     "of": {"path": "string"}}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("findings" in e and "object" in e.lower() for e in errs)

def test_exists_on_object_list_ok(bbw_module):
    wf = _wf([{"if": {"op": "exists", "left": "t1.findings"}, "then": [{"ref": "T1"}]}],
             emits=[{"name": "findings", "type": "list", "source": "field", "from": "t1.json",
                     "of": {"path": "string"}}])
    assert bbw_module.validate_orchestration(wf) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "contains_literal or object_list or exists_on_object" -v`
Expected: FAIL.

- [ ] **Step 3: Extend `_validate_condition`**

Generalize the existing enum-literal block (added by `b58f5a5`) so it also fires for `contains` against a list-of-enum, and add the object-list guard. Replace the current `if op in ("==", "!="):` block (~L1208-1221) with:

```python
    # enum-vocabulary check: a literal compared to (==/!=) an enum signal, or
    # `contains`-ed into a list of enums, must belong to the declared vocabulary.
    if op in ("==", "!=", "contains"):
        for sig_operand, lit_operand in ((left, right), (right, left)):
            if not isinstance(sig_operand, str) or sig_operand not in signals:
                continue
            sig_meta = signals[sig_operand]
            typ = sig_meta.get("type")
            values = sig_meta.get("values")
            is_enum = typ == "enum"
            is_enum_list = typ == "list" and sig_meta.get("of") == "enum"
            if not (is_enum or is_enum_list) or not values:
                continue
            # `contains` only carries a vocabulary meaning for an enum LIST;
            # ==/!= only for a scalar enum.
            if op == "contains" and not is_enum_list:
                continue
            if op in ("==", "!=") and not is_enum:
                continue
            if not isinstance(lit_operand, str) or lit_operand in signals:
                continue
            if lit_operand not in values:
                errors.append(
                    f"orchestration: literal '{lit_operand}' is not one of enum "
                    f"signal '{sig_operand}' values {values}")

    # object-list guard: a list whose elements are objects has no scalar to
    # compare — only `exists` is meaningful.
    if op != "exists":
        for operand in (left, right):
            if isinstance(operand, str) and operand in signals:
                m = signals[operand]
                if m.get("type") == "list" and isinstance(m.get("of"), dict):
                    errors.append(
                        f"orchestration: operator '{op}' cannot compare object-list "
                        f"signal '{operand}' — only 'exists' is valid (compare a scalar "
                        f"field via a field signal instead)")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "contains_literal or object_list or exists_on_object" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(signals): condition checks for enum-list contains + object-list guard"
```

---

### Task 4: `js` target requires `of` on lists

In the `js` target, a `list` signal without `of` is a blocking error (spec §4). `validate_orchestration` already carries `target`; add the emit-form check there so it is reachable via `validate_orchestration(wf, target="js")`.

**Files:**
- Modify: `src/scripts/bb-workflow` — `validate_orchestration` (~L1067, after `signals = collect_signals(...)`).
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `validate_orchestration(workflow, capabilities=None, target="standard")` (existing).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

```python
def test_list_without_of_rejected_in_js_target(bbw_module):
    wf = _wf([{"for_each": "t1.hits", "as": "h", "cap": 5, "body": [{"ref": "T1"}]}],
             emits=[{"name": "hits", "type": "list", "source": "field", "from": "t1.json"}])
    errs = bbw_module.validate_orchestration(wf, target="js")
    assert any("hits" in e and "of" in e and "js" in e.lower() for e in errs)

def test_list_without_of_ok_in_standard_target(bbw_module):
    wf = _wf([{"for_each": "t1.hits", "as": "h", "cap": 5, "body": [{"ref": "T1"}]}],
             emits=[{"name": "hits", "type": "list", "source": "field", "from": "t1.json"}])
    # standard target: missing `of` is a warning (Task 5), NOT an orchestration error
    assert not any("of" in e and "js" in e.lower()
                   for e in bbw_module.validate_orchestration(wf, target="standard"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "list_without_of" -v`
Expected: FAIL (js test fails; standard test passes already).

- [ ] **Step 3: Add the js-target emit check**

In `validate_orchestration`, right after `signals = collect_signals(workflow)` (~L1072), add:

```python
    if target == "js":
        for phase in workflow.get("phases", []):
            for emit in phase.get("emits", []) or []:
                if emit.get("type") == "list" and emit.get("of") is None:
                    errors.append(
                        f"signal {phase['id']}.{emit.get('name', '?')}: type 'list' "
                        f"requires an explicit 'of' element type in a js target")
```

(Insert after `errors = []` is initialized — check the exact ordering in the function and place it once `errors` and `signals` both exist.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "list_without_of" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(signals): js target requires explicit list 'of' element type"
```

---

### Task 5: Warnings — list-without-`of`, homonym-divergent vocabularies

Two non-blocking warnings (spec §4), surfaced through `_validate_one`'s warnings channel: a `list` with no `of` (assumed `string`), and two actions emitting a same-named signal with divergent `values`/`of`.

**Files:**
- Modify: `src/scripts/bb-workflow` — add `check_signal_payload_warnings`, wire into `_validate_one` (~L2939).
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `check_signal_payload_warnings(workflow: dict) -> list[str]` — warning strings, appended to `warnings` in `_validate_one`.

- [ ] **Step 1: Write the failing tests**

```python
def test_list_without_of_warns(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "hits", "type": "list", "source": "field", "from": "t1.json"}])
    warns = bbw_module.check_signal_payload_warnings(wf)
    assert any("hits" in w and "of" in w and "string" in w for w in warns)

def test_homonym_divergent_values_warns(bbw_module):
    wf = _wf([{"ref": "A"}, {"ref": "B"}],
             phases=[{"id": "A", "name": "a", "group": "g",
                      "emits": [{"name": "verdict", "type": "enum", "source": "token",
                                 "values": ["ok", "bad"]}]},
                     {"id": "B", "name": "b", "group": "g",
                      "emits": [{"name": "verdict", "type": "enum", "source": "token",
                                 "values": ["ok", "worse"]}]}])
    warns = bbw_module.check_signal_payload_warnings(wf)
    assert any("verdict" in w and "diverg" in w.lower() for w in warns)

def test_homonym_same_values_no_warn(bbw_module):
    wf = _wf([{"ref": "A"}, {"ref": "B"}],
             phases=[{"id": "A", "name": "a", "group": "g",
                      "emits": [{"name": "verdict", "type": "enum", "source": "token",
                                 "values": ["ok", "bad"]}]},
                     {"id": "B", "name": "b", "group": "g",
                      "emits": [{"name": "verdict", "type": "enum", "source": "token",
                                 "values": ["ok", "bad"]}]}])
    assert not any("diverg" in w.lower() for w in bbw_module.check_signal_payload_warnings(wf))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "without_of_warns or homonym" -v`
Expected: FAIL with `AttributeError: ... has no attribute 'check_signal_payload_warnings'`.

- [ ] **Step 3: Implement the warnings function and wire it in**

Add near the other `check_*_warnings` functions in `src/scripts/bb-workflow`:

```python
def check_signal_payload_warnings(workflow: dict) -> list:
    """Non-blocking payload-typing warnings: a list signal with no `of` (assumed
    string), and same-named signals across actions with divergent value/of specs."""
    warnings = []
    by_name = {}
    for phase in workflow.get("phases", []):
        for emit in phase.get("emits", []) or []:
            name = emit.get("name", "?")
            if emit.get("type") == "list" and emit.get("of") is None:
                warnings.append(
                    f"signal {phase['id']}.{name}: type 'list' has no 'of' — assuming "
                    f"'of: string' (declare it to fix the element contract)")
            spec = (emit.get("type"), _freeze(emit.get("values")), _freeze(emit.get("of")))
            by_name.setdefault(name, set()).add(spec)
    for name, specs in by_name.items():
        if len(specs) > 1:
            warnings.append(
                f"signal '{name}' is emitted by several actions with divergent "
                f"type/values/of specs — the vocabulary should match")
    return warnings


def _freeze(v):
    """Hashable snapshot of a values list / of map for divergence comparison."""
    if isinstance(v, list):
        return tuple(v)
    if isinstance(v, dict):
        return tuple(sorted((k, _freeze(x)) for k, x in v.items()))
    return v
```

Wire into `_validate_one` (~L2939), appending to the existing `warnings`:

```python
    warnings += check_effort_warnings(workflow)
    warnings += check_signal_payload_warnings(workflow)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "without_of_warns or homonym" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(signals): warnings for list-without-of and divergent homonym payloads"
```

---

### Task 6: Render the vocabulary into emission instructions

Make `_value_spec` render the enum vocabulary (`<ok|degraded|failed>` instead of `<one of the allowed values>`), and make `render_signal_emission` describe a list's element contract (spec §5). These lines are what the subagent receives at call time.

**Files:**
- Modify: `src/scripts/bb-workflow` — `_value_spec` (~L870), `render_signal_emission` (~L879), add helper `_of_spec`.
- Test: `src/scripts/tests/test_workflow_orchestration.py` (or `test_workflow_generate.py` — use whichever already imports `bbw_module`; these unit-test the functions directly).

**Interfaces:**
- Consumes: `_value_spec(emit) -> str`, `render_signal_emission(phase, emit) -> str` (existing).
- Produces: `_of_spec(emit) -> str` — human-readable element contract for a list emit.

- [ ] **Step 1: Write the failing tests**

```python
def test_value_spec_renders_enum_vocabulary(bbw_module):
    emit = {"name": "status", "type": "enum", "source": "token",
            "values": ["ok", "degraded", "failed"]}
    assert bbw_module._value_spec(emit) == "<ok|degraded|failed>"

def test_emission_line_lists_enum_values(bbw_module):
    phase = {"id": "SCAN", "type": "agent"}
    emit = {"name": "status", "type": "enum", "source": "token",
            "values": ["ok", "failed"]}
    line = bbw_module.render_signal_emission(phase, emit)
    assert "ok|failed" in line

def test_emission_line_describes_scalar_list(bbw_module):
    phase = {"id": "SCAN", "type": "agent"}
    emit = {"name": "hits", "type": "list", "source": "field",
            "from": "report.hits", "of": "string"}
    line = bbw_module.render_signal_emission(phase, emit)
    assert "array" in line.lower() and "string" in line

def test_emission_line_describes_object_list(bbw_module):
    phase = {"id": "SCAN", "type": "agent"}
    emit = {"name": "findings", "type": "list", "source": "field", "from": "report.findings",
            "of": {"path": "string", "severity": {"enum": ["low", "high"]}}}
    line = bbw_module.render_signal_emission(phase, emit)
    assert "path" in line and "severity" in line and "low|high" in line
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "value_spec_renders or emission_line" -v`
Expected: FAIL.

- [ ] **Step 3: Render the vocabulary and element contract**

Replace `_value_spec` (~L870) with:

```python
def _value_spec(emit):
    t = emit.get("type")
    if t == "bool":
        return "<true|false>"
    if t == "enum":
        vals = emit.get("values")
        if vals:
            return "<" + "|".join(vals) + ">"
        return "<one of the allowed values>"
    return f"<{t}>"
```

Add a helper just above `render_signal_emission`:

```python
def _of_spec(emit):
    """Human-readable element contract for a list emit's `of` (default: string)."""
    of = emit.get("of") or "string"
    if isinstance(of, str):
        if of == "enum":
            vals = emit.get("values")
            return "one of " + "|".join(vals) if vals else "an enum value"
        return of
    # flat object map
    parts = []
    for field, spec in of.items():
        if isinstance(spec, dict) and "enum" in spec:
            parts.append(f"{field}: {'|'.join(spec['enum'])}")
        else:
            parts.append(f"{field}: {spec}")
    return "objects {" + ", ".join(parts) + "}"
```

In `render_signal_emission`, upgrade the `field` branches that currently say only "json output MUST contain a field". For the `agent`/`field` case (and mirror it for `main_agent`/`field` and `script`/`field`), when the type is a list, append the element contract. Concretely, change the agent field line (~L891) from:

```python
        if src == "field":
            return f"- **Emit signal `{key}`**: your `{role}` json output MUST contain a field `{name}` of type `{emit.get('type')}`."
```

to:

```python
        if src == "field":
            base = f"- **Emit signal `{key}`**: your `{role}` json output MUST contain a field `{name}` of type `{emit.get('type')}`"
            if emit.get("type") == "list":
                return base + f" — a json array of {_of_spec(emit)}."
            return base + "."
```

Apply the same `if emit.get("type") == "list": ... + f" — a json array of {_of_spec(emit)}."` suffix to the `script`/`field` and `main_agent`/`field` return lines so every field-sourced list carries its element contract. (The enum vocabulary in the `token` lines is already handled by `_value_spec`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "value_spec_renders or emission_line" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(signals): render enum vocabulary + list element contract in emission lines"
```

---

### Task 7: Inject the item shape into the `for_each` body instruction

When a `for_each` iterates a typed list, the body's rendered instruction states the item shape (spec §5) so the consuming action is no longer blind to `as`.

**Files:**
- Modify: `src/scripts/bb-workflow` — `_render_blocks` `for_each` branch (~L2104). It needs `signals`; thread `collect_signals` into the render path.
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `_of_spec` (Task 6), `collect_signals` (existing), `_render_blocks` (existing, currently `(blocks, depth=0)`).
- Produces: `_render_blocks(blocks, depth=0, signals=None)` — new optional `signals` param; the top-level caller passes the workflow's signals.

- [ ] **Step 1: Write the failing test**

```python
def test_for_each_body_states_item_shape(bbw_module):
    wf = _wf([{"for_each": "t1.findings", "as": "f", "cap": 5, "body": [{"ref": "T1"}]}],
             emits=[{"name": "findings", "type": "list", "source": "field", "from": "t1.json",
                     "of": {"path": "string", "severity": {"enum": ["low", "high"]}}}])
    text = bbw_module.render_orchestration_text(wf)   # see Step 3 for the exact entry point
    assert "each `f`" in text
    assert "path" in text and "severity" in text
```

Note: confirm the public entry point that renders the orchestration block text. `_render_blocks` is called at ~L2149 by the orchestration-section renderer; use that function's name in the test (grep `_render_blocks(workflow\["orchestration"\]` and use its enclosing `def`). If it is not a top-level function, add a tiny testable wrapper `render_orchestration_text(workflow)` that calls `collect_signals` + `_render_blocks` and returns `"\n".join(lines)`, and assert on it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "for_each_body_states" -v`
Expected: FAIL.

- [ ] **Step 3: Thread signals and render the item shape**

Change `_render_blocks` signature to `def _render_blocks(blocks, depth=0, signals=None):`, pass `signals` through every recursive call (`_render_blocks(b.get("then"), depth + 1, signals)`, etc.), and in the `for_each` branch append the item shape when the collection is a typed list:

```python
        elif "for_each" in b:
            var = b.get("as", "item")
            gid = f" [{b['id']}]" if b.get("id") else ""
            out_note = (f" Aggregated output → `{b['output']['role']}`."
                        if b.get("output") else "")
            shape_note = ""
            sig = (signals or {}).get(b["for_each"])
            if sig and sig.get("type") == "list" and sig.get("of") is not None:
                shape_note = f" Each `{var}` is {_of_spec({'type': 'list', 'of': sig['of'], 'values': sig.get('values')})}."
            lines.append(f"{pad}- **For each**{gid} `{var}` in signal `{b['for_each']}` "
                         f"(cap {b.get('cap')}): run the body once per `{var}`; independent "
                         f"iterations launch together in one message.{shape_note}{out_note}")
            lines += _render_blocks(b.get("body"), depth + 1, signals)
```

At the top-level caller (~L2149, `out += _render_blocks(workflow["orchestration"])`), pass signals:

```python
    out += _render_blocks(workflow["orchestration"], signals=collect_signals(workflow))
```

If you added a `render_orchestration_text` wrapper for the test, have it do exactly this and return the joined lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "for_each_body_states" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(signals): state list item shape in the for_each body instruction"
```

---

### Task 8: Update the fixture and green the whole Python suite

Enum-strict now makes the existing fixture's `status` enum (no `values`) a blocking error. Fix the fixture and confirm the entire compiler suite + `awok validate`/`generate`/`check` are green (spec §8).

**Files:**
- Modify: `src/scripts/tests/fixtures/workflows/orchestrated.yaml` (~L5-6).
- Test: the whole `src/scripts/tests/test_workflow_*.py` suite + a CLI smoke run.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Update the fixture**

In `src/scripts/tests/fixtures/workflows/orchestrated.yaml`, give the enum its vocabulary and the list its element type:

```yaml
  - {id: RECON, name: recon, group: g, emits: [{name: endpoints, type: list, source: field, from: recon.json, of: string}]}
  - {id: SCAN, name: scan, group: g, emits: [{name: status, type: enum, source: token, values: [open, vuln, clean]}, {name: risk, type: number, source: token}]}
```

If any existing test in `test_workflow_orchestration.py`/`test_workflow_cartography.py` asserts on `status` values or the `endpoints` line, update those assertions to match (grep `status` and `endpoints` in the test dir first).

- [ ] **Step 2: Run the full compiler suite**

Run: `pytest src/scripts/tests/test_workflow_*.py -q`
Expected: PASS (0 failures). Fix any assertion that referenced the old untyped fixture.

- [ ] **Step 3: CLI smoke test**

Run:
```bash
awok validate --workflow src/scripts/tests/fixtures/workflows/orchestrated.yaml
awok validate    # all real workflows still valid
awok check       # no drift in generated SKILL.md (enum-strict touches no real workflow)
```
Expected: fixture valid; all real workflows valid; `awok check` reports no drift (the four shipped workflows use no enum/list emits, per spec §8).

- [ ] **Step 4: Commit**

```bash
git add src/scripts/tests/fixtures/workflows/orchestrated.yaml
git commit -m "test(signals): give the orchestrated fixture typed enum/list payloads"
```

---

### Task 9: Web editor — list `of` element-type input

Grow `signalsEditor` so a `list` signal gets an item-type dropdown, and an `object` item type gets a flat field repeater (spec §7). The enum `values` chips already exist; reuse `stringListEditor` for values and for per-field enums.

**Files:**
- Modify: `src/workflow/templates/webedit/formfields.js` — `signalsEditor` (~L280, the enum sub-row block).
- Test: `src/scripts/tests/webedit/formfields.test.js`

**Interfaces:**
- Consumes: `stringListEditor(label, items, onChange)` (existing), `signalsEditor(label, items, phase, onChange)` (existing).
- Produces: on the emit `item`, an `of` field mirroring the YAML shape — a scalar string, or a plain object `{field: "string"|"number"|"bool" | {enum: [...]}}`.

- [ ] **Step 1: Write the failing bun tests**

Append to `src/scripts/tests/webedit/formfields.test.js` (follow the file's existing `dom()`/`ev()` harness and the `import { ... signalsEditor }` line — add `signalsEditor` to the import if absent):

```javascript
test("signalsEditor shows an item-type dropdown for a list signal", () => {
  dom();
  let model = [{ name: "hits", type: "list", source: "field", of: "string" }];
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  const r = signalsEditor("emits", model, phase, v => { model = v; });
  const ofSel = r.querySelector("select.signal-of");
  expect(ofSel).not.toBeNull();
  expect(ofSel.value).toBe("string");
});

test("signalsEditor emits of=object with a flat field", () => {
  dom();
  let model = [{ name: "f", type: "list", source: "field", of: { path: "string" } }];
  const phase = { id: "T1", type: "agent", outputs: [{ role: "work:t1", kind: "json" }] };
  const r = signalsEditor("emits", model, phase, v => { model = v; });
  // the object field row exposes a field-name input pre-filled with "path"
  const fieldName = [...r.querySelectorAll("input")].find(i => i.value === "path");
  expect(fieldName).not.toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/scripts/tests/webedit && bun test formfields.test.js`
Expected: FAIL (`select.signal-of` is null — no `of` UI yet).

- [ ] **Step 3: Add the `of` editor to `signalsEditor`**

In `formfields.js`, right after the existing enum `values` sub-row (~L280-288, the `if ((item.type || "string") === "enum")` block), add a list-`of` sub-row:

```javascript
      if ((item.type || "string") === "list") {
        const sub = document.createElement("div"); sub.className = "signal-subrow";
        const ofSel = document.createElement("select"); ofSel.className = "signal-of";
        const ofOpts = ["string", "number", "bool", "enum", "object"];
        const curOf = (item.of && typeof item.of === "object") ? "object"
                    : (typeof item.of === "string" ? item.of : "string");
        for (const o of ofOpts) { const opt = document.createElement("option"); opt.value = o; opt.textContent = o; if (o === curOf) opt.selected = true; ofSel.appendChild(opt); }
        ofSel.addEventListener("change", () => {
          const v = ofSel.value;
          if (v === "object") item.of = (item.of && typeof item.of === "object") ? item.of : {};
          else { item.of = v; if (v !== "enum") delete item.values; }
          emit(); render();
        });
        sub.appendChild(ofSel);
        body.appendChild(sub);

        if (curOf === "enum") {
          const vrow = document.createElement("div"); vrow.className = "signal-subrow";
          vrow.appendChild(stringListEditor("values", item.values, (vals) => {
            if (vals.length) item.values = vals; else delete item.values; emit();
          }));
          body.appendChild(vrow);
        }
        if (curOf === "object") {
          const orow = document.createElement("div"); orow.className = "signal-subrow signal-of-object";
          const obj = item.of;
          Object.keys(obj).forEach((field) => {
            const fr = document.createElement("div"); fr.className = "of-field-row";
            const fname = document.createElement("input"); fname.type = "text"; fname.value = field; fname.className = "of-field-name";
            fname.addEventListener("change", () => {
              const nv = fname.value.trim();
              if (nv && nv !== field) { obj[nv] = obj[field]; delete obj[field]; }
              emit(); render();
            });
            const ftype = document.createElement("select"); ftype.className = "of-field-type";
            const cur = (obj[field] && typeof obj[field] === "object") ? "enum" : obj[field];
            for (const t of ["string", "number", "bool", "enum"]) { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === cur) o.selected = true; ftype.appendChild(o); }
            ftype.addEventListener("change", () => {
              obj[field] = ftype.value === "enum" ? { enum: (obj[field] && obj[field].enum) || [] } : ftype.value;
              emit(); render();
            });
            const del = document.createElement("button"); del.className = "of-field-del"; del.textContent = "✕";
            del.addEventListener("click", () => { delete obj[field]; render(); emit(); });
            fr.appendChild(fname); fr.appendChild(ftype); fr.appendChild(del);
            orow.appendChild(fr);
            if (obj[field] && typeof obj[field] === "object") {
              orow.appendChild(stringListEditor("values", obj[field].enum, (vals) => {
                obj[field] = { enum: vals }; emit();
              }));
            }
          });
          const addF = document.createElement("button"); addF.className = "of-field-add"; addF.textContent = "+ field";
          addF.addEventListener("click", () => { obj["field" + (Object.keys(obj).length + 1)] = "string"; render(); emit(); });
          orow.appendChild(addF);
          body.appendChild(orow);
        }
      }
```

Also extend the `type` `change` handler (~L230) so leaving `list` clears `of` (mirroring the existing `if (item.type !== "enum") delete item.values;`):

```javascript
      type.addEventListener("change", () => {
        item.type = type.value;
        if (item.type !== "enum") delete item.values;
        if (item.type !== "list") delete item.of;
        emit(); render();
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/scripts/tests/webedit && bun test formfields.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full web-editor suite**

Run: `cd src/scripts/tests/webedit && bun test`
Expected: PASS (no regression in the other webedit specs).

- [ ] **Step 6: Commit**

```bash
git add src/workflow/templates/webedit/formfields.js src/scripts/tests/webedit/formfields.test.js
git commit -m "feat(webedit): list 'of' element-type editor (scalar, enum, flat object)"
```

---

### Task 10: Final integration pass + TODO/spec bookkeeping

Confirm the whole feature holds together and record completion.

**Files:**
- Modify: `TODO.md` (S-section / S4 note), `docs/superpowers/specs/2026-07-16-typed-signal-payloads-design.md` (§10 status).

- [ ] **Step 1: Full green run**

Run:
```bash
pytest src/scripts/tests/test_workflow_*.py -q
cd src/scripts/tests/webedit && bun test && cd -
awok validate && awok check
```
Expected: all green, no drift.

- [ ] **Step 2: Update the design doc §10 status**

In `docs/superpowers/specs/2026-07-16-typed-signal-payloads-design.md`, change the "Reste à faire" bullet in §10 to note the delta is now implemented (enum-strict landed, list `of` axis landed), leaving only the dynamic-target consumption (S4/B1) as future work.

- [ ] **Step 3: Update TODO.md**

In `TODO.md`, under the S-section note tied to S4, mark that typed signal payloads (enum `values` + list `of`) are implemented on `feat/conditions-and-or-not`, so S4's remaining scope is the `emits` → JSON Schema derivation itself (the mapping table is frozen in the design §6).

- [ ] **Step 4: Commit**

```bash
git add TODO.md docs/superpowers/specs/2026-07-16-typed-signal-payloads-design.md
git commit -m "docs(signals): mark typed signal payloads implemented; S4 scope narrowed"
```

---

## Self-Review Notes

- **Spec coverage:** §3 schema → Tasks 1-2; §4 validation (enum-strict, values form, of form, condition enum/contains, object-list guard, js-required-of, warnings) → Tasks 1-5; §5 standard rendering (emitter + for_each consumer) → Tasks 6-7; §6 JS mapping → frozen in spec, not implemented here (correct — S4/B1); §7 web UI → Task 9; §8 migration/fixture → Task 8; §9 tests → each task is TDD; §10 status → Task 10.
- **Concurrent-work reconciliation:** Task 1 explicitly repurposes `test_enum_values_optional` and does not re-add the `values` schema field / `collect_signals` carry / `==`,`!=` check that `b58f5a5` already shipped — Task 3 *generalizes* that check rather than duplicating it.
- **Type consistency:** `_check_values_form`(Task 1) reused by `_check_of_form`(Task 2) and object-field enums; `_of_spec`(Task 6) reused by `_render_blocks`(Task 7); signal meta `of` key added in Task 2 and consumed by Tasks 3/6/7; `_render_blocks` gains `signals=None` in Task 7 with all call sites updated.
- **Verify-before-coding hooks:** Tasks 4, 7 flag exact grep/entry-point confirmations (js-check insertion point once `errors`+`signals` exist; the orchestration-text entry point) because line numbers may drift under concurrent edits.
