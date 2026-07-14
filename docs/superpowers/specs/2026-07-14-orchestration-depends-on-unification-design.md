# Design — Unification de l'orchestration sur `depends_on` (suppression de `parallel`)

> Statut : **design approuvé, à implémenter.** Révision du modèle d'orchestration livré le
> 2026-07-13 (`docs/superpowers/specs/2026-07-13-portes-logiques-orchestration-design.md`),
> branche `feat/portes-logiques-orchestration` (non mergée). Auteur du design : Marc-Antoine,
> avec un panel adversarial interne (devil's-advocate / premortem / rolestormer /
> cross-pollinator) le 2026-07-14.

## 1. Problème

Le modèle livré porte **deux défauts d'ordonnancement opposés** :

- **DAG de phases** : déclaratif, **parallèle par défaut** — deux phases sans arête `depends_on`
  entre elles sont sœurs et tournent ensemble.
- **Arbre d'orchestration** (`<name>.orchestration.yaml`) : impératif, **séquentiel par défaut** —
  le SKILL.md rendu dit littéralement « Run the pipeline actions in this order ». Un `parallel {}`
  est l'échappatoire qui réintroduit la concurrence dans le control-flow.

Conséquence (footgun) : déplacer deux phases sœurs (concurrentes dans le DAG) dans une liste
d'orchestration les **sérialise en silence** ; il faut les ré-emballer dans `parallel` pour
récupérer la concurrence. Deux autorités d'ordre pour une seule intention.

Le panel adversarial a par ailleurs établi que **le seul target qui tourne aujourd'hui est le
target standard** (SKILL.md exécuté par Claude ; le target JS « dynamic workflows » est différé et
sera géré autrement — voir TODO B1), et que sur ce target le modèle **sérialise par défaut** :
aujourd'hui `_render_blocks` n'émet l'instruction « launch all in one message » que pour
`parallel`. Cf. mémoire `awok-headless-parallelism-test`.

## 2. Décision

**Un seul modèle partout : `depends_on` ordonne ; l'absence d'arête = parallèle.** On supprime
`parallel` de la surface d'écriture, et un bloc de control-flow devient un **groupe** (cluster
repliable sur un seul DAG plat), *pas* une action opaque à interface I/O.

Ce choix « groupe sur DAG plat » (et non « nœud opaque avec interface I/O ») suit le précédent
**Airflow SubDAG → TaskGroup** : SubDAG (nœud opaque, contexte propre) a été déprécié puis
supprimé car il créait une seconde autorité de règles et rendait le graphe illisible d'un coup
d'œil ; TaskGroup (regroupement visuel/namespace sur le DAG unique, arêtes libres) l'a remplacé.
La cartographie étant le produit d'awok, l'opacité SubDAG était disqualifiante.

## 3. Règles de dépendance (le cœur)

Modèle mental unique : **des scopes lexicaux emboîtés.** Le top-level est un scope ; chaque
`then`/`else`/`body` de bloc ouvre un scope enfant. Une arête `depends_on` de la source `X` vers
la cible `T` obéit à **une seule loi de visibilité** :

> **`X` ne peut dépendre que d'une cible visible depuis son scope : une sœur du même scope, ou une
> entité d'un scope ancêtre. On regarde « au-dessus » et « à côté », jamais « à l'intérieur » d'un
> autre bloc.**

Et un corollaire :

> **Un bloc est opaque de l'extérieur : on dépend du bloc-entier (il est « fini » quand ses
> actions internes exécutées sont finies), jamais d'une action précise à l'intérieur.**

Ce qui se décline exactement en ce que Marc-Antoine a acté :

| Cas | Exemple | Règle | Pourquoi |
|---|---|---|---|
| Dehors → action interne | `Z` (après le bloc) dépend de `A` (dans le `then`) | **Interdit** | si le `else` est pris, `A` ne tourne jamais → `Z` bloque à jamais |
| Dehors → bloc sœur | `Z` dépend du **bloc `IF`** (même scope) | **Autorisé** | `Z` attend la résolution de la condition (quelle que soit la branche) |
| Dehors → bloc **imbriqué** | `Z` dépend d'un `if` niché dans un autre `if` | **Interdit** | reaching-in de 2 niveaux → orchestration illisible |
| Dedans → dehors | `HUNT` (dans la boucle) dépend de `RECON` (avant) | **Autorisé** | `RECON` tourne toujours avant l'évaluation du bloc |

