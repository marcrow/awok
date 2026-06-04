# Opportunistic Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `opportunistic` field (workflow-wide default + per-phase override) that injects a scoped licence into the generated `SKILL.md` allowing the main orchestrator to author and dispatch ad-hoc sub-agents on selected phases, and surfaces those autonomy zones in the cartography.

**Architecture:** awok has no runtime — the feature is pure compilation. A new `opportunistic` field (`bool | object`) is read at two levels; a Python resolver (`resolve_opportunistic`) combines global default + per-phase override into a per-phase `_opp` struct (mutated in place) plus a returned global dict. Templates stay logic-free: they read precomputed `_opp.note_kind` (SKILL.md) and `_opp.mark` (cartography). Validation adds three non-blocking coherence warnings.

**Tech Stack:** Python 3 stdlib + PyYAML + Jinja2 + jsonschema; pytest. Source of truth `src/scripts/bb-workflow` (a Python file, no `.py` extension), Jinja templates in `src/workflow/templates/`, JSON schema `src/workflow/workflow.schema.json`.

**Spec:** `docs/superpowers/specs/2026-06-04-opportunistic-phases-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/workflow/workflow.schema.json` | schema | add `opportunistic` definition; reference from top-level + `phase` |
| `src/scripts/bb-workflow` | compiler | `_normalize_opp` + `resolve_opportunistic`; `check_opportunistic_warnings`; wire resolver into 3 render fns + warning into `_validate_one` |
| `src/workflow/templates/skill-skeleton.md.jinja` | SKILL.md | global 🧭 section + per-phase note block |
| `src/workflow/templates/cartography.mermaid.jinja` | HTML carto | classDefs + node marking |
| `src/workflow/templates/cartography-texte.md.jinja` | ASCII carto | header mention + per-phase lines |
| `src/workflows/onboard.yaml` | demo | global on + `O2-DEPS` override + `O4-ARCHITECTURE: false` |
| `src/scripts/tests/test_workflow_opportunistic.py` | tests | new file, grows across tasks |
| `CLAUDE.md`, `README.md`, `docs/dev/bb-workflow.md` | docs | document the field |

All tests load the compiler via the session `bbw_module` fixture (`src/scripts/tests/conftest.py`), calling functions directly with in-memory dicts. `REPO_ROOT = Path(__file__).resolve().parents[3]`.

---

## Task 1: Schema — `opportunistic` definition + references

**Files:**
- Modify: `src/workflow/workflow.schema.json` (top-level `properties`, `phase.properties`, `definitions`)
- Test: `src/scripts/tests/test_workflow_opportunistic.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/scripts/tests/test_workflow_opportunistic.py`:

```python
"""Tests for the `opportunistic` field: schema, resolution, validation, rendering."""
from pathlib import Path
import shutil
import yaml
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
TEMPLATES_DIR = REPO_ROOT / "src" / "workflow" / "templates"
SNIPPETS_DIR = TEMPLATES_DIR / "invocations"


def _base_wf(**top):
    wf = {
        "schema_version": 1,
        "skill": {"name": "demo", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "First", "group": "g"}],
    }
    wf.update(top)
    return wf


# --- Task 1: schema acceptance ---

def test_schema_accepts_opportunistic_bool_toplevel(bbw_module):
    wf = _base_wf(opportunistic=True)
    assert bbw_module.validate_schema(wf) == []


def test_schema_accepts_opportunistic_object_toplevel(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True, "when": "w", "examples": ["e"]})
    assert bbw_module.validate_schema(wf) == []


def test_schema_accepts_opportunistic_on_phase(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = {"when": "w"}
    assert bbw_module.validate_schema(wf) == []


def test_schema_accepts_opportunistic_false_on_phase(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = False
    assert bbw_module.validate_schema(wf) == []


def test_schema_rejects_unknown_key_in_object(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True, "bogus": 1})
    errors = bbw_module.validate_schema(wf)
    assert errors != []


def test_schema_rejects_wrong_type(bbw_module):
    wf = _base_wf(opportunistic=123)
    errors = bbw_module.validate_schema(wf)
    assert errors != []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -v`
Expected: the two `rejects_*` tests FAIL (schema currently allows anything for the unknown key / wrong type because `opportunistic` is not in the schema, so no error is raised).

- [ ] **Step 3: Add the schema definition**

In `src/workflow/workflow.schema.json`, inside `"definitions"` (after the `on_demand_agent` definition block, before the closing `}` of `definitions`), add:

```json
,
    "opportunistic": {
      "oneOf": [
        { "type": "boolean" },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "enabled": { "type": "boolean" },
            "when": { "type": "string" },
            "examples": { "type": "array", "items": { "type": "string" } }
          }
        }
      ]
    }
```

- [ ] **Step 4: Reference it from top-level and phase**

In the top-level `"properties"` block, after the `"namespaces"` property (the object ending at line ~62), add:

```json
,
    "opportunistic": { "$ref": "#/definitions/opportunistic" }
```

In the `"phase"` definition `"properties"` block, after `"outputs": { ... }` (line ~84), add:

