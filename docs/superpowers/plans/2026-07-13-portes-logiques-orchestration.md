# Portes logiques & orchestration séparée — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à awok de vraies portes logiques (conditions typées + boucles) visualisables et éditables, décrites dans un fichier d'orchestration séparé, compilées vers la cible standard (`SKILL.md`).

**Architecture:** Le DAG de phases reste la bibliothèque d'unités appelables (fichier `<name>.yaml`). Une couche d'orchestration optionnelle (`<name>.orchestration.yaml`) est un arbre de blocs (`if`/`while`/`for_each`/`parallel`/`ref`) référençant les phases par id ; elle porte la logique. Les signaux (petits scalaires exposés par une phase, greffés sur l'I/O json ou émis en token compact) alimentent les conditions. La frontière js-safe/standard-only vit dans un fichier de capacités dédié, source unique lue par le validateur et (plus tard) par `create-workflow`.

**Tech Stack:** Python 3 (stdlib + PyYAML + Jinja2 + jsonschema), pytest. Le générateur est le script unique `src/scripts/bb-workflow` (~3266 lignes) ; les templates Jinja sont dans `src/workflow/templates/`.

## Global Constraints

- **Rétro-compatibilité totale** : orchestration absente ⇒ DAG pur ⇒ sortie `SKILL.md` **strictement identique** à aujourd'hui. Les 4 workflows existants (`onboard`, `create-workflow`, `workflow-doctor`, `edit-workflow`) ne doivent pas voir leur `SKILL.md` changer d'un octet tant qu'ils n'ajoutent pas d'orchestration.
- **`model: inherit`** dans toute frontmatter d'agent — jamais une valeur fixe (convention awok).
- **Ne jamais éditer un `SKILL.md` à la main** — toujours régénérer via `awok generate`.
- **Cap obligatoire** sur tout `while` / `for_each` (anti-runaway, miroir du cap 1000-agents du runtime JS).
- **Règle d'or des signaux (cible standard)** : le rendu ne demande jamais à l'orchestrateur de recharger un artefact entier pour router — lecture ciblée d'un champ, ou token compact déjà en contexte.
- **Ripple engine** : ce chantier modifie l'engine → après merge, régénérer TOUS les workflows, committer les artefacts régénérés, redéployer, et poser un trailer `Regen:` (voir CLAUDE.md § *Patching the engine or a template*).
- **Périmètre** : cible standard uniquement. Hors plan (suivis) : compilateur JS, UX détaillée de l'éditeur web, extensions `workflow-doctor`.
- **Spec de référence** : `docs/superpowers/specs/2026-07-13-portes-logiques-orchestration-design.md`.
- Lancer les tests : `pytest src/scripts/tests/test_workflow_*.py -v`. Charger le script comme module dans les tests via la fixture `bbw_module` (voir `src/scripts/tests/conftest.py`).

---

### Task 1: Fichier de capacités + loader

Source de vérité unique de la frontière js-safe / standard-only (spec §6).

**Files:**
- Create: `src/workflow/orchestration-capabilities.yaml`
- Modify: `src/scripts/bb-workflow` (ajouter `load_capabilities()` près de `load_schema`, ~ligne 392)
- Test: `src/scripts/tests/test_workflow_capabilities.py`

**Interfaces:**
- Produces: `load_capabilities(path: Path = None) -> dict` — retourne `{"operators": {...}, "builtins": {...}, "operands": {...}}`. Chaque entrée : `{"js_safe": bool, "standard": bool, "types": [str]?}`.

- [ ] **Step 1: Écrire le fichier de capacités**

Create `src/workflow/orchestration-capabilities.yaml`:

```yaml
# Source de vérité unique de la frontière js-safe / standard-only.
# Étendre le vocabulaire de conditions = éditer CE fichier (lu par awok validate
# ET, plus tard, par le skill create-workflow). Aucune matrice codée en dur ailleurs.
operators:
  "==":      { js_safe: true,  standard: true }
  "!=":      { js_safe: true,  standard: true }
  "<":       { js_safe: true,  standard: true,  types: [number] }
  ">":       { js_safe: true,  standard: true,  types: [number] }
  "<=":      { js_safe: true,  standard: true,  types: [number] }
  ">=":      { js_safe: true,  standard: true,  types: [number] }
  contains:  { js_safe: true,  standard: true,  types: [string, list] }
  matches:   { js_safe: true,  standard: true,  types: [string] }
  exists:    { js_safe: true,  standard: true }
builtins:
  file_exists: { js_safe: false, standard: true }   # pas de filesystem en JS
  dir_exists:  { js_safe: false, standard: true }
operands:
  signal:       { js_safe: true,  standard: true }
  literal:      { js_safe: true,  standard: true }
  escape_hatch: { js_safe: false, standard: true }  # prédicat string libre
```

- [ ] **Step 2: Écrire le test qui échoue**

Create `src/scripts/tests/test_workflow_capabilities.py`:

```python
"""Tests for the orchestration capability catalogue."""


def test_load_capabilities_shape(bbw_module):
    caps = bbw_module.load_capabilities()
    assert set(caps) >= {"operators", "builtins", "operands"}


def test_file_exists_is_standard_only(bbw_module):
    caps = bbw_module.load_capabilities()
    assert caps["builtins"]["file_exists"]["js_safe"] is False
    assert caps["builtins"]["file_exists"]["standard"] is True


def test_numeric_operator_declares_types(bbw_module):
    caps = bbw_module.load_capabilities()
    assert caps["operators"]["<"]["types"] == ["number"]


def test_escape_hatch_not_js_safe(bbw_module):
    caps = bbw_module.load_capabilities()
    assert caps["operands"]["escape_hatch"]["js_safe"] is False
```

- [ ] **Step 3: Lancer le test — doit échouer**

Run: `pytest src/scripts/tests/test_workflow_capabilities.py -v`
Expected: FAIL (`module 'bbw' has no attribute 'load_capabilities'`)

- [ ] **Step 4: Implémenter `load_capabilities`**

Dans `src/scripts/bb-workflow`, juste après `load_schema` (~ligne 397), ajouter :

```python
DEFAULT_CAPABILITIES_PATH = ENGINE_ROOT / "src" / "workflow" / "orchestration-capabilities.yaml"


def load_capabilities(path: Path = None) -> dict:
    """Load the js-safe/standard-only capability catalogue (single source of truth)."""
    path = path or DEFAULT_CAPABILITIES_PATH
    with open(path) as f:
        return yaml.safe_load(f) or {}
```

> Note : `ENGINE_ROOT` est défini au chargement du module (voir `_apply_roots`). Le fichier de capacités est engine-owned (comme les templates et le schéma), pas content-owned.

- [ ] **Step 5: Lancer le test — doit passer**

Run: `pytest src/scripts/tests/test_workflow_capabilities.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/workflow/orchestration-capabilities.yaml src/scripts/bb-workflow src/scripts/tests/test_workflow_capabilities.py
git commit -m "feat(orchestration): capability catalogue file + load_capabilities"
```

---

### Task 2: `load_workflow()` — fusion du fichier d'orchestration frère

Point d'entrée unique de chargement du modèle qui greffe `<name>.orchestration.yaml` s'il existe.

**Files:**
- Modify: `src/scripts/bb-workflow` (ajouter `load_workflow` près de `resolve_workflow`, ~ligne 131 ; router les sites de `yaml.safe_load(f)` de chargement du modèle)
- Test: `src/scripts/tests/test_workflow_orchestration.py`

**Interfaces:**
- Produces: `load_workflow(path: Path) -> dict` — charge `<name>.yaml` et, si `<name>.orchestration.yaml` existe à côté, place son contenu (une liste de blocs) sous `workflow["orchestration"]`. Absent ⇒ pas de clé `orchestration`.

- [ ] **Step 1: Écrire le test qui échoue**

Create `src/scripts/tests/test_workflow_orchestration.py`:

```python
"""Tests for the orchestration layer (block tree + merge)."""
import textwrap


def _write(dirpath, name, text):
    p = dirpath / name
    p.write_text(textwrap.dedent(text))
    return p


def test_load_workflow_without_orchestration(bbw_module, tmp_path):
    wf_path = _write(tmp_path, "w.yaml", """
        schema_version: 1
        skill: {name: w, description: x}
        groups: {g: {description: x}}
        phases: [{id: T1, name: a, group: g}]
    """)
    model = bbw_module.load_workflow(wf_path)
    assert "orchestration" not in model


def test_load_workflow_merges_orchestration(bbw_module, tmp_path):
    wf_path = _write(tmp_path, "w.yaml", """
        schema_version: 1
        skill: {name: w, description: x}
        groups: {g: {description: x}}
        phases: [{id: T1, name: a, group: g}]
    """)
    _write(tmp_path, "w.orchestration.yaml", """
        - ref: T1
    """)
    model = bbw_module.load_workflow(wf_path)
    assert model["orchestration"] == [{"ref": "T1"}]
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -v`
Expected: FAIL (`no attribute 'load_workflow'`)

- [ ] **Step 3: Implémenter `load_workflow`**

Dans `src/scripts/bb-workflow`, après `resolve_workflow` (~ligne 131) :

```python
def orchestration_path_for(workflow_path: Path) -> Path:
    """Sibling orchestration file: <name>.yaml -> <name>.orchestration.yaml."""
    return workflow_path.with_suffix("").with_suffix(".orchestration.yaml")


def load_workflow(path: Path) -> dict:
    """Load a workflow model, merging its sibling orchestration file if present.

    Single entry point so every command sees the same merged model. The base
    <name>.yaml is the content source of truth; <name>.orchestration.yaml (a list
    of blocks) is grafted under model['orchestration']. Absent => no key => pure
    DAG (backward compatible)."""
    path = Path(path)
    with open(path) as f:
        model = yaml.safe_load(f) or {}
    orch = orchestration_path_for(path)
    if orch.exists():
        with open(orch) as f:
            model["orchestration"] = yaml.safe_load(f) or []
    return model
```

> `Path("w.yaml").with_suffix("").with_suffix(".orchestration.yaml")` donne `w.orchestration.yaml`. Vérifier ce comportement pour un nom multi-points est inutile ici (les noms de workflow sont des slugs kebab-case sans point — cf. schéma `skill.name`).

- [ ] **Step 4: Router les sites de chargement du modèle vers `load_workflow`**

Remplacer `with open(workflow_path) as f: workflow = yaml.safe_load(f)` (et variantes) par `workflow = load_workflow(workflow_path)` aux sites **de chargement du modèle de workflow** :
- `generate_skill_md` (ligne ~1106-1107)
- `render_cartography_mermaid`/`generate_mermaid_cartography` (ligne ~1618)
- `generate_mermaid_dataflow` (ligne ~1708)
- `generate_mermaid_on_demand` (ligne ~1780)
- `generate_cartography_texte` (ligne ~1801)
- `_validate_one` (ligne ~2042)
- `check_drift`/`cmd_check` (ligne ~2107)
- `_generate_one` (ligne ~2200)
- `generate_workflows_index` loop (ligne ~2300)

**Ne PAS toucher** les `safe_load` non-modèle : `load_snippet` (976), agent frontmatter (2867/2947), `cmd_assist` base (2907), `cmd_init` (3055) — ce ne sont pas des modèles de workflow.

Exemple pour `generate_skill_md` :

```python
    # avant :
    # with open(workflow_path) as f:
    #     workflow = yaml.safe_load(f)
    workflow = load_workflow(workflow_path)
```

- [ ] **Step 5: Lancer les tests — doivent passer, et rien ne régresse**

Run: `pytest src/scripts/tests/ -v`
Expected: PASS (les 2 nouveaux + toute la suite existante inchangée)

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): load_workflow merges sibling <name>.orchestration.yaml"
```

---

### Task 3: Schéma — `emits` sur une phase + schéma d'orchestration

**Files:**
- Modify: `src/workflow/workflow.schema.json` (ajouter `emits` à la définition `phase`)
- Create: `src/workflow/orchestration.schema.json`
- Modify: `src/scripts/bb-workflow` (`validate_schema` valide aussi l'orchestration si présente)
- Test: `src/scripts/tests/test_workflow_schema.py` (étendre)

**Interfaces:**
- Consumes: `load_schema` (existant), `load_workflow` (Task 2).
- Produces: `validate_schema(workflow)` valide `workflow["orchestration"]` contre `orchestration.schema.json` quand la clé est présente.

- [ ] **Step 1: Ajouter `emits` à la définition `phase` du schéma**

Dans `src/workflow/workflow.schema.json`, dans `definitions.phase.properties` (après `interactive`, ligne ~87), ajouter :

```json
        "emits": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "type", "source"],
            "properties": {
              "name": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
              "type": { "enum": ["number", "string", "bool", "enum", "list"] },
              "source": { "enum": ["field", "token"] },
              "from": { "type": "string", "description": "For source=field: 'role' or 'role.field' of an existing json output." }
            }
          }
        }
