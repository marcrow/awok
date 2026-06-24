# bb-workflow — Générateur multi-workflows depuis YAML

`bb-workflow` est un CLI qui transforme **N workflows nommés** sous
`src/workflows/` (sources de vérité) en, pour chacun :
- `src/skills/<name>/SKILL.md` (orchestrateur Claude Code, callable via `/<name>`)
- `docs/architecture-cartography/<name>.html` (4 onglets : Details + Workflow + Dataflow + On-demand)
- `docs/architecture-cartography/<name>-texte.md` (ASCII)

Plus, en transverse :
- `docs/architecture-cartography/index.html` (index visuel de tous les workflows)

**Source de vérité = YAML.** Ne pas éditer les `SKILL.md` à la main : la prochaine
régénération les écrase. Le pre-commit hook bloque les commits si drift détecté.

> **Vocabulaire & exécution.** Ce document couvre la **compilation**. Pour la
> **sémantique d'exécution** (awok n'a pas de runtime ; **action** = bloc unitaire,
> **stage** = ligne/niveau dérivé de `depends_on`, **group** = bande transverse ;
> chaînage par fichiers ; motif fan-out → reduce), voir
> [`execution-model.md`](execution-model.md). Note : le YAML dit encore `phases:` —
> lis « phase » comme « action ».

## Commandes

Sans `--workflow` → la commande s'applique à **tous** les workflows découverts.
Avec `--workflow NAME|PATH` → ciblé sur un seul.

| Commande | Effet |
|---|---|
| `awok validate` | Valide tous les workflows (schema + cohérence + warnings dataflow) |
| `awok validate --workflow demo` | Valide un seul workflow |
| `awok generate` | Régénère tous les artefacts + l'index |
| `awok generate --workflow demo` | Régénère un seul (+ index toujours) |
| `awok check` | Drift check sur tous |
| `awok new-phase --workflow <name>` | Wizard sub-agent pour ajout de phase |
| `awok assist "<change>" --workflow <name>` | Prompt sub-agent pour modifs complexes |
| `awok rename-agent <old> <new>` | Renomme un agent dans **tous** les workflows |
| `awok edit [--port N] [--no-browser]` | Lance l'éditeur web local (voir section dédiée) |

## Anatomie d'un workflow YAML

```yaml
schema_version: 1

skill:                              # OBLIGATOIRE — métadonnées du skill généré
  name: demo                        # → /demo callable, kebab-case
  description: |                    # affiché dans frontmatter SKILL.md ET onglet Details
    Une à trois lignes : quoi + quand l'utiliser.
  title: "/demo — H1 du SKILL"      # optionnel

groups:                             # déclaration des couleurs par groupe
  collect:
    description: "..."
    risk: none

phases:                             # le DAG
  - id: D0-COLLECT
    name: Collecte des sources
    group: collect
    type: main_agent                # agent | script | external | main_agent | workflow_call
    description: "..."

  - id: D1-PROCESS
    name: Traitement
    group: collect
    depends_on: [D0-COLLECT]
    invocations:
      - agent: mon-agent            # doit exister dans src/agents/
        model: sonnet
        effort: high                # optionnel — effort de raisonnement ; omis → hérité du main agent
        description: "..."
        inputs:  [{ path: work/demo/raw.json, kind: json, external: true }]
        outputs: [{ path: work/demo/output.md, kind: md, terminal: true }]

  - id: D4-HANDOFF
    name: Bascule vers un autre workflow
    group: collect
    type: workflow_call             # ← chaînage vers un autre workflow
    workflow: autre-workflow        # nom (≠ self), validé par cohérence

on_demand_agents:                   # callables hors-DAG, listés dans l'onglet On-demand
  - agent: mon-agent-ondemand
    description: "..."
    model: haiku
    triggered_by: ["manual"]
    when: "..."
```

### `model:` par invocation — rendu en impératif, jamais hérité

Le `model:` d'une invocation vit dans le YAML (source de vérité) et est rendu dans le
`SKILL.md` comme une **instruction impérative** (« lance via le `Task` tool avec
`model: <model>` »), pas comme une simple étiquette `[model]`. Conséquence : en run
headless (`claude -p --model X`), chaque sous-agent tourne sur le modèle épinglé au lieu
d'hériter du modèle de session. Renforcement *discrétionnaire* (pas une garantie dure) —
les échappatoires déterministes restent `CLAUDE_CODE_SUBAGENT_MODEL` et le pinning
frontmatter (au prix de casser la convention `model: inherit`).