```json
,
        "opportunistic": { "$ref": "#/definitions/opportunistic" }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -v`
Expected: all 6 tests PASS.

- [ ] **Step 6: Validate the schema file is still valid JSON & existing tests pass**

Run: `python -m pytest src/scripts/tests/test_workflow_schema.py -v`
Expected: PASS (no regression).

- [ ] **Step 7: Commit**

```bash
git add src/workflow/workflow.schema.json src/scripts/tests/test_workflow_opportunistic.py
git commit -m "feat(awok): schema for opportunistic field (bool|object, two levels)"
```

---

## Task 2: Resolver — `_normalize_opp` + `resolve_opportunistic`

**Files:**
- Modify: `src/scripts/bb-workflow` (add two functions after `validate_schema`, line ~407)
- Test: `src/scripts/tests/test_workflow_opportunistic.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/scripts/tests/test_workflow_opportunistic.py`:

```python
# --- Task 2: resolution / precedence ---

def _resolved(bbw_module, wf):
    """Run resolve_opportunistic and return (global_dict, {phase_id: _opp})."""
    g = bbw_module.resolve_opportunistic(wf)
    return g, {p["id"]: p["_opp"] for p in wf["phases"]}


def test_resolve_global_off_phase_absent(bbw_module):
    wf = _base_wf()
    g, opp = _resolved(bbw_module, wf)
    assert g["enabled"] is False
    assert opp["T1"]["enabled"] is False
    assert opp["T1"]["mark"] is None
    assert opp["T1"]["note_kind"] is None


def test_resolve_global_on_phase_inherits(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True, "when": "gw", "examples": ["ge"]})
    g, opp = _resolved(bbw_module, wf)
    assert g["enabled"] is True
    assert opp["T1"]["enabled"] is True
    assert opp["T1"]["mark"] is None          # inherited, no own content → unmarked
    assert opp["T1"]["note_kind"] is None
    assert opp["T1"]["when"] == "gw"           # inherited guidance available


def test_resolve_global_off_phase_enables_standalone(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = True
    g, opp = _resolved(bbw_module, wf)
    assert opp["T1"]["enabled"] is True
    assert opp["T1"]["needs_full_grant"] is True
    assert opp["T1"]["mark"] == "opportunistic"
    assert opp["T1"]["note_kind"] == "full"


def test_resolve_global_on_phase_override_guidance(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True})
    wf["phases"][0]["opportunistic"] = {"when": "pw", "examples": ["pe"]}
    g, opp = _resolved(bbw_module, wf)
    assert opp["T1"]["mark"] == "opportunistic"
    assert opp["T1"]["note_kind"] == "short"
    assert opp["T1"]["when"] == "pw"
    assert opp["T1"]["examples"] == ["pe"]


def test_resolve_global_on_phase_locked(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True})
    wf["phases"][0]["opportunistic"] = False
    g, opp = _resolved(bbw_module, wf)
    assert opp["T1"]["explicitly_disabled"] is True
    assert opp["T1"]["mark"] == "locked"
    assert opp["T1"]["note_kind"] == "locked"


def test_resolve_global_off_phase_false_is_inert(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = False
    g, opp = _resolved(bbw_module, wf)
    assert opp["T1"]["mark"] is None           # nothing to lock when global off
    assert opp["T1"]["note_kind"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k resolve -v`
Expected: FAIL with `AttributeError: module 'bbw' has no attribute 'resolve_opportunistic'`.

- [ ] **Step 3: Implement the resolver**

In `src/scripts/bb-workflow`, immediately after the `validate_schema` function (ends line ~407), add:

```python
def _normalize_opp(raw):
    """Normalize an `opportunistic` value (bool|dict|None) into a dict
    {enabled, when, examples} or None if the key was absent."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return {"enabled": raw, "when": None, "examples": []}
    if isinstance(raw, dict):
        return {
            "enabled": bool(raw.get("enabled", True)),
            "when": raw.get("when"),
            "examples": list(raw.get("examples") or []),
        }
    # Unknown type: treat as absent (schema validation catches it separately).
    return None


def resolve_opportunistic(workflow: dict) -> dict:
    """Combine the top-level `opportunistic` default with each phase override.

    Mutates each phase in place, setting phase['_opp'] with precomputed render
    decisions. Returns the resolved global dict {enabled, when, examples}.
    """
    g = _normalize_opp(workflow.get("opportunistic"))
    global_enabled = bool(g["enabled"]) if g else False
    g_when = g["when"] if g else None
    g_examples = g["examples"] if g else []

    for phase in workflow.get("phases", []):
        p = _normalize_opp(phase.get("opportunistic"))
        if p is None:
            enabled = global_enabled
            explicitly_disabled = False
            has_guidance = False
            when, examples = g_when, g_examples
        else:
            enabled = p["enabled"]
            explicitly_disabled = (p["enabled"] is False)
            has_guidance = enabled and (p["when"] is not None or bool(p["examples"]))
            when = p["when"] if p["when"] is not None else g_when
            examples = p["examples"] if p["examples"] else g_examples

        needs_full_grant = enabled and not global_enabled

        if explicitly_disabled and global_enabled:
            mark, note_kind = "locked", "locked"
        elif needs_full_grant:
            mark, note_kind = "opportunistic", "full"
        elif enabled and global_enabled and has_guidance:
            mark, note_kind = "opportunistic", "short"
        else:
            mark, note_kind = None, None

        phase["_opp"] = {
            "enabled": enabled,
            "explicitly_disabled": explicitly_disabled,
            "needs_full_grant": needs_full_grant,
            "has_guidance": has_guidance,
            "mark": mark,
            "note_kind": note_kind,
            "when": when,
            "examples": examples,
        }

    return {"enabled": global_enabled, "when": g_when, "examples": g_examples}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k resolve -v`
