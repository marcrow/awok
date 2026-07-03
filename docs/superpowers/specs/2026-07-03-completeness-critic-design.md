# completeness-critic — Design

> **Statut** : design validé (brainstorming), en attente de relecture avant plan d'implémentation.
> **Date** : 2026-07-03
> **Scope** : un agent awok générique et réutilisable, posable après n'importe quel agent
> d'un **petit** workflow pentest/bug-bounty. **PAS** un hackbot end-to-end (voir §15).

---

## 1. Contexte & objectif

**Le problème.** En pentest/bug-bounty, les agents vont au plus vite et s'arrêtent au premier
obstacle : deux payloads XSS bloqués par un WAF → « pas exploitable » ; pas d'IDOR sur un
paramètre `id` → on passe à autre chose, sans avoir testé SQLi / injection de commande / SSTI ;
un test de rate-limiting mené sur trop peu de requêtes → conclusion non fondée. L'agent quitte
avant d'avoir épuisé l'exploration que la surface justifiait.

**L'objectif.** UN agent générique — `completeness-critic` — qu'on **dépose après n'importe quel
agent** d'un petit workflow pour juger si cet agent a fait son travail de façon **complète**
(toutes les classes d'attaque justifiées tentées, chaque blocage traité comme un checkpoint et non
un verdict, chaque méthode de caractérisation suffisante), puis renvoyer un **verdict compact** que
l'orchestrateur principal utilise pour décider s'il faut **reboucler l'agent précédent** — **sans
modifier le prompt de l'agent surveillé**, et **sans boucler inutilement** quand le travail est
réellement suffisant.

**Validation externe.** Joseph Thacker, *« We built a hackbot »* (2026-07-01) décrit un vrai
hackbot en production qui a convergé vers la même forme :
- **Rule 1 — logging** : *« les logs sont devenus plus précieux que les findings »* → notre
  **attempt-log** (juger ce qui a été *essayé*, pas seulement *trouvé*).
- **Rule 2 — Ralph loops** : *« s'arrêtait à la première explication plausible → maintenant creuse
  des heures »* → notre **boucle bornée** gate→re-dispatch.
- **Orchestrateur** jugeant la « richesse de la cible » pour persister ou lâcher → notre **gate**
  + le stop `diminishing-returns` (*« stopped giving up early on good targets AND stopped wasting
  tokens on bad ones »*).
- *« Pas besoin de modèles plus intelligents ; c'est la persistance et la structure qui comptent »*
  → le critic tourne en **sonnet**, pas opus ; la valeur est la structure, pas la puissance.

Ce design n'est donc pas spéculatif : une synthèse adversariale interne (4 designs indépendants,
12 critiques) **et** un hackbot réel pointent vers la même architecture.

---

## 2. Deux rôles jumeaux (positionnement)

L'article a **deux** agents distincts ; ce spec ne construit que le premier :

| Rôle | Sens | Ce spec ? |
|---|---|---|
| **completeness-critic** | anti-**faux-négatif** — « tu n'as pas assez creusé, réessaie » | **OUI** |
| **validateur** | anti-**faux-positif** — « ce bug est halluciné, prouve-le ou tue-le » | Non (futur) |

Les deux partagent le **même moteur** (gate + token + boucle) ; seule la doctrine s'inverse.
Construire le completeness-critic livre donc gratuitement le squelette du validateur plus tard.

---

## 3. Principe pivot — juger ce qui a été ESSAYÉ, pas ce qui a été TROUVÉ

Un rapport de findings ne liste que les **succès**. Juger la thoroughness à partir de cette
absence produit de **faux INSUFFICIENT** (l'agent a peut-être tout tenté sans rien trouver) et des
**boucles à vide**. C'est le mode d'échec que **toutes** les critiques adversariales ont confirmé
fatal, et exactement ce que Thacker corrige avec le logging.

**Solution retenue (Décision 1, option A) :** un **attempt-log** — journal append-only de chaque
**tentative ET abandon** (cible · classe · technique/famille · résultat/blocage) — que l'agent
surveillé écrit parce que **la description de sa phase** (pas son fichier `.md`) lui injecte
l'instruction au lancement.

**Règle de substrat (garde-fou anti-boucle) :** s'il n'y a **ni** attempt-log **ni** déclaration
d'arrêt explicite dans le draft → `INCONCLUSIVE STOP=no-substrate` — **jamais** `INSUFFICIENT` tiré
de l'absence. L'absence est l'état de base, pas un signal de lacune.

---

## 4. Les 4 couches de connaissance (Décision 2)

Le corps du critic ne porte **pas** un catalogue d'attaques (fragile, dérive, redondant avec le
modèle). Il porte une **posture**. La connaissance-domaine arrive par 4 couches :