### `effort:` par invocation — matérialisé au frontmatter au `deploy`

À côté de `model:`, une invocation peut épingler un **`effort`** de raisonnement
(`low | medium | high | xhigh | max`, les niveaux d'effort Claude). Il vit dans le YAML ;
le frontmatter de l'agent **source** reste propre (`model: inherit`, pas d'effort).
**Absent (ou `inherit`)** → le sous-agent tourne à l'effort du main agent (le défaut, sans
problème).

**Mécanisme runtime — différent de `model`.** Le `Task` tool n'a **pas** d'argument
`effort` ; on ne peut donc pas le passer au lancement comme `model`. À la place,
`awok deploy` **inscrit** l'effort épinglé dans le frontmatter de l'agent *déployé*
(`~/.claude/agents/<nom>.md` → `effort: <niveau>`), qui surcharge l'effort de session — le
sous-agent l'applique seul. La ligne ⚙️ du SKILL ne fait que le rappeler. Le deploy
re-dérive du source propre à chaque fois : retirer l'épingle puis re-déployer efface la
clé. Deux garde-fous (warn + rien injecté) :
- **Conflit** — un même agent invoqué avec deux efforts différents ne tient pas dans un
  frontmatter unique.
- **Gating modèle** — l'effort erreure sur le tier `haiku` (et tout modèle qui ne le
  supporte pas).

Modifiable par invocation dans l'éditeur web (liste déroulante à côté du modèle) et sur les
agents on-demand — le YAML/UI reste la source de vérité ; seul `deploy` écrit le frontmatter.

### Patch du moteur ou d'un template — ça touche TOUS les workflows

`bb-workflow` et les templates Jinja (`src/workflow/templates/*.jinja`) sont
**partagés** : les modifier re-rend **tous** les `SKILL.md`, pas un seul. Après un tel
patch : `awok generate` (sans `--workflow` → tout + index), committer les artefacts
régénérés dans le même commit, puis `./install.sh` pour redéployer (le runtime lit
`~/.claude/skills/<wf>/SKILL.md`). `awok check` passe au rouge sur tout workflow encore
généré par l'ancien moteur — c'est ta liste de tâches. Les **workdirs privés** ne se
mettent pas à jour seuls : `awok --workdir DIR generate && awok deploy --workdir DIR`.
Convention complète + discipline de commit (`Regen:`) : voir `CLAUDE.md`.

## Workflow type — ajouter une phase

```bash
# 1. Éditer le YAML du workflow cible
vim src/workflows/demo.yaml

# 2. Valider (le workflow ciblé seulement)
awok validate --workflow demo

# 3. (Si nouveau agent) — créer le snippet PARTAGÉ
cp src/workflow/templates/invocations/_template.md \
   src/workflow/templates/invocations/mon-agent.md
vim src/workflow/templates/invocations/mon-agent.md

# 4. Régénérer (le workflow ciblé + l'index)
awok generate --workflow demo

# 5. Inspecter le diff
git diff src/skills/demo/SKILL.md docs/architecture-cartography/

# 6. Commit
git add src/workflows/demo.yaml src/skills/demo/SKILL.md
git commit -m "feat(demo): add D2 phase"
```

## Workflow type — créer un nouveau workflow

```bash
# 1. Créer le YAML (au minimum : skill + groups + phases)
cat > src/workflows/mon-workflow.yaml << 'EOF'
schema_version: 1
skill:
  name: mon-workflow
  description: |
    Quand l'utiliser : ...
  title: "/mon-workflow — ..."
groups:
  default: { description: "..." }
phases:
  - id: M0
    name: ...
    group: default
    type: main_agent
EOF

# 2. Valider + générer
bb-workflow validate
bb-workflow generate

# 3. Déployer le skill
./install.sh

# 4. Le skill /mon-workflow est maintenant invocable
```

## Workflow type — modification complexe assistée

```bash
awok assist "Ajouter une phase D3-NOTIFY déclenchée après D2-PROCESS \
qui envoie une notification quand le traitement est prêt" --workflow demo
# → suit les instructions imprimées (run sub-agent via Claude Code)
```

## Chaînage : `type: workflow_call`

