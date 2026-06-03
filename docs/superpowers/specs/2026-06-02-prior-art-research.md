# Art antérieur & build-vs-adopt — CrewAI / Dagster / Dify / GitHub Actions

**Date :** 2026-06-02
**Méthode :** deep-research (5 angles, 23 sources, 102 claims extraits, 25 vérifiés
en vote adversarial 3-votes, 22 confirmés / 3 tués). Complète le modèle figé
`2026-06-02-bb-workflow-io-model.md`.

## Verdict (Partie B) — CONTINUER bb-workflow

**Aucun des 4 ne peut remplacer bb-workflow.** Distinction structurelle : les 4 sont
des **moteurs d'exécution** (CrewAI = moteur LLM ; Dagster = orchestrateur Python +
IO managers runtime ; Dify = GraphEngine qui peuple une VariablePool à l'exécution ;
GitHub Actions = runner CI). bb-workflow est une **couche de compilation** : il émet
un SKILL.md d'instructions pour Claude Code + humain dans la boucle, sans imposer de
runtime. Adopter l'un d'eux imposerait son daemon/service/engine → contredit
zéro-infra / offline / fichiers-plats.

Spécifique à nous et couvert par **aucun** : (1) compilation vers SKILL.md Claude Code
(relais verbatim au sous-agent Task), (2) conventions de répertoire projet
(chemins = conventions, pas params), (3) human-in-the-loop comme runtime, (4)
offline/zéro-infra, (5) cartographie HTML autonome + éditeur web local.

→ **Ne pas adosser. Voler conceptuellement à Dagster** (IO-manager + validate_loadable).
Pivot non justifié. CrewAI/Dify confirment un modèle **opposé** au nôtre (résolution
runtime + templating), à ignorer.

## Partie A — à voler / à éviter, par point

