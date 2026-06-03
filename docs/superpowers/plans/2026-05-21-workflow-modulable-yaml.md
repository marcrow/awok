# Workflow modulable YAML — bb-workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire `bb-workflow` — un CLI Python qui transforme `workflow.yaml` (source unique de vérité) en `SKILL.md` orchestrateur, en cartographie HTML/texte, et en nouveau diagramme dataflow.html. Migrer le `SKILL.md` actuel de 1070 lignes vers ce modèle sans perte de contenu.

**Architecture:** YAML source + snippets markdown par invocation agent → générateur Jinja2 produit les artefacts. JSON Schema valide le YAML. Pre-commit hook bloque le drift. Sub-agent Claude assiste les modifications complexes. Conventions : script sans extension `.py`, chargé via importlib pour les tests, pytest+stdlib.

**Tech Stack:** Python stdlib + PyYAML + Jinja2 + jsonschema. Pytest pour tests. Pas de SDK Claude (sub-agents invoqués via Task tool dans le runtime, pas dans le script).

**Spec source :** `docs/superpowers/specs/2026-05-21-workflow-modulable-yaml-design.md`

---

## File Structure

```
claude-setup/
├── workflow/                                      # NOUVEAU
│   ├── workflow.yaml                              # Source unique
│   ├── workflow.schema.json                       # JSON Schema validation
│   ├── templates/
│   │   ├── skill-skeleton.md.jinja                # Template SKILL.md
│   │   ├── cartography-texte.md.jinja             # Template carto ASCII
│   │   ├── cartography.mermaid.jinja              # Template flow de contrôle Mermaid
│   │   ├── dataflow.mermaid.jinja                 # Template dataflow Mermaid
│   │   ├── html-wrapper.html                      # Template HTML (libs inlinées)
│   │   └── invocations/
│   │       ├── js-cartographer.md                 # Un snippet par invocation
│   │       └── ...
│   └── manual/                                    # Sections SKILL.md non générées
│       ├── example-notes.md
│       └── manifeste-management.md
├── scripts/
│   ├── bb-workflow                                # NOUVEAU CLI (Python stdlib + PyYAML + Jinja2)
│   └── tests/
│       ├── conftest.py                            # Existant — étendre avec bbw_module
│       ├── test_workflow_schema.py                # NOUVEAU
│       ├── test_workflow_validate.py              # NOUVEAU
│       ├── test_workflow_dag.py                   # NOUVEAU
│       ├── test_workflow_generate.py              # NOUVEAU
│       ├── test_workflow_check.py                 # NOUVEAU
│       ├── test_workflow_migrate.py               # NOUVEAU
│       ├── test_workflow_rename.py                # NOUVEAU
│       └── fixtures/workflows/                    # NOUVEAU — YAML de test
│           ├── minimal.yaml
│           ├── valid-complex.yaml
│           ├── invalid-cycle.yaml
│           └── invalid-orphan.yaml
├── hooks/
│   └── pre-commit-bb-workflow-check.sh            # NOUVEAU — hook drift detection
└── install.sh                                     # MODIFIER — déployer bb-workflow

docs/architecture-cartography/
├── build.py                                       # REMPLACER — devient un wrapper HTML standalone
├── cartography-texte.md                           # GÉNÉRÉ
├── cartography.html                               # GÉNÉRÉ
├── dataflow.html                                  # NOUVEAU GÉNÉRÉ
└── _template.html                                 # Conservé (input du wrapper)

docs/dev/
└── bb-workflow.md                                 # NOUVEAU — guide utilisateur bb-workflow

CLAUDE-DEV.md                                      # MODIFIER — section bb-workflow
```

---

## Pre-flight Check

Avant de commencer, vérifier :

```bash
python3 --version            # >= 3.9
python3 -c "import yaml; print(yaml.__version__)"          # >= 5.x
python3 -c "import jinja2; print(jinja2.__version__)"      # >= 3.x (à installer si absent)
python3 -c "import jsonschema; print(jsonschema.__version__)"  # >= 4.x (à installer si absent)
pytest --version             # >= 7.x
```

Si `jinja2` ou `jsonschema` absent :
```bash
pip install jinja2 jsonschema
```

Confirmer : `ls claude-setup/scripts/bb-workflow` (le CLI principal).

---

## Phase 1 — Schéma + validation (CLI skeleton)

**Objectif** : `bb-workflow validate workflow.yaml` rejette les YAML invalides et accepte les valides.

### Task 1.1 — Structure projet + JSON Schema minimal

**Files:**
- Create: `claude-setup/workflow/workflow.schema.json`
- Create: `claude-setup/workflow/workflow.yaml` (fixture minimal pour démarrer)
- Create: `claude-setup/workflow/templates/invocations/` (dossier vide)
- Create: `claude-setup/scripts/tests/fixtures/workflows/minimal.yaml`

- [ ] **Step 1: Créer la structure de dossiers**

```bash
mkdir -p claude-setup/workflow/templates/invocations
mkdir -p claude-setup/workflow/manual
mkdir -p claude-setup/scripts/tests/fixtures/workflows
```

- [ ] **Step 2: Écrire `workflow.schema.json` — version 1 minimale**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "awok workflow.yaml",
  "type": "object",
  "required": ["schema_version", "groups", "phases"],
  "properties": {
    "schema_version": { "const": 1 },
    "groups": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["description"],
        "properties": {
          "description": { "type": "string" },
          "risk": { "enum": ["none", "low", "medium", "high"] }
        }
      }
    },
    "phases": {
      "type": "array",
      "items": { "$ref": "#/definitions/phase" }
    },
    "brainstormings": {
      "type": "array",
      "items": { "$ref": "#/definitions/brainstorming" }
    },
    "conditions": {
      "type": "object",
      "additionalProperties": { "$ref": "#/definitions/condition" }
    },
    "manual_sections": {
      "type": "array",
      "items": { "$ref": "#/definitions/manual_section" }
    }
  },
  "definitions": {
    "phase": {
      "type": "object",
      "required": ["id", "name", "group"],
      "properties": {
        "id": { "type": "string", "pattern": "^[A-Z][A-Z0-9-]*$" },
        "name": { "type": "string" },
        "group": { "type": "string" },
        "type": { "enum": ["agent", "script", "external", "main_agent"], "default": "agent" },
        "description": { "type": "string" },
        "depends_on": { "type": "array", "items": { "type": "string" } },
        "parallel_with": { "type": "array", "items": { "type": "string" } },
        "triggers": { "type": "array", "items": { "$ref": "#/definitions/trigger" } },
        "cmd": { "type": "string" },
        "invocations": { "type": "array", "items": { "$ref": "#/definitions/invocation" } },
        "inputs": { "type": "array", "items": { "$ref": "#/definitions/io_ref" } },
        "outputs": { "type": "array", "items": { "$ref": "#/definitions/io_ref" } }
      }
    },
    "invocation": {
      "type": "object",
      "required": ["agent"],
      "properties": {
        "agent": { "type": "string" },
        "description": { "type": "string" },
        "model": { "enum": ["haiku", "sonnet", "opus", "inherit"] },
        "background": { "type": "boolean" },
        "depends_on_invocation": { "type": "string" },
        "skip_if": { "type": "string" },
        "triggers": { "type": "array", "items": { "$ref": "#/definitions/trigger" } },
        "inputs": { "type": "array", "items": { "$ref": "#/definitions/io_ref" } },
        "outputs": { "type": "array", "items": { "$ref": "#/definitions/io_ref" } }
      }
    },
    "io_ref": {
      "type": "object",
      "required": ["path", "kind"],
      "properties": {
        "path": { "type": "string" },
        "kind": { "enum": ["json", "jsonl", "md", "text", "yaml", "dir", "sqlite", "binary"] },
        "optional": { "type": "boolean", "default": false }
      }
    },
    "trigger": {
      "type": "object",
      "required": ["on"],
      "properties": {
        "on": { "enum": ["file_appears", "file_changes", "event", "db_event", "threshold_reached"] },
        "path": { "type": "string" },
        "type": { "type": "string" },
        "source": { "type": "string" },
        "condition": { "type": "string" }
      }
    },
    "brainstorming": {
      "type": "object",
      "required": ["id", "timebox_minutes", "protocol"],
      "properties": {
        "id": { "type": "string" },
        "after_phase": { "type": "string" },
        "before_phase": { "type": "string" },
        "timebox_minutes": { "type": "integer", "minimum": 1 },
        "protocol": { "enum": ["brainstorm-light", "brainstorm-deep"] },
        "output": { "type": "array", "items": { "$ref": "#/definitions/io_ref" } }
      }
    },
    "condition": {
      "type": "object",
      "required": ["check"],
      "properties": {
        "check": { "enum": ["file_missing", "file_exists", "dir_missing", "dir_exists"] },
        "path": { "type": "string" }
      }
    },
    "manual_section": {
      "type": "object",
      "required": ["name", "path", "insert_at"],
      "properties": {
        "name": { "type": "string" },
        "path": { "type": "string" },
        "insert_at": { "type": "string" }
      }
    }
  }
}
```

- [ ] **Step 3: Créer `claude-setup/scripts/tests/fixtures/workflows/minimal.yaml`**

```yaml
schema_version: 1

groups:
  test-group:
    description: Group de test
    risk: none

phases:
  - id: T1
    name: Test phase
    group: test-group
    invocations:
      - agent: test-agent
        description: Agent de test
        model: haiku
```

- [ ] **Step 4: Créer `claude-setup/workflow/workflow.yaml` initial (vide mais valide)**

Copier le contenu de `minimal.yaml` vers `claude-setup/workflow/workflow.yaml`. Sera étoffé en Phase 6 (migration).

- [ ] **Step 5: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/workflow/ claude-setup/scripts/tests/fixtures/workflows/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): JSON schema + structure projet"
```

### Task 1.2 — bb-workflow CLI skeleton + validate command (TDD)

**Files:**
- Create: `claude-setup/scripts/bb-workflow`
- Modify: `claude-setup/scripts/tests/conftest.py` (ajouter fixture `bbw_module`)
- Create: `claude-setup/scripts/tests/test_workflow_schema.py`

- [ ] **Step 1: Étendre conftest.py — ajouter fixture `bbw_module`**

Ajouter en fin de `claude-setup/scripts/tests/conftest.py` :

```python
BBW_SCRIPT_PATH = REPO_ROOT / "claude-setup" / "scripts" / "bb-workflow"


@pytest.fixture(scope="session")
def bbw_module():
    """Load bb-workflow as a Python module."""
    loader = SourceFileLoader("bbw", str(BBW_SCRIPT_PATH))
    spec = importlib.util.spec_from_loader("bbw", loader)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.modules["bbw"] = mod
    return mod
```

- [ ] **Step 2: Écrire le test `test_workflow_schema.py`**