Expected: all 6 `resolve_*` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_opportunistic.py
git commit -m "feat(awok): resolve_opportunistic — combine global default + per-phase override"
```

---

## Task 3: Validation — `check_opportunistic_warnings`

**Files:**
- Modify: `src/scripts/bb-workflow` (add `check_opportunistic_warnings` after `check_dataflow_warnings` line ~767; wire into `_validate_one` line ~1770)
- Test: `src/scripts/tests/test_workflow_opportunistic.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/scripts/tests/test_workflow_opportunistic.py`:

```python
# --- Task 3: coherence warnings ---

def test_warn_opportunistic_on_workflow_call(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True})
    wf["phases"][0]["type"] = "workflow_call"
    wf["phases"][0]["workflow"] = "other"
    wf["phases"][0]["opportunistic"] = True
    w = bbw_module.check_opportunistic_warnings(wf)
    assert any("workflow_call" in x and "T1" in x for x in w)


def test_warn_redundant_disable_when_global_off(bbw_module):
    wf = _base_wf()
    wf["phases"][0]["opportunistic"] = False
    w = bbw_module.check_opportunistic_warnings(wf)
    assert any("redundant" in x and "T1" in x for x in w)


def test_warn_dead_global_config(bbw_module):
    wf = _base_wf(opportunistic={"enabled": False})
    w = bbw_module.check_opportunistic_warnings(wf)
    assert any("dead config" in x for x in w)


def test_no_warnings_on_clean_workflow(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True})
    wf["phases"][0]["opportunistic"] = {"when": "w"}
    w = bbw_module.check_opportunistic_warnings(wf)
    assert w == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k warn -v`
Expected: FAIL with `AttributeError: module 'bbw' has no attribute 'check_opportunistic_warnings'`.

- [ ] **Step 3: Implement the warnings function**

In `src/scripts/bb-workflow`, immediately after `check_dataflow_warnings` (ends line ~767), add:

```python
def check_opportunistic_warnings(workflow: dict) -> list:
    """Non-blocking coherence checks for the `opportunistic` field."""
    warnings = []
    raw_global = workflow.get("opportunistic")
    g = _normalize_opp(raw_global)
    global_enabled = bool(g["enabled"]) if g else False
    any_phase_enabled = False

    for phase in workflow.get("phases", []):
        pid = phase.get("id", "?")
        raw = phase.get("opportunistic")
        p = _normalize_opp(raw)
        if p and p["enabled"]:
            any_phase_enabled = True
        if raw is not None and phase.get("type") == "workflow_call":
            warnings.append(
                f"phase '{pid}': 'opportunistic' on a workflow_call phase has no "
                f"effect (opportunism belongs to the called workflow)"
            )
        if p is not None and p["enabled"] is False and not global_enabled:
            warnings.append(
                f"phase '{pid}': 'opportunistic: false' is redundant (no global "
                f"opportunistic default to disable)"
            )

    if raw_global is not None and not global_enabled and not any_phase_enabled:
        warnings.append(
            "opportunistic: global default is disabled and no phase enables it "
            "(dead config)"
        )
    return warnings
```

- [ ] **Step 4: Wire it into `_validate_one`**

In `_validate_one` (line ~1770), find:

```python
    warnings = check_dataflow_warnings(workflow)
    warnings += check_skill_name_matches_filename(workflow, workflow_path)
```

Replace with:

```python
    warnings = check_dataflow_warnings(workflow)
    warnings += check_skill_name_matches_filename(workflow, workflow_path)
    warnings += check_opportunistic_warnings(workflow)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k warn -v`
Expected: all 4 `warn`/`no_warnings` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_opportunistic.py
git commit -m "feat(awok): opportunistic coherence warnings (workflow_call, redundant, dead config)"
```

---

## Task 4: SKILL.md rendering — global section + per-phase note

**Files:**
- Modify: `src/scripts/bb-workflow` (`generate_skill_md`: call resolver + pass `opportunistic_global`, line ~903 and ~987)
- Modify: `src/workflow/templates/skill-skeleton.md.jinja` (global section + per-phase block)
- Test: `src/scripts/tests/test_workflow_opportunistic.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/scripts/tests/test_workflow_opportunistic.py`:

```python
# --- Task 4: SKILL.md rendering ---

def _gen_skill(bbw_module, tmp_path, wf_yaml):
    """Generate a SKILL.md from an inline YAML string; return its text."""
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"
    shutil.copy(SNIPPETS_DIR / "test-agent.md", invocations_dir / "test-agent.md")
    shutil.copy(TEMPLATES_DIR / "skill-skeleton.md.jinja",
                templates_dir / "skill-skeleton.md.jinja")
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")
    wf_path = workflow_dir / "workflow.yaml"
    wf_path.write_text(wf_yaml)
    out = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(workflow_path=wf_path, output_path=out,
                                 templates_dir=templates_dir, agents_dir=agents_dir)
    return out.read_text()


OPP_WF = """schema_version: 1
skill:
  name: demo
  description: d
opportunistic:
  enabled: true
  when: GLOBAL_WHEN_MARKER
  examples:
    - GLOBAL_EXAMPLE_MARKER
groups:
  g: { description: x }
phases:
  - id: T1
    name: First
    group: g
    opportunistic:
      when: PHASE_WHEN_MARKER
      examples:
        - PHASE_EXAMPLE_MARKER
    invocations:
      - agent: test-agent
  - id: T2
    name: Second
    group: g
    opportunistic: false
    invocations:
      - agent: test-agent
"""


def test_skill_renders_global_section(bbw_module, tmp_path):
    text = _gen_skill(bbw_module, tmp_path, OPP_WF)
    assert "## 🧭 Opportunistic autonomy" in text
    assert "GLOBAL_WHEN_MARKER" in text
    assert "GLOBAL_EXAMPLE_MARKER" in text


def test_skill_renders_phase_short_note(bbw_module, tmp_path):
    text = _gen_skill(bbw_module, tmp_path, OPP_WF)
    assert "Opportunistic lead here" in text
    assert "PHASE_WHEN_MARKER" in text


def test_skill_renders_locked_note(bbw_module, tmp_path):
    text = _gen_skill(bbw_module, tmp_path, OPP_WF)
    assert "No opportunistic autonomy here" in text
    assert "ask the user" in text


def test_skill_no_global_section_when_disabled(bbw_module, tmp_path):
    wf = OPP_WF.replace("  enabled: true", "  enabled: false")
    text = _gen_skill(bbw_module, tmp_path, wf)
    assert "## 🧭 Opportunistic autonomy" not in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k skill -v`
Expected: FAIL (no `## 🧭 Opportunistic autonomy` heading; `opportunistic_global` not passed).

- [ ] **Step 3: Wire the resolver into `generate_skill_md`**

In `src/scripts/bb-workflow`, in `generate_skill_md`, find the start of the pre-render loop (line ~902):

```python
    # Render each invocation snippet for each phase
    phases_rendered = []
```

Insert immediately **before** that comment:

```python
    opportunistic_global = resolve_opportunistic(workflow)
```

Then find the `template.render(` call (line ~972) and the `on_demand_agents=...` line (line ~987). Replace:

```python
        on_demand_agents=workflow.get("on_demand_agents", []),
    )
```

with:

```python
        on_demand_agents=workflow.get("on_demand_agents", []),
        opportunistic_global=opportunistic_global,
    )
```

- [ ] **Step 4: Add the global section to the skeleton template**

In `src/workflow/templates/skill-skeleton.md.jinja`, find (lines 19-25):

```jinja
{% for block in manual_blocks_at_top|default([]) %}
{{ block }}
{% endfor %}

---

## Pipeline phases (DAG)
```

Replace with:

```jinja
{% for block in manual_blocks_at_top|default([]) %}
{{ block }}
{% endfor %}
{% if opportunistic_global and opportunistic_global.enabled %}
---

## 🧭 Opportunistic autonomy

This workflow permits **scoped improvisation**. Beyond the planned work, you (the
orchestrator) may **author and launch an ad-hoc sub-agent** whenever you spot a
signal the planned agents do not cover.

- **How**: the `Task` tool, `subagent_type: general-purpose` (or `Explore`), with a
  prompt you write yourself from context. These agents do not exist in
  `src/agents/` — you create them on the fly.
{% if opportunistic_global.when %}- **When**: {{ opportunistic_global.when|trim }}
{% endif %}- **Mode**: usually in the **background**, unless the result is needed to continue the current phase.
- **Nesting limit**: a sub-agent cannot itself spawn sub-agents (max depth = 1). After reading the planned sub-agent's report, it is up to you to launch the follow-up.
- **Scope**: all phases, except those marked ⛔.
{% if opportunistic_global.examples %}
Examples: {{ opportunistic_global.examples|join('; ') }}
{% endif %}
{% endif %}

---

## Pipeline phases (DAG)
```

- [ ] **Step 5: Add the per-phase note block to the phase loop**

In the same template, find (lines 31-33):

```jinja
{% if phase.description %}{{ phase.description }}{% endif %}

{% if phase.type == 'script' %}
```

Replace with:

```jinja
{% if phase.description %}{{ phase.description }}{% endif %}

{% if phase._opp and phase._opp.note_kind == 'locked' %}
> ⛔ **No opportunistic autonomy here.** If the need is compelling, ask the user.

{% elif phase._opp and phase._opp.note_kind == 'full' %}
> 🧭 **Opportunistic autonomy — permitted on this phase.** You may author and launch an ad-hoc sub-agent (`Task` tool, `general-purpose`/`Explore`, with a prompt you write from context) when you spot a signal the planned agents don't cover — usually in the background. A sub-agent cannot itself spawn sub-agents, so after reading the planned sub-agent's report it is up to you to launch the follow-up.{% if phase._opp.when %} {{ phase._opp.when|trim }}{% endif %}
{% if phase._opp.examples %}> Examples: {{ phase._opp.examples|join('; ') }}{% endif %}

{% elif phase._opp and phase._opp.note_kind == 'short' %}
> 🧭 **Opportunistic lead here.** {{ phase._opp.when|trim }}{% if phase._opp.examples %} — e.g. {{ phase._opp.examples|join('; ') }}{% endif %}

{% endif %}
{% if phase.type == 'script' %}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k skill -v`
Expected: all 4 `skill` tests PASS.

- [ ] **Step 7: Run the full generate suite (no regression)**

Run: `python -m pytest src/scripts/tests/test_workflow_generate.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/scripts/bb-workflow src/workflow/templates/skill-skeleton.md.jinja src/scripts/tests/test_workflow_opportunistic.py
git commit -m "feat(awok): render opportunistic licence into SKILL.md (global section + per-phase notes)"
```

---

## Task 5: Cartography mermaid — marking

**Files:**
- Modify: `src/scripts/bb-workflow` (`render_cartography_mermaid`: call resolver, line ~1343)
- Modify: `src/workflow/templates/cartography.mermaid.jinja` (emoji prefix + classDefs + class statements)
- Test: `src/scripts/tests/test_workflow_opportunistic.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/scripts/tests/test_workflow_opportunistic.py`:

```python
# --- Task 5: cartography mermaid ---

def test_mermaid_marks_opportunistic_and_locked(bbw_module):
    wf = _base_wf(opportunistic={"enabled": True})
    wf["phases"] = [
        {"id": "T1", "name": "First", "group": "g",
         "opportunistic": {"when": "w"}},
        {"id": "T2", "name": "Second", "group": "g",
         "opportunistic": False},
    ]
    out = bbw_module.render_cartography_mermaid(wf)
    assert "classDef opportunistic" in out
    assert "classDef opp_locked" in out
    assert "class T1 opportunistic" in out
    assert "class T2 opp_locked" in out
    assert "🧭" in out
    assert "⛔" in out


def test_mermaid_unmarked_when_no_opportunistic(bbw_module):
    wf = _base_wf()
    wf["phases"] = [{"id": "T1", "name": "First", "group": "g"}]
    out = bbw_module.render_cartography_mermaid(wf)
    assert "class T1 opportunistic" not in out
    assert "class T1 opp_locked" not in out
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k mermaid -v`
Expected: FAIL (`class T1 opportunistic` absent; `classDef opportunistic` absent).

- [ ] **Step 3: Call the resolver in `render_cartography_mermaid`**

In `src/scripts/bb-workflow`, in `render_cartography_mermaid` (line ~1335), find:

```python
    env.filters["node_id"] = _node_id_filter
    template = env.get_template("cartography.mermaid.jinja")
    return template.render(
        phases=workflow.get("phases", []),
```

Replace with:

```python
    env.filters["node_id"] = _node_id_filter
    resolve_opportunistic(workflow)
    template = env.get_template("cartography.mermaid.jinja")
    return template.render(
        phases=workflow.get("phases", []),
```

- [ ] **Step 4: Add emoji prefix in the node label**

In `src/workflow/templates/cartography.mermaid.jinja`, find (lines 8-18):

```jinja
{%- set meta_parts = [] -%}
{%- if phase.type -%}{%- set _ = meta_parts.append(phase.type) -%}{%- endif -%}
{%- if inv0 and inv0.model -%}{%- set _ = meta_parts.append(inv0.model) -%}{%- endif -%}
{%- if phase.type == 'workflow_call' -%}
    {{ phase.id }}[["`🔗 **{{ phase.name }}**{% if show_id %}
*{{ phase.id }}*{% endif %}
_calls /{{ phase.workflow }}_`"]]:::workflow_call
{%- else -%}
    {{ phase.id }}["`**{{ phase.name }}**{% if show_id %}
*{{ phase.id }}*{% endif %}{% if meta_parts %}
_{{ meta_parts|join(' · ') }}_{% endif %}`"]:::{{ phase.group }}
{%- endif %}
```

Replace with:

```jinja
{%- set meta_parts = [] -%}
{%- if phase.type -%}{%- set _ = meta_parts.append(phase.type) -%}{%- endif -%}
{%- if inv0 and inv0.model -%}{%- set _ = meta_parts.append(inv0.model) -%}{%- endif -%}
{%- set opp_prefix = '' -%}
{%- if phase._opp and phase._opp.mark == 'opportunistic' -%}{%- set opp_prefix = '🧭 ' -%}{%- elif phase._opp and phase._opp.mark == 'locked' -%}{%- set opp_prefix = '⛔ ' -%}{%- endif -%}
{%- if phase.type == 'workflow_call' -%}
    {{ phase.id }}[["`🔗 **{{ phase.name }}**{% if show_id %}
