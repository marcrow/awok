# Modèle I/O bb-workflow — Lot 1 (rôle + namespaces + dérivation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de déclarer les I/O d'un agent par **rôle logique** (ex. `extraction:endpoints`) dont le chemin est **dérivé** d'une carte `namespaces` éditable, le `path` explicite restant un override — sans casser aucun workflow existant.

**Architecture:** On vole le pattern *IO-manager* de Dagster (nom logique découplé du stockage) mais appliqué **au compile-time** : une fonction pure `resolve_io_path(io_ref, namespaces)` calcule le chemin ; `resolve_io_paths(model)` remplit ces chemins sur une **copie** du modèle utilisée par la génération / le dataflow (jamais sur le modèle sauvegardé, pour que le YAML reste en rôles). Le schema accepte `role`+`namespaces` en plus de `path` (rétro-compatible : `path` seul = override).

**Tech Stack:** Python stdlib + PyYAML + Jinja2 + jsonschema. Tests : pytest (`claude-setup/scripts/tests/`).

**Référence design :** `docs/superpowers/specs/2026-06-02-bb-workflow-io-model.md` (modèle figé) + `docs/superpowers/specs/2026-06-02-prior-art-research.md` (§ dive Dagster).

**Hors scope (lots suivants) :** rubrique contrat dans `agents/*.md` + relais verbatim (Lot 2) ; check déterministe rôle↔prose dans `validate` (Lot 3) ; `bb-workflow init` (Lot 4) ; registre de namespaces partagé + panneau live web UI (V2).

---

## File Structure

- `claude-setup/workflow/workflow.schema.json` — **modifié** : `io_ref` gagne `role`/`namespace`, `required` assoupli ; nouvelle clé top-level `namespaces`.
- `claude-setup/scripts/bb-workflow` — **modifié** :
  - constante `EXT_BY_KIND` + fonctions `resolve_io_path` / `resolve_io_paths` (nouvelles, près de `dump_workflow_yaml`, ~ligne 175).
  - `_IO_REF_KEYS` (ligne 121) += `role`, `namespace`.
  - `validate_coherence` (ligne 416) : nouveau bloc de validation des io_ref.
  - `generate_skill_md` (ligne 737) et `check_dataflow_warnings` : opèrent sur le modèle résolu.
  - `_format_io_compact` (ligne 701) : enrichi (rôle + kind + légende + chemin résolu).
- `claude-setup/scripts/tests/test_workflow_io_roles.py` — **créé** : couvre dérivation, schema, round-trip, validation.
- `claude-setup/scripts/tests/test_workflow_dataflow_markers.py` — **modifié** : 1 test confirmant que les warnings marchent sur des rôles dérivés.
- `docs/dev/bb-workflow.md` + `docs/superpowers/specs/2026-06-02-bb-workflow-io-model.md` — **modifiés** : documenter `role`/`namespaces` comme livrés.