```python
"""Tests for the JSON Schema validation of workflow.yaml."""
from pathlib import Path
import json
import yaml
import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "claude-setup" / "workflow" / "workflow.schema.json"
FIXTURES_DIR = Path(__file__).parent / "fixtures" / "workflows"


def test_schema_loads():
    """Schema file is valid JSON."""
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    assert schema["$schema"] == "http://json-schema.org/draft-07/schema#"


def test_minimal_workflow_validates(bbw_module):
    """Minimal valid workflow passes validation."""
    with open(FIXTURES_DIR / "minimal.yaml") as f:
        wf = yaml.safe_load(f)
    errors = bbw_module.validate_schema(wf)
    assert errors == [], f"Unexpected errors: {errors}"


def test_missing_schema_version_fails(bbw_module):
    """Workflow without schema_version fails."""
    wf = {"groups": {}, "phases": []}
    errors = bbw_module.validate_schema(wf)
    assert any("schema_version" in e for e in errors)


def test_invalid_phase_id_pattern_fails(bbw_module):
    """Phase IDs must match ^[A-Z][A-Z0-9-]*$."""
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "invalid-lowercase", "name": "X", "group": "g"}],
    }
    errors = bbw_module.validate_schema(wf)
    assert any("invalid-lowercase" in e or "pattern" in e for e in errors)
```

- [ ] **Step 3: Run tests pour vérifier qu'ils échouent (fixtures pas encore créées)**

```bash
pytest claude-setup/scripts/tests/test_workflow_schema.py -v
```
Expected: FAIL — `bb-workflow` n'existe pas.

- [ ] **Step 4: Créer le squelette `bb-workflow`**

```python
#!/usr/bin/env python3
"""bb-workflow — CLI générateur du workflow awok.

Source unique de vérité : workflow.yaml. Génère : SKILL.md, cartographie HTML,
dataflow.html depuis le YAML + snippets markdown.

Usage:
  bb-workflow validate [path/to/workflow.yaml]
  bb-workflow generate [--workflow path] [--output-dir path]
  bb-workflow check [--workflow path] [--skill path]
  bb-workflow diff <phase-id>
  bb-workflow assist <change-desc>
  bb-workflow new-phase --interactive
  bb-workflow rename-agent <old> <new>
  bb-workflow migrate-from-skill <skill-path>
"""
import argparse
import json
import sys
from pathlib import Path

import yaml
import jsonschema


REPO_ROOT_GUESS = Path(__file__).resolve().parents[2]
DEFAULT_WORKFLOW_PATH = REPO_ROOT_GUESS / "claude-setup" / "workflow" / "workflow.yaml"
DEFAULT_SCHEMA_PATH = REPO_ROOT_GUESS / "claude-setup" / "workflow" / "workflow.schema.json"


# ============================================================================
# Validation
# ============================================================================

def load_schema(schema_path: Path = None) -> dict:
    """Load workflow.schema.json."""
    path = schema_path or DEFAULT_SCHEMA_PATH
    with open(path) as f:
        return json.load(f)


def validate_schema(workflow: dict, schema: dict = None) -> list[str]:
    """Validate workflow dict against JSON Schema. Returns list of error messages (empty if valid)."""
    schema = schema or load_schema()
    validator = jsonschema.Draft7Validator(schema)
    errors = []
    for err in validator.iter_errors(workflow):
        path = ".".join(str(p) for p in err.absolute_path) or "<root>"
        errors.append(f"{path}: {err.message}")
    return errors


# ============================================================================
# CLI
# ============================================================================

def cmd_validate(args):
    """Validate a workflow.yaml against schema + coherence rules."""
    workflow_path = Path(args.workflow) if args.workflow else DEFAULT_WORKFLOW_PATH
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)

    errors = validate_schema(workflow)
    if errors:
        for e in errors:
            print(f"  SCHEMA: {e}", file=sys.stderr)
        print(f"❌ {len(errors)} schema error(s) in {workflow_path}", file=sys.stderr)
        return 1
    print(f"✅ {workflow_path} valid")
    return 0


def main():
    parser = argparse.ArgumentParser(description="bb-workflow CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_val = sub.add_parser("validate", help="Validate workflow.yaml")
    p_val.add_argument("workflow", nargs="?", default=None)
    p_val.set_defaults(func=cmd_validate)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run tests à nouveau — doivent passer**

```bash
pytest claude-setup/scripts/tests/test_workflow_schema.py -v
```
Expected: PASS (4 tests).

- [ ] **Step 6: Test manuel CLI**

```bash
python3 claude-setup/scripts/bb-workflow validate claude-setup/workflow/workflow.yaml
```
Expected output: `✅ ... valid`

- [ ] **Step 7: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): CLI skeleton + validate command"
```

### Task 1.3 — Cohérence checks (au-delà du schema)

Le schema vérifie la STRUCTURE. La cohérence vérifie les RÉFÉRENCES (agents existent, depends_on valide, conditions référencées).

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `validate_coherence`)
- Create: `claude-setup/scripts/tests/test_workflow_validate.py`
- Create: `claude-setup/scripts/tests/fixtures/workflows/invalid-cycle.yaml`
- Create: `claude-setup/scripts/tests/fixtures/workflows/invalid-orphan.yaml`

- [ ] **Step 1: Créer les fixtures invalides**

`invalid-cycle.yaml` :
```yaml
schema_version: 1
groups:
  g: { description: x }
phases:
  - id: T1
    name: x
    group: g
    depends_on: [T2]
  - id: T2
    name: y
    group: g
    depends_on: [T1]
```

`invalid-orphan.yaml` :
```yaml
schema_version: 1
groups:
  g: { description: x }
phases:
  - id: T1
    name: x
    group: g
    depends_on: [T999]
```

- [ ] **Step 2: Écrire les tests `test_workflow_validate.py`**

```python
"""Tests for coherence validation beyond the JSON schema."""
from pathlib import Path
import yaml
import pytest


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "workflows"


def load_fixture(name):
    with open(FIXTURES_DIR / name) as f:
        return yaml.safe_load(f)


def test_minimal_passes_coherence(bbw_module, tmp_path):
    """Minimal workflow has no coherence errors."""
    # Need an agents dir for the test
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    wf = load_fixture("minimal.yaml")
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert errors == []


def test_unknown_agent_fails(bbw_module, tmp_path):
    """Agent referenced but not in agents/ dir."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    # No agent file created

    wf = load_fixture("minimal.yaml")
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("test-agent" in e and "not found" in e for e in errors)


def test_cycle_detection(bbw_module, tmp_path):
    """Cyclic depends_on detected."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    wf = load_fixture("invalid-cycle.yaml")
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("cycle" in e.lower() for e in errors)


def test_orphan_dependency_detected(bbw_module, tmp_path):
    """depends_on references a phase that doesn't exist."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    wf = load_fixture("invalid-orphan.yaml")
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("T999" in e for e in errors)


def test_unknown_group_fails(bbw_module, tmp_path):
    """Phase references a group not declared."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "x", "group": "undeclared-group", "invocations": []}],
    }
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("undeclared-group" in e for e in errors)


def test_unknown_condition_fails(bbw_module, tmp_path):
    """skip_if references a condition not declared."""
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "conditions": {},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "test-agent", "skip_if": "no_such_condition"}],
        }],
    }
    errors = bbw_module.validate_coherence(wf, agents_dir=agents_dir)
    assert any("no_such_condition" in e for e in errors)
```

- [ ] **Step 3: Run tests — doivent échouer (validate_coherence n'existe pas)**

```bash
pytest claude-setup/scripts/tests/test_workflow_validate.py -v
```
Expected: FAIL.

- [ ] **Step 4: Implémenter `validate_coherence` dans bb-workflow**

Ajouter dans `bb-workflow` (avant la section CLI) :

```python
DEFAULT_AGENTS_DIR = REPO_ROOT_GUESS / "claude-setup" / "agents"


def _all_agent_names(agents_dir: Path) -> set[str]:
    """Set of agent names from <agents_dir>/*.md frontmatter."""
    names = set()
    for md_file in agents_dir.glob("*.md"):
        names.add(md_file.stem)
    return names


def _detect_cycle(phases: list[dict]) -> str | None:
    """Returns a description of a cycle if found in depends_on, None otherwise."""
    graph = {p["id"]: p.get("depends_on", []) for p in phases}
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {pid: WHITE for pid in graph}

    def dfs(node, path):
        color[node] = GRAY
        for nxt in graph.get(node, []):
            if nxt not in graph:
                continue  # caught by orphan check
            if color[nxt] == GRAY:
                return path + [nxt]
            if color[nxt] == WHITE:
                cycle = dfs(nxt, path + [nxt])
                if cycle:
                    return cycle
        color[node] = BLACK
        return None

    for pid in graph:
        if color[pid] == WHITE:
            cycle = dfs(pid, [pid])
            if cycle:
                return " -> ".join(cycle)
    return None


def validate_coherence(workflow: dict, agents_dir: Path = None) -> list[str]:
    """Validate cross-references: agents exist, depends_on valid, conditions used exist."""
    agents_dir = agents_dir or DEFAULT_AGENTS_DIR
    errors = []
    known_agents = _all_agent_names(agents_dir)
    known_phase_ids = {p["id"] for p in workflow.get("phases", [])}
    known_groups = set(workflow.get("groups", {}).keys())
    known_conditions = set(workflow.get("conditions", {}).keys())

    for phase in workflow.get("phases", []):
        pid = phase["id"]

        # group must be declared
        if phase["group"] not in known_groups:
            errors.append(f"phase '{pid}' references unknown group '{phase['group']}'")

        # depends_on must reference existing phases
        for dep in phase.get("depends_on", []):
            if dep not in known_phase_ids:
                errors.append(f"phase '{pid}' depends_on references unknown phase '{dep}'")

        # parallel_with similarly
        for par in phase.get("parallel_with", []):
            if par not in known_phase_ids:
                errors.append(f"phase '{pid}' parallel_with references unknown phase '{par}'")

        # invocations
        for inv in phase.get("invocations", []):
            agent = inv["agent"]
            if agent not in known_agents:
                errors.append(f"phase '{pid}' invocation agent '{agent}' not found in {agents_dir}")

            skip_if = inv.get("skip_if")
            if skip_if and skip_if not in known_conditions:
                errors.append(f"phase '{pid}' invocation '{agent}' references unknown condition '{skip_if}'")

    # Cycle detection
    cycle = _detect_cycle(workflow.get("phases", []))
    if cycle:
        errors.append(f"depends_on cycle detected: {cycle}")

    return errors
```

Et modifier `cmd_validate` pour appeler aussi la cohérence :

```python
def cmd_validate(args):
    workflow_path = Path(args.workflow) if args.workflow else DEFAULT_WORKFLOW_PATH
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)

    schema_errors = validate_schema(workflow)
    coherence_errors = validate_coherence(workflow)

    for e in schema_errors:
        print(f"  SCHEMA: {e}", file=sys.stderr)
    for e in coherence_errors:
        print(f"  COHERENCE: {e}", file=sys.stderr)

    total = len(schema_errors) + len(coherence_errors)
    if total:
        print(f"❌ {total} error(s) in {workflow_path}", file=sys.stderr)
        return 1
    print(f"✅ {workflow_path} valid")
    return 0
```

- [ ] **Step 5: Run tests — doivent passer**

```bash
pytest claude-setup/scripts/tests/test_workflow_validate.py -v
```
Expected: PASS (6 tests).

- [ ] **Step 6: Run all workflow tests pour vérifier qu'on n'a rien cassé**

```bash
pytest claude-setup/scripts/tests/test_workflow_*.py -v
```
Expected: PASS (10 tests total).

- [ ] **Step 7: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): coherence validation (agents, cycles, references)"
```

---

## Phase 2 — Parser DAG + détection d'incohérences data-flow

**Objectif** : Construire le DAG d'exécution depuis le YAML et croiser avec les inputs/outputs pour détecter les flux orphelins.

### Task 2.1 — Build DAG from YAML

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `build_dag`)
- Create: `claude-setup/scripts/tests/test_workflow_dag.py`
- Create: `claude-setup/scripts/tests/fixtures/workflows/valid-complex.yaml`

- [ ] **Step 1: Créer la fixture complexe**

`valid-complex.yaml` :
```yaml
schema_version: 1