Une phase peut **dispatcher un autre workflow** comme un skill. Pas d'inlining
(les phases du sous-workflow ne fusionnent pas) — c'est un call-out qui dit à
Claude de lancer `/<autre-workflow>` via le Skill tool, puis de revenir.

**Garanties cohérence** :
- Champ `workflow:` obligatoire (sinon erreur de coherence)
- Cible doit exister (`src/workflows/<target>.yaml`)
- Auto-call interdit (loop)

**Rendu** :
- SKILL.md → bloc "🔗 Cette phase dispatche `/<target>`"
- Cartography mermaid → node violet pour distinguer du flux principal

## Autonomie opportuniste : `opportunistic`

Donne à l'**orchestrateur** (le main agent) une licence cadrée pour **fabriquer
et lancer un subagent ad hoc** (via le `Task` tool, `general-purpose`/`Explore`,
avec un prompt rédigé à la volée) quand il repère un signal que les agents
planifiés ne couvrent pas — p.ex. sur `O2-DEPS` d'`onboard`, repérer une dep
ancienne et lancer une recherche de CVE ; en pentest, détecter un CMS et lancer
une recon spécialisée.

awok n'a pas de runtime : c'est une **instruction injectée dans le SKILL.md**,
scopée à la phase. Le pouvoir de spawn appartient au main agent seul — un
subagent ne peut pas lui-même spawner (limite de nesting Claude Code = 1), donc
la licence s'exerce à la couture d'orchestration, après le retour du subagent
planifié.

`opportunistic` vaut `bool | objet`, à deux niveaux :

```yaml
# top-level (défaut du workflow)
opportunistic:
  enabled: true
  when: |
    Quand tu repères un signal que les agents planifiés ne traitent pas.
  examples:
    - "techno/CMS détecté → recon spécialisée"

phases:
  - id: O2-DEPS
    opportunistic:                 # override : guidage ciblé → 🧭
      when: "Une dépendance paraît ancienne/abandonnée."
      examples: ["dep ancienne → subagent qui cherche les CVE"]
  - id: O4-ARCHITECTURE
    opportunistic: false           # verrou (reduce déterministe) → ⛔
```

Résolution : `false` verrouille ; `true`/objet active ; absent hérite du défaut
global. `false` est le seul moyen de désactiver.

| `phase.opportunistic` | global | phase active ? | rendu |
|---|---|---|---|
| `false` | (peu importe) | non (verrou) | `⛔ Pas d'autonomie opportuniste ici` |
| `true` / objet | (peu importe) | oui | note 🧭 (full si global off, short si global on + guidage) |
| absent | activé | oui (hérité) | couvert par la section globale |
| absent | off | non | — |

**Rendu** :
- SKILL.md → section globale "🧭 Opportunistic autonomy" (si défaut global activé)
  + notes par phase (🧭 piste / ⛔ verrou)
- Cartography (mermaid + texte) → 🧭 sur les phases à contenu propre, ⛔ sur les verrous

**Warnings de cohérence** : `opportunistic` sur une phase `workflow_call` (sans
effet) ; `opportunistic: false` alors que le défaut global est off (redondant) ;
objet global désactivé sans aucune phase qui l'active (config morte).

**vs `on_demand_agents`** : ceux-ci sont hors-DAG, déclenchés par `when:`/
`triggered_by:` (hooks, skills) ; `opportunistic` est dans le DAG, rattaché à une
phase, et les agents sont fabriqués à la volée (pas pré-écrits dans `src/agents/`).

## Modèle I/O — comment les fichiers arrivent aux agents

> Modèle complet (qui sait quoi / produit quoi / vérifie quoi) + schéma :
> `docs/superpowers/specs/2026-06-02-bb-workflow-io-model.md`.

**Le YAML est la source de vérité des I/O.** Les `inputs`/`outputs` déclarés dans
une invocation servent **trois** mécanismes, pas un seul :
1. **Relais à l'agent** — l'orchestrateur les transmet au sous-agent au dispatch.
2. **Visualisation** — l'onglet Dataflow / la cartographie sont dessinés depuis eux.
3. **Validation** — détection d'orphelins (voir section suivante).

Point clé à comprendre : **un sous-agent ne voit ni le SKILL.md ni le YAML.** Il
reçoit seulement (a) son `agents/<name>.md` comme system prompt, et (b) le prompt
de tâche que l'orchestrateur lui écrit. Les chemins de fichiers n'arrivent que
par (b). C'est pour ça que les I/O déclarés doivent remonter dans le prompt.