| # | Couche | Contenu | Écrit où |
|---|---|---|---|
| 1 | **Corps du critic** | POSTURE + protocole de jugement + contrat de sortie (le « comment juger », universel) | Une fois, dans `completeness-critic.md` |
| 2 | **Modèle natif** | Le catalogue d'attaques (SQLi, cmdi, SSTI, IDOR, familles de bypass…) | Nulle part — Claude le connaît |
| 3 | **Fichier skill/référence** | Profondeur à la demande (guide SSTI dédié, tricks d'un vendor WAF, quirks d'un programme) | Input **optionnel** (`path:` override), seulement où une pose en a besoin |
| 4 | **Description d'invocation** | Réglage léger par pose (`stage`, `frame`, `cap`, « surveille aussi X ») | 2-3 lignes dans le YAML |

**Conséquence positive :** le corps étant pure posture (pas de taxonomie pentest en dur), le *même*
critic est réutilisable **hors pentest** — la connaissance-domaine venant des couches 2/3/4.

**Couche 3 — mécanisme confirmé sur le moteur** (`resolve_io_path` : *« explicit path always wins /
escape hatch »*) : un input `{ path: "refs/ssti.md", kind: md, optional: true, external: true }`
est rendu verbatim sous `- Reads :` dans le SKILL.md ; le sous-agent le lit. Précautions : chemin
**absolu ou relatif au workdir** (pas de `~`) ; `external: true` supprime le warning dataflow ;
`kind: dir` permet de fournir un skill multi-fichiers entier.

---

## 5. Architecture — le moteur

Deux phases **forward** par pose ; le DAG reste **acyclique** ; la boucle est de la **prose** dans
le gate (awok compile des instructions, Claude Code exécute la boucle) :

```
[phase surveillée]  --écrit-->  findings-draft.md  +  attempt-log.md
        |                              (log injecté au lancement par la description de phase)
        v
[completeness-critic] (type: agent)
   lit : attempt-log (primaire) + findings-draft + (opt) skill/référence + (opt) spec de l'agent
   écrit : gaps.md  +  ledger.jsonl  (compteur de passes file-backed)
   renvoie : UNE ligne (le token)
        |
        v
[gate] (type: main_agent) — PUR ROUTEUR
   lit UNIQUEMENT le token (ne rejuge jamais)
   - DIR=PROCEED / cap / illisible  -> avance à la phase suivante
   - DIR=RE-DISPATCH  -> relance l'AGENT SURVEILLÉ via Task, en lui passant le CHEMIN de gaps.md
                         + « logge tes nouvelles tentatives » ; puis re-lance le critic
   - DIR=RE-TEST-METHOD -> relance la phase méthode (script/collecteur) re-paramétrée ; puis re-critic
```

**Nesting = 1 respecté :** le critic ne relance jamais (il ne peut pas spawn) ; c'est le **main
agent (gate)** qui relance, à la couture d'orchestration.