groups:
  g1: { description: "Group 1", risk: none }
  g2: { description: "Group 2", risk: low }

conditions:
  no_data:
    check: file_missing
    path: data/in.json

phases:
  - id: T1
    name: First
    group: g1
    invocations:
      - agent: agent-a
        outputs:
          - { path: out/a.json, kind: json }

  - id: T2
    name: Second
    group: g1
    parallel_with: [T3]
    invocations:
      - agent: agent-b
        inputs:
          - { path: out/a.json, kind: json }
        outputs:
          - { path: out/b.json, kind: json }

  - id: T3
    name: Third
    group: g2
    parallel_with: [T2]
    invocations:
      - agent: agent-c
        inputs:
          - { path: out/a.json, kind: json }
        outputs:
          - { path: out/c.json, kind: json }

  - id: T4
    name: Fourth
    group: g2
    depends_on: [T2, T3]
    invocations:
      - agent: agent-d
        skip_if: no_data
        inputs:
          - { path: out/b.json, kind: json }
          - { path: out/c.json, kind: json }
```

- [ ] **Step 2: Écrire test `test_workflow_dag.py`**

```python
"""Tests for DAG construction and topological order."""
from pathlib import Path
import yaml


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "workflows"


def load_fixture(name):
    with open(FIXTURES_DIR / name) as f:
        return yaml.safe_load(f)


def test_build_dag_returns_topo_order(bbw_module):
    wf = load_fixture("valid-complex.yaml")
    dag = bbw_module.build_dag(wf)
    order = dag.topo_order()
    # T1 must come before T2 and T3, T2 and T3 before T4
    assert order.index("T1") < order.index("T2")
    assert order.index("T1") < order.index("T3")
    assert order.index("T2") < order.index("T4")
    assert order.index("T3") < order.index("T4")


def test_dag_parallel_groups(bbw_module):
    """parallel_with phases form a same execution level."""
    wf = load_fixture("valid-complex.yaml")
    dag = bbw_module.build_dag(wf)
    levels = dag.execution_levels()
    # Level 0: T1
    # Level 1: T2, T3 (parallel)
    # Level 2: T4
    assert levels[0] == ["T1"]
    assert set(levels[1]) == {"T2", "T3"}
    assert levels[2] == ["T4"]


def test_dag_dataflow_edges(bbw_module):
    """Each input matched to its producing output."""
    wf = load_fixture("valid-complex.yaml")
    dag = bbw_module.build_dag(wf)
    edges = dag.dataflow_edges()
    # T1 produces out/a.json, consumed by T2 and T3
    assert ("T1", "agent-a", "T2", "agent-b", "out/a.json") in edges
    assert ("T1", "agent-a", "T3", "agent-c", "out/a.json") in edges
```

- [ ] **Step 3: Run tests — doivent échouer**

```bash
pytest claude-setup/scripts/tests/test_workflow_dag.py -v
```
Expected: FAIL.

- [ ] **Step 4: Implémenter `build_dag` dans bb-workflow**

Ajouter dans `bb-workflow` :

```python
# ============================================================================
# DAG construction
# ============================================================================

class WorkflowDAG:
    """Represents the DAG of phases with execution order and data flow."""

    def __init__(self, phases: list[dict]):
        self.phases = {p["id"]: p for p in phases}
        self._build_edges()

    def _build_edges(self):
        """Build control-flow edges (depends_on) and data-flow edges (inputs/outputs)."""
        # Control edges: child -> set(parents)
        self.parents = {pid: set(p.get("depends_on", [])) for pid, p in self.phases.items()}

        # parallel_with is symmetric; treated as no order constraint between them
        # but both must come after their shared dependencies
        self.parallel_with = {pid: set(p.get("parallel_with", [])) for pid, p in self.phases.items()}

        # Output index: path -> (phase_id, invocation_agent)
        self.output_index = {}
        for pid, p in self.phases.items():
            for inv in p.get("invocations", []):
                for out in inv.get("outputs", []):
                    self.output_index[out["path"]] = (pid, inv["agent"])

    def topo_order(self) -> list[str]:
        """Topological sort respecting depends_on. parallel_with phases are siblings."""
        # Kahn's algorithm
        indeg = {pid: 0 for pid in self.phases}
        for pid, parents in self.parents.items():
            indeg[pid] = len(parents)

        ready = sorted([pid for pid, d in indeg.items() if d == 0])
        order = []
        # children[parent] = list of children
        children = {pid: [] for pid in self.phases}
        for child, parents in self.parents.items():
            for p in parents:
                children[p].append(child)

        while ready:
            current = ready.pop(0)
            order.append(current)
            for child in children[current]:
                indeg[child] -= 1
                if indeg[child] == 0:
                    ready.append(child)
            ready.sort()

        if len(order) != len(self.phases):
            raise ValueError("Cycle detected; cannot produce topo order")
        return order

    def execution_levels(self) -> list[list[str]]:
        """Group phases by execution level (level N depends on level N-1)."""
        level_of = {}
        for pid in self.topo_order():
            parents = self.parents[pid]
            if not parents:
                level_of[pid] = 0
            else:
                level_of[pid] = 1 + max(level_of[p] for p in parents)

        max_level = max(level_of.values()) if level_of else 0
        levels = [[] for _ in range(max_level + 1)]
        for pid, lvl in level_of.items():
            levels[lvl].append(pid)
        # sort each level deterministically
        for lvl in levels:
            lvl.sort()
        return levels

    def dataflow_edges(self) -> set[tuple]:
        """Returns set of (producer_phase, producer_agent, consumer_phase, consumer_agent, path)."""
        edges = set()
        for pid, p in self.phases.items():
            for inv in p.get("invocations", []):
                for inp in inv.get("inputs", []):
                    path = inp["path"]
                    if path in self.output_index:
                        prod_pid, prod_agent = self.output_index[path]
                        edges.add((prod_pid, prod_agent, pid, inv["agent"], path))
        return edges


def build_dag(workflow: dict) -> WorkflowDAG:
    """Construct DAG from workflow dict."""
    return WorkflowDAG(workflow.get("phases", []))
```

- [ ] **Step 5: Run tests — doivent passer**

```bash
pytest claude-setup/scripts/tests/test_workflow_dag.py -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): build DAG + topo order + dataflow edges"
```

### Task 2.2 — Détection d'incohérences data-flow (warnings)

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `check_dataflow_warnings`)
- Modify: `claude-setup/scripts/tests/test_workflow_dag.py` (ajouter tests warnings)

- [ ] **Step 1: Ajouter tests dans `test_workflow_dag.py`**

```python
def test_orphan_input_warning(bbw_module):
    """Input file that has no producing phase generates a warning."""
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "inputs": [{"path": "nowhere/missing.json", "kind": "json"}],
            }],
        }],
    }
    warnings = bbw_module.check_dataflow_warnings(wf)
    assert any("missing.json" in w and "no producer" in w for w in warnings)


def test_optional_input_no_warning(bbw_module):
    """Optional input without producer doesn't warn."""
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "inputs": [{"path": "nowhere/missing.json", "kind": "json", "optional": True}],
            }],
        }],
    }
    warnings = bbw_module.check_dataflow_warnings(wf)
    assert not any("missing.json" in w for w in warnings)


def test_orphan_output_warning(bbw_module):
    """Output that no one consumes is a soft warning (might be report)."""
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "outputs": [{"path": "report/final.md", "kind": "md"}],
            }],
        }],
    }
    warnings = bbw_module.check_dataflow_warnings(wf)
    assert any("final.md" in w and "no consumer" in w for w in warnings)
```

- [ ] **Step 2: Run tests — doivent échouer**

- [ ] **Step 3: Implémenter `check_dataflow_warnings`**

```python
def check_dataflow_warnings(workflow: dict) -> list[str]:
    """Detect data-flow incoherences. Returns warnings (non-blocking)."""
    warnings = []
    dag = build_dag(workflow)

    # 1. Orphan inputs: required inputs with no producer
    all_inputs = []
    for pid, p in dag.phases.items():
        for inv in p.get("invocations", []):
            for inp in inv.get("inputs", []):
                all_inputs.append((pid, inv["agent"], inp))

    for pid, agent, inp in all_inputs:
        if inp.get("optional"):
            continue
        path = inp["path"]
        # Allow inputs from outside the pipeline (no producer is OK if file is "given")
        # We only warn if the path looks like a generated artifact under work/
        if path.startswith(("work/",)) and path not in dag.output_index:
            warnings.append(f"phase '{pid}' invocation '{agent}': input '{path}' has no producer")

    # 2. Orphan outputs: outputs that no one reads (soft warning)
    consumed_paths = set()
    for _, _, _, _, path in dag.dataflow_edges():
        consumed_paths.add(path)

    for path, (pid, agent) in dag.output_index.items():
        if path not in consumed_paths:
            # Only warn for intermediate artifacts; final reports are allowed unconsumed
            if path.startswith("work/") and not path.endswith(("findings.md", "report.md")):
                warnings.append(f"phase '{pid}' invocation '{agent}': output '{path}' has no consumer")

    return warnings
```

- [ ] **Step 4: Run tests — doivent passer**

- [ ] **Step 5: Brancher dans `cmd_validate`**

Modifier `cmd_validate` pour afficher les warnings (sans bloquer) :

```python
def cmd_validate(args):
    workflow_path = Path(args.workflow) if args.workflow else DEFAULT_WORKFLOW_PATH
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)

    schema_errors = validate_schema(workflow)
    coherence_errors = validate_coherence(workflow)
    warnings = check_dataflow_warnings(workflow)

    for e in schema_errors:
        print(f"  SCHEMA: {e}", file=sys.stderr)
    for e in coherence_errors:
        print(f"  COHERENCE: {e}", file=sys.stderr)
    for w in warnings:
        print(f"  WARNING: {w}", file=sys.stderr)

    total_errors = len(schema_errors) + len(coherence_errors)
    if total_errors:
        print(f"❌ {total_errors} error(s), {len(warnings)} warning(s)", file=sys.stderr)
        return 1
    if warnings:
        print(f"⚠️  {len(warnings)} warning(s) — not blocking")
    print(f"✅ {workflow_path} valid")
    return 0
```

- [ ] **Step 6: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): dataflow warnings (orphan inputs/outputs)"
```

---

## Phase 3 — Generator core (SKILL.md)

