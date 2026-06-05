# Modèle d'exécution d'awok — doc avancée

> Doc destinée aux **humains** qui conçoivent ou maintiennent un workflow awok.
> Elle répond à une question simple mais jamais écrite noir sur blanc : *que se
> passe-t-il vraiment quand un workflow « s'exécute » ?* Le reste de la doc
> (`bb-workflow.md`) couvre la **compilation** ; celle-ci couvre la **sémantique
> d'exécution**.

## Le modèle mental, en une phrase

**awok n'a pas de runtime.** Il *compile et valide* — il ne *lance* rien. Le
`SKILL.md` généré n'est pas une mécanique : c'est un **paquet d'instructions**
que l'agent principal de Claude Code lit et interprète. L'« exécuteur », c'est
donc Claude Code lui-même.

Conséquence directe, à garder en tête partout : tout ce que ce document décrit
comme « parallèle », « séquentiel », « en arrière-plan » est une **convention
suggérée à l'orchestrateur**, jamais une garantie imposée par un moteur. La seule
chose réellement *structurante* est le graphe de dépendances (`depends_on`), parce
qu'il pilote ce qui est rendu dans le `SKILL.md` et la cartographie.

## Vocabulaire : action / stage / group

Trois concepts à ne pas confondre. Ce sont trois **axes différents**.

| Terme | Ce que c'est | Déclaré ? |
|---|---|---|
| **action** | Le bloc unitaire de travail : *un* agent, *un* script, *une* action directe du main agent, ou *un* appel à un autre workflow. C'est l'unité qu'on édite. | Oui (liste dans le YAML) |
| **stage** | La « ligne » / le niveau de profondeur : l'ensemble des actions à la même distance topologique d'une racine. C'est une **lecture du graphe**, pas un contenant. | **Non — dérivée** de `depends_on` |
| **group** | La bande transverse colorée (ex. `scan` / `explore` / `synthesize`, ou `recon-passive` / `recon-active`). Une **catégorie** sémantique qui peut chevaucher plusieurs stages. | Oui |

Trois invariants qui découlent de ce vocabulaire :

1. **Une action = une unité.** Pas de coordination *à l'intérieur* d'une action.
   Si A doit précéder B, ce sont **deux actions** reliées par une arête, pas une
   action à deux étapes.
2. **L'ordre n'existe qu'entre actions**, via `depends_on`. C'est le seul mécanisme
   d'ordonnancement validé (anti-cycle), rendu, et qui pilote les stages.
3. **La stage n'est jamais déclarée.** Elle est recalculée à partir des arêtes à
   chaque génération. On ne l'écrit pas dans le YAML — voir plus bas pourquoi
   c'est voulu.

> ⚠️ **Note de transition.** Dans le YAML et le code *actuels*, le bloc-action
> s'appelle encore `phase` (clé `phases:`, identifiants `phase` un peu partout).
> **Lis « phase » comme « action ».** Les *stages* sont ce que le code appelle les
> « niveaux » / « lignes ». Le renommage vers `action` / `stage` est planifié mais
> pas encore appliqué — ce document fixe le vocabulaire cible.

## Les types d'action — qui exécute quoi

Le champ `type:` d'une action dit *qui* fait le travail et *comment* le résultat
revient. C'est le cœur du modèle.

| `type` | Qui l'exécute | Ce qui revient à l'orchestrateur |
|---|---|---|
| `agent` (défaut) | Le main agent lance un **sous-agent isolé** via le `Task` tool | Le **message final** du sous-agent (un résumé). Les vraies données sont sur disque. |
| `script` | Le main agent l'exécute **lui-même** via le `Bash` tool | La sortie du script (souvent écrite dans un fichier). Déterministe, sans LLM. |
| `main_agent` | Le main agent fait le travail **directement**, sans déléguer | Rien à rapatrier : il est déjà dans son propre contexte. |
| `workflow_call` | Le main agent **délègue à un autre workflow** via le `Skill` tool | Les artefacts de l'autre workflow, lus dans son arborescence habituelle. |
| `external` | Un outil **hors pipeline** (déclaratif) | Rien n'est exécuté par awok ; l'action déclare seulement les fichiers attendus. |

## Frontière d'action = frontière de contexte

C'est le point le plus contre-intuitif, et le plus important.

Quand une action de type `agent` est lancée, le sous-agent tourne dans un
**contexte totalement isolé**. Concrètement :

- Il ne voit **ni le `SKILL.md` ni le YAML**.
- Il reçoit seulement (a) son fichier `agents/<nom>.md` comme *system prompt*, et
  (b) le **prompt de tâche que l'orchestrateur lui écrit** au moment du dispatch.
- C'est pourquoi les `inputs`/`outputs` déclarés dans le YAML doivent **remonter
  dans le prompt** : les chemins de fichiers n'arrivent au sous-agent que par (b).

Et surtout : **ce qui remonte dans le contexte du main agent, c'est le message
final du sous-agent** — son « rapport » de retour, généralement un résumé court.
Ce n'est *pas* tout son travail, et ce ne sont *pas* les fichiers qu'il a produits.
Les fichiers restent sur disque.

## Le chaînage passe par les fichiers, jamais par le contexte

Le corollaire : **le contexte ne traverse jamais une frontière d'action.** Une
action n'hérite pas du contexte de l'action précédente.

Ce qui circule d'une action à l'autre, ce sont les **fichiers** — modélisés par le
système I/O `role` + `namespaces` (voir `bb-workflow.md`). L'action B ne lit pas le
contexte de l'action A ; elle lit le **fichier** que A a écrit (`work/.../x.md`).