```

- [ ] **Step 2: Créer le schéma d'orchestration**

Create `src/workflow/orchestration.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "awok orchestration block tree",
  "type": "array",
  "items": { "$ref": "#/definitions/block" },
  "definitions": {
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
        { "type": "string", "description": "escape-hatch predicate (standard-only)" }
      ]
    },
    "block": {
      "type": "object",
      "oneOf": [
        { "required": ["ref"] },
        { "required": ["if"] },
        { "required": ["while"] },
        { "required": ["for_each"] },
        { "required": ["parallel"] }
      ],
      "properties": {
        "ref": { "type": "string" },
        "if": { "$ref": "#/definitions/condition" },
        "then": { "type": "array", "items": { "$ref": "#/definitions/block" } },
        "else": { "type": "array", "items": { "$ref": "#/definitions/block" } },
        "while": { "$ref": "#/definitions/condition" },
        "until": { "$ref": "#/definitions/condition" },
        "for_each": { "type": "string", "description": "a list-typed signal reference" },
        "as": { "type": "string" },
        "cap": { "type": "integer", "minimum": 1 },
        "body": { "type": "array", "items": { "$ref": "#/definitions/block" } },
        "parallel": { "type": "array", "items": { "$ref": "#/definitions/block" } }
      }
    }
  }
}
```

- [ ] **Step 3: Écrire le test qui échoue**

Dans `src/scripts/tests/test_workflow_schema.py`, ajouter :

```python
def test_orchestration_schema_accepts_valid_tree(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g"}],
        "orchestration": [
            {"ref": "T1"},
            {"if": {"op": "==", "left": "t1.status", "right": "ok"}, "then": [{"ref": "T1"}]},
        ],
    }
    assert bbw_module.validate_schema(wf) == []