État **actuel** du rendu (`generate`) :
- Les I/O d'une invocation sont rendus en lignes compactes `- Reads :` / `- Writes :`
  (helper `_format_io_compact`) **dans le bloc d'invocation du SKILL.md**, pas dans
  le `.md` de l'agent.
- L'agent `.md` ne contient pas ses chemins : un même agent peut être référencé
  par plusieurs workflows (ex. `report-triage` est dans 3 workflows). Son
  comportement est dans le body ; ses chemins viennent de la phase.
- Le relais est une **convention implicite** : l'orchestrateur (Claude) est *fait
  confiance* pour recopier le bloc dans le prompt du Task tool — rien ne le force.

### I/O par rôle + namespaces (livré — Lot 1)

Un `io_ref` peut déclarer un `role` au lieu d'un `path`. Le chemin est dérivé d'une
carte `namespaces` (top-level) : `role: extraction:endpoints` + `namespaces: {extraction: work/extraction}`
→ `work/extraction/endpoints.json` (extension par `kind`, `dir` → dossier). Un `path`
explicite reste possible et l'emporte (override / fichiers hors-convention comme `scope.md`).
La résolution est faite à `generate` (les chemins concrets atterrissent dans le SKILL,
le dataflow et la validation) ; le YAML reste en rôles. Validation : un namespace
référencé non déclaré est une erreur bloquante.

## Dataflow — inputs/outputs et warnings

`awok validate` vérifie la cohérence du graphe de données et émet des
**warnings non-bloquants** :
- *input has no producer* : un input `work/…` qu'aucune phase ne produit
- *output has no consumer* : un output `work/…` qu'aucune phase ne lit

Le matching est **dir↔fichier** : un input répertoire `work/x/` est satisfait par
un output `work/x/a.json` (et inversement), et les I/O de **niveau phase** comptent
comme producteurs/consommateurs (ex. un script de prep qui déclare ses artefacts
en `outputs:` de phase).

