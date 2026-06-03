# `bb-workflow edit` — éditeur web local de workflow

**Date :** 2026-05-28
**Statut :** design validé, prêt pour plan d'implémentation

## Objectif

Éditer les workflows (`claude-setup/workflows/*.yaml`) via une interface web
locale, avec un design proche du HTML standalone de la cartography. Couvrir un
maximum de cas d'usage du YAML de façon utilisable (le polish UI n'est pas
prioritaire). Permettre de **créer un workflow from scratch ou par duplication**,
et d'**éditer** les existants.

Hors scope (pour l'instant) : pont « demander à Claude depuis la GUI ». Le
hunter rédige des agents moyens puis les fait améliorer par Claude depuis son PC.

## Modèle d'interaction (validé)

- **Grille** : lignes = enchaînement (niveaux de dépendance), colonnes dans une
  ligne = parallélisme.
- **Pas d'édition d'arêtes au drag.** Les dépendances se créent via cases à
  cocher dans le panneau d'édition d'une phase.
- Boutons : `+ ligne` (nouveau niveau), `+ phase ∥` (phase parallèle sur la
  ligne). **Drag & drop** des cartes phase entre lignes.
- **Sémantique du drag (Option 1)** : déposer une carte sur une ligne met
  `depends_on` = toutes les phases de la ligne précédente (défaut), affinable au
  formulaire. La position de ligne est **recalculée** depuis `depends_on`
  (topo-level, plus long chemin depuis les racines). **`depends_on` est la seule
  source de vérité** ; le numéro de ligne n'est jamais persisté.

## Architecture

### CLI
Nouvelle sous-commande dans le `bb-workflow` existant :
```
bb-workflow edit [--workflow NAME] [--port 0] [--no-browser]
```
Lance un serveur `http.server` (stdlib, aucune nouvelle dépendance), ouvre le
navigateur. Réutilise `_find_repo_root()`.

### Backend — API REST (stdlib `http.server`, liée à `127.0.0.1`)

| Route | Rôle |
|-------|------|
| `GET /` | sert l'éditeur HTML (libs inlinées comme `html-wrapper.html`) |
| `GET /api/workflows` | liste des `.yaml` sous `claude-setup/workflows/` |
| `GET /api/workflow/<name>` | modèle JSON + niveaux calculés |
| `POST /api/workflow` | crée un workflow (vierge ou cloné depuis `?from=<name>`) |
| `PUT /api/workflow/<name>` | **valide** (schema + cohérence) PUIS écrit le YAML ; refuse si invalide |
| `POST /api/preview` | rend le Mermaid live depuis le modèle non-sauvé (templates jinja existants) |
| `GET /api/agents` | agents dispo dans `claude-setup/agents/` |
| `GET /PUT /api/invocation/<agent>` | lit/écrit `templates/invocations/<agent>.md` |
| `POST /api/agent` | crée `claude-setup/agents/<name>.md` (frontmatter + prompt) **+** template d'invocation |

Validation : réutilise `cmd_validate` + le check de cohérence existants. **Rien
n'est écrit si la validation échoue** → le YAML reste toujours valide.

### Front-end — un HTML unique, vanilla JS

- Réutilise le CSS/thème de `html-wrapper.html`. Pas de build step.
- **Grille** avec drag & drop HTML5 (Option 1 ci-dessus).
- **Panneau d'édition de phase** : `name`, `type`
  (`agent`/`script`/`external`/`main_agent`/`workflow_call`), `group`,
  `depends_on` (cases à cocher), `invocations` (agent + model + description +
  bouton « éditer le prompt »), `inputs`/`outputs` (path + kind +
  external/terminal/optional), `triggers`, `cmd` (si script), `workflow` (si
  workflow_call).
- **Sélecteur de workflow** avec actions : nouveau (vierge) / dupliquer / éditer.
- **3 onglets** : Grille · Dataflow agents↔fichiers (réutilise
  `dataflow.mermaid.jinja`) · YAML preview read-only (via `/api/preview`).
- Sous-panneaux pour les sections moins fréquentes : `groups`, `conditions`,
  `brainstormings`, `manual_sections`, `on_demand_agents`.

### Création / ajout (scope validé)
- **Ajout d'agent** : la GUI scaffolde `claude-setup/agents/<name>.md`
  (frontmatter name/description/tools/model + prompt rédigé par le hunter) **et**
  le template d'invocation. Raffinement ultérieur via Claude.
- **Phase script** : la GUI saisit `cmd` + inputs/outputs uniquement. Le fichier
  script lui-même n'est pas créé par la GUI.

## Sérialisation YAML

**Dumper PyYAML custom** (déjà installé, zéro dépendance). Les YAML actuels
n'ont aucun commentaire `#` à préserver. Le dumper reproduit le style écrit à la
main :
- `sort_keys=False` (ordre des clés préservé),
- block scalars pour les longues `description`,
- flow-style `{ path:…, kind:… }` pour les io_refs,
- sortie **idempotente** (re-dump d'un fichier inchangé = no-op de diff).

`ruamel.yaml` écarté : sans commentaires à préserver, n'apporte pas assez pour
justifier une nouvelle dépendance.

## Round-trip & sécurité

- Modèle : YAML → JSON (front) → édition → JSON → YAML (PUT). Le niveau de ligne
  est toujours recalculé, jamais stocké.
- Serveur lié à `127.0.0.1` uniquement.
- Écritures confinées sous `claude-setup/` ; garde-fou anti path-traversal sur
  les segments `<name>` / `<agent>` (slug `^[a-z][a-z0-9-]*$`, déjà imposé par le
  schema pour `skill.name`).

## Tests

- Idempotence du round-trip YAML (load → dump → load == identique).
- Calcul des niveaux topologiques depuis `depends_on` (cas parallèles,
  dépendances granulaires, racines multiples).
- Refus d'écriture sur modèle invalide (schema + cohérence).
- Création workflow vierge / cloné produit un YAML valide.
- La suite `tests/` existante (schema, cohérence, drift) reste verte.

## Découpage des unités

- `webedit/server.py` — handler `http.server` + routing API (un fichier focalisé).
- `webedit/model.py` — YAML ↔ modèle JSON, calcul des niveaux, dumper custom.
- `webedit/static/editor.html` (+ JS/CSS inlinés à la génération) — front-end.
- Réutilisation : `cmd_validate`, check de cohérence, templates jinja
  (`dataflow.mermaid.jinja`, `cartography.mermaid.jinja`).