def test_orchestration_schema_rejects_bad_operator(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g"}],
        "orchestration": [{"if": {"op": "~=", "left": "a", "right": "b"}, "then": [{"ref": "T1"}]}],
    }
    assert bbw_module.validate_schema(wf) != []


def test_phase_emits_accepted(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": [{"id": "T1", "name": "a", "group": "g",
                    "emits": [{"name": "verdict", "type": "enum", "source": "token"}]}],
    }
    assert bbw_module.validate_schema(wf) == []
```

- [ ] **Step 4: Lancer le test — doit échouer**

Run: `pytest src/scripts/tests/test_workflow_schema.py -k "orchestration or emits" -v`
Expected: FAIL (`test_orchestration_schema_rejects_bad_operator` passe par accident car rien ne valide encore ; `accepts_valid_tree` peut échouer si emits/orchestration inconnus font planter un `additionalProperties`). Confirmer au moins un FAIL réel.

- [ ] **Step 5: Valider l'orchestration dans `validate_schema`**

Lire `validate_schema` (ligne ~399). Après la validation du schéma principal, ajouter la validation du sous-arbre orchestration :

```python
DEFAULT_ORCH_SCHEMA_PATH = ENGINE_ROOT / "src" / "workflow" / "orchestration.schema.json"


def load_orchestration_schema(path: Path = None) -> dict:
    path = path or DEFAULT_ORCH_SCHEMA_PATH
    with open(path) as f:
        return json.load(f)
```

À la fin de `validate_schema`, avant le `return errors` :

```python
    if "orchestration" in workflow:
        try:
            jsonschema.validate(workflow["orchestration"], load_orchestration_schema())
        except jsonschema.ValidationError as e:
            errors.append(f"orchestration schema: {e.message}")
```

> Vérifier que `json` et `jsonschema` sont déjà importés en tête du script (ils le sont : le schéma principal les utilise).

- [ ] **Step 6: Lancer les tests — doivent passer**

Run: `pytest src/scripts/tests/test_workflow_schema.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/workflow/workflow.schema.json src/workflow/orchestration.schema.json src/scripts/bb-workflow src/scripts/tests/test_workflow_schema.py
git commit -m "feat(orchestration): schema for block tree + phase emits"
```

---

### Task 4: Modèle de signaux — collecte + résolution d'une référence

**Files:**
- Modify: `src/scripts/bb-workflow` (ajouter `collect_signals` près de `validate_coherence`, ~ligne 605)
- Test: `src/scripts/tests/test_workflow_signals.py`

**Interfaces:**
- Produces: `collect_signals(workflow: dict) -> dict` — retourne `{signal_name: {"type": str, "source": "field"|"token", "phase": pid}}`. Deux origines : (a) un bloc `emits` de phase ; (b) implicite depuis un output json — mais pour ce plan, seule l'origine explicite `emits` peuple la map ; les références `field` non déclarées sont tolérées avec `type=None` (typées sur la condition). Le nom du signal côté condition suit la convention `<pid_lowercase>.<champ>` (ex. `RECON` → `recon.endpoints`).

- [ ] **Step 1: Écrire le test qui échoue**

Create `src/scripts/tests/test_workflow_signals.py`:

```python
"""Tests for the signal model."""