> **Note fixture :** les tests workflow utilisent la fixture `bbw_module` (déjà dans `claude-setup/scripts/tests/conftest.py`, chargée comme `test_workflow_dataflow_markers.py` l'utilise). Tous les tests ci-dessous la réutilisent.

---

## Task 1 : Schema — `role`, `namespace`, `namespaces`, `required` assoupli

**Files:**
- Modify: `claude-setup/workflow/workflow.schema.json` (def `io_ref` lignes 97-107 ; properties top-level lignes ~30-57)
- Test: `claude-setup/scripts/tests/test_workflow_io_roles.py`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer le fichier `claude-setup/scripts/tests/test_workflow_io_roles.py` :

```python
"""I/O par rôle + namespaces : dérivation de chemin, schema, round-trip, validation."""


def test_schema_accepts_role_only_io_ref(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "outputs": [{"role": "extraction:endpoints", "kind": "json"}],
            }],
        }],
    }
    assert bbw_module.validate_schema(wf) == []


def test_schema_rejects_io_ref_without_path_or_role(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a", "outputs": [{"kind": "json"}]}],
        }],
    }
    assert bbw_module.validate_schema(wf) != []


def test_schema_still_accepts_explicit_path(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "outputs": [{"path": "work/x.json", "kind": "json"}],
            }],
        }],
    }
    assert bbw_module.validate_schema(wf) == []
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -v`
Expected: `test_schema_accepts_role_only_io_ref` et `test_schema_rejects_io_ref_without_path_or_role` ÉCHOUENT (schema exige `path`).

- [ ] **Step 3 : Modifier le schema**

Dans `claude-setup/workflow/workflow.schema.json`, remplacer la définition `io_ref` (lignes 97-107) par :

```json
    "io_ref": {
      "type": "object",
      "required": ["kind"],
      "anyOf": [
        { "required": ["path"] },
        { "required": ["role"] }
      ],
      "properties": {
        "path": { "type": "string" },
        "role": { "type": "string", "description": "Nom logique de la donnée, optionnellement préfixé d'un namespace (ns:nom). Le chemin est dérivé de namespaces[ns] sauf si path est fourni (override)." },
        "namespace": { "type": "string", "description": "Namespace explicite si role ne contient pas de préfixe ns:. Ignoré si role contient ':' ou si path est fourni." },
        "kind": { "enum": ["json", "jsonl", "md", "text", "yaml", "dir", "sqlite", "binary"] },
        "optional": { "type": "boolean", "default": false },
        "external": { "type": "boolean", "default": false, "description": "Input produced outside the agent DAG by an external tool; suppresses the no-producer warning." },
        "terminal": { "type": "boolean", "default": false, "description": "Final artifact read by the hunter or report phase, not consumed by another agent; suppresses the no-consumer warning." }
      }
    },
```

Puis ajouter la clé top-level `namespaces` dans le bloc `properties` racine (après `on_demand_agents`, ligne ~57) :

```json
    "namespaces": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Carte namespace logique -> chemin de base. Un io_ref avec role 'ns:nom' résout en '<namespaces[ns]>/nom.<ext>'."
    }
```

(Ajouter une virgule après le bloc `on_demand_agents` qui précède.)

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -v`
Expected: les 3 tests PASSENT.

- [ ] **Step 5 : Commit**

```bash
git add claude-setup/workflow/workflow.schema.json claude-setup/scripts/tests/test_workflow_io_roles.py
git commit -m "feat(bb-workflow): schema accepte io_ref par role + namespaces (path = override)"
```

---

## Task 2 : `EXT_BY_KIND` + `resolve_io_path` (fonction pure)

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ajouter après `dump_workflow_yaml`, ligne ~181)
- Test: `claude-setup/scripts/tests/test_workflow_io_roles.py`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans `test_workflow_io_roles.py` :

```python
def test_resolve_explicit_path_wins(bbw_module):
    io = {"path": "notes/findings.md", "role": "x:y", "kind": "md"}
    assert bbw_module.resolve_io_path(io, {"x": "work/x"}) == "notes/findings.md"


def test_resolve_namespaced_role(bbw_module):
    io = {"role": "extraction:endpoints", "kind": "json"}
    ns = {"extraction": "work/extraction"}
    assert bbw_module.resolve_io_path(io, ns) == "work/extraction/endpoints.json"


def test_resolve_role_with_separate_namespace_field(bbw_module):
    io = {"role": "params", "namespace": "extraction", "kind": "json"}
    ns = {"extraction": "work/extraction"}
    assert bbw_module.resolve_io_path(io, ns) == "work/extraction/params.json"


def test_resolve_dir_kind_gets_trailing_slash_no_ext(bbw_module):
    io = {"role": "extraction:chunks", "kind": "dir"}
    ns = {"extraction": "work/extraction"}
    assert bbw_module.resolve_io_path(io, ns) == "work/extraction/chunks/"


def test_resolve_strips_trailing_slash_on_base(bbw_module):
    io = {"role": "notes:tests", "kind": "md"}
    assert bbw_module.resolve_io_path(io, {"notes": "notes/"}) == "notes/tests.md"


def test_resolve_unknown_namespace_returns_none(bbw_module):
    io = {"role": "ghost:x", "kind": "json"}
    assert bbw_module.resolve_io_path(io, {"extraction": "work/extraction"}) is None


def test_resolve_no_path_no_role_returns_none(bbw_module):
    assert bbw_module.resolve_io_path({"kind": "json"}, {}) is None
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k resolve -v`
Expected: FAIL — `module 'bbw' has no attribute 'resolve_io_path'`.

- [ ] **Step 3 : Implémenter `EXT_BY_KIND` + `resolve_io_path`**

Dans `claude-setup/scripts/bb-workflow`, juste après `dump_workflow_yaml` (ligne 181) :

```python
EXT_BY_KIND = {
    "json": ".json", "jsonl": ".jsonl", "md": ".md", "text": ".txt",
    "yaml": ".yaml", "sqlite": ".sqlite", "binary": "", "dir": "",
}


def resolve_io_path(io_ref: dict, namespaces: dict) -> str:
    """Concrete path for an io_ref.

    Explicit `path` always wins (override / escape hatch). Otherwise the path is
    derived from `role` + `namespaces`: a role `ns:name` (or `role`+`namespace`)
    resolves to `<namespaces[ns]>/name<ext>`, the extension coming from `kind`.
    `dir` kind yields a trailing-slash directory and no extension. Returns None
    when the path can't be resolved (no path, no role, or unknown namespace) —
    callers validate that case.
    """
    if io_ref.get("path"):
        return io_ref["path"]
    role = io_ref.get("role")
    if not role:
        return None
    if ":" in role:
        ns, name = role.split(":", 1)
    else:
        ns, name = io_ref.get("namespace", ""), role
    base = (namespaces or {}).get(ns)
    if base is None:
        return None
    base = base.rstrip("/")
    kind = io_ref.get("kind", "")
    if kind == "dir":
        return f"{base}/{name}/"
    return f"{base}/{name}{EXT_BY_KIND.get(kind, '')}"
```

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k resolve -v`
Expected: les 7 tests `resolve` PASSENT.

- [ ] **Step 5 : Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_io_roles.py
git commit -m "feat(bb-workflow): resolve_io_path — dérivation role+namespace -> chemin"
```

---

## Task 3 : `resolve_io_paths(model)` — remplit les chemins sur une copie

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (après `resolve_io_path`)
- Test: `claude-setup/scripts/tests/test_workflow_io_roles.py`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans `test_workflow_io_roles.py` :

```python
def test_resolve_io_paths_fills_derived_paths(bbw_module):
    model = {
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "inputs": [{"role": "extraction:sections", "kind": "json"}],
                "outputs": [{"role": "extraction:endpoints", "kind": "json"}],
            }],
        }],
    }
    resolved = bbw_module.resolve_io_paths(model)
    inv = resolved["phases"][0]["invocations"][0]
    assert inv["inputs"][0]["path"] == "work/extraction/sections.json"
    assert inv["outputs"][0]["path"] == "work/extraction/endpoints.json"