**Feedback sans toucher l'agent surveillé :** la reboucle ré-injecte les gaps **au lancement**
(composition de prompt live par l'orchestrateur), pas par édition de fichier. Le seul endroit
touché est la **prose de la phase** (pour activer le log), jamais le `.md` de l'agent.

---

## 6. Le token de verdict (contrat de sortie)

La **seule** chose renvoyée à l'orchestrateur (économie de contexte : tout le détail va en fichier,
le brut de l'agent surveillé ne remonte jamais) :

```
COMPLETENESS <SUFFICIENT|INSUFFICIENT|INCONCLUSIVE> | DIR=<PROCEED|RE-DISPATCH|RE-TEST-METHOD>
 | BLOCKING=<n> | ATTEMPT=<i>/<cap> | STOP=<none|bar-met|diminishing-returns|cap|unsafe|no-substrate>
 | GAPS=<chemin> | <phrase ≤25 mots>
```

Mapping :
- `SUFFICIENT` ⇒ `DIR=PROCEED STOP=bar-met` — stop avec conviction.
- `INSUFFICIENT` ⇒ `DIR=RE-DISPATCH` — lacune de couverture : une classe **nommée, plausible au vu
  d'un sink, non tentée, dans le mandat**, qui a survécu à l'auto-réfutation.
- `INCONCLUSIVE` ⇒ `DIR=RE-TEST-METHOD` (le test était méthodologiquement incapable de trancher —
  re-tester **différemment**) **ou** `DIR=PROCEED STOP=unsafe|no-substrate|diminishing-returns|cap`
  quand continuer est dangereux / impossible / non rentable.

Le routeur n'ouvre **jamais** de fichier pour connaître une raison d'arrêt : elle est dans le token.

`STATUS`, `DIR` et `STOP` sont des **champs indépendants** : `STATUS` juge le travail, `DIR` route,
`STOP` est la raison terminale. Le mapping ci-dessus est le **défaut** ; un `STOP` terminal override
`DIR`. Donc un HUNT qui sort au cap ou en rendements décroissants avec des gaps ouverts **garde son
vrai `STATUS`** (`INSUFFICIENT`) tout en émettant `DIR=PROCEED` — le gate obéit à `DIR`, pas au
`STATUS`.

---

## 7. Artefacts fichiers

**`ledger.jsonl`** (append-only, une ligne par passe — **source unique du compteur** :
`pass = lignes_précédentes + 1`, survit à la compaction). Le critic n'a que `Write` (pas d'outil
d'append) : « append » = lire le ledger COMPLET puis le ré-écrire avec toutes les lignes précédentes
inchangées + la nouvelle en dernier. Tronquer le ledger réinitialiserait le compteur et pourrait
contourner le cap (l'unique borne dure) :

```json
{"pass":1,"watched_phase":"P2-XSS","status":"INSUFFICIENT","dir":"RE-DISPATCH","blocking_count":1,
 "gaps":[{"id":"g1","class":"waf-bypass","target":"param q","severity":"BLOCKING",
          "state":"IGNORED","action":"tenter familles encoding+case+HPP","first_pass":1}],
 "credited":["xss-reflected-basic"],"stop_reason":"none"}
```

**`gaps.md`** (réécrit à chaque passe ; sections titrées et adressables pour que la reboucle soit
une copie verbatim, pas une sélection) :
- `## OPEN GAPS TO RE-ATTEMPT` — chaque gap **nommé / classé / actionnable** (« double-URL-encode +
  case-mutation + HPP sur `q` », pas « fais plus de bypass »), avec l'auto-réfutation qu'il a passée.
- `## METHOD CORRECTION — RE-TEST DIFFERENTLY` — pour INCONCLUSIVE, avec un **plafond de sécurité**.
- `## CREDIT` — ce qui a été bien fait (jamais re-demandé).
- `## DROP` — rendements décroissants / risque accepté.
- `## RESIDUAL-AT-CAP` — ce qui reste ouvert quand le cap est atteint.

---

## 8. L'agent `completeness-critic` (frontmatter + corps)

**Fichier :** `src/agents/completeness-critic.md`

```yaml
---
name: completeness-critic
description: |
  Thoroughness critic for a pentest/bug-bounty pipeline. Dropped after ANY hunt or validation
  agent, it judges whether that agent did ITS job completely — every warranted attack class
  attempted, every defense block treated as a checkpoint not a verdict, every characterization
  method sufficient — and returns a compact routing token plus a gaps file. Use this agent to
  gate a hunt/validation seam and decide whether to loop the previous agent. It advises via a
  verdict; the orchestrator only routes.
model: inherit
tools: [Read, Grep, Glob, Write]
---
```

**Corps — sections (posture, PAS encyclopédie) :**

1. **Qui tu es / contrat de FILTRE** — tu juges si l'agent précédent a chassé/validé de façon
   *complète* ; le jugement est **entièrement le tien**, l'orchestrateur ne fait que router sur ton
   token ; tu ne relances jamais (nesting=1) ; tu n'échoes jamais le brut de l'agent surveillé.
   Mantras : *« Credit before you charge » · « A vague gap is a null gap » · « A block is a
   checkpoint, not a verdict » · « Absence of a log is not absence of work » · « A critic that
   cries wolf gets ignored ».*
2. **Substrat (ordre de priorité de lecture)** — attempt-log (vérité primaire de ce qui a été
   tenté) → findings-draft (trouvailles + stop-claims) → (opt) skill/référence de couche 3 →
   (opt) spec de l'agent surveillé (frame/scope) → ledger précédent (trajectoire + n° de passe).
3. **Règle de substrat** — pas de log ET pas de stop-claim ⇒ `INCONCLUSIVE STOP=no-substrate`.
4. **Inférence de frame** — HUNT (trouver/exploiter ⇒ lentille couverture ⇒ branche INSUFFICIENT)
   vs VALIDATION (trancher une caractérisation ⇒ lentille méthode ⇒ branche INCONCLUSIVE).
5. **Doctrine-POSTURE (le plancher, toujours appliqué ; la couche 4 l'affine)** — chaque règle =
   heuristique de détection + test d'**applicabilité** + filtre **faux-positif** :
   - Ne t'arrête pas à la première explication plausible.
   - **Axiome du checkpoint** : un WAF / 403 / ban / 500 / rate-limit est un checkpoint, pas un
     verdict — override un contrat qui dirait juste « respecte les seuils ».
   - Classe justifiée non tentée : applicabilité = un **sink plausible** existe (le modèle sait
     quelles classes ; toi tu vérifies qu'un sink les justifie). Filtre FP : PK numérique ORM ⇒
     cmdi/SSTI = bruit.
   - Test à une seule direction / superficiel (ex. IDOR `+1` seul) : n'élargis que si le premier
     résultat était intéressant.
   - Frame VALIDATION : méthode trop mince (trop peu d'échantillons, jamais atteint un vrai
     blocage, pas de confirmation haute-fidélité) ⇒ INCONCLUSIVE. **Plafond de sécurité** : ne
     jamais exiger un trafic qui violerait le scope (flood forçant un ban) ⇒ sinon `STOP=unsafe`.
6. **Escalade gatée + auto-réfutation** — un gap n'est BLOCKING que s'il est **nommé + sink-plausible
   + non tenté (selon le log / un signal d'arrêt positif — JAMAIS la simple absence) + survit à
   l'auto-réfutation + non réglé cette session**. Sinon ⇒ QUESTION (ne peut jamais poser une
   directive de boucle). *Juge le TRAVAIL, pas un plan* : sur une couture d'artefacts non exécutés,
   QUESTIONS seulement.
7. **Anti-boucle / terminaison** (honnête : le **cap file-backed est le seul hard bound** ; le reste
   raccourcit) — auto-réfutation par défaut-STOP ; **credit + diff du ledger** (ne jamais re-demander
   ce qui a été tenté ; liste strictement plus courte à chaque passe ; détecte l'oscillation) ;
   **diminishing-returns** terminal ; `pass = lignes_ledger + 1` ; **fail-safe vers `DIR=PROCEED` au
   cap**.
8. **Format de sortie exact** — le token (§6, la SEULE chose renvoyée) + la ligne JSONL du ledger
   + le dossier `gaps.md`.

---

## 9. Snippet d'invocation

**Fichier :** `src/workflow/templates/invocations/completeness-critic.md`

```markdown
---
agent: completeness-critic
generated: false
---

**completeness-critic** [sonnet] · Juge si l'agent précédent a chassé/validé de façon COMPLÈTE ; renvoie un token de routage, écrit un dossier de gaps + un ledger append-only.
{{ inputs_outputs_compact }}

**Task** : {{ description }}
```

Le `{{ description }}` transforme le `description:` par-invocation en Task text (couche 4). Le
`{{ inputs_outputs_compact }}` rend les chemins résolus (log/spec/skill/gaps/ledger) pour que le
sous-agent sache où lire/écrire. **Confirmé sur le moteur** : `render_snippet` étale le dict
d'invocation dans le contexte Jinja (`**invocation`, `bb-workflow:1032`), donc `{{ description }}`
résout le champ `description:` par-invocation.

---

## 10. La phase gate (`type: main_agent`)

Sa `description` est rendue **verbatim** comme protocole de routage runtime de l'orchestrateur :

> ROUTAGE PUR — ne rouvre PAS et ne rejuge PAS la chasse ; le critic l'a déjà fait. Lis
> UNIQUEMENT le token une-ligne du critic. Route sur `DIR` + `ATTEMPT` (le critic possède le cap
> via son ledger) :
> - `DIR=PROCEED` → phase suivante ; si `STOP=cap|diminishing-returns|unsafe`, note d'abord le
>   chemin des gaps résiduels comme risque accepté.
> - `DIR=RE-DISPATCH` et `ATTEMPT<cap` → relance l'agent surveillé via Task avec l'addendum : « traite
>   les gaps qui te concernent dans `<gaps>` (lis-le) ; logge chaque nouvelle tentative/abandon dans
>   `<attempt-log>` ; puis re-reporte. » N'édite aucun fichier d'agent ; ne colle PAS les gaps dans
>   ton contexte — passe le CHEMIN. Puis relance le critic.
> - `DIR=RE-TEST-METHOD` et `ATTEMPT<cap` → relance la phase méthode nommée dans
>   `## METHOD CORRECTION` (script/collecteur re-paramétré — mécanisme DISTINCT de l'injection Task) ;
>   jamais de trafic hors scope. Puis relance le critic.
> - Si `DIR` dit boucler mais `ATTEMPT ≥ cap` → traite comme PROCEED. Si token illisible → PROCEED.
> Tu ne tiens AUCUN compteur ; le ledger est l'unique source de vérité.

---

## 11. Croquis YAML — petit workflow (chasse XSS→SSTI sur un endpoint)

Workflow neuf ⇒ `namespaces:` propre (les path-overrides ne sont nécessaires que pour rétrofit sur
un workflow legacy sans namespaces).

```yaml
namespaces: { work: work/xss-hunt }

phases:
  # ── PHASE SURVEILLÉE — fichier d'agent INCHANGÉ ; une ligne ajoutée à la PROSE de la phase
  #    active le log (Décision 1, option A) :
  - id: P2-HUNT
    name: Chasse XSS/SSTI sur l'endpoint
    group: hunt
    type: agent
    depends_on: [P1-RECON]
    description: >
      Au LANCEMENT de l'agent, ajoute à sa tâche : « Logge CHAQUE tentative ET abandon
      (cible · classe · technique/famille · payload · résultat/blocage) dans
      work/xss-hunt/attempt-log.md — append-only, ne jamais écraser. »
    invocations:
      - agent: js-opportunist          # (ou l'agent de chasse du petit workflow)
        model: opus
        description: Chasse XSS/SSTI sur l'endpoint ; écris les drafts dans work/xss-hunt/.
        outputs:
          - { role: work:findings-draft, kind: md }

  # ── LE CRITIC — agent générique, ne nomme aucun agent surveillé ──
  - id: P2C-COMPLETE
    name: Critic de complétude — chasse
    group: hunt
    type: agent
    depends_on: [P2-HUNT]
    invocations:
      - agent: completeness-critic
        model: sonnet
        effort: high
        description: >
          stage=xss-ssti · frame=hunt · cap=3.
          Substrat = work/xss-hunt/attempt-log.md + findings-draft ; si le log est absent ET le
          draft ne porte aucune stop-claim, renvoie INCONCLUSIVE STOP=no-substrate (relancer AVEC
          log) — jamais INSUFFICIENT de l'absence. Un guide SSTI est fourni en input `ssti-hunting` :
          lis-le et exige ses techniques si un paramètre est réfléchi. Un 403/WAF sur un sink
          réfléchi ⇒ une FAMILLE de bypass avant « pas exploitable ». Escalade INSUFFICIENT seulement
          sur un gap nommé, sink-plausible, non tenté, qui survit à l'auto-réfutation ; les intuitions
          ⇒ QUESTIONS. Crédite les familles déjà tentées d'après le log. Lis ton ledger précédent à
          work/xss-hunt/ledger.jsonl (pass = lignes + 1 ; fail-safe PROCEED au cap).
        inputs:
          - { role: work:findings-draft, kind: md }
          - { role: work:attempt-log, kind: md, optional: true }
          - { path: "refs/ssti-hunting.md", kind: md, optional: true, external: true }   # couche 3
        outputs:
          - { role: work:gaps, kind: md, terminal: true }
          - { role: work:ledger, kind: jsonl, terminal: true }

  # ── LE GATE — main_agent ; exécute la boucle en prose (voir §10) ──
  - id: P2G-GATE
    name: Router sur le verdict de complétude
    group: hunt
    type: main_agent
    depends_on: [P2C-COMPLETE]
    description: >
      (protocole de routage du §10 — pur routeur, relance P2-HUNT avec le chemin de gaps + « logge
      tes tentatives » sur RE-DISPATCH<cap, sinon avance)
```

Note : `attempt-log` est déclaré `optional` (pas de producteur formel — il naît de l'injection au
lancement) ; `gaps`/`ledger` sont `terminal` (leurs vrais consommateurs — l'agent relancé et le
gate — sont atteints par injection runtime, pas par une arête déclarée).

---

## 12. Décisions retenues

| # | Décision | Choix | Défaut/à confirmer |
|---|---|---|---|
| 1 | **Substrat** (voir ce que l'agent a essayé) | **Log injecté au lancement** (option A) + escalade sur signal positif comme plancher + passe d'instrumentation comme fallback | ✅ choisi |
| 2 | **Doctrine** (où vit la connaissance) | **Posture dans le corps** + modèle natif + skill-input optionnel + description (4 couches) | ✅ choisi |
| 3 | **Cible de reboucle** | **L'agent surveillé lui-même** (petit workflow, pas de spécialistes) | défaut petit-workflow |
| 4 | **Cap** | **Plat, file-backed** (défaut 3) + `diminishing-returns` terminal | défaut petit-workflow |

---

## 13. Risques ouverts

- **Prose-only, pas de runtime** : cap, branche DIR, frontière FILTRE et « router sans rejuger »
  sont des instructions dans le SKILL.md. Un orchestrateur qui dérive peut rejuger ou mal compter.
  Atténué (cap file-backed + fail-safe-PROCEED + « token illisible ⇒ PROCEED »), pas éliminé.
- **Dépend de l'agent qui honore le log** : un agent avare sous-logue ⇒ fausse absence ⇒ boucle
  d'instrumentation inutile. Le critic biaise vers STOP/INCONCLUSIVE (jamais INSUFFICIENT) sur log
  manquant, pour ne pas re-demander du travail fait.
- **Skill-input (couche 3)** : chemin verbatim (pas de `~`) ; le lire à chaque passe coûte des
  tokens → ne l'attacher qu'aux poses qui en ont besoin.
- **Posture générique** : le recall « quelles classes sont justifiées » dépend du modèle natif — ce
  qui est acceptable et préférable à une taxonomie en dur qui périme.
- **Spec de l'agent surveillé** (si fournie) : chemin absolu machine-spécifique ; un mauvais chemin
  droppe silencieusement le leg (optional-absent). Le corps doit consigner « mandat non trouvé —
  jugé sur posture + description seules » dans le ledger pour rendre la dégradation visible.

---

## 14. Hors scope (déféré — c'était la version « gros pipeline »)

- Corroboration `candidates.db` (polarité fragile, périme dans la boucle).
- Routage vers spécialistes / owner-map (utile seulement quand le workflow a des spécialistes).
- Split-caps (coverage vs method) + new-gap budget.
- Spec-mirror complet (lire le contrat de l'agent surveillé comme barre de complétude).
- Le **validateur** jumeau (anti-faux-positif) — même moteur, doctrine inversée.

Ces éléments deviennent pertinents si/quand un petit workflow grossit vers un pipeline complet.

---

## 15. Prochaines étapes

1. Écrire `src/agents/completeness-critic.md` (§8) + le snippet (§9).
2. Choisir **un petit workflow cible réel** pour le poser et le tester (un des cas : détection
   rate-limit/WAF, ou une chasse XSS/SSTI ciblée).
3. Câbler les phases critic + gate via `/edit-workflow` (si le workflow existe) ou `/create-workflow`
   (s'il est neuf), puis `awok validate && awok generate && ./install.sh`.
4. Tester la boucle sur un cas réel : vérifier qu'un early-stop est bien rattrapé ET qu'un travail
   suffisant ne déclenche pas de boucle.