Exemple de la borne « même niveau » (mot de Marc-Antoine) : deux `if` imbriqués + une action `Z`
hors des deux. `Z` **peut** dépendre du `if` externe (sa sœur), **pas** du `if` interne (niché
d'un niveau).

**Acyclicité** : toujours vérifiée, mais le détecteur de cycle doit désormais compter l'arête
**implicite** « bloc-fini dépend de ses actions internes exécutées ». Un `A` interne qui
dépendrait d'un `Z` placé après le bloc, alors que `Z` dépend du bloc → cycle, à rejeter.

## 4. Protocole d'exécution rendu dans le SKILL.md (ce qui remplace `parallel`)

Puisque `parallel` disparaît, **le générateur doit émettre un protocole d'exécution explicite** que
l'orchestrateur (Claude, mode standard) suit — sinon tout se sérialise. Le protocole est un
exécuteur topologique événementiel décrit en prose :

1. **État par action** : `pending` → `running` → `done`. Une action est **prête** quand tous ses
   `depends_on` sont `done`.
2. **Lancement groupé** : lancer **toutes les actions prêtes ensemble, dans un seul message**.
   *C'est de là que vient la concurrence — plus besoin du mot-clé `parallel`.*
3. **Fin d'un lot — geler l'état avant de recalculer** (le point de concurrence soulevé par
   Marc-Antoine) : quand un lancement groupé revient, **marquer TOUTES les actions du lot comme
   `done` d'abord**, *puis seulement* recalculer les prêtes. Ne jamais évaluer la disponibilité
   au fil de l'eau action par action : si deux actions finissent « en même temps », on risquerait
   de sauter une action dont les deux dépendances viennent de finir, ou de bloquer l'orchestration.
4. **Réveil ciblé** (optimisation demandée) : ne ré-examiner que les **dépendants des actions qui
   viennent de finir**, pas toutes les actions ; pour chacun, vérifier s'il lui reste une
   dépendance active ; lancer les nouvellement prêts.
5. **Blocs** :
   - `if/else` : quand le bloc est prêt, évaluer sa **condition** (lecture d'un signal, jamais un
     artefact) ; seules les actions de la **branche prise** entrent dans l'ensemble des prêtes ; le
     bloc est `done` quand la branche prise est finie.
   - `while`/`until`/`for_each` : ré-instancier le **corps** à chaque itération ; le bloc est `done`
     quand la boucle sort (condition, ou `cap` atteint). L'aval qui dépend du bloc attend ce
     `done`.

Ce protocole est, de fait, une version légère du **générateur de graphe d'orchestration** (TODO
B6) : il aide le main-agent à décider quoi lancer en fonction de l'état des actions.