def test_resolve_io_paths_does_not_mutate_original(bbw_module):
    model = {
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a",
                             "outputs": [{"role": "extraction:e", "kind": "json"}]}],
        }],
    }
    bbw_module.resolve_io_paths(model)
    # Le modèle d'origine reste en rôle pur (pas de path injecté) -> le YAML sauvé reste propre
    assert "path" not in model["phases"][0]["invocations"][0]["outputs"][0]


def test_resolve_io_paths_handles_phase_level_io(bbw_module):
    model = {
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g", "type": "script",
            "outputs": [{"role": "extraction:chunks", "kind": "dir"}],
        }],
    }
    resolved = bbw_module.resolve_io_paths(model)
    assert resolved["phases"][0]["outputs"][0]["path"] == "work/extraction/chunks/"
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k resolve_io_paths -v`
Expected: FAIL — `no attribute 'resolve_io_paths'`.

- [ ] **Step 3 : Implémenter `resolve_io_paths`**

Dans `claude-setup/scripts/bb-workflow`, juste après `resolve_io_path` :

```python
def resolve_io_paths(model: dict) -> dict:
    """Return a deep copy of the model with every io_ref's `path` filled in from
    its role + the model's `namespaces`. Used by generation / dataflow / rendering
    so downstream code can keep reading io['path']. NEVER call this on the model
    that gets dumped back to YAML — the persisted form must stay role-based."""
    resolved = copy.deepcopy(model)
    namespaces = resolved.get("namespaces", {})

    def fill(io_list):
        for io in io_list or []:
            if not io.get("path"):
                path = resolve_io_path(io, namespaces)
                if path is not None:
                    io["path"] = path

    for phase in resolved.get("phases", []):
        fill(phase.get("inputs"))
        fill(phase.get("outputs"))
        for inv in phase.get("invocations", []) or []:
            fill(inv.get("inputs"))
            fill(inv.get("outputs"))
    return resolved