**Objectif** : `bb-workflow generate` produit le SKILL.md depuis le YAML + snippets.

### Task 3.1 — Snippet loader (frontmatter + body)

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `load_snippet`)
- Create: `claude-setup/scripts/tests/test_workflow_generate.py`
- Create: `claude-setup/workflow/templates/invocations/test-agent.md` (snippet fixture)

- [ ] **Step 1: Créer un snippet fixture**

`claude-setup/workflow/templates/invocations/test-agent.md` :
```markdown
---
agent: test-agent
generated: false
---

Tu es l'agent test-agent. Lis ~/.claude/agents/test-agent.md pour tes instructions complètes.

Workspace : {{ workspace }}

## Inputs lus
{{ inputs_table }}

## Output à produire
{{ outputs_table }}

## Tâche
Fais ton travail.
```

- [ ] **Step 2: Écrire test `test_workflow_generate.py`**

```python
"""Tests for snippet loading and template rendering."""
from pathlib import Path
import yaml
import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
SNIPPETS_DIR = REPO_ROOT / "claude-setup" / "workflow" / "templates" / "invocations"


def test_load_snippet_parses_frontmatter(bbw_module):
    snippet = bbw_module.load_snippet(SNIPPETS_DIR / "test-agent.md")
    assert snippet.frontmatter["agent"] == "test-agent"
    assert snippet.frontmatter["generated"] is False
    assert "Tu es l'agent test-agent" in snippet.body


def test_load_snippet_missing_file_raises(bbw_module, tmp_path):
    with pytest.raises(FileNotFoundError):
        bbw_module.load_snippet(tmp_path / "missing.md")


def test_load_snippet_no_frontmatter_raises(bbw_module, tmp_path):
    p = tmp_path / "bad.md"
    p.write_text("no frontmatter here")
    with pytest.raises(ValueError, match="frontmatter"):
        bbw_module.load_snippet(p)
```

- [ ] **Step 3: Implémenter `load_snippet`**

Ajouter dans `bb-workflow` :

```python
# ============================================================================
# Snippet loader
# ============================================================================

from dataclasses import dataclass


@dataclass
class Snippet:
    frontmatter: dict
    body: str
    path: Path


def load_snippet(path: Path) -> Snippet:
    """Load a markdown snippet with YAML frontmatter."""
    text = Path(path).read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"{path}: missing YAML frontmatter (expected '---' on line 1)")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise ValueError(f"{path}: unterminated YAML frontmatter")
    fm_text = text[4:end]
    body = text[end + 5:]
    frontmatter = yaml.safe_load(fm_text) or {}
    return Snippet(frontmatter=frontmatter, body=body, path=Path(path))
```

- [ ] **Step 4: Run tests — passent**

- [ ] **Step 5: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): snippet loader (frontmatter + body)"
```

### Task 3.2 — Template Jinja2 + substitutions I/O

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `render_snippet`)
- Create: `claude-setup/workflow/templates/skill-skeleton.md.jinja`

- [ ] **Step 1: Écrire `skill-skeleton.md.jinja` (template SKILL.md complet)**

```jinja
---
name: demo
description: |
  Use when starting or resuming an analysis session. Orchestrates
  specialized agents in phases (auto-generated from workflow.yaml).
---

# /demo — Orchestrateur d'analyse

> ⚠️ Ce fichier est **GÉNÉRÉ** depuis `claude-setup/workflow/workflow.yaml`.
> Ne pas éditer à la main. Pour modifier : éditer le YAML puis `bb-workflow generate`.

Pipeline en {{ phase_count }} phases, organisées en {{ group_count }} groupes.

---

{% for phase in phases %}
## Phase {{ phase.id }} — {{ phase.name }}

> **Groupe** : `{{ phase.group }}` · **Type** : `{{ phase.type|default('agent') }}`
{%- if phase.depends_on %} · **Dépend de** : {{ phase.depends_on|join(', ') }}{% endif %}
{%- if phase.parallel_with %} · **Parallèle avec** : {{ phase.parallel_with|join(', ') }}{% endif %}
{%- if phase.triggers %} · **Déclenchement réactif** : {{ phase.triggers|tojson }}{% endif %}

{% if phase.description %}{{ phase.description }}{% endif %}

{% if phase.type == 'script' %}
### Commande à exécuter

```bash
{{ phase.cmd }}
```

{% elif phase.type == 'external' %}
### Outil externe (hors pipeline orchestré)

Cette phase est gérée hors du pipeline (ex : outils externes). Les outputs attendus :

{% for out in phase.outputs|default([]) %}
- `{{ out.path }}` ({{ out.kind }})
{% endfor %}

{% elif phase.type == 'main_agent' %}
### Étape main agent

{% for inv_block in phase.rendered_invocations %}
{{ inv_block }}
{% endfor %}

{% else %}
### Invocations

{% for inv_block in phase.rendered_invocations %}
{{ inv_block }}
{% endfor %}
{% endif %}

---

{% endfor %}
{% if brainstormings %}
## Brainstormings

{% for bs in brainstormings %}
### Brainstorming `{{ bs.id }}` — {{ bs.protocol }} ({{ bs.timebox_minutes }} min)

{% if bs.after_phase %}Lancé après `{{ bs.after_phase }}`{% endif %}{% if bs.before_phase %}, avant `{{ bs.before_phase }}`{% endif %}.

Voir `docs/new_process_improve_coverage/spec-v2/04-brainstorming-protocol.md` pour le protocole détaillé.

{% endfor %}
{% endif %}
{% if manual_blocks %}
{% for block in manual_blocks %}

{{ block }}

{% endfor %}
{% endif %}
```

- [ ] **Step 2: Ajouter test de rendu basique**

Dans `test_workflow_generate.py` :

```python
def test_render_snippet_substitutes_io(bbw_module, tmp_path):
    snippet = bbw_module.load_snippet(SNIPPETS_DIR / "test-agent.md")
    invocation = {
        "agent": "test-agent",
        "inputs": [{"path": "in/a.json", "kind": "json"}],
        "outputs": [{"path": "out/b.json", "kind": "json"}],
    }
    rendered = bbw_module.render_snippet(snippet, invocation)
    assert "in/a.json" in rendered
    assert "out/b.json" in rendered
    assert "{{ inputs_table }}" not in rendered  # substituted
    assert "{{ workspace }}" in rendered or "<CWD>" in rendered  # placeholder kept or replaced
```

- [ ] **Step 3: Implémenter `render_snippet`**

```python
# Import jinja2 at top of file
import jinja2


def _format_io_table(items: list[dict]) -> str:
    """Format a list of {path, kind, optional?} as a markdown table."""
    if not items:
        return "_(aucun)_"
    lines = ["| Path | Kind | Optional |", "|------|------|----------|"]
    for it in items:
        opt = "yes" if it.get("optional") else ""
        lines.append(f"| `{it['path']}` | {it['kind']} | {opt} |")
    return "\n".join(lines)


def render_snippet(snippet: Snippet, invocation: dict) -> str:
    """Render a snippet body with Jinja2, substituting inputs_table/outputs_table."""
    env = jinja2.Environment(
        undefined=jinja2.ChainableUndefined,
        autoescape=False,
        keep_trailing_newline=True,
    )
    template = env.from_string(snippet.body)
    context = {
        "workspace": "<CWD>",
        "inputs_table": _format_io_table(invocation.get("inputs", [])),
        "outputs_table": _format_io_table(invocation.get("outputs", [])),
        **invocation,
    }
    return template.render(**context)
```

- [ ] **Step 4: Run tests — passent**

- [ ] **Step 5: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): Jinja2 snippet rendering + I/O table substitution"
```

### Task 3.3 — `bb-workflow generate` — assemblage SKILL.md

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `generate_skill_md`, `cmd_generate`)

- [ ] **Step 1: Test E2E génération**

Dans `test_workflow_generate.py` :

```python
def test_generate_skill_produces_file(bbw_module, tmp_path, monkeypatch):
    # Setup minimal workflow + snippet in tmp
    workflow_dir = tmp_path / "workflow"
    workflow_dir.mkdir()
    (workflow_dir / "templates" / "invocations").mkdir(parents=True)

    # Copy fixtures
    import shutil
    shutil.copy(SNIPPETS_DIR / "test-agent.md", workflow_dir / "templates" / "invocations" / "test-agent.md")
    shutil.copy(REPO_ROOT / "claude-setup" / "workflow" / "templates" / "skill-skeleton.md.jinja",
                workflow_dir / "templates" / "skill-skeleton.md.jinja")

    # Create agents/ dir with test-agent
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    # Workflow
    workflow_yaml = workflow_dir / "workflow.yaml"
    workflow_yaml.write_text("""schema_version: 1
groups:
  g: { description: x }
phases:
  - id: T1
    name: First
    group: g
    invocations:
      - agent: test-agent
        inputs: [{ path: in/a.json, kind: json }]
        outputs: [{ path: out/b.json, kind: json }]
""")

    output_skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(
        workflow_path=workflow_yaml,
        output_path=output_skill,
        templates_dir=workflow_dir / "templates",
        agents_dir=agents_dir,
    )

    content = output_skill.read_text()
    assert "Phase T1 — First" in content
    assert "in/a.json" in content
    assert "out/b.json" in content
    assert "test-agent" in content
```

- [ ] **Step 2: Implémenter `generate_skill_md`**

```python
def generate_skill_md(workflow_path: Path, output_path: Path,
                     templates_dir: Path = None, agents_dir: Path = None) -> None:
    """Generate the SKILL.md from workflow.yaml + snippets."""
    templates_dir = templates_dir or (REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates")
    invocations_dir = templates_dir / "invocations"

    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)

    # Validate first; fail loudly
    schema_errors = validate_schema(workflow)
    if schema_errors:
        raise ValueError(f"Workflow invalid: {schema_errors}")

    coherence_errors = validate_coherence(workflow, agents_dir=agents_dir)
    if coherence_errors:
        raise ValueError(f"Workflow coherence errors: {coherence_errors}")

    # Render each invocation snippet for each phase
    phases_rendered = []
    for phase in workflow.get("phases", []):
        rendered_invocations = []
        for inv in phase.get("invocations", []):
            snippet_path = invocations_dir / f"{inv['agent']}.md"
            if not snippet_path.exists():
                # Generate a default skeleton on the fly
                rendered_invocations.append(
                    f"#### Invocation `{inv['agent']}`\n\n"
                    f"_(snippet missing: `templates/invocations/{inv['agent']}.md`)_"
                )
                continue
            snippet = load_snippet(snippet_path)
            rendered = render_snippet(snippet, inv)
            rendered_invocations.append(f"#### Invocation `{inv['agent']}`\n\n{rendered}")
        phase["rendered_invocations"] = rendered_invocations
        phases_rendered.append(phase)

    # Load manual sections
    manual_blocks = []
    for ms in workflow.get("manual_sections", []):
        manual_path = REPO_ROOT_GUESS / "claude-setup" / ms["path"]
        if manual_path.exists():
            manual_blocks.append(manual_path.read_text(encoding="utf-8"))

    # Render top-level skeleton
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(templates_dir)),
        autoescape=False,
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = env.get_template("skill-skeleton.md.jinja")
    output = template.render(
        phases=phases_rendered,
        phase_count=len(phases_rendered),
        group_count=len(workflow.get("groups", {})),
        brainstormings=workflow.get("brainstormings", []),
        manual_blocks=manual_blocks,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output, encoding="utf-8")
```