| Notre point | Verdict | Source / détail |
|---|---|---|
| **1. Relais verbatim vs dynamique** | Dagster câble **statiquement** (DAG inféré des signatures, pas de `{{ }}`) → **aligné** avec notre relais verbatim. CrewAI/Dify résolvent au **runtime** (`{{ }}`/`{var}`) → **à éviter**, ça n'a aucun sens pour un compilateur. | Dagster assets docs ; CrewAI tasks ; Dify `variable_pool.py` |
| **2. Binding rôle→chemin** ⭐ | **Dagster IO managers** = seul art antérieur canonique : découplent QUELLE donnée (asset key / nom logique) de OÙ elle est stockée, via `io_manager_key`. **À VOLER en priorité.** CrewAI (`output_file` en dur, interpolation buggée #1803) et Dify (adressage par node-id du producteur) font **l'inverse**. | `docs.dagster.io/api/dagster/io-managers` ; crewAI#1803 |
| **3. Identité agent vs I/O tâche + réutilisation** | Dagster : une **op definition** réutilisée N fois via **alias** (`.alias('...')`, auto `add_one_2`), chaque invocation = instance avec ses I/O. **Valide notre choix** : I/O par rôle, pas dans l'identité ; paramétrage > duplication (= notre « dérivation = exception »). CrewAI sépare agent (identité) / task (I/O) mais lien runtime. | `docs.dagster.io/guides/build/ops/graphs` |
| **4. Validation à l'écriture** ⭐ | **Dagster `Definitions.validate_loadable()`** = seul à valider à l'authoring (clés en conflit, jobs résolubles, ressources satisfaites, partition mappings). **À VOLER.** CrewAI = validation **runtime only** (Pydantic), pas de détection d'orphelins. Dify : rien d'équivalent exposé. NUANCE : Dagster repose sur un type-system Python ; notre jsonschema + graph-check est **plus léger et adapté** à un YAML déclaratif. | `docs.dagster.io/api/dagster/definitions` |
| **5. DAG + parallélisme** | Dagster **infère** les deps depuis les références de données ; nous gardons `depends_on` **explicite** comme source de vérité = 3ᵉ modèle, **plus lisible/auditable** pour un humain. **Ne PAS voler l'inférence** (rendrait le YAML moins auditable). | Dagster assets ; Dify `graph_engine.py` |

## Mise à jour — dive source Dagster (commit `285c33607f`, 2026-06-01)

Lecture du code réel pour trancher les 2 questions prioritaires. Corrige/affine
la Partie A.

**Point 2 (binding rôle→chemin) — CONFIRMÉ + recette concrète.** L'IO manager FS par
défaut construit le chemin = `base_dir / *asset_key.path`
(`_core/storage/upath_io_manager.py:204-213`), extension par convention
(`_with_extension`). `base_dir` = config, sinon défaut (`storage/` sous
DAGSTER_HOME). → **nom logique + racine suffisent ; l'utilisateur n'écrit AUCUN
chemin par sortie.** Il existe en plus une variante **opt-in**
`CustomPathPickledObjectFilesystemIOManager` (`fs_io_manager.py:300-315`) où
l'utilisateur fournit un `path` explicite via metadata.
→ **À voler : chemin dérivé par convention (racine + composants du rôle + ext) PAR
DÉFAUT, override explicite en échappatoire.** Chez nous : le champ `path` peut
devenir **optionnel/dérivé**.

**Point 4 (validation à l'écriture) — CORRECTION : Dagster N'EST PAS l'art antérieur
espéré.** `validate_loadable` (`definitions_class.py:720` →
`repository_definition.py:194`) **NE détecte PAS** :
- orphelins (output que personne ne lit) → **NON** (un asset feuille est valide) ;
- dépendance manquante (clé consommée non produite) → **NON** — devient un *stub
  externe silencieux* via `resolve_stub_assets_defs` (`asset_graph.py:227`) ;
- mismatch de type producteur↔consommateur → **NON** (runtime only, `do_type_check`
  dans `execute_step.py:309`).

Il ne **bloque** que sur : conflits de clés d'assets/checks, noms de
jobs/sensors/schedules en double, résolubilité des jobs, ressources satisfaites,
partition mappings. → **Notre check orphelins / deps manquantes / rôle↔prose est à
construire NOUS-MÊMES : aucun des 4 ne le fait à l'authoring.** (On a déjà la base :
warnings dataflow + marqueurs `external:`/`terminal:`.)

**Bonus** : nos marqueurs `external:`/`terminal:` = exactement l'idée des *external
source assets* de Dagster (une dep sans producteur = source externe, pas une
erreur). Notre design avait convergé indépendamment.

## Caveats (honnêteté méthodo)

- **GitHub Actions : 0 claim vérifié survivant.** La comparaison GHA (artifacts =
  binding par nom logique, `needs` = DAG explicite proche de `depends_on`, pas de
  validation d'authoring native — d'où des linters tiers type **actionlint**) repose
  sur le cadrage, **pas sur des sources vérifiées**. À refaire si on veut s'appuyer dessus.
- **Chemins de code Dify périmés** : refactorés dans un package `graphon` sur `main`.
  Claims vérifiés sur tags **v1.0.0 / 0.15.3** — pointer un tag, pas `main`.
- **CrewAI : claims 2-1 (split).** « injection structurée vs interpolation » est
  idéalisé — sous le capot les `TaskOutput` sont **concaténés en texte** dans le prompt.
  L'absence de validation compile-time repose sur docs, pas sur le source.
- **Dagster IO-manager : analogie raisonnable mais à creuser.** Les IO managers sont
  **optionnels**, et la dérivation concrète du chemin (asset key seul vs config) exige
  une **lecture de code** avant toute implémentation inspirée.

## Open questions (→ étape « descente dans le source »)

1. **GHA** mérite une passe dédiée (artifacts/needs/validation) si on veut s'en servir.
2. **Dagster IO-manager** : le chemin vient-il de l'asset key seul ou de config runtime ?
   Lire `IOManager._get_path` / `PickledObjectFilesystemIOManager`.
3. **`validate_loadable()`** détecte-t-il vraiment **orphelins + mismatches
   producteur/consommateur**, ou seulement conflits de clés + résolubilité ? (notre
   cible = orphelins → vérifier que l'analogie tient).
4. **5ᵉ système ?** Un outil qui serait une **couche de compilation** et non un moteur
   (LangGraph, Temporal, Prefect, DSPy, ou **Microsoft Conductor** — « deterministic
   orchestration for multi-agent AI », mai 2026) serait un vrai concurrent. Non étudié.

## Sources clés (primary)
- Dagster IO managers : https://docs.dagster.io/api/dagster/io-managers
- Dagster Definitions/validate : https://docs.dagster.io/api/dagster/definitions
- Dagster ops/graphs (alias/reuse) : https://docs.dagster.io/guides/build/ops/graphs
- CrewAI tasks : https://docs.crewai.com/en/concepts/tasks (+ issue #1803 output_file)
- Dify variable pool : https://github.com/langgenius/dify (tag v1.0.0, pas main)
- Microsoft Conductor : https://github.com/microsoft/conductor
- actionlint (GHA lint tiers) : https://github.com/rhysd/actionlint