```

(`copy` est déjà importé — utilisé par `clone_workflow` ligne 266.)

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k resolve_io_paths -v`
Expected: les 3 tests PASSENT.

- [ ] **Step 5 : Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_io_roles.py
git commit -m "feat(bb-workflow): resolve_io_paths — remplit les chemins dérivés sur une copie"
```

---

## Task 4 : Round-trip YAML — `_IO_REF_KEYS` += `role`, `namespace`

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` (ligne 121)
- Test: `claude-setup/scripts/tests/test_workflow_io_roles.py`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter dans `test_workflow_io_roles.py` :

```python
import yaml as _yaml


def test_role_io_ref_roundtrips_without_injected_path(bbw_module):
    model = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a",
                             "outputs": [{"role": "extraction:endpoints", "kind": "json"}]}],
        }],
    }
    dumped = bbw_module.dump_workflow_yaml(model)
    reloaded = _yaml.safe_load(dumped)
    out = reloaded["phases"][0]["invocations"][0]["outputs"][0]
    assert out == {"role": "extraction:endpoints", "kind": "json"}
    assert "path" not in out
    # io_ref avec role est bien rendu en flow (sur une ligne)
    assert "{role: extraction:endpoints, kind: json}" in dumped
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k roundtrip -v`
Expected: FAIL — l'io_ref `{role, kind}` n'est pas reconnu comme io_ref (clé `role` absente de `_IO_REF_KEYS`) donc pas rendu en flow → l'assert `in dumped` échoue.

- [ ] **Step 3 : Étendre `_IO_REF_KEYS`**

Dans `claude-setup/scripts/bb-workflow` ligne 121, remplacer :

```python
_IO_REF_KEYS = {"path", "kind", "optional", "external", "terminal"}
```

par :

```python
_IO_REF_KEYS = {"path", "role", "namespace", "kind", "optional", "external", "terminal"}
```

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k roundtrip -v`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_io_roles.py
git commit -m "feat(bb-workflow): round-trip YAML des io_ref par role (flow style)"
```

---

## Task 5 : Validation de cohérence des io_ref (role/namespace)

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` — `validate_coherence` (ligne 416)
- Test: `claude-setup/scripts/tests/test_workflow_io_roles.py`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans `test_workflow_io_roles.py` :

```python
def _wf_with_io(io, namespaces=None):
    return {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": namespaces or {},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a", "outputs": [io]}],
        }],
    }