- [ ] **Step 3: Implémenter `cmd_generate`**

```python
def cmd_generate(args):
    workflow_path = Path(args.workflow) if args.workflow else DEFAULT_WORKFLOW_PATH
    output_skill = Path(args.output_skill) if args.output_skill else (
        REPO_ROOT_GUESS / "claude-setup" / "skills" / "demo" / "SKILL.md"
    )

    generate_skill_md(workflow_path, output_skill)
    print(f"✅ Generated: {output_skill}")
    return 0
```

Et ajouter le subcommand dans `main()` :

```python
    p_gen = sub.add_parser("generate", help="Generate SKILL.md + cartography")
    p_gen.add_argument("--workflow", default=None)
    p_gen.add_argument("--output-skill", default=None)
    p_gen.set_defaults(func=cmd_generate)
```

- [ ] **Step 4: Run tests — passent**

- [ ] **Step 5: Test manuel**

```bash
python3 claude-setup/scripts/bb-workflow generate --output-skill /tmp/SKILL-test.md
cat /tmp/SKILL-test.md
```
Expected: SKILL.md généré contenant la phase T1 du workflow.yaml minimal.

- [ ] **Step 6: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): generate command produces SKILL.md from YAML"
```

---

## Phase 4 — Cartography + dataflow HTML

**Objectif** : Génération automatique des 3 visualisations (cartography texte, cartography HTML, dataflow HTML).

### Task 4.1 — Template cartography texte (ASCII)

**Files:**
- Create: `claude-setup/workflow/templates/cartography-texte.md.jinja`
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `generate_cartography_texte`)

- [ ] **Step 1: Écrire le template `cartography-texte.md.jinja`**

```jinja
# Cartographie (généré depuis workflow.yaml)

> Auto-généré par `bb-workflow generate`. Ne pas éditer à la main.

## Vue d'ensemble

{{ phases|length }} phases, organisées en {{ groups|length }} groupes.

## Groupes

{% for gname, g in groups.items() %}
- **`{{ gname }}`** — {{ g.description }} (risque : {{ g.risk|default('?') }})
{% endfor %}

## DAG

```
{% for level in execution_levels %}
Niveau {{ loop.index0 }} : {{ level|join(' || ') }}
{% endfor %}
```

## Phases

{% for phase in phases %}
### {{ phase.id }} — {{ phase.name }}

- Groupe : `{{ phase.group }}`
- Type : `{{ phase.type|default('agent') }}`
{%- if phase.depends_on %}
- Dépend de : {{ phase.depends_on|join(', ') }}
{%- endif %}
{%- if phase.parallel_with %}
- Parallèle avec : {{ phase.parallel_with|join(', ') }}
{%- endif %}
{%- if phase.invocations %}
- Invocations :
{% for inv in phase.invocations %}
  - `{{ inv.agent }}` ({{ inv.model|default('inherit') }}){% if inv.background %} [bg]{% endif %}
{% endfor %}
{%- endif %}

{% endfor %}
```

- [ ] **Step 2: Test**

```python
def test_generate_cartography_texte(bbw_module, tmp_path):
    workflow_yaml = REPO_ROOT / "claude-setup" / "scripts" / "tests" / "fixtures" / "workflows" / "valid-complex.yaml"
    output = tmp_path / "carto.md"
    bbw_module.generate_cartography_texte(workflow_yaml, output)
    content = output.read_text()
    assert "T1" in content and "T4" in content
    assert "Niveau 0" in content
    assert "g1" in content
```

- [ ] **Step 3: Implémenter `generate_cartography_texte`**

```python
def generate_cartography_texte(workflow_path: Path, output_path: Path,
                                templates_dir: Path = None) -> None:
    templates_dir = templates_dir or (REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates")
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)
    dag = build_dag(workflow)

    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(templates_dir)),
        autoescape=False,
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = env.get_template("cartography-texte.md.jinja")
    output = template.render(
        phases=workflow.get("phases", []),
        groups=workflow.get("groups", {}),
        execution_levels=dag.execution_levels(),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output, encoding="utf-8")
```

- [ ] **Step 4: Run tests — passent**

- [ ] **Step 5: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): generate cartography-texte.md from YAML"
```

### Task 4.2 — Templates mermaid (flow de contrôle + dataflow)

**Files:**
- Create: `claude-setup/workflow/templates/cartography.mermaid.jinja`
- Create: `claude-setup/workflow/templates/dataflow.mermaid.jinja`
- Modify: `claude-setup/scripts/bb-workflow` (ajouter générateurs Mermaid)

- [ ] **Step 1: Écrire `cartography.mermaid.jinja`**

```jinja
```mermaid
flowchart TB
{% for phase in phases %}
    {{ phase.id }}["{{ phase.id }}<br/>{{ phase.name }}"]:::{{ phase.group }}
{% endfor %}
{% for phase in phases %}
{% for dep in phase.depends_on|default([]) %}
    {{ dep }} --> {{ phase.id }}
{% endfor %}
{% endfor %}
{% for gname in groups %}
    classDef {{ gname }} fill:{{ group_colors[gname] }},stroke:#888,color:#fff
{% endfor %}
```
```

- [ ] **Step 2: Écrire `dataflow.mermaid.jinja`**

```jinja
```mermaid
flowchart LR
{% for path, (producer_phase, producer_agent) in output_index.items() %}
    {{ path|node_id }}[/"{{ path }}"/]
    {{ producer_phase }}_{{ producer_agent|node_id }} --> {{ path|node_id }}
{% endfor %}
{% for prod_pid, prod_agent, cons_pid, cons_agent, path in dataflow_edges %}
    {{ path|node_id }} --> {{ cons_pid }}_{{ cons_agent|node_id }}
{% endfor %}
```
```

- [ ] **Step 3: Implémenter générateurs Mermaid + filtre `node_id`**

```python
# Palette de couleurs par défaut (peut être surchargée par config)
DEFAULT_GROUP_COLORS = {
    "passive-recon": "#14532d",
    "active-collection": "#1e3a5f",
    "static-analysis": "#5c3a00",
    "consolidation": "#3b0764",
    "active-exploit": "#5b1a1a",
}


def _node_id_filter(s: str) -> str:
    """Sanitize a string for use as a Mermaid node ID."""
    return s.replace("/", "_").replace(".", "_").replace("-", "_")


def generate_mermaid_cartography(workflow_path: Path, output_path: Path,
                                  templates_dir: Path = None) -> None:
    templates_dir = templates_dir or (REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates")
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)

    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(templates_dir)),
        autoescape=False,
        keep_trailing_newline=True,
    )
    env.filters["node_id"] = _node_id_filter
    template = env.get_template("cartography.mermaid.jinja")
    output = template.render(
        phases=workflow.get("phases", []),
        groups=workflow.get("groups", {}),
        group_colors=DEFAULT_GROUP_COLORS,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output, encoding="utf-8")


def generate_mermaid_dataflow(workflow_path: Path, output_path: Path,
                              templates_dir: Path = None) -> None:
    templates_dir = templates_dir or (REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates")
    with open(workflow_path) as f:
        workflow = yaml.safe_load(f)
    dag = build_dag(workflow)

    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(templates_dir)),
        autoescape=False,
        keep_trailing_newline=True,
    )
    env.filters["node_id"] = _node_id_filter
    template = env.get_template("dataflow.mermaid.jinja")
    output = template.render(
        output_index=dag.output_index,
        dataflow_edges=dag.dataflow_edges(),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(output, encoding="utf-8")
```

- [ ] **Step 4: Tests basiques**

```python
def test_generate_mermaid_cartography(bbw_module, tmp_path):
    workflow_yaml = REPO_ROOT / "claude-setup" / "scripts" / "tests" / "fixtures" / "workflows" / "valid-complex.yaml"
    output = tmp_path / "carto.mermaid"
    bbw_module.generate_mermaid_cartography(workflow_yaml, output)
    content = output.read_text()
    assert "flowchart TB" in content
    assert "T1" in content and "T4" in content


def test_generate_mermaid_dataflow(bbw_module, tmp_path):
    workflow_yaml = REPO_ROOT / "claude-setup" / "scripts" / "tests" / "fixtures" / "workflows" / "valid-complex.yaml"
    output = tmp_path / "df.mermaid"
    bbw_module.generate_mermaid_dataflow(workflow_yaml, output)
    content = output.read_text()
    assert "flowchart LR" in content
    assert "out_a_json" in content  # node_id sanitization
```

- [ ] **Step 5: Run tests — passent**

- [ ] **Step 6: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): mermaid generators (cartography flow + dataflow)"
```

### Task 4.3 — HTML wrapping (réécriture de build.py)

**Files:**
- Create: `claude-setup/workflow/templates/html-wrapper.html` (copie de `_template.html`)
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `wrap_mermaid_in_html`)
- Modify: `docs/architecture-cartography/build.py` (devient wrapper qui appelle bb-workflow)

- [ ] **Step 1: Copier `_template.html` vers `html-wrapper.html`**

```bash
cp docs/architecture-cartography/_template.html claude-setup/workflow/templates/html-wrapper.html
```

- [ ] **Step 2: Implémenter `wrap_mermaid_in_html`**

```python
def wrap_mermaid_in_html(mermaid_content: str, output_path: Path,
                          template_path: Path = None,
                          libs_dir: Path = None) -> None:
    """Wrap a mermaid diagram in a standalone HTML (libs inlined).

    Reuses the existing _template.html which has /*__PANZOOM_LIB__*/ and
    /*__MERMAID_LIB__*/ markers, and a placeholder for the mermaid content.
    """
    libs_dir = libs_dir or Path("/tmp")
    template_path = template_path or (
        REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates" / "html-wrapper.html"
    )

    # Fetch libs if missing
    mermaid_lib_path = libs_dir / "mermaid.min.js"
    panzoom_lib_path = libs_dir / "svg-pan-zoom.min.js"

    if not mermaid_lib_path.exists():
        import urllib.request
        urllib.request.urlretrieve(
            "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js",
            mermaid_lib_path,
        )
    if not panzoom_lib_path.exists():
        import urllib.request
        urllib.request.urlretrieve(
            "https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js",
            panzoom_lib_path,
        )

    html = template_path.read_text(encoding="utf-8")
    html = html.replace("/*__PANZOOM_LIB__*/", panzoom_lib_path.read_text(encoding="utf-8"))
    html = html.replace("/*__MERMAID_LIB__*/", mermaid_lib_path.read_text(encoding="utf-8"))

    # Inject mermaid content — assumes template has a marker like <!--__MERMAID_CONTENT__-->
    # If marker absent (legacy _template.html), append at end of body
    if "<!--__MERMAID_CONTENT__-->" in html:
        html = html.replace("<!--__MERMAID_CONTENT__-->", mermaid_content)
    else:
        html = html.replace("</body>", f"<div class='mermaid'>{mermaid_content}</div></body>")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
