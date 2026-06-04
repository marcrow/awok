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
    assert "PHASE_EXAMPLE_MARKER\n\n" in text   # short note is followed by a blank line, not glued


def test_skill_renders_locked_note(bbw_module, tmp_path):
    text = _gen_skill(bbw_module, tmp_path, OPP_WF)
    assert "No opportunistic autonomy here" in text
    assert "ask the user" in text


def test_skill_no_global_section_when_disabled(bbw_module, tmp_path):
    wf = OPP_WF.replace("  enabled: true", "  enabled: false")
    text = _gen_skill(bbw_module, tmp_path, wf)
    assert "## 🧭 Opportunistic autonomy" not in text


FULL_WF = """schema_version: 1
skill:
  name: demo
  description: d
groups:
  g: { description: x }
phases:
  - id: T1
    name: First
    group: g
    opportunistic:
      enabled: true
      when: FULL_WHEN_MARKER
      examples:
        - FULL_EXAMPLE_MARKER
    invocations:
      - agent: test-agent
"""


def test_skill_renders_full_grant_note(bbw_module, tmp_path):
    # No top-level opportunistic → global off → a phase enable yields note_kind 'full'.
    text = _gen_skill(bbw_module, tmp_path, FULL_WF)
    assert "Opportunistic autonomy — permitted on this phase" in text
    assert "FULL_WHEN_MARKER" in text
    assert "> Examples: FULL_EXAMPLE_MARKER" in text          # examples on their own blockquote line
    assert "FULL_WHEN_MARKER> Examples" not in text           # not glued to the when text