def test_collect_signals_from_emits(bbw_module):
    wf = {"phases": [
        {"id": "CRITIC", "name": "c", "group": "g",
         "emits": [{"name": "verdict", "type": "enum", "source": "token"}]},
    ]}
    sig = bbw_module.collect_signals(wf)
    assert "critic.verdict" in sig
    assert sig["critic.verdict"]["type"] == "enum"
    assert sig["critic.verdict"]["source"] == "token"
    assert sig["critic.verdict"]["phase"] == "CRITIC"


def test_collect_signals_empty_when_no_emits(bbw_module):
    wf = {"phases": [{"id": "T1", "name": "a", "group": "g"}]}
    assert bbw_module.collect_signals(wf) == {}
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `pytest src/scripts/tests/test_workflow_signals.py -v`
Expected: FAIL (`no attribute 'collect_signals'`)

- [ ] **Step 3: Implémenter `collect_signals`**

Avant `validate_coherence` (~ligne 610) :

```python
def collect_signals(workflow: dict) -> dict:
    """Map declared signals to their metadata, keyed '<pid_lower>.<name>'.

    Only explicit `emits` populate the map. A condition may also reference a
    field of a json output ('<pid_lower>.<field>') that is not declared here;
    such references are typed on the condition itself, not from this map."""
    signals = {}
    for phase in workflow.get("phases", []):
        pid = phase["id"]
        for emit in phase.get("emits", []) or []:
            key = f"{pid.lower()}.{emit['name']}"
            signals[key] = {
                "type": emit.get("type"),
                "source": emit.get("source"),
                "phase": pid,
            }
    return signals
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `pytest src/scripts/tests/test_workflow_signals.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_signals.py
git commit -m "feat(orchestration): collect_signals from phase emits"
```

---

### Task 5: Validation d'orchestration — refs, cap, cohérence signal↔type, frontière js-safe

**Files:**
- Modify: `src/scripts/bb-workflow` (ajouter `validate_orchestration` après `collect_signals` ; l'appeler depuis `validate_coherence`)
- Test: `src/scripts/tests/test_workflow_orchestration.py` (étendre)

**Interfaces:**
- Consumes: `collect_signals` (Task 4), `load_capabilities` (Task 1).
- Produces: `validate_orchestration(workflow, capabilities=None, target="standard") -> list[str]`. Appelée dans `validate_coherence`, ses erreurs s'ajoutent à la liste retournée.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/scripts/tests/test_workflow_orchestration.py`, ajouter :

```python
def _wf(orchestration, phases=None, emits=None):
    phases = phases or [{"id": "T1", "name": "a", "group": "g"}]
    if emits:
        phases[0]["emits"] = emits
    return {
        "schema_version": 1,
        "skill": {"name": "w", "description": "x"},
        "groups": {"g": {"description": "x"}},
        "phases": phases,
        "orchestration": orchestration,
    }


def test_block_ref_unknown_phase(bbw_module):
    errs = bbw_module.validate_orchestration(_wf([{"ref": "NOPE"}]))
    assert any("NOPE" in e for e in errs)


def test_loop_requires_cap(bbw_module):
    wf = _wf([{"while": {"op": "==", "left": "t1.v", "right": "x"}, "body": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("cap" in e.lower() for e in errs)


def test_condition_references_unknown_signal(bbw_module):
    wf = _wf([{"if": {"op": "==", "left": "ghost.v", "right": "x"}, "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("ghost.v" in e for e in errs)


def test_numeric_operator_on_string_signal(bbw_module):
    wf = _wf([{"if": {"op": "<", "left": "t1.v", "right": 3}, "then": [{"ref": "T1"}]}],
             emits=[{"name": "v", "type": "string", "source": "token"}])
    errs = bbw_module.validate_orchestration(wf)
    assert any("t1.v" in e and "number" in e for e in errs)


def test_file_exists_rejected_in_js_target(bbw_module):
    wf = _wf([{"if": {"op": "exists", "left": {"file_exists": "x.txt"}}, "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf, target="js")
    assert any("file_exists" in e for e in errs)


def test_escape_hatch_ok_in_standard(bbw_module):
    wf = _wf([{"if": "le rapport mentionne un CVE", "then": [{"ref": "T1"}]}])
    errs = bbw_module.validate_orchestration(wf, target="standard")
    assert errs == []
```

- [ ] **Step 2: Lancer les tests — doivent échouer**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -k validate_orchestration -v`
Expected: FAIL (`no attribute 'validate_orchestration'`)

- [ ] **Step 3: Implémenter `validate_orchestration`**

Après `collect_signals` :

```python
_NUMERIC_OPS = {"<", ">", "<=", ">="}


def _iter_blocks(blocks):
    """Yield every block in the tree, depth-first."""
    for b in blocks or []:
        yield b
        for key in ("then", "else", "body", "parallel"):
            yield from _iter_blocks(b.get(key))


def _operand_type(operand, signals):
    """Best-effort type of a condition operand. None = unknown/untyped."""
    if isinstance(operand, bool):
        return "bool"
    if isinstance(operand, (int, float)):
        return "number"
    if isinstance(operand, str):
        # a signal reference '<pid>.<field>' if declared, else a literal string
        return signals.get(operand, {}).get("type") if operand in signals else "string"
    if isinstance(operand, dict):
        return "builtin"
    return None