*{{ phase.id }}*{% endif %}
_calls /{{ phase.workflow }}_`"]]:::workflow_call
{%- else -%}
    {{ phase.id }}["`**{{ opp_prefix }}{{ phase.name }}**{% if show_id %}
*{{ phase.id }}*{% endif %}{% if meta_parts %}
_{{ meta_parts|join(' · ') }}_{% endif %}`"]:::{{ phase.group }}
{%- endif %}
```

- [ ] **Step 5: Add classDefs and class statements**

In the same template, find (lines 26-29):

```jinja
{% for gname in groups -%}
    classDef {{ gname }} fill:{{ group_colors[gname] }},stroke:#94a3b8,stroke-width:1px,color:#f1f5f9
{% endfor -%}
    classDef workflow_call fill:#312e81,stroke:#a78bfa,stroke-width:2px,color:#ede9fe
```

Replace with:

```jinja
{% for phase in phases -%}
{%- if phase._opp and phase._opp.mark == 'opportunistic' %}
    class {{ phase.id }} opportunistic
{%- elif phase._opp and phase._opp.mark == 'locked' %}
    class {{ phase.id }} opp_locked
{%- endif %}
{% endfor %}
{% for gname in groups -%}
    classDef {{ gname }} fill:{{ group_colors[gname] }},stroke:#94a3b8,stroke-width:1px,color:#f1f5f9
{% endfor -%}
    classDef workflow_call fill:#312e81,stroke:#a78bfa,stroke-width:2px,color:#ede9fe
    classDef opportunistic stroke:#f59e0b,stroke-width:2px,stroke-dasharray:5 4
    classDef opp_locked stroke:#6b7280,stroke-width:1px,color:#9ca3af
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k mermaid -v`
Expected: both `mermaid` tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/workflow/templates/cartography.mermaid.jinja src/scripts/tests/test_workflow_opportunistic.py
git commit -m "feat(awok): mark opportunistic/locked phases in the mermaid cartography"
```

---

## Task 6: Cartography texte — header + per-phase lines

**Files:**
- Modify: `src/scripts/bb-workflow` (`generate_cartography_texte`: call resolver + pass global, line ~1533)
- Modify: `src/workflow/templates/cartography-texte.md.jinja` (header mention + per-phase lines)
- Test: `src/scripts/tests/test_workflow_opportunistic.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/scripts/tests/test_workflow_opportunistic.py`:

```python
# --- Task 6: cartography texte ---

def test_texte_marks_phases(bbw_module, tmp_path):
    wf_yaml = """schema_version: 1
skill:
  name: demo
  description: d
opportunistic:
  enabled: true
groups:
  g: { description: x }
phases:
  - id: T1
    name: First
    group: g
    opportunistic:
      when: PHASE_WHEN_TXT
  - id: T2
    name: Second
    group: g
    opportunistic: false
"""
    wf_path = tmp_path / "wf.yaml"
    wf_path.write_text(wf_yaml)
    out = tmp_path / "carto.md"
    bbw_module.generate_cartography_texte(workflow_path=wf_path, output_path=out,
                                          templates_dir=TEMPLATES_DIR)
    text = out.read_text()
    assert "Opportunistic workflow" in text          # header mention
    assert "Opportunistic autonomy" in text and "PHASE_WHEN_TXT" in text
    assert "Opportunism locked" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k texte -v`
Expected: FAIL (`Opportunistic workflow` not in output).

- [ ] **Step 3: Call the resolver and pass the global dict**

In `src/scripts/bb-workflow`, in `generate_cartography_texte` (line ~1533), find:

```python
    template = env.get_template("cartography-texte.md.jinja")
    output = template.render(
        phases=workflow.get("phases", []),
        groups=workflow.get("groups", {}),
        execution_levels=dag.execution_levels(),
    )
```

Replace with:

```python
    template = env.get_template("cartography-texte.md.jinja")
    opportunistic_global = resolve_opportunistic(workflow)
    output = template.render(
        phases=workflow.get("phases", []),
        groups=workflow.get("groups", {}),
        execution_levels=dag.execution_levels(),
        opportunistic_global=opportunistic_global,
    )
```

- [ ] **Step 4: Add the header mention to the texte template**

In `src/workflow/templates/cartography-texte.md.jinja`, find (lines 5-7):

```jinja
## Overview

{{ phases|length }} phases, organized into {{ groups|length }} groups.
```

Replace with:

```jinja
## Overview

