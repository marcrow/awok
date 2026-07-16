# Conditions `and` / `or` / `not` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add composable boolean connectors (`and` / `or` / `not`, nestable) to awok orchestration conditions — in the engine (validation, rendering, schema, capabilities) and in the web editor's inline condition builder.

**Architecture:** A condition becomes a recursive tree: a leaf (`{op,left,right}` or an escape-hatch string), a group (`{and:[…]}` / `{or:[…]}`), or a negation (`{not:…}`). The Python engine is purely recursive and imposes **no depth limit**. The web editor works **directly on this canonical on-disk shape** (no conversion layer), addressing nested nodes by path, and caps *authoring* of new sub-groups at 2 levels. Signal selection is unchanged (select-only over declared signals).

**Tech Stack:** Python 3 stdlib + PyYAML + jsonschema (engine, `src/scripts/bb-workflow`); Jinja2 templates; ES-module vanilla-DOM web editor (`src/workflow/templates/webedit/`); tests via `pytest` (engine) and `bun:test` + `linkedom` (editor logic).

## Global Constraints

- **Never edit a `SKILL.md` by hand** — it is generated. Regenerate with `awok generate`.
- **Engine/template change ripples to every workflow**: after touching `bb-workflow` or a template, run `awok generate` (all), commit the regenerated `src/skills/*/SKILL.md` + `docs/architecture-cartography/*` in the same change, `awok check` must be green, then `./install.sh`. The commit that changes generated output carries a `Regen:` trailer.
- **Canonical on-disk condition shape** (source of truth): `string` (escape-hatch) | `{op,left,right?}` (leaf) | `{and:[cond,…]}` | `{or:[cond,…]}` | `{not:cond}`.
- **`orchestration-capabilities.yaml` is the single source of truth** for the js-safe/standard frontier — no operator/connector matrix is hardcoded elsewhere.
- **Signal selection unchanged**: an operand of kind signal is chosen from the `<select>` of declared signals (per emitter); do not rebuild it.
- **No JS runtime work**: the `target: js` compiler does not exist yet (deferred TODO B1). Connectors are marked `js_safe: true` for the future only.
- Reference visual (in-repo, source of truth for editor styles/interactions): `docs/superpowers/specs/2026-07-16-conditions-and-or-not-refs/condition-builder-prototype.dc.html` and its `visual-mini-spec.md`.
- Design: `docs/superpowers/specs/2026-07-16-conditions-and-or-not-design.md`.

## File Structure

- `src/workflow/orchestration-capabilities.yaml` — add a `connectors` section.
- `src/workflow/orchestration.schema.json` — make `condition` a recursive `oneOf`.
- `src/scripts/bb-workflow` — recursion in `_validate_condition` (connector dispatch + leaf-completeness) and `_render_condition` (parenthesized composite text).
- `src/scripts/tests/test_workflow_capabilities.py`, `test_workflow_orchestration.py` — engine tests.
- `src/scripts/tests/fixtures/workflows/orchestrated.orchestration.yaml` — a composite example.
- `src/workflow/templates/webedit/editlogic.js` — pure, tested helpers: condition-shape predicates, recursive signal collection, path-addressed tree mutations.
- `src/scripts/tests/webedit/condition.test.js` — `bun:test` for the pure helpers.
- `src/workflow/templates/webedit/orchestration.js` — recursive read view (grid vignette) and edit view (inline builder); gate-placement recursion.
- Docs: `docs/dev/bb-workflow.md`, `CLAUDE.md` (orchestration section), the portes-logiques spec, capabilities header.

---

### Task 1: Capabilities — declare the `and` / `or` / `not` connectors

**Files:**
- Modify: `src/workflow/orchestration-capabilities.yaml`
- Test: `src/scripts/tests/test_workflow_capabilities.py`

**Interfaces:**
- Produces: `load_capabilities()["connectors"]` → `{ and: {...}, or: {...}, not: {...} }`, each `{js_safe: True, standard: True}`.

- [ ] **Step 1: Write the failing tests**

Add to `src/scripts/tests/test_workflow_capabilities.py`:

```python
def test_connectors_present_and_js_safe(bbw_module):
    caps = bbw_module.load_capabilities()
    assert set(caps["connectors"]) == {"and", "or", "not"}
    for c in ("and", "or", "not"):
        assert caps["connectors"][c]["js_safe"] is True
        assert caps["connectors"][c]["standard"] is True


def test_capabilities_shape_includes_connectors(bbw_module):
    caps = bbw_module.load_capabilities()
    assert set(caps) >= {"operators", "builtins", "operands", "connectors"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_capabilities.py -k connector -v`
Expected: FAIL with `KeyError: 'connectors'`.

- [ ] **Step 3: Add the `connectors` section**

In `src/workflow/orchestration-capabilities.yaml`, after the `operators:` block (before `builtins:`), add:

```yaml
# Boolean connectors compose sub-conditions (recursive). They take sub-conditions,
# not left/right operands, so they live in their own section (not `operators`).
connectors:
  and: { js_safe: true,  standard: true }
  or:  { js_safe: true,  standard: true }
  not: { js_safe: true,  standard: true }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_capabilities.py -v`
Expected: PASS (all, including the pre-existing shape test).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/orchestration-capabilities.yaml src/scripts/tests/test_workflow_capabilities.py
git commit -m "feat(orchestration): declare and/or/not connectors in capabilities"
```

---

### Task 2: Schema — recursive `condition` definition

**Files:**
- Modify: `src/workflow/orchestration.schema.json`
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Produces: `load_orchestration_schema()` validates leaf, escape-hatch, `{and:[…]}`, `{or:[…]}`, `{not:…}` recursively.

- [ ] **Step 1: Write the failing tests**

Add to `src/scripts/tests/test_workflow_orchestration.py`:

```python
def test_schema_accepts_and_or_not(bbw_module):
    import jsonschema
    schema = bbw_module.load_orchestration_schema()
    block = {"if": {"or": [
        {"and": [{"op": "==", "left": "recon.waf", "right": "true"},
                 {"op": ">", "left": "scan.risk", "right": "7"}]},
        {"not": {"and": [{"op": "==", "left": "scan.status", "right": "open"},
                         {"op": "exists", "left": {"file_exists": "/etc/passwd"}}]}},
    ]}, "then": [{"ref": "A"}]}
    jsonschema.validate([block], schema)  # must not raise