def validate_orchestration(workflow, capabilities=None, target="standard"):
    """Validate the orchestration block tree: refs, caps, signal coherence,
    operator/type compatibility, js-safe frontier."""
    if "orchestration" not in workflow:
        return []
    caps = capabilities or load_capabilities()
    signals = collect_signals(workflow)
    known_pids = {p["id"] for p in workflow.get("phases", [])}
    errors = []

    for b in _iter_blocks(workflow["orchestration"]):
        # ref -> existing phase
        if "ref" in b and b["ref"] not in known_pids:
            errors.append(f"orchestration: block ref '{b['ref']}' is not an existing phase")
        # loops need a cap
        if ("while" in b or "until" in b or "for_each" in b) and "cap" not in b:
            errors.append(f"orchestration: loop block {b.get('while') or b.get('for_each')} missing mandatory 'cap'")
        # for_each collection must be a declared list signal
        if "for_each" in b:
            coll = b["for_each"]
            sig = signals.get(coll)
            if sig is None:
                errors.append(f"orchestration: for_each references unknown signal '{coll}'")
            elif sig["type"] not in (None, "list"):
                errors.append(f"orchestration: for_each '{coll}' is type '{sig['type']}', expected list")

        # conditions
        cond = b.get("if") or b.get("while") or b.get("until")
        if cond is not None:
            errors.extend(_validate_condition(cond, signals, caps, target))

    return errors


def _validate_condition(cond, signals, caps, target):
    errors = []
    # escape-hatch (string predicate)
    if isinstance(cond, str):
        if not caps["operands"]["escape_hatch"].get(target if target == "standard" else "js_safe", False):
            pass  # standard: allowed
        if target == "js":
            errors.append("orchestration: escape-hatch predicate is standard-only (not js-safe)")
        return errors
    if not isinstance(cond, dict):
        return errors

    op = cond.get("op")
    op_meta = caps["operators"].get(op)
    if op_meta is None:
        errors.append(f"orchestration: unknown operator '{op}'")
        return errors
    if target == "js" and not op_meta.get("js_safe", False):
        errors.append(f"orchestration: operator '{op}' is standard-only in a js target")

    left, right = cond.get("left"), cond.get("right")

    # builtin operand (file_exists/dir_exists) js-safety
    for operand in (left, right):
        if isinstance(operand, dict):
            for bname in operand:
                bmeta = caps["builtins"].get(bname)
                if bmeta is None:
                    errors.append(f"orchestration: unknown builtin '{bname}'")
                elif target == "js" and not bmeta.get("js_safe", False):
                    errors.append(f"orchestration: builtin '{bname}' is standard-only in a js target")

    # signal existence: a dotted string operand that looks like a ref must resolve
    for operand in (left, right):
        if isinstance(operand, str) and "." in operand and operand.split(".")[0].isidentifier():
            # heuristic: treat 'a.b' as a signal ref
            if operand not in signals and not _looks_like_literal(operand):
                errors.append(f"orchestration: condition references unknown signal '{operand}'")

    # operator/type compatibility
    if op in _NUMERIC_OPS:
        for operand in (left, right):
            t = _operand_type(operand, signals)
            if t is not None and t not in ("number", "builtin"):
                errors.append(f"orchestration: operator '{op}' needs number operands, got '{operand}' (type {t})")
    return errors


def _looks_like_literal(s):
    """A dotted string that is a literal value, not a signal ref (e.g. a version)."""
    return s.replace(".", "").isdigit()
```

> Le repérage signal-vs-littéral est heuristique (un opérande string pointé `a.b` où `a` est un identifiant = référence de signal). C'est acceptable : le faux positif se corrige en déclarant le signal ; le cas ambigu (littéral pointé non numérique) est rare et documenté.

- [ ] **Step 4: Brancher dans `validate_coherence`**

À la fin de `validate_coherence` (avant `return errors`, ~ligne 710) :

```python
    errors.extend(validate_orchestration(workflow))