**Rendu** : remplacer la section « Run … in this order » par une section « Execution protocol »
(l'ossature existe déjà, gated par `any_parallelism`, bb-workflow ~L1458). Le générateur calcule
la topologie locale de chaque scope et l'exprime comme ready-set, pas comme liste ordonnée.

## 5. Membres du corps de boucle : « une fois » vs « par itération »

Règle simple et lexicale : **tout ce qui est dans le `body:` tourne à chaque itération.** Une
étape d'initialisation « une seule fois » se place **avant** la boucle (dans le scope parent), pas
dans le corps. On évite ainsi l'ambiguïté « un membre de corps sans dépendance interne tourne-t-il
une fois ou N fois ? » sans analyse de dépendance-de-données. (Le raffinement « appartenance au
corps par dépendance à la variable `as` », à la Beam/Dagster, est noté comme amélioration
possible mais **hors scope** de cette révision.)

## 6. Sortie agrégée d'une boucle

Zéro machinerie nouvelle : on réutilise le modèle **I/O par rôle**. Un bloc-boucle **déclare un
rôle de sortie** comme n'importe quelle action, et on sépare deux canaux :

- **Contrôle** (condition de boucle) : lit un **signal** bon marché (champ/token). Règle d'or
  préservée.
- **Données** (consommé par l'aval) : un **fichier** produit par le corps :
  - `for_each` (fan-out) → sortie `kind: dir` ; le corps écrit un fichier par itération
    (`<item>.json`) ; l'aval lit le dossier. Map→collect via le filesystem (`kind: dir` existe déjà).
  - `while`/`until` → fichier unique **accumulé** (jsonl append) ou **écrasé** (dernière valeur) ;
    l'aval le lit. Exactement le pattern `ledger.jsonl` de completeness-critic.

L'aval dépend du **bloc-boucle entier** (règle sœur du §3) et lit ce rôle. Le **carry** d'une
itération à la suivante (completeness-critic) reste un artefact-fichier lu/écrit par le corps,
comme aujourd'hui — le passage au modèle « groupe » fait disparaître le problème que posait
l'ancienne interface I/O opaque.

> Réserve : un construct `collect` explicite (nœud d'agrégation first-class, visible en
> cartographie, mappé `list.map(body).collect()` en JS) reste une option **différée** si on veut
> plus tard rendre l'agrégation visible dans le graphe. Par défaut, le fichier suffit.

## 7. Changements moteur (`src/scripts/bb-workflow`)

- **Schéma / capabilities** : retirer `parallel` du catalogue de constructs
  (`orchestration-capabilities.yaml`, `workflow.schema.json` orchestration). Constructs restants :
  `ref`, `if/then/else`, `while`, `until`, `for_each`. (6 → 5.)
- **`_render_blocks` / `render_orchestration`** : ne plus rendre une liste ordonnée ; rendre
  l'**Execution protocol** du §4 (ready-set + lancement groupé + gel de lot + réveil ciblé). Émettre
  explicitement les ensembles à lancer « in one message ».
- **`validate_orchestration`** : ajouter la **loi de visibilité** du §3 (rejeter dehors→action
  interne, dehors→bloc imbriqué non-sœur) ; intégrer l'arête implicite « bloc-fini » au détecteur
  de cycle ; permettre à un bloc-boucle de déclarer un rôle de sortie (validé comme une sortie
  d'action).
- **`build_orchestration_overlay` / cartographie** : le bloc devient un **cluster repliable** sur
  le DAG plat (style TaskGroup), arêtes traversant le cluster affichées telles quelles ; diamants
  de branche et sous-graphes de boucle conservés ; montrer le rôle de sortie de boucle comme un
  nœud dataflow normal.
- **Dataflow** (`build_dataflow_graph`) : les arêtes dedans→dehors et dehors→bloc sont des arêtes
  normales du graphe plat ; la sortie de boucle est un producteur normal.

## 8. Migration

- **`parallel` existant** : les workflows/fixtures qui l'utilisent
  (`src/scripts/tests/fixtures/workflows/orchestrated.orchestration.yaml`) doivent retirer le
  wrapper — les enfants deviennent des refs sœurs sans `depends_on` entre eux (donc parallèles).
  Écrire un test de régression : la section Execution protocol émet bien l'instruction « in one
  message » pour ces refs.
- **Rétro-compat** : orchestration absente ⇒ DAG pur ⇒ sortie identique. Inchangé.
- **Ripple** : changement moteur → `awok generate` (tous), commit des artefacts régénérés, trailer
  `Regen:`, `./install.sh`, test de régression (positif + négatif). Cf. CLAUDE.md § *Patching the
  engine*.

## 9. Impact backlog

- **B1 (compilateur JS)** : sans `parallel`, le backend infère les groupes concurrents depuis
  l'absence d'arête ; `for_each`+sortie `dir` mappe `list.map(body)` + lecture dossier — plus
  propre à coder que l'ancienne interface opaque. À valider quand B1 démarre.
- **B2 (web UI blocs)** : l'éditeur listait `parallel` comme bloc éditable → à retirer ; la
  concurrence n'est plus un bloc mais l'absence d'arête (édition via le graphe de `depends_on`).
- **B6 (générateur de graphe d'orchestration)** : le §4 en est la première brique (protocole
  état-des-actions rendu dans le SKILL.md). Vérifier le recouvrement avant d'aller plus loin.
- **D1 / D2 (vocabulaire)** : le bloc est un **groupe**, pas une action → **pas** de collision avec
  « une action est une unité indivisible, sans ordre intra-action ». Cohérent avec le 3e axe
  (`group`) déjà en place.

## 10. Hors scope (différé)

- Le construct `collect` explicite (§6, réserve).
- L'appartenance au corps de boucle par dépendance-de-données à `as` (§5).
- Le target JS / dynamic workflows (B1) — ce design vise le target standard.
- Le générateur de graphe d'orchestration complet (B6) au-delà du protocole du §4.

## 11. Points encore ouverts (à trancher à l'implémentation)

1. **Format exact de la section Execution protocol** dans le SKILL.md : liste de « vagues » (level
   0, level 1, …) pré-calculées, ou vrai algorithme événementiel décrit en prose ? Le §4 décrit
   l'algorithme ; à voir si un pré-calcul en vagues est plus lisible pour l'orchestrateur sans
   perdre le réveil ciblé.
2. **Déclaration du rôle de sortie d'un bloc-boucle** : sous quelle clé YAML (`output:` sur le
   bloc `while`/`for_each` ?) et comment le relier au corps qui l'écrit.
3. **Nommage du cluster** en cartographie (réutiliser `group` ou un id de bloc dédié ?).