{{ phases|length }} phases, organized into {{ groups|length }} groups.
{% if opportunistic_global and opportunistic_global.enabled %}
> 🧭 Opportunistic workflow: the orchestrator may launch ad-hoc sub-agents (except phases marked ⛔).
{% endif %}
```

- [ ] **Step 5: Add per-phase lines to the texte template**

In the same template, find (lines 36-41):

```jinja
{%- if phase.invocations %}
- Invocations:
{% for inv in phase.invocations %}
  - `{{ inv.agent }}` ({{ inv.model|default('inherit') }}){% if inv.background %} [bg]{% endif %}
{% endfor %}
{%- endif %}
```

Replace with:

```jinja
{%- if phase.invocations %}
- Invocations:
{% for inv in phase.invocations %}
  - `{{ inv.agent }}` ({{ inv.model|default('inherit') }}){% if inv.background %} [bg]{% endif %}
{% endfor %}
{%- endif %}
{%- if phase._opp and phase._opp.mark == 'opportunistic' %}
- 🧭 Opportunistic autonomy{% if phase._opp.when %}: {{ phase._opp.when|trim }}{% endif %}
{%- elif phase._opp and phase._opp.mark == 'locked' %}
- ⛔ Opportunism locked
{%- endif %}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `python -m pytest src/scripts/tests/test_workflow_opportunistic.py -k texte -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/workflow/templates/cartography-texte.md.jinja src/scripts/tests/test_workflow_opportunistic.py
git commit -m "feat(awok): mark opportunistic/locked phases in the text cartography"
```

---

## Task 7: Demo wiring in `onboard.yaml` + regenerate

**Files:**
- Modify: `src/workflows/onboard.yaml`
- Regenerate: `src/skills/onboard/SKILL.md`, `docs/architecture-cartography/onboard.html`, `onboard-texte.md`, `index.html`

- [ ] **Step 1: Add the global default to `onboard.yaml`**

In `src/workflows/onboard.yaml`, find (lines 10-12):

```yaml
namespaces:
  work: work/onboard
groups:
```

Replace with:

```yaml
namespaces:
  work: work/onboard
opportunistic:
  enabled: true
  when: When an explorer surfaces a signal the planned reduce won't chase.
  examples:
    - "detected framework/CMS → ad-hoc specialised recon"
groups:
```

- [ ] **Step 2: Add the targeted override to `O2-DEPS`**

In `src/workflows/onboard.yaml`, find the `O2-DEPS` phase header:

```yaml
  - id: O2-DEPS
    name: Dependency audit
    group: explore
    type: agent
    depends_on: [O0-INVENTORY]
    invocations:
```

Replace with:

```yaml
  - id: O2-DEPS
    name: Dependency audit
    group: explore
    type: agent
    depends_on: [O0-INVENTORY]
    opportunistic:
      when: A dependency looks old / abandoned.
      examples:
        - "old dependency → ad-hoc agent that looks up known CVEs"
    invocations:
```

- [ ] **Step 3: Lock `O4-ARCHITECTURE`**

In `src/workflows/onboard.yaml`, find the `O4-ARCHITECTURE` phase header:

```yaml
  - id: O4-ARCHITECTURE
    name: Architecture synthesis
    group: synthesize
    type: agent
    depends_on: [O1-STRUCTURE, O2-DEPS, O3-FLOW, OG-GITSTATS]
    invocations:
```

Replace with:

```yaml
  - id: O4-ARCHITECTURE
    name: Architecture synthesis
    group: synthesize
    type: agent
    depends_on: [O1-STRUCTURE, O2-DEPS, O3-FLOW, OG-GITSTATS]
    opportunistic: false
    invocations:
```

- [ ] **Step 4: Validate**

Run: `awok validate --workflow onboard`
Expected: `✅ [onboard] valid` with **no** opportunistic warnings (global on, O2-DEPS adds guidance, O4 locked under global-on — none of the three warning conditions apply).

- [ ] **Step 5: Regenerate all artifacts**

Run: `awok generate`
Expected: regenerates `src/skills/onboard/SKILL.md`, `docs/architecture-cartography/onboard.html`, `onboard-texte.md`, `index.html` without error.

- [ ] **Step 6: Verify the generated SKILL.md and texte carry the markers**

Run: `grep -c "Opportunistic autonomy" src/skills/onboard/SKILL.md && grep -c "No opportunistic autonomy here" src/skills/onboard/SKILL.md && grep "Opportunism locked" docs/architecture-cartography/onboard-texte.md`
Expected: a count ≥ 1 for the global section, ≥ 1 for the O4 locked note, and the texte locked line printed.

- [ ] **Step 7: Drift check passes**

Run: `awok check`
Expected: exit 0 (generated files match their YAML source — i.e. step 5 actually regenerated them).

- [ ] **Step 8: Commit**

```bash
git add src/workflows/onboard.yaml src/skills/onboard/SKILL.md docs/architecture-cartography/
git commit -m "feat(awok): wire opportunistic demo into onboard (DEPS lead + ARCHITECTURE lock)"
```

---

## Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/dev/bb-workflow.md`

- [ ] **Step 1: Document the field in `CLAUDE.md`**

In `CLAUDE.md`, after the `### Workflow chaining: type: workflow_call phase` section (ends before `### Add or modify a pipeline phase`), insert a new section:

```markdown
### Opportunistic phases: `opportunistic` field

A phase can grant the **main orchestrator** a scoped licence to *author and
dispatch ad-hoc sub-agents* (via the `Task` tool, `general-purpose`/`Explore`,
with a prompt written on the fly) when it spots something the planned agents
don't cover — e.g. on `onboard`'s `O2-DEPS`, noticing an old dependency and
spinning up an ad-hoc CVE lookup; in pentest recon, detecting WordPress and
launching specialised recon.

awok has no runtime, so this is purely **instructions injected into `SKILL.md`**,
scoped to the phase. The spawning power belongs to the main agent only — a
sub-agent cannot itself spawn sub-agents (Claude Code nesting limit = 1), so the
licence is exercised at the orchestration seam, after the planned sub-agent
returns.

`opportunistic` is `bool | object`, available at two levels:

```yaml
# top-level (workflow-wide default)
opportunistic:
  enabled: true
  when: |
    When you spot a signal the planned agents don't cover.
  examples:
    - "detected tech/CMS → specialised recon"

phases:
  - id: O2-DEPS
    opportunistic:                 # override: adds targeted guidance → 🧭
      when: "A dependency looks old / abandoned."
      examples: ["old dependency → ad-hoc agent that looks up known CVEs"]
  - id: O4-ARCHITECTURE
    opportunistic: false           # lock a deterministic reduce → ⛔
```

Resolution: a phase with `opportunistic: false` is locked; with `true`/object is
enabled; absent inherits the global default. `false` is the only way to disable.

Rendering: a global "🧭 Opportunistic autonomy" section (when the global default
is on) + per-phase notes (🧭 lead / ⛔ locked). The cartography marks 🧭 phases
that carry their own content and ⛔ locked phases.

**vs `on_demand_agents`**: those are out-of-DAG agents triggered by `when:`/
`triggered_by:` (hooks, skills); `opportunistic` is in-DAG, attached to a phase,
and the agents are authored on the fly rather than pre-written in `src/agents/`.
```

- [ ] **Step 2: Mention it in `README.md`**

In `README.md`, in the bullet list of what awok compiles (lines 17-20), after the
index bullet (`- an index of every workflow you've defined.`), add:

```markdown

It can also encode **opportunistic autonomy zones** — phases where the
orchestrator is licensed to author and launch ad-hoc sub-agents to handle the
unexpected (e.g. pentest recon), kept visible and bounded in the cartography.
```

- [ ] **Step 3: Document the field reference in `docs/dev/bb-workflow.md`**

In `docs/dev/bb-workflow.md`, add a subsection (place it near the phase/`type`
reference). Append this block at the end of the phase-fields documentation:

```markdown
### `opportunistic` (phase + top-level)

Grants the main orchestrator a scoped licence to author and dispatch ad-hoc
sub-agents on a phase. `bool | object`:

- `true` — enabled, generic guidance.
- `false` — disabled (the only way to lock a phase under a global default).
- `{ enabled?, when?, examples? }` — enabled with targeted guidance.

Top-level `opportunistic` sets the workflow default; a phase value overrides it.
Resolution and rendering:

| `phase.opportunistic` | global | phase active? | rendered |
|---|---|---|---|
| `false` | (any) | no (lock) | `⛔ No opportunistic autonomy here` |
| `true` / object | (any) | yes | 🧭 note (full if global off, short if global on + guidance) |
| absent | enabled | yes (inherited) | covered by the global section |
| absent | off | no | — |

Coherence warnings: `opportunistic` on a `workflow_call` phase (no effect);
`opportunistic: false` while the global default is off (redundant); a global
object disabled with no phase enabling it (dead config).
```

- [ ] **Step 4: Verify docs reference real behavior**

Run: `awok validate` (all workflows) and `python -m pytest src/scripts/tests/ -q`
Expected: validation clean, full test suite green.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/dev/bb-workflow.md
git commit -m "docs(awok): document the opportunistic field (CLAUDE.md, README, bb-workflow.md)"
```

---

## Final verification

- [ ] **Run the complete test suite**

Run: `python -m pytest src/scripts/tests/ -q`
Expected: all tests pass (including the new `test_workflow_opportunistic.py`).

- [ ] **Confirm no drift**

Run: `awok check`
Expected: exit 0.

- [ ] **(Optional) Deploy and smoke-test**

Run: `./install.sh` then restart Claude Code and invoke `/onboard` on a repo with old dependencies; confirm the orchestrator reads the 🧭 licence on the DEPS phase and respects the ⛔ lock on the architecture synthesis.

---

## Notes on deviations from the spec

- **Mermaid subtitle dropped.** The spec (§5) mentioned a graph subtitle "🧭
  Opportunistic workflow (except ⛔)". Mermaid flowcharts have no clean subtitle
  primitive; injecting one is fragile. The node markers (🧭/⛔ + amber dashed
  border) carry the visual signal, and the **text** cartography keeps the header
  mention. Net intent preserved without a brittle hack.
- **Two mermaid classes per node** are applied via a `class <id> <name>`
  statement (not the `:::` shorthand) so the group fill is preserved and only the
  border/stroke is overridden by `opportunistic`/`opp_locked`.
```
