# Portes logiques & orchestration séparée — design

- **Date** : 2026-07-13
- **Statut** : design validé, prêt pour plan d'implémentation
- **Périmètre** : awok engine (`src/scripts/bb-workflow`, schéma, templates), pas la web UI détaillée

## 1. Problème

awok compile un DAG déclaratif en `SKILL.md`. Aujourd'hui :

- Il n'y a **pas de vraies portes logiques** : les boucles sont de la prose dans les
  descriptions d'agents (`edit-workflow.yaml:212` « loop back to S2 »), et le conditionnel
  se limite à un embryon anémique (`skip_if` + un map `conditions` file/dir +
  `triggers.condition`) — aucune comparaison d'entiers, aucun « chaîne contient chaîne »,
  aucune boucle.
- Cette logique est **invisible** : ni visualisée dans la cartographie, ni éditable dans la
  web UI. C'est le point de douleur central.
- Le YAML généré est **trop gros et peu lisible** ; mélanger le contenu (agents, I/O) et
  l'orchestration (logique) dans un seul fichier aggrave le problème.
- À terme awok doit pouvoir compiler vers les **dynamic workflows** (scripts JS du tool
  `Workflow`, feature Claude récente), en plus du `SKILL.md` standard. Le même modèle de
  logique doit servir les deux cibles.

## 2. Le nœud central : awok n'a pas de runtime

awok **compile**, c'est Claude Code qui **exécute**. Une porte logique n'a donc pas le même
sens selon la cible :

| Cible | Ce qu'est une condition / boucle | Exécution |
|---|---|---|
| **Standard** (`SKILL.md`) | des **instructions structurées** que l'orchestrateur LLM suit | best-effort (le LLM déroule) |
| **Dynamic** (script JS `Workflow`) | un vrai `if` / `while` dans le script | déterministe (le runtime exécute) |

Contrainte JS forte : le tool `Workflow` **n'a aucun accès filesystem**. Une condition JS ne
lit que des valeurs de retour d'`agent()` (typées via schéma) et des variables JS — pas de
`file_exists`. Le modèle d'opérande doit donc être assez abstrait pour mapper les deux cibles,
avec les briques non-mappables explicitement marquées `standard-only`.

**Décision de périmètre** : ce spec fige le modèle de logique, le format 2-YAML, les signaux,
le rendu cartographie et le validateur, **plus** la compilation standard. Sont explicitement
différés : (a) le compilateur JS complet ; (b) le design détaillé de l'éditeur web (édition de
blocs imbriqués). Le modèle est néanmoins conçu **compatible-JS dès le départ**.

## 3. Architecture : orchestration au-dessus d'une bibliothèque de phases

Le DAG de phases reste **acyclique** et devient la **bibliothèque d'unités appelables** (le
« contenu »). Une **couche d'orchestration** au-dessus référence ces phases par id et porte la
logique. C'est un **arbre de blocs**, pas un graphe cyclique — donc aucune violation
d'acyclicité, et ça mappe 1:1 vers le JS (`if→if`, `while→while`) et vers le `SKILL.md`
(instructions imbriquées).

**Coexistence** : à l'intérieur d'un bloc, les références de phases gardent leur `depends_on`
local. Donc **la dépendance et le parallélisme déclaratifs survivent « dans le petit », et le
control-flow s'ajoute « dans le grand »**. On n'échange pas le DAG contre de l'impératif : on
garde le DAG pour la partie simple et on l'enveloppe de boucles/conditions là où il en faut.

**Cas dégénéré = rétro-compatibilité** : aucune orchestration déclarée ⇒ DAG pur ⇒ comportement
strictement identique à aujourd'hui. Les 4 workflows existants ne changent pas.

## 4. Découpage 2-YAML