```

- [ ] **Step 3: Test E2E**

```python
def test_wrap_mermaid_in_html(bbw_module, tmp_path):
    # Create a fake template
    template = tmp_path / "tpl.html"
    template.write_text("<html><body><!--__MERMAID_CONTENT__--></body></html>")
    # Fake libs
    libs = tmp_path / "libs"
    libs.mkdir()
    (libs / "mermaid.min.js").write_text("/* mock mermaid */")
    (libs / "svg-pan-zoom.min.js").write_text("/* mock panzoom */")

    out = tmp_path / "out.html"
    bbw_module.wrap_mermaid_in_html(
        "flowchart TB\nA --> B",
        out,
        template_path=template,
        libs_dir=libs,
    )
    content = out.read_text()
    assert "flowchart TB" in content
```

- [ ] **Step 4: Run tests — passent**

- [ ] **Step 5: Mettre à jour `docs/architecture-cartography/build.py`**

Réécrire pour utiliser bb-workflow :

```python
#!/usr/bin/env python3
"""Assemble cartography.html + dataflow.html depuis workflow.yaml.

Wrapper léger appelant bb-workflow. Conserve le nom historique pour
compatibilité avec les utilisateurs habitués.
"""
import subprocess
import sys


def main():
    cmd = ["bb-workflow", "generate"]
    result = subprocess.run(cmd, capture_output=False)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/ docs/architecture-cartography/build.py
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): HTML wrapper + build.py delegates to bb-workflow"
```

### Task 4.4 — Étendre `cmd_generate` pour tout produire

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (étendre `cmd_generate`)

- [ ] **Step 1: Modifier `cmd_generate` pour produire les 4 artefacts**

```python
def cmd_generate(args):
    workflow_path = Path(args.workflow) if args.workflow else DEFAULT_WORKFLOW_PATH

    output_skill = Path(args.output_skill) if args.output_skill else (
        REPO_ROOT_GUESS / "claude-setup" / "skills" / "demo" / "SKILL.md"
    )
    output_dir_carto = REPO_ROOT_GUESS / "docs" / "architecture-cartography"
    output_carto_texte = output_dir_carto / "cartography-texte.md"
    output_carto_mermaid = output_dir_carto / "_cartography.mermaid"  # intermédiaire
    output_carto_html = output_dir_carto / "cartography.html"
    output_dataflow_mermaid = output_dir_carto / "_dataflow.mermaid"
    output_dataflow_html = output_dir_carto / "dataflow.html"

    print(f"Generating SKILL.md...")
    generate_skill_md(workflow_path, output_skill)

    print(f"Generating cartography-texte.md...")
    generate_cartography_texte(workflow_path, output_carto_texte)

    print(f"Generating cartography.html...")
    generate_mermaid_cartography(workflow_path, output_carto_mermaid)
    wrap_mermaid_in_html(output_carto_mermaid.read_text(), output_carto_html)

    print(f"Generating dataflow.html...")
    generate_mermaid_dataflow(workflow_path, output_dataflow_mermaid)
    wrap_mermaid_in_html(output_dataflow_mermaid.read_text(), output_dataflow_html)

    # Clean intermediates
    output_carto_mermaid.unlink(missing_ok=True)
    output_dataflow_mermaid.unlink(missing_ok=True)

    print(f"✅ All artifacts generated.")
    print(f"   - {output_skill}")
    print(f"   - {output_carto_texte}")
    print(f"   - {output_carto_html}")
    print(f"   - {output_dataflow_html}")
    return 0
```

- [ ] **Step 2: Test manuel E2E**

```bash
python3 claude-setup/scripts/bb-workflow generate
ls -lh docs/architecture-cartography/cartography.html docs/architecture-cartography/dataflow.html
```

- [ ] **Step 3: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): cmd_generate produces all 4 artifacts"
```

---

## Phase 5 — Check / drift detection

**Objectif** : `bb-workflow check` détecte si le SKILL.md committé diffère de ce qui serait régénéré.

### Task 5.1 — `bb-workflow check` (comparaison byte-à-byte)

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `cmd_check`)
- Create: `claude-setup/scripts/tests/test_workflow_check.py`

- [ ] **Step 1: Test**

```python
"""Tests for drift detection."""
import pytest


def test_check_no_drift(bbw_module, tmp_path):
    """Check returns 0 if SKILL.md matches what would be generated."""
    # Setup: generate SKILL.md, then check immediately should pass
    workflow = tmp_path / "wf.yaml"
    workflow.write_text("""schema_version: 1
groups: { g: { description: x } }
phases:
  - id: T1
    name: First
    group: g
""")
    skill = tmp_path / "SKILL.md"
    # Generate
    bbw_module.generate_skill_md(workflow, skill)
    # Check
    drift = bbw_module.check_drift(workflow, skill)
    assert drift == []  # no drift


def test_check_drift_detected(bbw_module, tmp_path):
    workflow = tmp_path / "wf.yaml"
    workflow.write_text("""schema_version: 1
groups: { g: { description: x } }
phases:
  - id: T1
    name: First
    group: g
""")
    skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(workflow, skill)
    # Tamper
    skill.write_text(skill.read_text() + "\n\n# Manually added\n")
    drift = bbw_module.check_drift(workflow, skill)
    assert drift != []
    assert any("differ" in d.lower() for d in drift)
```

- [ ] **Step 2: Implémenter `check_drift` et `cmd_check`**

```python
import difflib


def check_drift(workflow_path: Path, skill_path: Path) -> list[str]:
    """Compare actual SKILL.md vs what would be generated. Returns list of drift messages."""
    if not skill_path.exists():
        return [f"{skill_path}: does not exist (run bb-workflow generate)"]

    # Generate to a temp location
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        generate_skill_md(workflow_path, tmp_path)
        actual = skill_path.read_text(encoding="utf-8")
        expected = tmp_path.read_text(encoding="utf-8")
        if actual == expected:
            return []
        diff = list(difflib.unified_diff(
            actual.splitlines(keepends=True),
            expected.splitlines(keepends=True),
            fromfile=str(skill_path),
            tofile="generated",
            n=2,
        ))
        return [f"SKILL.md differs from generated:\n{''.join(diff[:50])}"]
    finally:
        tmp_path.unlink(missing_ok=True)


def cmd_check(args):
    workflow_path = Path(args.workflow) if args.workflow else DEFAULT_WORKFLOW_PATH
    skill_path = Path(args.skill) if args.skill else (
        REPO_ROOT_GUESS / "claude-setup" / "skills" / "demo" / "SKILL.md"
    )
    drift = check_drift(workflow_path, skill_path)
    if drift:
        for d in drift:
            print(d, file=sys.stderr)
        print(f"❌ Drift detected. Run: bb-workflow generate", file=sys.stderr)
        return 1
    print(f"✅ No drift")
    return 0
```

Ajouter au CLI :
```python
    p_check = sub.add_parser("check", help="Detect drift between SKILL.md and YAML")
    p_check.add_argument("--workflow", default=None)
    p_check.add_argument("--skill", default=None)
    p_check.set_defaults(func=cmd_check)
```

- [ ] **Step 3: Run tests — passent**

- [ ] **Step 4: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): check command + drift detection"
```

### Task 5.2 — Pre-commit hook

**Files:**
- Create: `claude-setup/hooks/pre-commit-bb-workflow-check.sh`
- Modify: `CLAUDE-DEV.md` (documenter l'installation)

- [ ] **Step 1: Créer le hook**

```bash
#!/bin/bash
# Pre-commit hook: bloque les commits si SKILL.md drifte de workflow.yaml
# Installation : cp claude-setup/hooks/pre-commit-bb-workflow-check.sh .git/hooks/pre-commit

set -e

# Skip si bb-workflow pas installé
if ! command -v bb-workflow &>/dev/null; then
    exit 0
fi

# Check only if workflow.yaml or SKILL.md changed
CHANGED=$(git diff --cached --name-only)
if echo "$CHANGED" | grep -qE "(workflow\.yaml|SKILL\.md|templates/invocations)"; then
    echo "[pre-commit] bb-workflow check..."
    if ! bb-workflow check; then
        echo ""
        echo "❌ SKILL.md drifts from workflow.yaml."
        echo "   Run: bb-workflow generate"
        echo "   Then re-stage the SKILL.md and try again."
        exit 1
    fi
fi

exit 0
```

```bash
chmod +x claude-setup/hooks/pre-commit-bb-workflow-check.sh
```

- [ ] **Step 2: Documenter dans CLAUDE-DEV.md**

Ajouter une section avant "Plugin superpowers" :

```markdown
## bb-workflow (générateur SKILL.md)

`SKILL.md` est généré depuis `claude-setup/workflow/workflow.yaml` via le CLI
`bb-workflow`. Ne JAMAIS éditer `SKILL.md` à la main.

Commandes :
- `bb-workflow validate` — valide le YAML
- `bb-workflow generate` — régénère SKILL.md + cartographie + dataflow
- `bb-workflow check` — détecte le drift (utilisé par le pre-commit hook)
- `bb-workflow assist <desc>` — sub-agent pour modifs complexes (Phase 7)

Installation du pre-commit hook :
```bash
cp claude-setup/hooks/pre-commit-bb-workflow-check.sh .git/hooks/pre-commit
```

Spec : `docs/superpowers/specs/2026-05-21-workflow-modulable-yaml-design.md`
```

- [ ] **Step 3: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/hooks/ CLAUDE-DEV.md
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): pre-commit hook + CLAUDE-DEV.md docs"
```

---

## Phase 6 — Migration depuis SKILL.md actuel

**Objectif** : Convertir le SKILL.md actuel (1070 lignes) en workflow.yaml + snippets, sans perte de contenu.

**Stratégie** : faire la migration **incrémentale** sur 3-5 phases au début pour valider l'approche, puis dérouler.

### Task 6.1 — `bb-workflow migrate-from-skill` (sub-agent parser)

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `cmd_migrate_from_skill`)

- [ ] **Step 1: Implémenter le command qui prépare les inputs pour un sub-agent**

Le command lui-même ne lance pas le sub-agent (c'est l'orchestrateur Claude qui le fait). Le command prépare les inputs et imprime des instructions claires.