```

- [ ] **Step 5: Lancer les tests — doivent passer**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py -v`
Expected: PASS (tous les tests d'orchestration)

- [ ] **Step 6: Lancer TOUTE la suite — rien ne régresse**

Run: `pytest src/scripts/tests/ -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_orchestration.py
git commit -m "feat(orchestration): validate block refs, caps, signal coherence, js-safe frontier"
```

---

### Task 6: Rétro-compat legacy — golden test des 4 workflows existants

Garantit que, sans orchestration, la sortie reste identique (les conditionnels legacy `skip_if`/`conditions` continuent de générer comme avant).

**Files:**
- Test: `src/scripts/tests/test_workflow_generate.py` (étendre)

**Interfaces:**
- Consumes: `generate_skill_md` (existant), `load_workflow` (Task 2).

- [ ] **Step 1: Écrire le test de non-régression**

Dans `src/scripts/tests/test_workflow_generate.py`, ajouter :

```python
import subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def test_existing_skills_unchanged_after_regen(tmp_path):
    """Regenerating the 4 committed workflows yields byte-identical SKILL.md
    (no orchestration => pure DAG => today's output)."""
    for name in ["onboard", "create-workflow", "workflow-doctor", "edit-workflow"]:
        committed = (REPO / "src" / "skills" / name / "SKILL.md").read_text()
        out = tmp_path / f"{name}.md"
        subprocess.run(
            [sys.executable, str(REPO / "src" / "scripts" / "bb-workflow"),
             "generate", "--workflow", name, "--skill", str(out)],
            cwd=REPO, check=True, capture_output=True,
        )
        assert out.read_text() == committed, f"{name} SKILL.md drifted after regen"
```

> Si `generate --skill <path>` n'existe pas comme override de sortie, adapter en générant dans un workdir temporaire et en comparant `src/skills/<name>/SKILL.md`. Lire `cmd_generate` (ligne ~2406) pour l'option exacte ; sinon comparer via `awok check` (exit 0 = pas de drift).

- [ ] **Step 2: Lancer le test — doit passer d'emblée (rétro-compat)**

Run: `pytest src/scripts/tests/test_workflow_generate.py::test_existing_skills_unchanged_after_regen -v`
Expected: PASS. **S'il échoue, un des Tasks 1–5 a modifié la sortie du chemin sans-orchestration → corriger avant d'avancer.**

- [ ] **Step 3: Commit**

```bash
git add src/scripts/tests/test_workflow_generate.py
git commit -m "test(orchestration): golden regression — legacy workflows generate unchanged"
```

---

### Task 7: Rendu de l'orchestration dans le SKILL.md

Compile l'arbre de blocs en un programme d'instructions imbriquées (cible standard).

**Files:**
- Modify: `src/scripts/bb-workflow` (ajouter `render_orchestration` ; injecter dans le contexte de `generate_skill_md`)
- Modify: `src/workflow/templates/skill-skeleton.md.jinja` (section "## Orchestration program")
- Test: `src/scripts/tests/test_workflow_generate.py` (étendre)

**Interfaces:**
- Consumes: `collect_signals` (Task 4).
- Produces: `render_orchestration(workflow: dict) -> str` — markdown des instructions, ou `""` si pas d'orchestration. Passé au template sous la variable `orchestration_md`.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `test_workflow_generate.py` :

```python
def test_render_orchestration_for_each_and_if(bbw_module):
    wf = {
        "phases": [
            {"id": "SCAN", "name": "s", "group": "g",
             "emits": [{"name": "status", "type": "enum", "source": "token"}]},
            {"id": "RECON", "name": "r", "group": "g",
             "emits": [{"name": "endpoints", "type": "list", "source": "field", "from": "recon.json"}]},
            {"id": "EXPLOIT", "name": "e", "group": "g"},
        ],
        "orchestration": [
            {"ref": "RECON"},
            {"for_each": "recon.endpoints", "as": "ep", "cap": 200, "body": [
                {"ref": "SCAN"},
                {"if": {"op": "==", "left": "scan.status", "right": "vuln"},
                 "then": [{"ref": "EXPLOIT"}]},
            ]},
        ],
    }
    md = bbw_module.render_orchestration(wf)
    assert "Orchestration program" in md
    assert "For each" in md and "recon.endpoints" in md and "ep" in md
    assert "EXPLOIT" in md and "scan.status" in md


def test_render_orchestration_empty_without_key(bbw_module):
    assert bbw_module.render_orchestration({"phases": []}) == ""
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `pytest src/scripts/tests/test_workflow_generate.py -k render_orchestration -v`
Expected: FAIL (`no attribute 'render_orchestration'`)

- [ ] **Step 3: Implémenter `render_orchestration`**

Ajouter (près des autres builders de rendu, ~ligne 1499) :

```python
def _render_condition(cond):
    if isinstance(cond, str):
        return f"_{cond}_"  # escape-hatch: natural-language predicate
    op, left, right = cond.get("op"), cond.get("left"), cond.get("right")
    if isinstance(left, dict):
        left = " ".join(f"{k}({v})" for k, v in left.items())
    if op == "exists":
        return f"`{left}` exists"
    return f"`{left}` {op} `{right}`"


def _render_blocks(blocks, depth=0):
    lines = []
    pad = "  " * depth
    for b in blocks or []:
        if "ref" in b:
            lines.append(f"{pad}- Run action **{b['ref']}**.")
        elif "if" in b:
            lines.append(f"{pad}- **If** {_render_condition(b['if'])}:")
            lines += _render_blocks(b.get("then"), depth + 1)
            if b.get("else"):
                lines.append(f"{pad}- **Else**:")
                lines += _render_blocks(b["else"], depth + 1)
        elif "for_each" in b:
            var = b.get("as", "item")
            lines.append(f"{pad}- **For each** `{var}` in signal `{b['for_each']}` "
                         f"(cap {b.get('cap')}), launch the body once per `{var}` "
                         f"(independent items → run them together in one message):")
            lines += _render_blocks(b.get("body"), depth + 1)
        elif "while" in b or "until" in b:
            kw = "While" if "while" in b else "Until"
            cond = b.get("while") or b.get("until")
            lines.append(f"{pad}- **{kw}** {_render_condition(cond)} (max {b.get('cap')} iterations):")
            lines += _render_blocks(b.get("body"), depth + 1)
        elif "parallel" in b:
            lines.append(f"{pad}- **In parallel** (launch all in one message):")
            lines += _render_blocks(b["parallel"], depth + 1)
    return lines


def render_orchestration(workflow: dict) -> str:
    """Render the block tree as a nested instruction program (standard target)."""
    if "orchestration" not in workflow:
        return ""
    signals = collect_signals(workflow)
    out = ["## Orchestration program", "",
           "Run the pipeline actions **in this order and control flow** — this program "
           "drives the DAG below. Evaluate each condition from the **signals** the actions "
           "emit; read only the named signal, never reload a whole artifact.", ""]
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

- [ ] **Step 4: Injecter dans `generate_skill_md` et le template**

Dans `generate_skill_md`, là où le contexte du template est construit (chercher l'appel `template.render(...)` ; lire autour de ~1250-1286), ajouter au contexte : `orchestration_md=render_orchestration(workflow)`.

Dans `src/workflow/templates/skill-skeleton.md.jinja`, insérer **avant** `## Pipeline actions (DAG)` (ligne 84) :

```jinja
{% if orchestration_md %}
---

{{ orchestration_md }}
{% endif %}
```

- [ ] **Step 5: Lancer les tests — doivent passer**

Run: `pytest src/scripts/tests/test_workflow_generate.py -v`
Expected: PASS (nouveaux + `test_existing_skills_unchanged_after_regen` toujours vert car `orchestration_md` vide ⇒ section absente)

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/workflow/templates/skill-skeleton.md.jinja src/scripts/tests/test_workflow_generate.py
git commit -m "feat(orchestration): render block tree as nested instruction program in SKILL.md"
```

---

### Task 8: Cartographie — branches (losanges), boucles (sous-graphes), signaux

**Files:**
- Modify: `src/scripts/bb-workflow` (`build_edge_labels`/`render_cartography_mermaid` ou un nouveau `build_orchestration_overlay`)
- Modify: `src/workflow/templates/cartography.mermaid.jinja`
- Modify: `src/workflow/templates/cartography-texte.md.jinja`
- Test: `src/scripts/tests/test_workflow_generate.py` ou nouveau `test_workflow_cartography.py`

**Interfaces:**
- Produces: `build_orchestration_overlay(workflow) -> dict` — `{"branches": [...], "loops": [...]}` consommé par le template mermaid pour ajouter losanges + sous-graphes bordés.

- [ ] **Step 1: Écrire le test qui échoue**

Create `src/scripts/tests/test_workflow_cartography.py`:

```python
def test_overlay_marks_branch_and_loop(bbw_module):
    wf = {
        "phases": [{"id": "H", "name": "h", "group": "g"}, {"id": "C", "name": "c", "group": "g"}],
        "orchestration": [
            {"while": {"op": "==", "left": "c.verdict", "right": "INSUFFICIENT"},
             "cap": 3, "body": [{"ref": "H"}, {"ref": "C"}]},
        ],
    }
    ov = bbw_module.build_orchestration_overlay(wf)
    assert ov["loops"] and ov["loops"][0]["cap"] == 3
    assert "H" in ov["loops"][0]["body_ids"] and "C" in ov["loops"][0]["body_ids"]


def test_overlay_empty_without_orchestration(bbw_module):
    assert bbw_module.build_orchestration_overlay({"phases": []}) == {"branches": [], "loops": []}
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `pytest src/scripts/tests/test_workflow_cartography.py -v`
Expected: FAIL (`no attribute 'build_orchestration_overlay'`)

- [ ] **Step 3: Implémenter `build_orchestration_overlay`**

Près des builders de cartographie (~ligne 1321) :

```python
def _collect_ref_ids(blocks):
    ids = []
    for b in _iter_blocks(blocks):
        if "ref" in b:
            ids.append(b["ref"])
    return ids


def build_orchestration_overlay(workflow: dict) -> dict:
    """Overlay data for the cartography: branch diamonds + loop subgraphs."""
    overlay = {"branches": [], "loops": []}
    for b in _iter_blocks(workflow.get("orchestration", [])):
        if "if" in b:
            overlay["branches"].append({
                "cond": _render_condition(b["if"]),
                "then_ids": _collect_ref_ids(b.get("then")),
                "else_ids": _collect_ref_ids(b.get("else")),
            })
        if "while" in b or "until" in b or "for_each" in b:
            label = (b.get("for_each") and f"for each {b['for_each']}") or \
                    _render_condition(b.get("while") or b.get("until"))
            overlay["loops"].append({
                "label": label,
                "cap": b.get("cap"),
                "body_ids": _collect_ref_ids(b.get("body")),
            })
    return overlay
```

- [ ] **Step 4: Câbler dans le rendu mermaid**

Lire `render_cartography_mermaid` (~1597) pour voir le contexte passé au template. Ajouter `orchestration_overlay=build_orchestration_overlay(workflow)` au contexte, puis dans `cartography.mermaid.jinja` rendre :
- pour chaque `loop` : un `subgraph` bordé regroupant `body_ids`, titre `label (cap N)` ;
- pour chaque `branch` : un nœud losange `{{cond}}` avec arêtes `-->|true|` vers `then_ids` et `-->|false|` vers `else_ids`.

Exemple de fragment Jinja à ajouter en fin de template mermaid :

```jinja
{% for lp in orchestration_overlay.loops %}
subgraph loop_{{ loop.index }}["🔁 {{ lp.label }} (cap {{ lp.cap }})"]
{% for bid in lp.body_ids %}  {{ bid }}
{% endfor %}end
{% endfor %}
{% for br in orchestration_overlay.branches %}
br_{{ loop.index }}{"{{ br.cond }}"}
{% for tid in br.then_ids %}br_{{ loop.index }} -->|true| {{ tid }}
{% endfor %}{% for eid in br.else_ids %}br_{{ loop.index }} -->|false| {{ eid }}
{% endfor %}{% endfor %}
```

> Adapter la syntaxe exacte des nœuds/ids à celle déjà produite par le template (lire `build_phase_agent_nodes` ~1364 et le `.jinja` existant pour respecter le `_node_id_filter`). Garder le rendu **inerte quand l'overlay est vide** (les `{% for %}` ne produisent rien).

- [ ] **Step 5: Rendu ASCII**

Dans `cartography-texte.md.jinja`, ajouter une section "Orchestration" listant boucles et branches en indentation (réutiliser `orchestration_overlay`). Inerte si vide.

- [ ] **Step 6: Lancer les tests — doivent passer + non-régression cartographie**

Run: `pytest src/scripts/tests/ -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/workflow/templates/cartography.mermaid.jinja src/workflow/templates/cartography-texte.md.jinja src/scripts/tests/test_workflow_cartography.py
git commit -m "feat(orchestration): cartography overlay — branch diamonds + loop subgraphs"
```

---

### Task 9: Fixture end-to-end + docs

**Files:**
- Create: `src/scripts/tests/fixtures/workflows/orchestrated.yaml` + `orchestrated.orchestration.yaml`
- Modify: `CLAUDE.md` (section conventions : documenter le 2-YAML, `emits`, le fichier de capacités)
- Modify: `docs/dev/bb-workflow.md` (référence utilisateur)
- Test: `src/scripts/tests/test_workflow_orchestration.py` (test end-to-end sur la fixture)

- [ ] **Step 1: Créer la fixture**

Create `src/scripts/tests/fixtures/workflows/orchestrated.yaml`:

```yaml
schema_version: 1
skill: {name: orchestrated, description: fixture d'orchestration}
groups: {g: {description: demo}}
phases:
  - {id: RECON, name: recon, group: g, emits: [{name: endpoints, type: list, source: field, from: recon.json}]}
  - {id: SCAN, name: scan, group: g, emits: [{name: status, type: enum, source: token}]}
  - {id: EXPLOIT, name: exploit, group: g}
```

Create `src/scripts/tests/fixtures/workflows/orchestrated.orchestration.yaml`:

```yaml
- ref: RECON
- for_each: recon.endpoints
  as: ep
  cap: 100
  body:
    - ref: SCAN
    - if: {op: "==", left: scan.status, right: vuln}
      then: [{ref: EXPLOIT}]
```

- [ ] **Step 2: Test end-to-end (validation propre + rendu)**

Ajouter dans `test_workflow_orchestration.py` :

```python
from pathlib import Path
FIX = Path(__file__).parent / "fixtures" / "workflows"


def test_fixture_validates_and_renders(bbw_module):
    model = bbw_module.load_workflow(FIX / "orchestrated.yaml")
    assert bbw_module.validate_schema(model) == []
    assert bbw_module.validate_orchestration(model) == []
    md = bbw_module.render_orchestration(model)
    assert "For each" in md and "recon.endpoints" in md
```

- [ ] **Step 3: Lancer — doit passer**

Run: `pytest src/scripts/tests/test_workflow_orchestration.py::test_fixture_validates_and_renders -v`
Expected: PASS

- [ ] **Step 4: Documenter dans CLAUDE.md**

Dans `CLAUDE.md`, sous "Workflow conventions", ajouter une sous-section "### Orchestration (portes logiques)" résumant : le 2ᵉ fichier `<name>.orchestration.yaml` (optionnel, absent = DAG pur), les 6 constructs, le bloc `emits` opt-in sur une phase, la règle d'or des signaux, et le fichier `orchestration-capabilities.yaml` comme source unique de la frontière js-safe. Renvoyer vers le spec `docs/superpowers/specs/2026-07-13-portes-logiques-orchestration-design.md`.

- [ ] **Step 5: Documenter dans docs/dev/bb-workflow.md**

Ajouter la même matière côté doc utilisateur (format des blocs, exemple `for_each`/`if`/`while`, comment déclarer un signal).

- [ ] **Step 6: Commit**

```bash
git add src/scripts/tests/fixtures/workflows/orchestrated.yaml src/scripts/tests/fixtures/workflows/orchestrated.orchestration.yaml src/scripts/tests/test_workflow_orchestration.py CLAUDE.md docs/dev/bb-workflow.md
git commit -m "docs(orchestration): end-to-end fixture + CLAUDE.md & dev doc"
```

---

### Task 10: Ripple engine — régénérer, vérifier le drift, redéployer

L'engine a changé ; propager aux artefacts (voir CLAUDE.md § *Patching the engine or a template*).

**Files:**
- Modify (regénérés) : `src/skills/*/SKILL.md`, `docs/architecture-cartography/*` (doivent rester identiques — les 4 workflows n'ont pas d'orchestration)

- [ ] **Step 1: Régénérer tous les workflows**

Run: `awok generate`
Expected: succès, aucune erreur.

- [ ] **Step 2: Vérifier l'absence de drift**

Run: `awok check`
Expected: exit 0 (les 4 `SKILL.md` sont inchangés — c'est la garantie de rétro-compat du Task 6).

> **Si `awok check` signale un drift**, c'est une régression : un des rendus a bougé alors qu'aucune orchestration n'est déclarée. Revenir sur le Task fautif (probablement 7 ou 8 : un fragment de template non-inerte quand l'overlay est vide).

- [ ] **Step 3: Lancer toute la suite de tests**

Run: `pytest src/scripts/tests/ -v`
Expected: PASS (suite complète).

- [ ] **Step 4: Redéployer**

Run: `./install.sh`
Expected: wrappers + skills/agents déployés.

- [ ] **Step 5: Commit final avec trailer Regen**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(orchestration): regenerate artifacts after engine change

Regen: all SKILL.md + cartography (orchestration layer added, inert when
       no <name>.orchestration.yaml present — existing workflows unchanged);
       workdir owners run `awok generate && awok deploy`.
EOF
)"
```

---

## Self-Review

**1. Spec coverage** :
- §3–4 architecture 2-YAML → Task 2 (merge) + Task 3 (schéma) + Task 9 (fixture/doc). ✓
- §5 catalogue des 6 constructs → schéma Task 3 (`if/while/until/for_each/parallel/ref`) + rendu Task 7. ✓ (l'accumulateur/reduce n'a pas de syntaxe dédiée : il s'exprime via un signal `emits` relu à l'itération suivante — documenté Task 9, pas de construct séparé à valider.)
- §6 conditions & frontière js-safe → Task 1 (fichier) + Task 5 (validation). ✓
- §7 signaux (source field/token, opt-in, règle d'or) → Task 4 (collecte) + Task 7 (rendu de la consigne de lecture). ✓
- §8 double compilation → cible standard uniquement ici (JS = suivi, hors périmètre, annoncé). ✓
- §9 cartographie → Task 8. ✓
- §10 validateur → Task 5 ; extensions workflow-doctor = **suivi explicitement hors plan** (à porter dans un plan doctor séparé). ✓
- §11 legacy = sucre, rétro-compat → Task 6 (golden test) + Task 10 (drift check). ✓

**2. Placeholder scan** : chaque step porte du code réel. Les deux endroits où le code exact doit être confirmé à l'exécution (fragment mermaid Task 8 step 4 ; option `--skill` Task 6 step 1) sont signalés avec l'instruction de lecture précise et un fallback — pas des « TODO » ouverts.

**3. Type consistency** : `load_workflow`, `load_capabilities`, `collect_signals`, `validate_orchestration`, `_iter_blocks`, `_render_condition`, `_render_blocks`, `render_orchestration`, `build_orchestration_overlay`, `_collect_ref_ids` — noms cohérents entre définitions (Tasks 1/2/4/5/7/8) et usages. `_iter_blocks` défini en Task 5 et réutilisé en Task 8 (ordre respecté : Task 5 avant Task 8).

## Suivis explicitement hors de ce plan

1. **Compilateur JS** (dynamic workflows) : même modèle, cible `js`, `validate_orchestration(target="js")` déjà prêt à refuser les briques `standard-only`.
2. **Éditeur web** : édition de blocs imbriqués + « exposer un signal » à la pose d'une condition.
3. **Extensions workflow-doctor** : flag conditionnel-dans-le-prompt = orchestration obsolète ; flag sur-usage best-effort ; flag logique échappée.