| Fichier | Rôle | Obligatoire |
|---|---|---|
| `src/workflows/<name>.yaml` | **Contenu** : `skill`, `groups`, `namespaces`, `phases` (agent / I/O / description / `emits`) | oui |
| `src/workflows/<name>.orchestration.yaml` | **Orchestration** : l'arbre de blocs + le catalogue de conditions | non (absent = DAG pur) |

Le fichier contenu reste la source de vérité des phases ; le fichier orchestration référence
les phases par `id`. La résolution (blocs → phases, signaux → sources) se fait à `generate`,
comme la résolution `role → path` actuelle.

### Exemple d'orchestration

```yaml
# <name>.orchestration.yaml — un arbre de blocs
- ref: RECON                         # une phase du fichier contenu (garde son depends_on local)
- for_each: recon.endpoints          # itère sur un signal-liste produit par RECON
  as: ep
  cap: 200
  body:
    - ref: SCAN                      # prend `ep` en input
    - if: { op: "==", left: scan.status, right: "vuln" }
      then:
        - ref: EXPLOIT
- while: { op: "==", left: critic.verdict, right: "INSUFFICIENT" }
  cap: 3                             # borne obligatoire (anti-runaway)
  body:
    - ref: HUNT
    - ref: CRITIC
```

## 5. Catalogue des constructs (6, exhaustif)

> **Révisé 2026-07-14** : `parallel` supprimé, modèle unifié sur `depends_on`. Voir
> 2026-07-14-orchestration-depends-on-unification-design.md.

Validé exhaustif contre le skill de référence `workflow-builder` (ses 5 topologies —
fan-out, pipeline, loop, barrier, judge-panel — se ramènent toutes à ces 6) :

1. **séquence / dépendance** — `depends_on`, inchangé.
2. **`parallel { }`** — fan-out de largeur **connue à l'écriture** (le parallélisme actuel).
3. **`if / else`** — branche sur une condition.
4. **`while` / `until`** — boucle conditionnelle, **`cap` obligatoire**.
5. **`for_each`** — itère sur un **signal-liste** produit au runtime, en liant une **variable
   d'itération** consommée par les phases du corps. Fan-out de **largeur runtime** : c'est le
   pouvoir expressif nouveau que le DAG actuel ne sait pas exprimer. Mappe vers
   `pipeline()` / `parallel(items.map(...))` en JS.
6. **accumulateur / reduce** — un signal qui **persiste et s'agrège** à travers les itérations
   (le motif `bugs.push(...)` / loop-until-count).