```python
def cmd_migrate_from_skill(args):
    """Prepare inputs for a Claude sub-agent to migrate SKILL.md to workflow.yaml + snippets."""
    skill_path = Path(args.skill) if args.skill else (
        REPO_ROOT_GUESS / "claude-setup" / "skills" / "demo" / "SKILL.md"
    )
    output_dir = Path(args.output_dir) if args.output_dir else (
        REPO_ROOT_GUESS / "claude-setup" / "workflow"
    )

    if not skill_path.exists():
        print(f"❌ SKILL.md not found: {skill_path}", file=sys.stderr)
        return 1

    # Read SKILL.md
    skill_content = skill_path.read_text(encoding="utf-8")
    lines = skill_content.count("\n")

    print(f"📄 Source: {skill_path} ({lines} lines)")
    print(f"📁 Output: {output_dir}")
    print()
    print("Run this prompt with a Claude sub-agent (Task tool, model=opus):")
    print()
    print("=" * 70)
    print(f"""
You are migrating a Claude Code SKILL.md to a YAML workflow + markdown snippets.

INPUT: {skill_path} ({lines} lines)
OUTPUT TARGETS:
  - {output_dir}/workflow.yaml (DAG structure, NOT prompts)
  - {output_dir}/templates/invocations/<agent>.md (one per agent invocation)
  - {output_dir}/manual/<section>.md (sections to preserve as-is: Manifeste,
    Notes importantes, Multi-cycle)

SCHEMA REFERENCE: {output_dir}/workflow.schema.json
EXISTING WORKFLOW: {output_dir}/workflow.yaml (extend, don't overwrite)

INSTRUCTIONS:
1. Parse SKILL.md to identify phases (sections that match "Phase N", "T-N", or
   "BRAINSTORMING").
2. For each phase, extract:
   - id (T0a, T2, etc.), name, group (infer from purpose), type (agent/script/external/main_agent)
   - depends_on (sequence in SKILL.md)
   - parallel_with (explicit "(parallèle)" mentions)
   - invocations: agent name, model, background flag, inputs/outputs (from "Inputs:" / "Output:" prose)
3. For each invocation, create a snippet at templates/invocations/<agent>.md with:
   - frontmatter: agent, generated: false
   - body: the prompt from SKILL.md verbatim (the text after "prompt: |"), but
     substitute Inputs/Output prose with {{ inputs_table }} / {{ outputs_table }}
4. Preserve as manual_sections the parts that aren't generative (Manifeste Management,
   Notes importantes, 11b. Multi-cycle).
5. After writing, run: bb-workflow validate
6. Then: bb-workflow generate --output-skill /tmp/SKILL-regen.md
7. Compare /tmp/SKILL-regen.md with the original. Iterate until semantic equivalence.

CONSTRAINTS:
- Don't paraphrase prompts. Copy them verbatim.
- Don't merge invocations of different agents.
- If unsure about a field, leave it out (better partial than wrong).
- Brainstormings have their own block; don't model them as phases.
""")
    print("=" * 70)
    return 0


# Add to main():
    p_mig = sub.add_parser("migrate-from-skill", help="Prepare migration of SKILL.md to YAML+snippets")
    p_mig.add_argument("--skill", default=None)
    p_mig.add_argument("--output-dir", default=None)
    p_mig.set_defaults(func=cmd_migrate_from_skill)
```

- [ ] **Step 2: Test (le command doit imprimer les bonnes instructions)**

```python
def test_migrate_from_skill_prints_instructions(bbw_module, tmp_path, capsys):
    skill = tmp_path / "SKILL.md"
    skill.write_text("# Skill\n\nphase 1...")
    # Simulate args
    class A: pass
    args = A()
    args.skill = str(skill)
    args.output_dir = str(tmp_path)
    rc = bbw_module.cmd_migrate_from_skill(args)
    assert rc == 0
    out = capsys.readouterr().out
    assert "workflow.yaml" in out
    assert "templates/invocations" in out
```

- [ ] **Step 3: Run tests — passent**