def test_schema_rejects_unknown_connector(bbw_module):
    import jsonschema, pytest
    schema = bbw_module.load_orchestration_schema()
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate([{"if": {"xor": [{"op": "exists", "left": "a.x"}]},
                              "then": [{"ref": "A"}]}], schema)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k schema_accepts_and_or_not -v`
Expected: FAIL (a group condition does not match the current leaf-or-string `oneOf`).

- [ ] **Step 3: Rewrite the `condition` definition**

Replace the `"condition"` definition (lines 7–20) in `src/workflow/orchestration.schema.json` with:

```json
    "condition": {
      "oneOf": [
        {
          "type": "object",
          "required": ["op", "left"],
          "properties": {
            "op": { "enum": ["==", "!=", "<", ">", "<=", ">=", "contains", "matches", "exists"] },
            "left": {},
            "right": {}
          }
        },
        { "type": "string", "description": "escape-hatch predicate (standard-only)" },
        {
          "type": "object",
          "required": ["and"],
          "properties": { "and": { "type": "array", "items": { "$ref": "#/definitions/condition" } } },
          "additionalProperties": false
        },
        {
          "type": "object",
          "required": ["or"],
          "properties": { "or": { "type": "array", "items": { "$ref": "#/definitions/condition" } } },
          "additionalProperties": false
        },
        {
          "type": "object",
          "required": ["not"],
          "properties": { "not": { "$ref": "#/definitions/condition" } },
          "additionalProperties": false
        }
      ]
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "schema_accepts_and_or_not or schema_rejects_unknown_connector" -v`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/orchestration.schema.json src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): recursive condition schema for and/or/not"
```

---

### Task 3: Validation — recursive `_validate_condition`

**Files:**
- Modify: `src/scripts/bb-workflow` (`_validate_condition`, currently around lines 1121–1164)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `caps["connectors"]` (Task 1), `caps["operators"]`, `caps["builtins"]`, `signals` (`collect_signals`).
- Produces: `_validate_condition(cond, signals, caps, target)` returns a list of error strings; recurses into `and`/`or`/`not`; emits leaf-completeness errors.

- [ ] **Step 1: Write the failing tests**

Add to `src/scripts/tests/test_workflow_orchestration.py`:

```python
def test_and_or_not_valid_condition(bbw_module):
    wf = _wf(
        [{"if": {"or": [
            {"and": [{"op": "==", "left": "t1.waf", "right": "true"},
                     {"op": ">", "left": "t1.risk", "right": 7}]},
            {"not": {"op": "==", "left": "t1.status", "right": "open"}},
        ]}, "then": [{"ref": "T1"}]}],
        emits=[{"name": "waf", "type": "bool", "source": "token"},
               {"name": "risk", "type": "number", "source": "token"},
               {"name": "status", "type": "string", "source": "token"}],
    )
    assert bbw_module.validate_orchestration(wf) == []


def test_nested_unknown_signal_is_caught(bbw_module):
    wf = _wf([{"if": {"and": [{"op": "==", "left": "t1.v", "right": "x"},
                              {"op": "==", "left": "ghost.v", "right": "y"}]},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("ghost.v" in e for e in errs)


def test_incomplete_leaf_missing_right_is_error(bbw_module):
    wf = _wf([{"if": {"op": "==", "left": "t1.v", "right": ""},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("incomplete" in e.lower() or "missing" in e.lower() for e in errs)


def test_builtin_missing_argument_is_error(bbw_module):
    wf = _wf([{"if": {"op": "exists", "left": {"file_exists": ""}},
               "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("argument" in e.lower() and "file_exists" in e for e in errs)


def test_group_with_single_member_warns_not_blocks(bbw_module):
    wf = _wf([{"if": {"and": [{"op": "==", "left": "t1.v", "right": "x"}]},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    # non-blocking: no ERROR, but a warning string is present
    assert any("at least 2" in e.lower() or "single member" in e.lower() for e in errs)
    assert all(e.lower().startswith("orchestration:") for e in errs)


def test_escape_hatch_inside_group_rejected_in_js(bbw_module):
    wf = _wf([{"if": {"or": [{"op": "exists", "left": "t1.v"},
                             "some free predicate"]},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "bool", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf, target="js")
    assert any("escape-hatch" in e.lower() for e in errs)
```

> Note on the single-member warning routing: `validate_orchestration`'s return list feeds **two paths** — it is **warning-only in the web-editor save path** (`save_workflow`, where a single-member group is a transient authoring state) and **blocking in `awok validate`/`generate`** (via `validate_coherence`, where a committed malformed group should fail). The single-member message rides this channel deliberately: it never blocks live editing, but a committed `{and:[X]}` fails CLI validation — which satisfies the design's "non-blocking during authoring" intent. This test calls `_validate_condition`/`validate_orchestration` directly and only asserts the message is emitted; it does not assert CLI blocking behaviour.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "and_or_not_valid or nested_unknown_signal or incomplete_leaf or builtin_missing_argument or single_member or escape_hatch_inside_group" -v`
Expected: FAIL (current `_validate_condition` reads `op` and returns "unknown operator" for a group dict).

- [ ] **Step 3: Rewrite `_validate_condition` to recurse**

Replace the body of `_validate_condition` in `src/scripts/bb-workflow` with:

```python
def _validate_condition(cond, signals, caps, target):
    errors = []
    # escape-hatch (string predicate)
    if isinstance(cond, str):
        if target == "js":
            errors.append("orchestration: escape-hatch predicate is standard-only (not js-safe)")
        return errors
    if not isinstance(cond, dict):
        return errors

    # --- boolean connectors: and / or / not (recursive) ---
    conn = next((k for k in ("and", "or", "not") if k in cond), None)
    if conn is not None:
        cmeta = caps.get("connectors", {}).get(conn)
        if cmeta is None:
            errors.append(f"orchestration: unknown connector '{conn}'")
            return errors
        if target == "js" and not cmeta.get("js_safe", False):
            errors.append(f"orchestration: connector '{conn}' is standard-only in a js target")
        if conn == "not":
            inner = cond["not"]
            if isinstance(inner, list):
                errors.append("orchestration: 'not' takes a single condition, not a list")
            else:
                errors.extend(_validate_condition(inner, signals, caps, target))
        else:
            members = cond[conn]
            if not isinstance(members, list):
                errors.append(f"orchestration: '{conn}' must be a list of conditions")
            else:
                if len(members) < 2:
                    errors.append(
                        f"orchestration: group '{conn}' should have at least 2 members "
                        f"(has {len(members)})")
                for m in members:
                    errors.extend(_validate_condition(m, signals, caps, target))
        return errors

    # --- leaf comparison ---
    op = cond.get("op")
    op_meta = caps["operators"].get(op)
    if op_meta is None:
        errors.append(f"orchestration: unknown operator '{op}'")
        return errors
    if target == "js" and not op_meta.get("js_safe", False):
        errors.append(f"orchestration: operator '{op}' is standard-only in a js target")

    left, right = cond.get("left"), cond.get("right")

    # leaf completeness (mini-spec §7)
    def _empty(v):
        return v is None or (isinstance(v, str) and v.strip() == "")
    if _empty(left):
        errors.append("orchestration: incomplete comparison — missing left operand")
    if op != "exists" and _empty(right):
        errors.append("orchestration: incomplete comparison — missing right operand")

    # builtin operand (file_exists/dir_exists) js-safety + argument presence
    for operand in (left, right):
        if isinstance(operand, dict):
            for bname, barg in operand.items():
                bmeta = caps["builtins"].get(bname)
                if bmeta is None:
                    errors.append(f"orchestration: unknown builtin '{bname}'")
                    continue
                if target == "js" and not bmeta.get("js_safe", False):
                    errors.append(f"orchestration: builtin '{bname}' is standard-only in a js target")
                if _empty(barg):
                    errors.append(f"orchestration: builtin '{bname}' is missing its argument")

    # signal existence: a dotted string operand that looks like a ref must resolve
    for operand in (left, right):
        if isinstance(operand, str) and "." in operand and _SIGNAL_PREFIX_RE.match(operand.split(".")[0]):
            if operand not in signals and not _looks_like_literal(operand):
                errors.append(f"orchestration: condition references unknown signal '{operand}'")

    # operator/type compatibility
    if op in _NUMERIC_OPS:
        for operand in (left, right):
            t = _operand_type(operand, signals)
            if t is not None and t not in ("number", "builtin"):
                errors.append(f"orchestration: operator '{op}' needs number operands, got '{operand}' (type {t})")
    return errors
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -v`
Expected: PASS (new tests + all pre-existing condition tests, including `test_condition_references_unknown_signal`, `test_numeric_operator_on_string_signal`, `test_file_exists_rejected_in_js_target`, `test_escape_hatch_ok_in_standard`).

> If `test_escape_hatch_ok_in_standard` (a bare-string root condition) now trips the new completeness check, confirm the string branch returns early *before* the leaf path — it does in the code above.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): recursive condition validation + leaf completeness"
```

---

### Task 4: Rendering — recursive `_render_condition`

**Files:**
- Modify: `src/scripts/bb-workflow` (`_render_condition`, currently around lines 1999–2010)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `_render_condition(cond)` returns markdown text; groups joined by ` and `/` or `, sub-groups parenthesized, `not (…)`, builtin leaf as `file_exists("arg")`.

- [ ] **Step 1: Write the failing tests**

Add to `src/scripts/tests/test_workflow_orchestration.py`:

```python
def test_render_condition_composite(bbw_module):
    cond = {"or": [
        {"and": [{"op": "==", "left": "recon.waf", "right": "true"},
                 {"op": ">", "left": "scan.risk", "right": 7}]},
        {"not": {"and": [{"op": "==", "left": "scan.status", "right": "open"},
                         {"op": "exists", "left": {"file_exists": "/etc/passwd"}}]}},
    ]}
    r = bbw_module._render_condition(cond)
    assert "and" in r and "or" in r and "not (" in r
    assert 'file_exists("/etc/passwd")' in r
    assert "exists`" not in r          # builtin leaf renders without the redundant `exists` keyword
    # the two AND groups are parenthesized inside the OR
    assert r.count("(") >= 2 and r.count(")") >= 2


def test_render_condition_not_leaf(bbw_module):
    r = bbw_module._render_condition({"not": {"op": "==", "left": "a.x", "right": "1"}})
    assert r.startswith("not (") and r.rstrip().endswith(")")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "render_condition_composite or render_condition_not_leaf" -v`
Expected: FAIL (current `_render_condition` reads `cond.get("op")` → renders `None`).

- [ ] **Step 3: Rewrite `_render_condition` to recurse**

Replace `_render_condition` in `src/scripts/bb-workflow` with:

```python
def _render_condition(cond):
    if isinstance(cond, str):
        return f"_{cond}_"  # escape-hatch: natural-language predicate
    if not isinstance(cond, dict):
        return str(cond)

    # boolean connectors
    for conn, word in (("and", "and"), ("or", "or")):
        if conn in cond:
            parts = [_render_condition_member(m) for m in cond[conn]]
            return f" {word} ".join(parts)
    if "not" in cond:
        return f"not ({_render_condition(cond['not'])})"

    # leaf
    op, left, right = cond.get("op"), cond.get("left"), cond.get("right")
    if isinstance(left, dict):
        # builtin operand: autonomous predicate, e.g. file_exists("/etc/passwd")
        return " ".join(f'{k}("{v}")' for k, v in left.items())
    left = _fmt_operand(left)
    right = _fmt_operand(right)
    if op == "exists":
        return f"`{left}` exists"
    return f"`{left}` {op} `{right}`"


def _render_condition_member(m):
    """A group/negation member is parenthesized so precedence reads correctly;
    a bare leaf is rendered inline."""
    if isinstance(m, dict) and ("and" in m or "or" in m):
        return f"({_render_condition(m)})"
    return _render_condition(m)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "render" -v`
Expected: PASS (new tests + `test_render_condition_renders_bool_literal_lowercase`).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): recursive condition rendering (parenthesized and/or/not)"
```

---

### Task 5: Fixture + cartography overlay coverage

**Files:**
- Modify: `src/scripts/tests/fixtures/workflows/orchestrated.orchestration.yaml`
- Modify: `src/scripts/tests/fixtures/workflows/orchestrated.yaml` (only if a new signal must be declared)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Consumes: `render_orchestration`, `build_orchestration_overlay`, `validate_orchestration`.

- [ ] **Step 1: Inspect the fixture pair**

Run: `sed -n '1,60p' src/scripts/tests/fixtures/workflows/orchestrated.orchestration.yaml && echo --- && grep -n "emits" src/scripts/tests/fixtures/workflows/orchestrated.yaml`
Expected: see the existing `if: {op: "==", left: scan.status, right: vuln}` block and which signals (`scan.status`, `scan.risk`, …) are already emitted.

- [ ] **Step 2: Write the failing test**

Add to `src/scripts/tests/test_workflow_orchestration.py`:

```python
def test_fixture_composite_condition_renders(bbw_module):
    wf = bbw_module.load_workflow(FIX / "orchestrated.yaml")
    assert bbw_module.validate_orchestration(wf) == []
    protocol = bbw_module.render_orchestration(wf)
    assert " and " in protocol or " or " in protocol
    overlay = bbw_module.build_orchestration_overlay(wf)
    assert overlay  # branch labels built without error
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k fixture_composite -v`
Expected: FAIL (no `and`/`or` in the current fixture protocol).

- [ ] **Step 4: Add a composite condition to the fixture**

Change the `if` block in `orchestrated.orchestration.yaml` to a composite that only uses already-declared signals (adjust operands to real emitted signals discovered in Step 1). Example, if `scan.status` and `scan.risk` are emitted:

```yaml
    - if:
        and:
          - { op: "==", left: scan.status, right: vuln }
          - { op: ">",  left: scan.risk,   right: 5 }
      then: [{ref: EXPLOIT}]
```

If you introduce a signal not yet emitted, add its `emits:` entry to the producing phase in `orchestrated.yaml` (mirror the existing `emits` shape).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k "fixture" -v`
Expected: PASS (`test_fixture_validates_and_renders` still green + new composite test).

- [ ] **Step 6: Commit**

```bash
git add src/scripts/tests/fixtures/workflows/orchestrated.orchestration.yaml src/scripts/tests/fixtures/workflows/orchestrated.yaml src/scripts/tests/test_workflow_orchestration.py
git commit -m "test(orchestration): composite and/or condition in the orchestrated fixture"
```

---

### Task 6: Editor logic — condition-shape helpers, recursive signal collection, path-addressed mutations

**Files:**
- Modify: `src/workflow/templates/webedit/editlogic.js`
- Test: `src/scripts/tests/webedit/condition.test.js` (create)

**Interfaces:**
- Produces (all pure, exported from `editlogic.js`):
  - `condKind(c)` → `"escape" | "leaf" | "and" | "or" | "not" | "empty"`.
  - `isGroupCond(c)` → bool (`and`/`or`).
  - `conditionSignalKeys(c)` → `string[]` (every operand string in the tree).
  - `getCondAt(root, path)` / `setCondAt(root, path, value)` — path get/set (path is an array of keys/indices).
  - `toggleNotAt(root, path)` — wrap/unwrap `{not:…}` at path; returns new root.
  - `toggleConnectorAt(root, path)` — swap `and`↔`or` on the group at path.
  - `addComparisonAt(root, groupPath, leaf)` / `addSubgroupAt(root, groupPath, subgroup)` / `removeCondAt(root, path)`.
- Consumed by: `orchestration.js` (Tasks 7–9).

- [ ] **Step 1: Write the failing tests**

Create `src/scripts/tests/webedit/condition.test.js`:

```javascript
import { test, expect } from "bun:test";
import {
  condKind, isGroupCond, conditionSignalKeys,
  getCondAt, setCondAt, toggleNotAt, toggleConnectorAt,
  addComparisonAt, addSubgroupAt, removeCondAt,
} from "../../../workflow/templates/webedit/editlogic.js";

const SAMPLE = { or: [
  { and: [ { op: "==", left: "recon.waf", right: "true" },
           { op: ">",  left: "scan.risk", right: "7" } ] },
  { not: { and: [ { op: "==", left: "scan.status", right: "open" },
                  { op: "exists", left: { file_exists: "/etc/passwd" } } ] } },
] };

test("condKind classifies each node", () => {
  expect(condKind(SAMPLE)).toBe("or");
  expect(condKind(SAMPLE.or[0])).toBe("and");
  expect(condKind(SAMPLE.or[1])).toBe("not");
  expect(condKind(SAMPLE.or[0].and[0])).toBe("leaf");
  expect(condKind("free text")).toBe("escape");
  expect(isGroupCond(SAMPLE)).toBe(true);
  expect(isGroupCond(SAMPLE.or[0].and[0])).toBe(false);
});

test("conditionSignalKeys collects every operand string across the tree", () => {
  const keys = conditionSignalKeys(SAMPLE);
  expect(keys).toContain("recon.waf");
  expect(keys).toContain("scan.risk");
  expect(keys).toContain("scan.status");
  // builtin operand (object) is NOT a string key
  expect(keys.every(k => typeof k === "string")).toBe(true);
});

test("getCondAt / setCondAt address nested nodes by path", () => {
  expect(getCondAt(SAMPLE, ["or", 0, "and", 1, "op"])).toBe(">");
  const next = setCondAt(SAMPLE, ["or", 0, "and", 1, "op"], "<=");
  expect(getCondAt(next, ["or", 0, "and", 1, "op"])).toBe("<=");
  expect(getCondAt(SAMPLE, ["or", 0, "and", 1, "op"])).toBe(">"); // input not mutated
});

test("toggleNotAt wraps a bare node and unwraps a not node", () => {
  const wrapped = toggleNotAt(SAMPLE, ["or", 0]);          // wrap the first AND group
  expect(condKind(getCondAt(wrapped, ["or", 0]))).toBe("not");
  const unwrapped = toggleNotAt(wrapped, ["or", 0]);       // toggle back
  expect(condKind(getCondAt(unwrapped, ["or", 0]))).toBe("and");
});

test("toggleConnectorAt swaps and<->or preserving members", () => {
  const next = toggleConnectorAt(SAMPLE, ["or", 0]);
  const g = getCondAt(next, ["or", 0]);
  expect(condKind(g)).toBe("or");
  expect(g.or.length).toBe(2);
});

test("addComparisonAt / addSubgroupAt / removeCondAt mutate group members", () => {
  const added = addComparisonAt(SAMPLE, ["or", 0], { op: "==", left: "scan.risk", right: "" });
  expect(getCondAt(added, ["or", 0]).and.length).toBe(3);
  const withGrp = addSubgroupAt(added, ["or", 0], { and: [{ op: "exists", left: "exploit.ok" }] });
  expect(condKind(getCondAt(withGrp, ["or", 0, "and", 3]))).toBe("and");
  const removed = removeCondAt(withGrp, ["or", 0, "and", 3]);
  expect(getCondAt(removed, ["or", 0]).and.length).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/scripts/tests/webedit && bun test condition.test.js`
Expected: FAIL (imports undefined).

- [ ] **Step 3: Implement the helpers in `editlogic.js`**

Append to `src/workflow/templates/webedit/editlogic.js`:

```javascript
// --- condition tree (and/or/not) helpers -----------------------------------
// On-disk condition shape: string (escape-hatch) | {op,left,right?} (leaf) |
// {and:[…]} | {or:[…]} | {not:cond}. All helpers are pure; mutators return a
// deep-cloned new root (never mutate the argument).
export function condKind(c) {
  if (typeof c === "string") return "escape";
  if (!c || typeof c !== "object") return "empty";
  if (Array.isArray(c.and)) return "and";
  if (Array.isArray(c.or)) return "or";
  if ("not" in c) return "not";
  return "leaf";
}
export function isGroupCond(c) { const k = condKind(c); return k === "and" || k === "or"; }

export function conditionSignalKeys(c) {
  const out = [];
  const walk = (n) => {
    const k = condKind(n);
    if (k === "and" || k === "or") { n[k].forEach(walk); return; }
    if (k === "not") { walk(n.not); return; }
    if (k === "leaf") {
      [n.left, n.right].forEach(v => { if (typeof v === "string") out.push(v); });
    }
  };
  walk(c);
  return out;
}

function _clone(c) { return JSON.parse(JSON.stringify(c)); }
export function getCondAt(root, path) {
  return path.reduce((acc, step) => (acc == null ? acc : acc[step]), root);
}
export function setCondAt(root, path, value) {
  const next = _clone(root);
  if (path.length === 0) return value;
  let cur = next;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = value;
  return next;
}
export function toggleNotAt(root, path) {
  const node = getCondAt(root, path);
  const replacement = condKind(node) === "not" ? node.not : { not: node };
  return setCondAt(root, path, replacement);
}
export function toggleConnectorAt(root, path) {
  const g = getCondAt(root, path);
  const k = condKind(g);
  if (k !== "and" && k !== "or") return root;
  const other = k === "and" ? "or" : "and";
  return setCondAt(root, path, { [other]: g[k] });
}
export function addComparisonAt(root, groupPath, leaf) {
  const g = _clone(getCondAt(root, groupPath));
  const k = condKind(g);
  g[k] = g[k].concat([leaf]);
  return setCondAt(root, groupPath, g);
}
export function addSubgroupAt(root, groupPath, subgroup) {
  return addComparisonAt(root, groupPath, subgroup);
}
export function removeCondAt(root, path) {
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const parent = getCondAt(root, parentPath);
  if (Array.isArray(parent)) {
    const arr = parent.slice(); arr.splice(key, 1);
    return setCondAt(root, parentPath, arr);
  }
  return root;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/scripts/tests/webedit && bun test condition.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/templates/webedit/editlogic.js src/scripts/tests/webedit/condition.test.js
git commit -m "feat(webedit): pure condition-tree helpers (shape, signal collection, path mutations)"
```

---

### Task 7: Editor read view — recursive condition vignette on the grid

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (`condEl`/`operandEl`, currently around lines 319–351)

**Interfaces:**
- Consumes: `condKind`, `isGroupCond` (Task 6), existing `operandEl(op, sigKeys)`.
- Produces: `condEl(cond, sigKeys)` renders leaf **and** composite conditions read-only (grid vignette).

- [ ] **Step 1: Port the recursive read renderer**

Rewrite `condEl` in `orchestration.js` to recurse. Keep `operandEl` as-is (it already renders signal `◈`, literal, and builtin one-key objects). Style the connector pills, parenthesis groups, and the NOT badge **verbatim from the prototype** (`condition-builder-prototype.dc.html` → `connRead`, `readNode`, `leafRead`, `notBadge(…, ro=true)`), adapting the data reads to the awok shape:

```javascript
// import at top of orchestration.js:
//   import { condKind, isGroupCond } from "./editlogic.js";

function notBadgeRead() {
  const b = document.createElement("span");
  b.className = "cond-not";                 // style from prototype notBadge(active=true, ro=true)
  b.textContent = "NOT";
  return b;
}
function connReadEl(word) {                 // word: "and" | "or"
  const s = document.createElement("span");
  s.className = "cond-conn cond-conn-" + word;   // AND blue / OR rose per palette
  s.textContent = word.toUpperCase();
  return s;
}
function condEl(cond, sigKeys, depth = 0) {
  const kind = condKind(cond);
  if (kind === "escape") {
    const pill = document.createElement("span"); pill.className = "cond-pill";
    const bolt = document.createElement("span"); bolt.className = "cond-lit"; bolt.textContent = "⚡";
    const txt = document.createElement("span"); txt.style.fontStyle = "italic";
    txt.textContent = cond || "free predicate";
    pill.append(bolt, txt); return pill;
  }
  if (kind === "not") {
    const wrap = document.createElement("span");
    wrap.style.display = "inline-flex"; wrap.style.alignItems = "center"; wrap.style.gap = "6px";
    wrap.append(notBadgeRead(), condEl(cond.not, sigKeys, depth));
    return wrap;
  }
  if (kind === "and" || kind === "or") {
    const members = cond[kind];
    const box = document.createElement("span");
    // depth 0: flat row, no outer parens; deeper: translucent parenthesized group
    box.className = depth === 0 ? "cond-row" : "cond-group cond-group-" + kind;
    members.forEach((m, i) => {
      if (i > 0) box.append(connReadEl(kind));
      box.append(condEl(m, sigKeys, depth + 1));
    });
    return box;
  }
  // leaf
  const pill = document.createElement("span"); pill.className = "cond-pill";
  pill.appendChild(operandEl(cond.left, sigKeys));
  if (cond.op !== "exists" && !(cond.left && typeof cond.left === "object")) {
    const op = document.createElement("span"); op.className = "cond-op"; op.textContent = cond.op || "";
    pill.appendChild(op);
    pill.appendChild(operandEl(cond.right, sigKeys));
  }
  return pill;
}
```

- [ ] **Step 2: Add the CSS classes**

In `src/workflow/templates/webedit/editor.css`, add `.cond-not`, `.cond-conn`, `.cond-conn-and`, `.cond-conn-or`, `.cond-group`, `.cond-group-and`, `.cond-group-or`, `.cond-row` using the palette from the mini-spec §6 (AND `#93c5fd`, OR `#fda4af`, NOT `#fca5a5`, parenthesis-tint translucent, `flex-wrap: wrap` so the vignette never overflows). Copy the exact colors/radii from the prototype's inline styles.

- [ ] **Step 3: Verify in the browser**

Run: `awok edit --workflow <a workflow with an orchestration>` (or hand-edit a fixture's `.orchestration.yaml` to a composite `if`), open the orchestration view, confirm the gate vignette renders `( ◈ a == x AND ◈ b > 7 ) OR NOT ( … )` and wraps instead of overflowing.
Expected: composite condition renders read-only, matching the prototype.

- [ ] **Step 4: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js src/workflow/templates/webedit/editor.css
git commit -m "feat(webedit): recursive read-only condition vignette on the grid"
```

---

### Task 8: Editor edit view — recursive inline builder in the gate panel

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (the gate edit panel builder, `build`/`operandCtrl`/`setOp`/`setOperand`/`toggleEscape`, currently around lines 428–509)

**Interfaces:**
- Consumes: Task 6 mutators (`toggleNotAt`, `toggleConnectorAt`, `addComparisonAt`, `addSubgroupAt`, `removeCondAt`, `setCondAt`, `getCondAt`, `condKind`); the editor's existing state-commit path (whatever `orchestration.js` uses to persist a block's condition and re-render).
- Produces: an inline recursive builder that edits the block's `if`/`while`/`until` condition in place.

- [ ] **Step 1: Port the recursive builder**

Rewrite the panel's condition builder to recurse over the awok condition, porting the prototype's `build(n, depth)` interactions (`condition-builder-prototype.dc.html`) onto the awok shape + Task-6 mutators. Each rendered node knows its **path** (array), and every control commits via `setBlockCondition(newRoot)` — a small helper that writes the new condition back into the block (`block.if`/`block.while`/`block.until`) and triggers the editor's existing re-render. Structure:

```javascript
// import { condKind, getCondAt, setCondAt, toggleNotAt, toggleConnectorAt,
//          addComparisonAt, addSubgroupAt, removeCondAt } from "./editlogic.js";

const MAX_GROUP_DEPTH = 2;   // authoring cap (engine imposes none); mini-spec §2 "ajustable"

function buildCond(root, path, depth, commit) {
  const node = getCondAt(root, path);
  const kind = condKind(node);

  if (kind === "and" || kind === "or") {
    const members = node[kind];
    const box = el("span", depth === 0 ? "cond-build-row" : "cond-build-group cond-group-" + kind);
    if (depth > 0) box.append(notToggle(root, path, commit), openParen(kind));
    else if (isRootNegated(root)) box.append(notToggle(root, path, commit));
    members.forEach((m, i) => {
      if (i > 0) box.append(connToggle(root, path, kind, commit));   // click → toggleConnectorAt
      box.append(buildCond(root, path.concat([kind, i]), depth + 1, commit));
    });
    if (depth > 0) box.append(closeParen(kind));
    box.append(addComparisonBtn(root, path, commit));
    if (depth < MAX_GROUP_DEPTH) box.append(addSubgroupBtn(root, path, commit));
    if (depth > 0) box.append(removeBtn(root, path, commit));
    return box;
  }

  if (kind === "not") {
    // render the NOT badge (active) then the wrapped node at path+["not"]
    const wrap = el("span", "cond-build-neg");
    wrap.append(notToggle(root, path, commit), buildCond(root, path.concat(["not"]), depth, commit));
    return wrap;
  }

  // leaf
  return leafBuilder(root, path, node, commit);   // NOT badge + operandCtrl(left) + opSelect + operandCtrl(right) + ✕
}
```

Key control behaviours (all commit a new root, never mutate in place):
- **NOT badge** (`notToggle`): `commit(toggleNotAt(root, path))`. Rendered on leaves, groups, **and the root** (mini-spec: `neg` on any node incl. racine). For the root, render the badge before the row.
- **connector pill** (`connToggle`): `commit(toggleConnectorAt(root, groupPath))` — flips the whole group's `and`↔`or`.
- **＋ comparison** (`addComparisonBtn`): `commit(addComparisonAt(root, groupPath, {op:"==", left: firstSignalKey(), right:""}))`.
- **() sub-group** (`addSubgroupBtn`, only when `depth < MAX_GROUP_DEPTH`): `commit(addSubgroupAt(root, groupPath, {or:[{op:"==", left: firstSignalKey(), right:""}]}))`.
- **✕ remove** (`removeBtn`): `commit(removeCondAt(root, path))`.

- [ ] **Step 2: Port the operand kind selector**

Port the prototype's `kindSelect`/`opValue`/`operandCtrl` (segmented `◈ signal` / `"" literal` / `ƒ builtin`, always-visible icons + tooltips) onto the awok operand encoding, committing via `setCondAt`:
- **◈ signal** → the existing `<select>` over declared signals (do not change it); commit sets `left`/`right` to the chosen signal-key string.
- **"" literal** → text input; commit sets the operand to the string.
- **ƒ builtin** (left only) → function `<select>` (`file_exists`/`dir_exists`) + arg input; commit sets `left = {[fn]: arg}` **and** `op = "exists"`, and the builder hides the op-select + right operand for a builtin left.
- Right operand offers only signal/literal (no builtin).
- Add the symbol help panel (mini-spec §3) once, at the bottom of the builder.

- [ ] **Step 3: Keep escape-hatch at root only**

Leave the existing root escape-hatch toggle (`toggleEscape`) working: it swaps the whole condition between a free string and a default leaf. Do not offer escape-hatch inside groups.

- [ ] **Step 4: Verify in the browser**

Run: `awok edit --workflow <workflow>`; click a gate to open the panel. Confirm you can: toggle AND↔OR, add a comparison, add a sub-group (blocked past depth 2), negate a leaf/group/**root**, pick signal/literal/builtin operands, and that the grid vignette (Task 7) updates live. Build `(A and B) or not(C and D)` and confirm the saved `.orchestration.yaml` is the canonical `{or:[{and:[…]},{not:{and:[…]}}]}`.
Expected: round-trips to canonical awok shape; matches the prototype's look.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js src/workflow/templates/webedit/editor.css
git commit -m "feat(webedit): recursive inline condition builder (and/or/not, operand kinds, root NOT)"
```

---

### Task 9: Gate placement — recurse the condition's signals

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (`condSignalKeys` inside the grid-level computation, currently around lines 138–141)

**Interfaces:**
- Consumes: `conditionSignalKeys` (Task 6).

- [ ] **Step 1: Replace the flat operand read with the recursive collector**

In `orchestration.js`, the `condSignalKeys(b)` helper currently does:

```javascript
    const c = condOf(b);
    if (!c || typeof c !== "object") return [];
    return [c.left, c.right].filter(v => typeof v === "string" && v in sigPhase);
```

Replace the last line with the recursive collector so a composite condition contributes **all** its leaf signals:

```javascript
    const c = condOf(b);
    if (!c || typeof c !== "object") return [];
    return conditionSignalKeys(c).filter(v => v in sigPhase);
```

Add `conditionSignalKeys` to the `editlogic.js` import at the top of `orchestration.js`.

- [ ] **Step 2: Verify gate placement**

Run: `awok edit --workflow <workflow>`; make a gate whose composite condition references signals from two different phases; confirm the gate sits one level below the **latest** of its signal producers (not misplaced).
Expected: gate level = max producer level + 1, honoring every leaf's signal.

- [ ] **Step 3: Commit**

```bash
git add src/workflow/templates/webedit/orchestration.js
git commit -m "fix(webedit): gate placement recurses all signals of a composite condition"
```

---

### Task 10: Docs sync + regeneration ripple

**Files:**
- Modify: `docs/dev/bb-workflow.md`, `CLAUDE.md` (Orchestration section), `docs/superpowers/specs/2026-07-13-portes-logiques-orchestration-design.md` (cross-ref), `src/workflow/orchestration-capabilities.yaml` (header comment)
- Regenerate: `src/skills/*/SKILL.md`, `docs/architecture-cartography/*`

**Interfaces:** none (docs + generated artifacts).

- [ ] **Step 1: Update the human docs**

- `docs/dev/bb-workflow.md`: document the condition vocabulary — leaf, escape-hatch, and now `{and:[…]}` / `{or:[…]}` / `{not:…}`, recursion, editor 2-level authoring cap, validation (leaf-completeness error, single-member warning).
- `CLAUDE.md` → "Orchestration (portes logiques)": in the **Signals**/condition paragraph, note that a condition may compose sub-conditions with `and`/`or`/`not` (nestable), and that the golden rule (read only named signals/tokens, never reload an artifact) still holds per leaf.
- `2026-07-13-portes-logiques-orchestration-design.md`: add a one-line cross-reference to `2026-07-16-conditions-and-or-not-design.md`.
- capabilities header comment: mention the `connectors` section.

- [ ] **Step 2: Run the full engine test suite**

Run: `pytest src/scripts/tests/test_workflow_*.py -q && (cd src/scripts/tests/webedit && bun test)`
Expected: all green.

- [ ] **Step 3: Regenerate every artifact**

Run: `awok generate`
Expected: SKILL.md + cartography regenerated for all workflows + `index.html`. Because no shipped workflow uses composite conditions, the `SKILL.md` diffs should be empty; only regeneration timestamps/nothing changes. Inspect `git status`.

- [ ] **Step 4: Drift check**

Run: `awok check`
Expected: exit 0 (green) — committed SKILL.md matches generated.

- [ ] **Step 5: Deploy and smoke-test**

Run: `./install.sh` then, in Claude Code (after restart if agents changed), open `awok edit` and confirm the composite builder loads.
Expected: editor serves the new builder.

- [ ] **Step 6: Commit (with the `Regen:` trailer)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs(orchestration): document and/or/not connectors; regenerate artifacts

Regen: all SKILL.md + cartography (recursive condition rendering);
       workdir owners run `awok generate && awok deploy`.
EOF
)"
```

---

## Self-Review

- **Spec coverage:**
  - §2 decisions 1–6 → Tasks 1 (js_safe), 3 (permissive/recursive validate), 4 (render), 7–8 (editor 2-level cap, root NOT), 6/9 (signal selection unchanged path).
  - §3 on-disk shape → Tasks 2 (schema), 3/4 (engine), 6 (editor works on canonical shape).
  - §4.1 capabilities → Task 1. §4.2 schema → Task 2. §4.3 validate + §4.5 rules → Task 3. §4.4 render (incl. builtin leaf) → Task 4. Overlay inheritance → Task 5.
  - §5 editor (two views, kind selector, connectors, NOT incl. root, depth cap, gate-placement recursion, escape-hatch at root) → Tasks 6–9.
  - §6 tests → per-task (pytest + bun). §7 docs & ripple → Task 10. §8 out-of-scope (no JS runtime) honored (connectors only flagged js_safe).
- **Placeholder scan:** engine tasks carry complete code; editor DOM tasks reference the in-repo prototype for exact inline styles (a real source file, not a placeholder) and give complete structural code + Task-6 mutators. Task 5 Step 1 is an inspection step because the fixture's already-emitted signals must be read before choosing operands.
- **Type consistency:** `conditionSignalKeys`, `condKind`, `getCondAt`/`setCondAt`, `toggleNotAt`, `toggleConnectorAt`, `addComparisonAt`, `addSubgroupAt`, `removeCondAt` are defined in Task 6 and consumed with the same names in Tasks 7–9. `_render_condition_member` is introduced and used within Task 4. `_validate_condition` signature unchanged.

---

## Lot 2 — edit-panel refinements + enum signal values

Source: design §10 (browser-pass feedback). Scope: the **edit panel** for visuals (the grid vignette is unchanged), plus one **engine** addition for enum values. Tasks 11–12 (editor visual/UX) and Task 13 (engine) are independent (different files); Task 14 depends on 12 + 13.

### Task 11: Edit builder — connectors at line start + per-depth group colors

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (the recursive builder `buildCond`/`buildGroupCond` from Task 8)
- Modify: `src/workflow/templates/webedit/editor.css`

**Interfaces:** consumes the Task-8 builder + Task-6 mutators. No new exports.

- [ ] **Step 1: Vertical layout with leading connector.** In the EDIT builder's group branch (`buildGroupCond`), lay members out as a **vertical stack** (one row per member) instead of an inline row. Render the connector label (`AND`/`OR`) at the **start of each member row from the 2nd member on** (the first member has no leading connector; align it with the others). The connector stays clickable → `commit(toggleConnectorAt(root, path))` (toggles the whole group). Do NOT change the read-only grid vignette (`condEl`) — it stays inline.
- [ ] **Step 2: Per-depth group color.** Give each nested group's parentheses/box border a color chosen **deterministically from `depth`** (e.g. `GROUP_PALETTE[depth % GROUP_PALETTE.length]`), so nesting levels are visually distinct and STABLE across re-renders (no randomness that would flicker). Add a `GROUP_PALETTE` const (4–6 distinct hues) and a CSS mechanism (e.g. an inline `style.borderColor`/`color` set from the palette, or `data-depth` + CSS rules). Apply to the box border and the `(`/`)` glyphs in the edit builder.
- [ ] **Step 3: Static checks.** `node --check src/workflow/templates/webedit/orchestration.js`; `cd src/scripts/tests/webedit && bun test` (stays green).
- [ ] **Step 4: Self-review** the vertical layout + palette against design §10.1–§10.2; confirm the read vignette is untouched.
- [ ] **Step 5: Commit** `feat(webedit): vertical connectors-at-line-start + per-depth group colors in the builder`.

> Browser-verify pending (user): readability of the vertical layout, distinctness of the depth colors.

### Task 12: Edit builder — type-aware literal editor (bool / number)

**Files:**
- Modify: `src/workflow/templates/webedit/orchestration.js` (the literal operand control in the builder)

**Interfaces:** consumes the declared-signals metadata already available to the builder (the `SIGNALS`/`sigPhase` map carries each signal's `type`). No new exports.

- [ ] **Step 1: Infer the compared signal's type.** For a leaf where THIS operand is a **literal** and the OTHER operand is a **signal**, look up that signal's `type` from the declared-signals metadata. (If the other operand is not a signal — two literals, or literal-left + signal-right — no type; fall through to free text.)
- [ ] **Step 2: Render the typed control:**
  - `type === "bool"` → a `<select>` with options `true` / `false`; commit sets the literal to the chosen string (`"true"`/`"false"`, consistent with how bool literals are stored/rendered — see `_fmt_operand`).
  - `type === "number"` → `<input type="number">` (spinner) with numeric validation (reject non-numeric); commit the string value.
  - anything else (string / unknown / no signal) → the existing free-text input (unchanged).
  Commit via the existing builder commit path (`setCondAt` → `commitCond` → `applyGateEdit`).
- [ ] **Step 3: Static checks** (`node --check`, `bun test` green). Optionally a throwaway linkedom harness to confirm bool→select and number→spinner render for the right signal type (delete after).
- [ ] **Step 4: Self-review** against design §10.3; confirm the signal picker (◈) and builtin control are untouched.
- [ ] **Step 5: Commit** `feat(webedit): type-aware literal editor (bool dropdown, number spinner)`.

> Note: the enum dropdown case is Task 14 (needs Task 13's declared values). Leave a clear seam (e.g. a `default:` branch) where Task 14 plugs in enum.

### Task 13: Engine — enum signal `values`

**Files:**
- Modify: `src/workflow/workflow.schema.json` (the `emits` item)
- Modify: `src/scripts/bb-workflow` (`collect_signals`, and the enum-literal warning in `_validate_condition` or `validate_orchestration`)
- Test: `src/scripts/tests/test_workflow_orchestration.py` (and/or a signals test file)

**Interfaces:**
- Produces: `collect_signals(wf)[key]` carries `"values"` (list or None) alongside `"type"`.

- [ ] **Step 1: Write the failing tests.**

```python
def test_emits_enum_values_carried_by_collect_signals(bbw_module):
    wf = _wf([{"ref": "T1"}],
             emits=[{"name": "status", "type": "enum", "source": "token",
                     "values": ["open", "vuln", "clean"]}])
    sigs = bbw_module.collect_signals(wf)
    assert sigs["t1.status"]["values"] == ["open", "vuln", "clean"]


def test_literal_not_in_enum_values_warns(bbw_module):
    wf = _wf([{"if": {"op": "==", "left": "t1.status", "right": "ghost"},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "status", "type": "enum", "source": "token",
                     "values": ["open", "vuln"]}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("status" in e and "ghost" in e for e in errs)


def test_enum_values_optional(bbw_module):
    # enum signal with no declared values → no crash, no enum warning
    wf = _wf([{"if": {"op": "==", "left": "t1.status", "right": "whatever"},
               "then": [{"ref": "T1"}]}],
             emits=[{"name": "status", "type": "enum", "source": "token"}])
    assert bbw_module.validate_orchestration(wf) == []
```

- [ ] **Step 2: Run tests → FAIL** (`values` not carried; no warning).
- [ ] **Step 3: Schema.** In `workflow.schema.json`, add to the `emits` item properties:
  ```json
  "values": { "type": "array", "items": { "type": "string" }, "description": "For type=enum: the allowed values." }
  ```
- [ ] **Step 4: `collect_signals`.** Carry `values`: in the metadata dict add `"values": emit.get("values")`.
- [ ] **Step 5: Enum-literal warning.** In `_validate_condition`'s leaf path (for `op in ("==","!=")`), if one operand is a signal whose metadata `type == "enum"` and has non-empty `values`, and the other operand is a plain string literal NOT in `values`, append a NON-blocking warning `orchestration: literal '<v>' is not one of enum signal '<sig>' values <values>`. (Reuse the `signals` map already passed in.)
- [ ] **Step 6: Run tests → PASS**, then the whole file + no regression. Commit `feat(orchestration): enum signal values (schema + collect_signals + literal check)`.

### Task 14: Wiring UI for enum values + literal enum dropdown

**Files:**
- Modify: `src/workflow/templates/webedit/formfields.js` (or wherever `emits` signals are declared in the Wiring editor)
- Modify: `src/workflow/templates/webedit/orchestration.js` (the Task-12 literal control: add the enum case)

**Interfaces:** consumes Task-13's `values` in the signals metadata; extends Task-12's literal control.

- [ ] **Step 1: Wiring input.** Where a signal's `emits` entry is edited, when `type === "enum"` show an input to enter the allowed `values` (e.g. a comma-separated field or a small add/remove list), persisting `values: [...]` on the emits entry. Hide it for non-enum types.
- [ ] **Step 2: Literal enum dropdown.** In the builder's literal control (Task 12), add the `type === "enum"` case: if the compared enum signal has declared `values`, render a `<select>` of those values; if it has none, fall back to free text.
- [ ] **Step 3: Static checks** (`node --check`, `bun test` green).
- [ ] **Step 4: Self-review** against design §10.4; confirm non-enum signal declaration is unchanged.
- [ ] **Step 5: Commit** `feat(webedit): enum values in Wiring + enum literal dropdown in the builder`.

> Browser-verify pending (user): declaring enum values on a signal, then the literal dropdown offering them.

### Lot 2 ripple

After Tasks 11–14, fold into Task 10's ripple (or a second ripple): `awok generate`, `awok check` green, `./install.sh`, `Regen:` trailer. Schema/engine change in Task 13 does not alter existing SKILL.md output (no shipped workflow declares enum values), so no artifact churn expected — confirm with `awok check`.