Pour les orphelins **légitimes**, deux marqueurs explicites sur l'item I/O
suppriment le warning (et documentent l'intention) :

| Marqueur | Côté | Sens |
|---|---|---|
| `external: true` | input | Produit hors du DAG d'agents (source externe) |
| `terminal: true` | output | Artefact final consommé en dehors du pipeline, pas par un autre agent |

```yaml
outputs:
  - path: work/demo/output.md
    kind: md
    terminal: true        # lu par l'utilisateur final, pas par un sous-agent
```

> Ne marque un orphelin que s'il est *vraiment* external/terminal. Un warning sur
> un I/O censé être chaîné = arête manquante à câbler, pas à masquer.

Les garde-fous pytest (`test_workflow_realfile.py`) vérifient que chaque
`workflows/*.yaml` passe schema + cohérence et que les SKILL.md commités n'ont
pas de drift. Les warnings dataflow restent **advisory** (non testés en dur).

## Cartography HTML — UI

Chaque page workflow expose :
- **Topbar** (au-dessus) : sélecteur listant tous les workflows + lien Index
- **Onglets** : Details (description + stats) · Workflow (DAG) · Dataflow (I/O) · On-demand
- **Drawer** : click sur un node de phase ou d'agent on-demand → doc complète
- **Index** : `docs/architecture-cartography/index.html` (cards cliquables)

## Éditeur web local — `awok edit`

```bash
awok edit [--workflow NAME] [--port N] [--no-browser]
```

Sert un éditeur web (serveur `http.server` stdlib threadé, lié à `127.0.0.1`)
pour éditer les workflows visuellement. Aucune dépendance Python supplémentaire.
Le JS est servi en modules ES sous `/editor/*.js` (source unique partagée avec
les tests bun) ; le rendu est anti-XSS (DOM construit, pas d'`innerHTML` de
données).

- **Grille** : lignes = enchaînement (niveaux de `depends_on`, recalculés ; une
  ligne = une **stage**), colonnes dans une ligne = parallélisme. Les **liens de
  dépendance** sont tracés (overlay SVG).
- **Drag & drop** d'une carte vers une ligne → `depends_on` = phases de la
  ligne précédente, affinable au panneau. Anti-cycle (impossible de dépendre
  d'une phase qui dépend de soi ; une vignette explique si un drop est
  contraint). `depends_on` reste la source de vérité ; `parallel_with` est
  dérivé des voisins de ligne et écrit au save.
- **Panneau d'édition** (clic sur une carte) en **onglets** : Général
  (id/name/type/group/description, + `cmd` si script, `workflow` si
  workflow_call) · Dépendances · Fichiers (inputs/outputs io_refs) · Triggers ·
  Invocations (model/effort/description/background/skip_if/depends_on_invocation/
  triggers/io + **éditeur de prompt** plein écran). Aides en icône `?` au
  survol. Panneau redimensionnable, se ferme au clic en dehors.
- **Onglets principaux** : Grille · Dataflow (diagramme mermaid agents↔fichiers,
  chargé à la demande) · Réglages (skill.* / groups / conditions /
  on_demand_agents) · YAML (lecture seule).
- **Création** : « + nouveau » (vierge) ou « dupliquer » (clone) ; « + phase » ;
  « + agent » (scaffolde `src/agents/<nom>.md` + le template
  d'invocation via `POST /api/agent`).
- **`--workflow NAME`** ouvre directement ce workflow (sinon le premier).
- Hors couverture éditable (lecture YAML) : `brainstormings`, `manual_sections`.
- **Enregistrer** (💾) valide (schema + cohérence) **puis** écrit le YAML —
  rien n'est écrit si invalide, le fichier reste toujours valide.

**Deux points à connaître :**

1. **Normalisation du formatage au premier save.** Le YAML est ré-sérialisé
   en forme canonique (PyYAML). Le contenu est préservé à l'identique
   (round-trip vérifié) et la sortie est **idempotente**, mais le premier
   enregistrement d'un fichier écrit à la main peut produire un gros diff
   cosmétique (re-wrapping des blocs `>`, lignes vides entre phases). Les
   enregistrements suivants ne produisent plus de diff.
2. **Régénérer après édition.** L'éditeur écrit le `.yaml` mais ne régénère
   pas le `SKILL.md` / la cartography. Lancer ensuite :

   ```bash
   bb-workflow generate --workflow NAME
   ```

   sinon le hook pre-commit signalera une dérive SKILL.md ↔ YAML.

## Pre-commit hook

```bash
cp src/hooks/pre-commit-bb-workflow-check.sh .git/hooks/pre-commit
```

Bloque les commits si un `workflows/*.yaml`, un `SKILL.md`, ou un template change
sans régénérer.

## Spec

- `docs/superpowers/specs/2026-05-21-workflow-modulable-yaml-design.md`
- `docs/superpowers/specs/2026-05-28-bb-workflow-web-editor-design.md` (éditeur web v1)
- `docs/superpowers/specs/2026-05-29-bb-workflow-web-editor-v2-design.md` (éditeur web v2)
- `docs/superpowers/specs/2026-06-02-bb-workflow-io-model.md` (modèle I/O figé — qui sait/produit/vérifie quoi) + `.mermaid`

## Plan d'implémentation

- `docs/superpowers/plans/2026-05-21-workflow-modulable-yaml.md`
- `docs/superpowers/plans/2026-05-28-bb-workflow-web-editor.md` (éditeur web v1)
- `docs/superpowers/plans/2026-05-29-bb-workflow-web-editor-v2-lot{1,2,3}.md` (éditeur web v2)

## `--workdir` / `$AWOK_WORKDIR` (external content root)

awok resolves paths from two roots: **ENGINE_ROOT** (this repo — templates +
schema, found via `$BB_WORKFLOW_REPO` → schema-marker walk-up → install location)
and **CONTENT_ROOT** (`--workdir` / `$AWOK_WORKDIR`, default = engine).

| From ENGINE_ROOT | From CONTENT_ROOT |
|---|---|
| `src/workflow/templates/*.jinja`, `html-wrapper.html`, webedit | `src/workflows/`, `src/agents/` |
| `src/workflow/workflow.schema.json` | `src/workflow/templates/invocations/`, `src/workflow/manual/` |
| | generated `src/skills/`, `docs/architecture-cartography/`, `index.html` |

`awok init --workdir DIR` scaffolds a workdir (idempotent); `awok deploy --workdir DIR`
copies its `src/skills/*` + `src/agents/*` into `~/.claude/` (honours `$CLAUDE_HOME`).
Agents are self-sufficient: a workflow referencing an agent absent from the workdir
fails coherence validation.