- [ ] **Step 4: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): migrate-from-skill command (prepares sub-agent input)"
```

### Task 6.2 — Exécuter la migration sur le SKILL.md actuel (étape humaine + sub-agent)

**Files:**
- Modify: `claude-setup/workflow/workflow.yaml` (population complète)
- Create: `claude-setup/workflow/templates/invocations/*.md` (un par invocation actuelle)
- Create: `claude-setup/workflow/manual/*.md` (sections préservées)

Cette tâche est interactive — elle est principalement pilotée par le hunter avec un sub-agent.

- [ ] **Step 1: Préparer**

```bash
bb-workflow migrate-from-skill > /tmp/migrate-prompt.txt
cat /tmp/migrate-prompt.txt
```

- [ ] **Step 2: Invoquer le sub-agent**

Dans une session Claude Code, lancer un Task tool avec :
- `subagent_type: general-purpose`
- `model: opus`
- `prompt`: contenu de `/tmp/migrate-prompt.txt`

Le sub-agent écrit dans `claude-setup/workflow/`.

- [ ] **Step 3: Validation par étapes**

```bash
bb-workflow validate
```
Itérer jusqu'à `✅ valid`.

- [ ] **Step 4: Génération + comparaison**

```bash
bb-workflow generate --output-skill /tmp/SKILL-regen.md
diff -u claude-setup/skills/demo/SKILL.md /tmp/SKILL-regen.md | head -200
```

Itérer sur le YAML / snippets jusqu'à ce que les différences soient acceptables (reformulations triviales OK, manques de contenu = à corriger).

- [ ] **Step 5: Hunter review**

Le hunter ouvre côte à côte : workflow.yaml, snippets, SKILL.md original, /tmp/SKILL-regen.md.

- [ ] **Step 6: Quand validé, remplacer le SKILL.md**

```bash
bb-workflow generate    # écrit SKILL.md final
git add claude-setup/workflow/ claude-setup/skills/demo/SKILL.md
git status
```

- [ ] **Step 7: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): migrate SKILL.md to workflow.yaml + snippets

SKILL.md (1070 lignes prose) → workflow.yaml (~400 lignes) + N snippets
markdown. Source unique de vérité maintenant le YAML. SKILL.md devient un
artefact généré."
```

---

## Phase 7 — Sub-agent assist + utilitaires

**Objectif** : Outils ergonomiques pour modifier le workflow sans casser les cohérences.

### Task 7.1 — `bb-workflow assist` (sub-agent helper)

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `cmd_assist`)

- [ ] **Step 1: Implémenter `cmd_assist`**

Comme `migrate-from-skill`, ce command prépare le prompt pour un sub-agent.

```python
def cmd_assist(args):
    """Prepare prompt for sub-agent to help with workflow modifications."""
    change_desc = args.change_desc
    workflow_path = DEFAULT_WORKFLOW_PATH
    snippets_dir = REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates" / "invocations"

    print(f"📝 Change requested: {change_desc}")
    print()
    print("Run this prompt with a Claude sub-agent (Task tool, model=opus):")
    print()
    print("=" * 70)
    print(f"""
You are assisting with a workflow modification in awok.

CONTEXT:
- Workflow YAML: {workflow_path}
- Snippets dir: {snippets_dir}
- Schema: {workflow_path.parent}/workflow.schema.json
- Spec: docs/superpowers/specs/2026-05-21-workflow-modulable-yaml-design.md

CHANGE REQUESTED: {change_desc}

INSTRUCTIONS:
1. Read workflow.yaml and the relevant snippets in templates/invocations/.
2. Propose the YAML edits + snippet additions/modifications needed.
3. For each new agent invocation, create a snippet at templates/invocations/<agent>.md
   (use the template with frontmatter and {{{{ inputs_table }}}} / {{{{ outputs_table }}}} placeholders).
4. Run: bb-workflow validate (must pass).
5. Run: bb-workflow generate (must succeed).
6. Show a diff summary of what changed.
7. DO NOT commit. The hunter reviews and commits.

CONSTRAINTS:
- Keep `generated: false` in snippet frontmatter (preserve manual edits).
- Match agent names to existing files in claude-setup/agents/.
- Preserve idempotency: re-running bb-workflow generate must produce identical output.
""")
    print("=" * 70)
    return 0


# Add to main():
    p_assist = sub.add_parser("assist", help="Get help from a sub-agent for workflow modifications")
    p_assist.add_argument("change_desc", help="Description of the change to make")
    p_assist.set_defaults(func=cmd_assist)
```

- [ ] **Step 2: Test basique**

```python
def test_assist_prints_prompt(bbw_module, capsys):
    class A: pass
    args = A()
    args.change_desc = "add a new ssrf-prober agent in T6"
    rc = bbw_module.cmd_assist(args)
    assert rc == 0
    out = capsys.readouterr().out
    assert "ssrf-prober" in out
    assert "bb-workflow validate" in out
```

- [ ] **Step 3: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): assist command (sub-agent prompt for modifications)"
```

### Task 7.2 — `bb-workflow rename-agent`

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `cmd_rename_agent`)
- Create: `claude-setup/scripts/tests/test_workflow_rename.py`

- [ ] **Step 1: Test**

```python
"""Tests for the rename-agent utility."""
from pathlib import Path
import yaml


def test_rename_agent_updates_yaml(bbw_module, tmp_path):
    workflow = tmp_path / "workflow.yaml"
    workflow.write_text("""schema_version: 1
groups: { g: { description: x } }
phases:
  - id: T1
    name: x
    group: g
    invocations:
      - agent: old-name
""")
    snippets_dir = tmp_path / "snippets"
    snippets_dir.mkdir()
    (snippets_dir / "old-name.md").write_text("---\nagent: old-name\n---\nbody")
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "old-name.md").write_text("---\nname: old-name\n---\nx")

    bbw_module.rename_agent("old-name", "new-name",
                            workflow_path=workflow,
                            snippets_dir=snippets_dir,
                            agents_dir=agents_dir)

    wf = yaml.safe_load(workflow.read_text())
    assert wf["phases"][0]["invocations"][0]["agent"] == "new-name"
    assert (snippets_dir / "new-name.md").exists()
    assert not (snippets_dir / "old-name.md").exists()
    assert (agents_dir / "new-name.md").exists()
    assert not (agents_dir / "old-name.md").exists()
    snippet_content = (snippets_dir / "new-name.md").read_text()
    assert "agent: new-name" in snippet_content
```

- [ ] **Step 2: Implémenter `rename_agent` et `cmd_rename_agent`**

```python
def rename_agent(old: str, new: str,
                 workflow_path: Path = None,
                 snippets_dir: Path = None,
                 agents_dir: Path = None) -> dict:
    """Rename an agent across workflow.yaml, snippets, and agents/."""
    workflow_path = workflow_path or DEFAULT_WORKFLOW_PATH
    snippets_dir = snippets_dir or (REPO_ROOT_GUESS / "claude-setup" / "workflow" / "templates" / "invocations")
    agents_dir = agents_dir or (REPO_ROOT_GUESS / "claude-setup" / "agents")

    changes = {"yaml": 0, "snippets": 0, "agents": 0}

    # 1. Update YAML
    with open(workflow_path) as f:
        text = f.read()
    new_text = text.replace(f"agent: {old}", f"agent: {new}")
    if new_text != text:
        workflow_path.write_text(new_text, encoding="utf-8")
        changes["yaml"] = text.count(f"agent: {old}")

    # 2. Rename snippet file + update its frontmatter
    old_snippet = snippets_dir / f"{old}.md"
    new_snippet = snippets_dir / f"{new}.md"
    if old_snippet.exists():
        content = old_snippet.read_text(encoding="utf-8")
        content = content.replace(f"agent: {old}", f"agent: {new}")
        new_snippet.write_text(content, encoding="utf-8")
        old_snippet.unlink()
        changes["snippets"] = 1

    # 3. Rename agent file + update its frontmatter name
    old_agent_file = agents_dir / f"{old}.md"
    new_agent_file = agents_dir / f"{new}.md"
    if old_agent_file.exists():
        content = old_agent_file.read_text(encoding="utf-8")
        content = content.replace(f"name: {old}", f"name: {new}")
        new_agent_file.write_text(content, encoding="utf-8")
        old_agent_file.unlink()
        changes["agents"] = 1

    return changes


def cmd_rename_agent(args):
    changes = rename_agent(args.old, args.new)
    print(f"✅ Renamed '{args.old}' → '{args.new}':")
    print(f"   YAML invocations updated: {changes['yaml']}")
    print(f"   Snippet renamed: {changes['snippets']}")
    print(f"   Agent file renamed: {changes['agents']}")
    print(f"\nRun 'bb-workflow generate' to apply.")
    return 0


# Add to main():
    p_ren = sub.add_parser("rename-agent", help="Rename an agent across YAML/snippets/agents")
    p_ren.add_argument("old")
    p_ren.add_argument("new")
    p_ren.set_defaults(func=cmd_rename_agent)
```

- [ ] **Step 3: Run tests — passent**

- [ ] **Step 4: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): rename-agent utility"
```

### Task 7.3 — `bb-workflow new-phase --interactive`

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter `cmd_new_phase`)

- [ ] **Step 1: Implémenter (prépare un sub-agent wizard)**

```python
def cmd_new_phase(args):
    """Interactive wizard for adding a new phase. Prepares prompt for a sub-agent."""
    print("New phase wizard. Run this prompt with a Claude sub-agent:")
    print()
    print("=" * 70)
    print(f"""
You are helping a hunter add a new phase to the awok workflow.

WORKFLOW PATH: {DEFAULT_WORKFLOW_PATH}
SCHEMA: {DEFAULT_SCHEMA_PATH}

INTERVIEW the hunter to fill the following:
1. Phase id (must match ^[A-Z][A-Z0-9-]*$, e.g., T7, TR-x)
2. Human-readable name
3. Group (passive-recon | active-collection | static-analysis | consolidation | active-exploit | other?)
4. Type (agent | script | external | main_agent)
5. depends_on (list of existing phase ids, or none)
6. parallel_with (optional)
7. Triggers? (event-based, optional)
8. Invocations (for type=agent): which agents, with what inputs/outputs

After collecting the answers:
1. Insert the new phase block in workflow.yaml at the right position (after its depends_on).
2. For each new agent invocation: create a snippet at templates/invocations/<agent>.md
   (use the standard template — frontmatter + body with placeholders).
3. Run: bb-workflow validate (must pass).
4. Run: bb-workflow generate.
5. Show the hunter what changed (git diff).
6. DO NOT commit. Hunter reviews.
""")
    print("=" * 70)
    return 0


# Add to main():
    p_new = sub.add_parser("new-phase", help="Interactive wizard for adding a phase")
    p_new.add_argument("--interactive", action="store_true")
    p_new.set_defaults(func=cmd_new_phase)
```

- [ ] **Step 2: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/scripts/
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(bb-workflow): new-phase interactive wizard prompt"
```

---

## Phase 8 — Déploiement + documentation

### Task 8.1 — Étendre `install.sh`

**Files:**
- Modify: `claude-setup/install.sh`

- [ ] **Step 1: Modifier install.sh pour déployer bb-workflow**

Localiser la section qui déploie les scripts CLI et ajouter :

```bash
# bb-workflow CLI
echo "[X/Y] Installing bb-workflow..."
cp "$SCRIPT_DIR/scripts/bb-workflow" "$HOME/.local/bin/bb-workflow"
chmod +x "$HOME/.local/bin/bb-workflow"

# Copy workflow templates + schema to a stable location
mkdir -p "$HOME/.local/share/bb-workflow"
cp -r "$SCRIPT_DIR/workflow/templates" "$HOME/.local/share/bb-workflow/"
cp "$SCRIPT_DIR/workflow/workflow.schema.json" "$HOME/.local/share/bb-workflow/"

# Check Python deps
if ! python3 -c "import jinja2, jsonschema" 2>/dev/null; then
    echo "WARNING: jinja2 or jsonschema missing. Run: pip install jinja2 jsonschema"
fi

echo "  bb-workflow installed at $HOME/.local/bin/bb-workflow"
```

- [ ] **Step 2: Vérifier `~/.local/bin/` dans `$PATH`**

Le SCRIPT_DIR n'est pas équivalent à `~/.local/bin`. Vérifier que le bindir est bien dans `$PATH`, sinon prévenir l'utilisateur.

- [ ] **Step 3: Test manuel**

```bash
./claude-setup/install.sh
which bb-workflow
bb-workflow validate
```

- [ ] **Step 4: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add claude-setup/install.sh
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "feat(install): deploy bb-workflow CLI"
```

### Task 8.2 — Documentation utilisateur

**Files:**
- Create: `docs/dev/bb-workflow.md`

- [ ] **Step 1: Écrire le README utilisateur**

```markdown
# bb-workflow — Générateur du SKILL.md depuis YAML

`bb-workflow` est un CLI qui transforme `claude-setup/workflow/workflow.yaml`
(source unique de vérité) en :
- `claude-setup/skills/demo/SKILL.md` (orchestrateur Claude Code)
- `docs/architecture-cartography/cartography.html` (flow de contrôle)
- `docs/architecture-cartography/dataflow.html` (flux de données — NOUVEAU)
- `docs/architecture-cartography/cartography-texte.md` (ASCII)

**Source de vérité = YAML.** Ne pas éditer `SKILL.md` à la main : la prochaine
régénération l'écrasera. Pre-commit hook bloque les commits si drift détecté.

## Commandes

| Commande | Effet |
|---|---|
| `bb-workflow validate` | Valide workflow.yaml (schema + cohérence + warnings dataflow) |
| `bb-workflow generate` | Régénère tous les artefacts |
| `bb-workflow check` | Détecte le drift (exit 1 si SKILL.md ≠ généré) |
| `bb-workflow diff <phase>` | Voir ce qui changerait pour une phase |
| `bb-workflow assist "<change>"` | Prompt sub-agent pour modifs complexes |
| `bb-workflow new-phase --interactive` | Wizard sub-agent pour ajout de phase |
| `bb-workflow rename-agent <old> <new>` | Renomme un agent partout |
| `bb-workflow migrate-from-skill` | One-shot migration SKILL.md → YAML |

## Workflow type — modifier une phase

```bash
# 1. Éditer le YAML
vim claude-setup/workflow/workflow.yaml

# 2. Valider
bb-workflow validate

# 3. (Si nouveau agent) — créer le snippet
cp claude-setup/workflow/templates/invocations/_template.md \
   claude-setup/workflow/templates/invocations/mon-agent.md
vim claude-setup/workflow/templates/invocations/mon-agent.md

# 4. Régénérer
bb-workflow generate

# 5. Inspecter le diff
git diff claude-setup/skills/demo/SKILL.md

# 6. Commit
git add claude-setup/workflow/ claude-setup/skills/demo/SKILL.md
git commit -m "feat(workflow): add mon-agent in phase TX"
```

## Workflow type — modification complexe assistée

```bash
bb-workflow assist "Ajouter une phase TR-rate-limit-check déclenchée quand
le friction-detector remonte un 429 sur plus de 3 endpoints"
# → suit les instructions imprimées (run sub-agent via Claude Code)
```

## Spec

`docs/superpowers/specs/2026-05-21-workflow-modulable-yaml-design.md`
```

- [ ] **Step 2: Commit**

```bash
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git add docs/dev/bb-workflow.md
GIT_AUTHOR_NAME=marcrow GIT_AUTHOR_EMAIL=marcrowproject@gmail.com git commit -m "docs(bb-workflow): user guide"
```

---

## Self-Review

### Spec coverage check

| Section spec | Couverte par |
|---|---|
| 1. Problème (4 sources qui drift) | Préambule + Phase 1-3 (générateur élimine la source manuelle) |
| 2. Vision (YAML source unique) | Phase 1.1 (schema), 3 (generator) |
| 3. Décisions structurantes | Toutes implémentées |
| 4. Architecture / fichiers | File Structure top-level + Phase 1.1 |
| 5. Schéma YAML | Phase 1.1 (workflow.schema.json) |
| 5.1 Types de phases | Phase 1.1 (enum dans schema) |
| 5.2 Types de triggers | Phase 1.1 (schema). Câblage runtime = hors scope MVP (P5 spec, hors plan) |
| 5.3 Valeurs par défaut triggers | Hors scope MVP (P5 spec) |
| 6. Snippets markdown | Phase 3.1-3.2 |
| 7. Générateur (CLI) | Phases 1.2, 3.3, 5.1, 7.1-7.3, 8.1 |
| 7.5 Pre-commit hook | Phase 5.2 |
| 8. Sorties générées | Phase 4 |
| 9. Migration | Phase 6 |
| 10. Tests | Distribués dans toutes les phases |
| 11. Roadmap | Plan = P1-P4 spec (P5 différé, P6 séparé) |

**Gap volontaire** : P5 spec (triggers runtime câblés) n'est PAS dans ce plan. C'est intentionnel pour livrer un MVP fonctionnel sans s'enliser. Phase à enchaîner après. Documenté dans la spec §11 et reconfirmé par Marc.

### Placeholder scan

Recherche dans le plan :
- "TBD", "TODO" : aucun
- "implement later" : aucun
- Tests sans code : tous les tests sont écrits intégralement
- "Similar to Task N" : aucun (code répété quand nécessaire)

### Type consistency check

Fonctions définies et utilisées :
- `validate_schema(workflow, schema=None) -> list[str]` ✓
- `validate_coherence(workflow, agents_dir=None) -> list[str]` ✓
- `check_dataflow_warnings(workflow) -> list[str]` ✓
- `build_dag(workflow) -> WorkflowDAG` ✓
- `WorkflowDAG.topo_order() -> list[str]` ✓
- `WorkflowDAG.execution_levels() -> list[list[str]]` ✓
- `WorkflowDAG.dataflow_edges() -> set[tuple]` ✓
- `load_snippet(path) -> Snippet` ✓
- `render_snippet(snippet, invocation) -> str` ✓
- `generate_skill_md(workflow_path, output_path, ...)` ✓
- `generate_cartography_texte(workflow_path, output_path, ...)` ✓
- `generate_mermaid_cartography(workflow_path, output_path, ...)` ✓
- `generate_mermaid_dataflow(workflow_path, output_path, ...)` ✓
- `wrap_mermaid_in_html(content, output_path, ...)` ✓
- `check_drift(workflow_path, skill_path) -> list[str]` ✓
- `rename_agent(old, new, ...) -> dict` ✓

Tous les noms cohérents entre tasks.

---

## Exécution

Plan complet et committé. Estimation totale : 6-9 jours de travail séquentiel.

**Étapes ordre suggéré** :
- Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 8.1 (déploiement) → **Milestone : MVP utilisable sur un workflow minimal**
- Phase 6 (migration du SKILL.md actuel) → **Milestone : SKILL.md généré pour la 1ère fois**
- Phase 7 (ergonomie) → **Milestone : MVP complet, utilisable en production**
- Phase 8.2 (doc utilisateur)

P5 (triggers runtime câblés) et P6 (dérivation ingestion) = plans séparés à venir.