| Frontière | Ce qui passe |
|---|---|
| main agent → sous-agent (au dispatch) | le prompt de tâche (qui *cite* les chemins d'I/O) |
| sous-agent → main agent (au retour) | le message final (résumé), **pas** les données |
| action → action | **toujours via fichiers sur disque** |

C'est tout l'intérêt du modèle I/O par rôle : il rend explicite ce contrat de
fichiers que le contexte, lui, ne transporte pas.

## La stage est une lecture du DAG, pas du temps

La stage d'une action est calculée comme le **plus long chemin de dépendances**
depuis une racine (`compute_levels` : `niveau = 1 + max(niveau des parents)`). Deux
actions sur la même stage ont donc deux propriétés, et **seulement** ces deux :

1. elles sont **mutuellement indépendantes** (aucune arête entre elles) ;
2. elles sont à la **même profondeur topologique**.

La stage **ne dit pas** « ces actions démarrent au même instant ». Exemple concret,
sur `onboard`, si l'on ajoute à `flow` une dépendance vers `git-stats` :

- `inventory` et `git-stats` sont des racines → stage 0.
- `structure` et `deps` dépendent de `inventory` → stage 1.
- `flow` dépend de `inventory` **et** `git-stats` → stage `1 + max(0, 0)` = **1
  aussi**, donc même stage que `structure`/`deps`.

Pourtant, au runtime, `structure` et `deps` sont prêts dès que `inventory` finit,
tandis que `flow` doit attendre *en plus* que `git-stats` finisse. Même stage,
instants de départ différents. La stage décrit la **forme du graphe**, pas le
**temps**. Le temps, ce sont les arêtes + ce que l'orchestrateur en fait.

C'est précisément pour ça que la stage reste **dérivée et jamais déclarée** : une
stage dérivée est toujours cohérente avec les arêtes par construction, et ne
promet jamais une simultanéité qu'elle ne peut pas tenir. La déclarer comme un
conteneur dans le YAML reviendrait soit à dupliquer `depends_on`, soit à *mentir*
sur la synchronie dès qu'une arête traverse les stages en biais.

## Garanti vs suggéré

| Élément | Statut | Effet réel |
|---|---|---|
| `depends_on` | **structurant** | pilote les stages, l'anti-cycle, la cartographie, l'ordre de rendu |
| stage / `parallel_with` (`∥`) | *hint* | « ces actions sont parallélisables » — l'orchestrateur décide |
| `background` (sur une invocation) | *hint* | rend un tag `(bg)` suggérant un lancement asynchrone |
| `depends_on_invocation` | **inerte** | ni validé ni rendu : il n'atteint jamais l'orchestrateur (à retirer) |

## Une action = une unité — pas de coordination intra-action

Comme une action n'a pas de runtime et que rien ne peut ordonner ou coordonner
plusieurs sous-tâches *en son sein*, la règle est : **une seule unité de travail
par action.**

- Besoin de parallélisme ? → plusieurs **actions** sur la même stage (même
  `depends_on`). Comportement identique à « plusieurs agents dans un bloc », mais
  chacune reste annotable (🧭 `opportunistic`, `triggers`) et adressable par une
  arête aval.
- Besoin d'un ordre A → B ? → **deux actions** + une arête. Jamais « deux étapes
  dans une action ».

(Le champ `depends_on_invocation` tente d'exprimer un ordre intra-action ; il est
inerte aujourd'hui et contredit cet invariant.)

## Le motif fan-out → reduce

Question récurrente : « j'ai deux répertoires de JS à analyser. Un agent par
répertoire en parallèle (rapide, mais chacun ignore le contexte de l'autre), ou
un seul agent qui fait les deux (lent, mais avec contexte croisé) ? »

Faux dilemme. Le vrai critère n'est pas le temps ni les tokens (qui s'équilibrent
largement : deux petits contextes vs un gros contexte qui ré-attend tout son
contenu à chaque token). Le vrai critère est le **couplage** : les deux unités
ont-elles besoin d'un contexte partagé pour être analysées *correctement* ?

Et le motif idiomatique d'awok dissout le dilemme — c'est exactement ce que fait
`onboard` (`structure`/`deps`/`flow` en parallèle → `architecture-writer` qui
réduit) :

1. **fan-out** : une action par répertoire, en parallèle (même stage), chacune
   écrit des **faits distillés** dans un fichier ;
2. **reduce** : une action en aval qui lit ces fichiers et fait l'**analyse
   croisée** — sur des faits compacts, pas sur le JS brut.

On obtient *les deux* : le parallélisme sur la lecture lourde, **et** le contexte
croisé dans le reduce — pour moins cher qu'un seul méga-agent.

## Opportunistic — une licence, pas un type d'action

L'autonomie opportuniste (voir `bb-workflow.md`) n'est **pas** un type d'action.
C'est une **licence** accordée au main agent de *fabriquer et lancer un sous-agent
ad hoc* (prompt écrit à la volée) quand il repère un signal que les actions
planifiées ne couvrent pas. Elle s'exerce **à la couture d'orchestration**, après
le retour d'une action — parce qu'un sous-agent ne peut pas lui-même spawner
(limite de nesting Claude Code = 1). C'est purement des instructions injectées
dans le `SKILL.md`, scopées par action (🧭 permis / ⛔ verrouillé).

## À retenir

- awok ne lance rien ; **l'orchestrateur Claude Code est l'exécuteur**.
- **action** = unité de travail ; **stage** = lecture dérivée de la profondeur du
  DAG ; **group** = catégorie transverse.
- Le **contexte ne franchit jamais** une frontière d'action ; **seuls les fichiers
  la franchissent**.
- L'**ordre n'existe qu'entre actions** (`depends_on`) ; la stage décrit la forme,
  pas le temps.
- Couplage fort → **fan-out → reduce**, pas le mono-agent par défaut.