def test_coherence_flags_unknown_namespace(bbw_module, tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\n---\nbody\n")
    wf = _wf_with_io({"role": "ghost:x", "kind": "json"},
                     namespaces={"extraction": "work/extraction"})
    errs = bbw_module.validate_coherence(wf, agents_dir=tmp_path)
    assert any("ghost" in e and "namespace" in e for e in errs)


def test_coherence_ok_for_known_namespace(bbw_module, tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\n---\nbody\n")
    wf = _wf_with_io({"role": "extraction:x", "kind": "json"},
                     namespaces={"extraction": "work/extraction"})
    assert bbw_module.validate_coherence(wf, agents_dir=tmp_path) == []


def test_coherence_ok_for_explicit_path(bbw_module, tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\n---\nbody\n")
    wf = _wf_with_io({"path": "anywhere.md", "kind": "md"})
    assert bbw_module.validate_coherence(wf, agents_dir=tmp_path) == []
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k coherence -v`
Expected: `test_coherence_flags_unknown_namespace` ÉCHOUE (aucune erreur levée).

- [ ] **Step 3 : Ajouter le bloc de validation**

Dans `validate_coherence`, juste avant le `return errors` final, insérer :

```python
    # io_ref par rôle : le namespace référencé doit être déclaré.
    namespaces = workflow.get("namespaces", {})

    def _check_io(io, where):
        if io.get("path"):
            return
        role = io.get("role")
        if not role:
            errors.append(f"{where}: io_ref sans path ni role")
            return
        ns = role.split(":", 1)[0] if ":" in role else io.get("namespace", "")
        if ns not in namespaces:
            errors.append(
                f"{where}: namespace '{ns}' (role '{role}') non déclaré dans namespaces"
            )

    for phase in workflow.get("phases", []):
        pid = phase.get("id", "?")
        for io in (phase.get("inputs") or []) + (phase.get("outputs") or []):
            _check_io(io, f"phase {pid}")
        for inv in phase.get("invocations", []) or []:
            ag = inv.get("agent", "?")
            for io in (inv.get("inputs") or []) + (inv.get("outputs") or []):
                _check_io(io, f"phase {pid}/{ag}")
```

> Vérifier que `return errors` est bien la dernière instruction de la fonction et que ce bloc est inséré avant.

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k coherence -v`
Expected: les 3 tests PASSENT.

- [ ] **Step 5 : Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_io_roles.py
git commit -m "feat(bb-workflow): validate_coherence vérifie les namespaces des io_ref par role"
```

---

## Task 6 : Brancher la résolution dans generate + dataflow

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` — `generate_skill_md` (ligne 737, après `yaml.safe_load`) et `check_dataflow_warnings` (résoudre avant analyse)
- Test: `claude-setup/scripts/tests/test_workflow_io_roles.py` + `test_workflow_dataflow_markers.py`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans `test_workflow_dataflow_markers.py` :

```python
def test_dataflow_warnings_work_on_derived_paths(bbw_module):
    wf = {
        "schema_version": 1,
        "namespaces": {"work": "work"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a",
                             "outputs": [{"role": "work:foo", "kind": "json"}]}],
        }],
    }
    w = bbw_module.check_dataflow_warnings(wf)
    assert any("work/foo.json" in x and "no consumer" in x for x in w)
```

Ajouter dans `test_workflow_io_roles.py` :

```python
def test_generate_resolves_role_paths_in_skill(bbw_module, tmp_path):
    # Workflow minimal avec un agent réel scaffolé + un rôle dérivé
    agents = tmp_path / "agents"
    invs = tmp_path / "inv"
    agents.mkdir(); invs.mkdir()
    bbw_module.create_agent("a", "desc", "Read", "inherit", "fais x",
                            agents_dir=agents, invocations_dir=invs)
    wf_path = tmp_path / "w.yaml"
    wf_path.write_text(bbw_module.dump_workflow_yaml({
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a", "model": "haiku",
                             "outputs": [{"role": "extraction:endpoints", "kind": "json"}]}],
        }],
    }))
    out = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(wf_path, out, templates_dir=tmp_path,
                                 agents_dir=agents)
    text = out.read_text()
    assert "work/extraction/endpoints.json" in text
```

> Le test ci-dessus suppose que `generate_skill_md(templates_dir=...)` lit `invocations/` sous `templates_dir`. Adapter : créer `invs` comme `tmp_path/"invocations"` si la fonction attend ce sous-dossier (voir ligne 741 `invocations_dir = templates_dir / "invocations"`). Donc remplacer `invs = tmp_path / "inv"` par `invs = tmp_path / "invocations"`.

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_dataflow_markers.py::test_dataflow_warnings_work_on_derived_paths claude-setup/scripts/tests/test_workflow_io_roles.py::test_generate_resolves_role_paths_in_skill -v`
Expected: FAIL — `check_dataflow_warnings` lève `KeyError: 'path'` (ou ne voit pas le chemin), et le SKILL ne contient pas le chemin dérivé.

- [ ] **Step 3 : Brancher `resolve_io_paths`**

Dans `generate_skill_md` (ligne 737), juste après `workflow = yaml.safe_load(f)` (ligne 744) et **après** les deux blocs `validate_schema` / `validate_coherence` (qui doivent valider la forme rôle, donc les laisser AVANT la résolution), ajouter la résolution avant le rendu des invocations :

```python
    # Résout les chemins dérivés (role+namespace) pour le rendu — sur une copie,
    # le YAML source reste en rôles.
    workflow = resolve_io_paths(workflow)
```

Insérer cette ligne juste avant la boucle `for phase in workflow.get("phases", []):` qui rend les invocations (ligne ~757).

Dans `check_dataflow_warnings`, résoudre en tête de fonction. Localiser la définition (`grep -n "def check_dataflow_warnings" claude-setup/scripts/bb-workflow`) et ajouter comme première instruction :

```python
    workflow = resolve_io_paths(workflow)
```

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_dataflow_markers.py claude-setup/scripts/tests/test_workflow_io_roles.py -v`
Expected: tous PASSENT (y compris les tests dataflow existants, inchangés).

- [ ] **Step 5 : Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_io_roles.py claude-setup/scripts/tests/test_workflow_dataflow_markers.py
git commit -m "feat(bb-workflow): generate et dataflow résolvent les chemins dérivés"
```

---

## Task 7 : `_format_io_compact` enrichi (rôle + kind + légende)

**Files:**
- Modify: `claude-setup/scripts/bb-workflow` — `_format_io_compact` (ligne 701)
- Test: `claude-setup/scripts/tests/test_workflow_io_roles.py`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter dans `test_workflow_io_roles.py` :

```python
def test_compact_shows_role_kind_and_path(bbw_module):
    inputs = [{"role": "extraction:sections", "kind": "json",
               "path": "work/extraction/sections.json"}]
    outputs = [{"role": "extraction:endpoints", "kind": "json",
                "path": "work/extraction/endpoints.json"}]
    s = bbw_module._format_io_compact(inputs, outputs)
    assert "`extraction:sections`" in s          # rôle (back-tické pour le check Lot 3)
    assert "(json)" in s                          # kind rendu
    assert "work/extraction/sections.json" in s   # chemin résolu visible
    assert "Reads" in s and "Writes" in s


def test_compact_marks_optional_and_legend(bbw_module):
    inputs = [{"role": "x:y", "kind": "json", "path": "work/x/y.json",
               "optional": True}]
    s = bbw_module._format_io_compact(inputs, [])
    assert "optionnel" in s.lower()


def test_compact_falls_back_to_path_basename_without_role(bbw_module):
    s = bbw_module._format_io_compact([{"path": "scope.md", "kind": "md"}], [])
    assert "scope.md" in s
```

- [ ] **Step 2 : Lancer les tests pour vérifier l'échec**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k compact -v`
Expected: FAIL — la sortie actuelle ne contient ni le rôle, ni `(json)`, ni « optionnel ».

- [ ] **Step 3 : Réécrire `_format_io_compact`**

Remplacer la fonction `_format_io_compact` (lignes 701-710) par :

```python
def _format_io_compact(inputs: list, outputs: list) -> str:
    """Format inputs/outputs as compact Reads/Writes lines.

    Each item: `role-or-name` (kind[, optionnel]) → chemin résolu. The role is
    back-ticked so the Lot 3 role<->prose check can detect it. A legend line is
    appended when at least one item is optional."""
    has_optional = any(i.get("optional") for i in (inputs or []) + (outputs or []))

    def _item(io):
        label = io.get("role") or (io.get("path", "").rstrip("/").split("/")[-1])
        flags = io.get("kind", "")
        if io.get("optional"):
            flags += ", optionnel"
        suffix = f" → {io['path']}" if io.get("path") else ""
        return f"`{label}` ({flags}){suffix}"

    parts = []
    if inputs:
        parts.append("- Reads : " + ", ".join(_item(i) for i in inputs))
    if outputs:
        parts.append("- Writes : " + ", ".join(_item(o) for o in outputs))
    if has_optional:
        parts.append("- _(optionnel = peut être absent)_")
    return "\n".join(parts) if parts else "_(no I/O)_"
```

- [ ] **Step 4 : Lancer les tests pour vérifier le succès**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py -k compact -v`
Expected: les 3 tests PASSENT.

- [ ] **Step 5 : Commit**

```bash
git add claude-setup/scripts/bb-workflow claude-setup/scripts/tests/test_workflow_io_roles.py
git commit -m "feat(bb-workflow): _format_io_compact rend role+kind+chemin+legende"
```

---

## Task 8 : Garde-fou non-régression + docs

**Files:**
- Test: `claude-setup/scripts/tests/test_workflow_io_roles.py`
- Modify: `docs/dev/bb-workflow.md`, `docs/superpowers/specs/2026-06-02-bb-workflow-io-model.md`

- [ ] **Step 1 : Écrire le test de non-régression**

Ajouter dans `test_workflow_io_roles.py` :

```python
import pathlib


def test_existing_workflows_still_validate_and_generate(bbw_module):
    repo = pathlib.Path(__file__).resolve().parents[3]
    wf_dir = repo / "claude-setup" / "workflows"
    for wf_path in sorted(wf_dir.glob("*.yaml")):
        if wf_path.stem == "test":   # fichier scratch du hunter, ignoré
            continue
        import yaml
        model = yaml.safe_load(wf_path.read_text())
        assert bbw_module.validate_schema(model) == [], f"{wf_path.name} schema"
        # resolve_io_paths ne doit jamais lever sur les workflows existants
        bbw_module.resolve_io_paths(model)
```

- [ ] **Step 2 : Lancer le test**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/test_workflow_io_roles.py::test_existing_workflows_still_validate_and_generate -v`
Expected: PASS (les workflows actuels utilisent `path` explicite → toujours valides, et `resolve_io_paths` les laisse intacts).

- [ ] **Step 3 : Lancer TOUTE la suite workflow (non-régression globale)**

Run: `/home/marc-antoine/python3-venv/bin/python -m pytest claude-setup/scripts/tests/ -k workflow -v`
Expected: tout PASSE. Si `test_real_skill_has_no_drift[test]` échoue, c'est le fichier scratch `test.yaml` connu (cf. mémoire projet) — l'ignorer.

- [ ] **Step 4 : Régénérer les artefacts et vérifier l'absence de drift**

Run:
```bash
cd /path/to/your/project
python3 claude-setup/scripts/bb-workflow generate
git diff --stat claude-setup/skills/ docs/architecture-cartography/
```
Expected: **aucun** changement (les workflows existants n'utilisent pas encore de rôles → sortie identique). Si diff non vide, investiguer avant de continuer.

- [ ] **Step 5 : Documenter**

Dans `docs/dev/bb-workflow.md`, section « Modèle I/O », remplacer le paragraphe « Cible (en cours de design…) » concernant le binding rôle→chemin par une sous-section livrée :

```markdown
### I/O par rôle + namespaces (livré — Lot 1)

Un `io_ref` peut déclarer un `role` au lieu d'un `path`. Le chemin est dérivé d'une
carte `namespaces` (top-level) : `role: extraction:endpoints` + `namespaces: {extraction: work/extraction}`
→ `work/extraction/endpoints.json` (extension par `kind`, `dir` → dossier). Un `path`
explicite reste possible et l'emporte (override / fichiers hors-convention comme `scope.md`).
La résolution est faite à `generate` (les chemins concrets atterrissent dans le SKILL,
le dataflow et la validation) ; le YAML reste en rôles. Validation : un namespace
référencé non déclaré est une erreur bloquante.
```

Dans `docs/superpowers/specs/2026-06-02-bb-workflow-io-model.md`, ajouter en fin de section « Conséquences pour le dev » : `- [x] Lot 1 livré : role + namespaces + dérivation + _format_io_compact enrichi.`

- [ ] **Step 6 : Commit**

```bash
git add claude-setup/scripts/tests/test_workflow_io_roles.py docs/dev/bb-workflow.md docs/superpowers/specs/2026-06-02-bb-workflow-io-model.md
git commit -m "test(bb-workflow): non-régression workflows existants + doc Lot 1 I/O par role"
```

---

## Self-Review (vérifié à la rédaction)

- **Couverture spec :** schema role/namespace/namespaces (T1) ✓ ; dérivation path (T2) ✓ ; copie non-mutante pour round-trip (T3) ✓ ; round-trip YAML (T4) ✓ ; validation namespace inconnu / ni path ni role (T5) ✓ ; branchement generate+dataflow (T6) ✓ ; rendu compact enrichi kind+rôle+légende (T7) ✓ ; non-régression + docs (T8) ✓.
- **Cohérence des noms :** `resolve_io_path` / `resolve_io_paths` / `EXT_BY_KIND` / `_IO_REF_KEYS` / `_format_io_compact` employés identiquement partout.
- **Pas de placeholder :** chaque step de code montre le code complet.
- **Décisions reportées (hors Lot 1, volontaire) :** la rubrique contrat dans `agents/*.md`, le relais verbatim, le check rôle↔prose et `bb-workflow init` sont des lots distincts (cf. en-tête « Hors scope »).