**Turing-complétude** via `while` + accumulateur (points 4 et 6). Réelle en JS ; best-effort en
standard (l'orchestrateur LLM déroule). Toute itération est **bornée** par un `cap` — miroir du
cap dur à 1000 agents du runtime JS et du ledger de la completeness-critic.

## 6. Conditions & modèle d'opérande

Une condition est un **objet YAML structuré**, jamais une DSL à parser :

```yaml
{ op: "<", left: recon.bug_count, right: 10 }
```

- **Opérateurs typés** : `==` `!=` `<` `>` `<=` `>=` `contains` `matches` `exists`.
- **Opérandes** : `signal` · `littéral` · **built-in** (`file_exists`, `dir_exists`).
- **Escape-hatch** : un opérande/prédicat en **string** libre, évalué par l'orchestrateur LLM —
  **`standard-only`**.

### Frontière js-safe / standard-only

Chaque brique (opérateur, type d'opérande, built-in) porte un **tag de capacité** :

- **Mode standard** = liberté maximale : signaux + built-ins fichiers + escape-hatch autorisé.
- **Mode JS** = sous-ensemble **contraint** : signaux typés + opérateurs uniquement ; **pas de
  `file_exists`, pas d'escape-hatch** (le JS n'a pas de filesystem et ne devine pas).

Le mode JS n'est pas un modèle différent : c'est le **sous-ensemble js-safe** du même modèle.

### Le catalogue de capacités = un fichier dédié, source unique

La frontière js-safe / standard-only ne vit **ni dans du code, ni dans la prose d'un skill** :
c'est un **fichier de données dédié** (proposé : `src/workflow/orchestration-capabilities.yaml`),
source de vérité unique, qui liste chaque brique (opérateur, type d'opérande, built-in,
escape-hatch) avec ses tags :

```yaml
# src/workflow/orchestration-capabilities.yaml
operators:
  "==":       { js_safe: true,  standard: true }
  "<":        { js_safe: true,  standard: true,  types: [number] }
  contains:   { js_safe: true,  standard: true,  types: [string, list] }
  matches:    { js_safe: true,  standard: true,  types: [string] }
builtins:
  file_exists: { js_safe: false, standard: true }   # pas de filesystem en JS
  dir_exists:  { js_safe: false, standard: true }
operands:
  escape_hatch: { js_safe: false, standard: true }  # prédicat string libre
```

Ce fichier est consommé par **deux** consommateurs, ce qui garantit la maintenabilité (on ajoute
un opérateur **une seule fois**) :

- **`awok validate`** (engine) l'**applique** : refuse une brique `standard-only` dans un workflow
  marqué cible-JS, et vérifie la compatibilité de type opérateur↔opérande.
- **`create-workflow`** (skill) le **consomme pour guider** : sur le chemin de bascule JS, il sait
  quelles conditions proposer/interdire sans dupliquer la matrice dans sa prose.

Le fichier est engine-level (il vaut pour tous les workflows) et éditable ; l'étendre est le seul
geste pour élargir le vocabulaire de conditions.

## 7. Signaux (context-frugal, greffés sur l'I/O)

Un signal est un **petit scalaire/liste** qu'une phase expose **pour l'orchestration** — pas sa
sortie complète. Il ne sert qu'à router.

**Règle d'or (cible standard)** : pour router, **on ne recharge jamais un artefact entier**.
L'orchestrateur a déjà le retour de chaque sous-agent dans son contexte ; on route sur des
éléments compacts déjà présents. Ça élimine l'explosion de contexte par construction.

Deux **sources**, le signal déclare la sienne :

- **(a) champ d'un output déjà déclaré** — la condition pointe un *champ* d'un output structuré
  que la phase produit de toute façon (`from: recon.json`, champ `status`). **Rien de neuf à
  déclarer** ; l'orchestrateur fait une **lecture ciblée** du champ. C'est le greffage sur le
  modèle de fichiers I/O existant.
- **(b) token compact** — `SIGNALS status=vuln` en fin de sortie, pour les phases **prose-only**
  (agent qui ne produit pas d'output structuré). **Zéro relecture** : le token est déjà dans le
  transcript de l'orchestrateur. C'est la généralisation du token de la completeness-critic
  (`COMPLETENESS … | DIR=…`).

**`emits` est opt-in** : requis uniquement pour les phases prose-only. Une phase qui a déjà un
output `json` ne demande **rien à déclarer** quand on pose une condition sur elle plus tard — la
condition nomme le champ, son type est posé sur la condition.

```yaml
# fichier contenu — emits uniquement là où c'est utile
- id: RECON
  outputs:
    - { role: work:recon, kind: json }
  # pas d'emits : la condition pointera recon.json champ `status` (source a)
- id: CRITIC
  emits:
    - { name: verdict, type: enum, source: token }   # phase prose-only (source b)
```

En **cible JS**, les deux sources deviennent la valeur de retour schématisée d'`agent()` — une
variable. La déclaration `emits` / le champ pointé fixe le schéma de retour.

## 8. Double compilation

- **Standard → `SKILL.md`** : chaque bloc se rend en **instructions imbriquées** ; l'orchestrateur
  maintient un petit **contexte de signaux** qu'il porte le long du skill. Best-effort assumé.
- **Dynamic → script `Workflow`** (différé) : `if→if`, `while→while (+cap)`,
  `for_each→pipeline()/parallel(map)`, accumulateur→variable JS.

**Composition des deux cibles** (elles ne sont pas que des alternatives) :

- Un workflow standard peut **appeler un dynamic workflow** via `workflow_call` (feature déjà
  présente).
- Un `for_each` de **largeur runtime** dans un standard peut compiler vers un **appel de
  sous-workflow dynamique** : la boucle reste dans le YAML (visible, éditable, auditée), son
  exécution est déterministe car déléguée au JS. C'est le **chemin modélisé** pour le fan-out
  fiable connu à l'écriture.
- **Soupape opportuniste** (exception) : l'orchestrateur autorisé à écrire un dynamic workflow
  **ad-hoc** au runtime, uniquement pour l'imprévu — dans l'esprit exact de la feature
  `opportunistic`. Ce n'est **pas** la réponse par défaut au fan-out (sinon la logique
  redevient invisible, le trou qu'on veut boucher). Le doctor la surveille (§10).

## 9. Cartographie

- `if` → **losange**, arêtes étiquetées `true` / `false`.
- `while` / `for_each` → **sous-graphe bordé** étiqueté (condition + `cap` / collection +
  variable d'itération).
- Signaux **annotés** sur les coutures producteur→consommateur qu'ils traversent.

La version ASCII (`-texte.md`) rend les mêmes constructs en indentation imbriquée.

## 10. Validateur & workflow-doctor

### Nouveaux checks `awok validate`

- **Cohérence inter-fichiers** : tout signal référencé dans l'orchestration résout vers un champ
  d'output déclaré ou un `emits`, **type-compatible** avec l'opérateur (`< >` ⇒ numérique,
  `contains` ⇒ chaîne/liste, `matches` ⇒ chaîne, etc.). Une condition qui pend dans le vide =
  **erreur bloquante**.
- **Cap obligatoire** sur `while` / `for_each` (anti-runaway).
- **Frontière js-safe** : brique `standard-only` dans un workflow cible-JS = erreur. Les tags
  sont lus depuis `orchestration-capabilities.yaml` (§6), pas codés en dur.
- **Refs de blocs** → phases existantes ; **pas d'auto-appel** de workflow.

### Extensions workflow-doctor (signalées comme suivi, hors cœur de ce spec)

- **(a)** conditionnel/boucle **écrit dans le prompt** d'un agent (les « loop back to S2 »
  actuels) = **orchestration obsolète** : « cette logique devrait vivre dans le fichier
  d'orchestration ». C'est le levier qui force la migration.
- **(b)** **sur-usage de constructs best-effort** en cible standard = suggère de basculer une
  partie en dynamic.
- **(c)** **logique échappée** : JS ad-hoc opportuniste récurrent = drapeau.

## 11. Legacy

`skip_if`, le map `conditions` (file/dir), `triggers.condition` deviennent du **sucre** au-dessus
du nouveau modèle :

- `skip_if: cond` ≡ un bloc `if` inversé enveloppant une seule `ref`.
- `file_exists` / `dir_exists` ≡ des built-ins `standard-only`.

**Rétro-compatibilité totale** : les 4 workflows existants continuent de générer à l'identique.
La doc pousse le nouveau modèle ; le doctor (§10-a) signale l'ancien.

## 12. Découpage en sous-projets

1. **Ce spec** — modèle de logique + 2-YAML + signaux + compilation standard + cartographie +
   validateur + legacy. **Prérequis de tout le reste.**
2. **Suivi** — compilateur JS (dynamic workflows) : le même modèle, cible JS, `standard-only`
   refusé.
3. **Suivi** — éditeur web : édition de blocs imbriqués + « exposer un signal » au moment de
   poser une condition, sur une UI aujourd'hui pensée graphe-plat.

## 13. Hors périmètre (YAGNI)

- Compilateur JS complet (suivi).
- UX détaillée de l'éditeur web (suivi).
- Un langage/DSL de conditions : **rejeté**, on reste en YAML structuré.
- Persistance des niveaux/stages : inchangé, toujours dérivés du `depends_on`.
```
