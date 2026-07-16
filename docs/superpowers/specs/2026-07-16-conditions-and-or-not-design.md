# Conditions booléennes composées — `and` / `or` / `not` pour les blocs logiques

**Date** : 2026-07-16
**Statut** : design validé, prêt pour le plan d'implémentation
**Réfs visuelles** :
- Prototype (source de vérité du visuel/interactions) : `2026-07-16-conditions-and-or-not-refs/condition-builder-prototype.dc.html`
- Mini-spec visuelle : `2026-07-16-conditions-and-or-not-refs/visual-mini-spec.md`
**Design parent** : `2026-07-13-portes-logiques-orchestration-design.md` (portes logiques / orchestration)

## 1. Problème

Une condition d'orchestration (`if` / `while` / `until`) est aujourd'hui **plate** :
un unique triplet `{op, left, right}` (ou une chaîne escape-hatch). On ne peut pas
exprimer « A **et** B », « A **ou** B », ni « **non** A ». On a livré les portes logiques
avec les seuls opérateurs de comparaison (`==`, `<`, `contains`…) et **oublié les
connecteurs booléens**. Ce design les ajoute : `and`, `or`, `not`, avec imbrication.

Cible d'expressivité (exemple canonique) :

```
(A and B) or not(C and D)
```

## 2. Décisions de conception (fixées en brainstorming)

1. **Arbre récursif**, pas de liste plate. Une condition est soit une **feuille**
   (`{op,left,right}` ou string escape-hatch), soit un **groupe** (`{and:[…]}` /
   `{or:[…]}`), soit une **négation** (`{not: …}`).
2. **Moteur permissif, sans limite de profondeur.** La validation, le rendu SKILL.md et
   la cartographie sont purement récursifs et acceptent n'importe quelle profondeur
   d'imbrication. Écrire un plafond de profondeur serait du code *en plus*, pas en moins.
3. **Le plafond « 2 niveaux » vit uniquement dans l'éditeur** : le constructeur limite
   l'ajout de sous-groupe à 2 niveaux (ajustable). Une condition écrite à la main plus
   profonde reste valide et s'affiche (fallback lecture, jamais de corruption).
4. **`not` posable partout** : sur une feuille, sur un groupe, et **sur la racine**
   (`not(A or B)`).
5. **Le choix des signaux ne change pas** : l'opérande signal reste le `<select>` des
   signaux déclarés (mécanisme select-only avec identification de l'émetteur déjà en place,
   cf. `2026-07-14-signals-declaration-on-action-design.md`). On n'ajoute QUE la
   composition des feuilles par connecteurs.
6. **Pas de travail runtime.** Le compilateur JS n'existe pas encore (TODO B1 différé) ;
   marquer les connecteurs `js_safe: true` suffit pour quand il arrivera.

## 3. Modèle de données sur disque (forme canonique awok)

L'éditeur prototypé utilise une représentation interne (`t:'grp'/'cmp'`, `bool`, flag
`neg`, `kids`, opérandes `{k,v}` — voir la mini-spec §2). **Sur disque, awok ne persiste
pas cette forme** : il garde la forme canonique récursive, et l'éditeur travaille
directement dessus (pas de couche de conversion, comme le code des gates actuel).

| Concept | Forme sur disque |
|---|---|
| feuille comparaison | `{ op, left, right }` (inchangé ; `op: exists` → pas de `right`) |
| feuille built-in | `{ op: exists, left: { file_exists: "<arg>" } }` |
| feuille escape-hatch | chaîne libre (inchangé, standard-only) |
| groupe ET | `{ and: [ <cond>, <cond>, … ] }` |
| groupe OU | `{ or: [ <cond>, <cond>, … ] }` |
| négation | `{ not: <cond> }` |

Exemple `(A and B) or not(C and D)` :

```yaml
if:
  or:
    - and:
        - { op: "==", left: recon.waf, right: "true" }
        - { op: ">",  left: scan.risk, right: "7" }
    - not:
        and:
          - { op: "==", left: scan.status, right: open }
          - { op: exists, left: { file_exists: "/etc/passwd" } }
  then: [ … ]
```

**Correspondance éditeur ↔ disque** :
- le flag `neg:true` d'un nœud ⇒ enveloppe `{ not: <ce nœud> }` (point de récursion unique) ;
- `neg` sur la racine ⇒ la racine devient `{ not: <groupe> }` ;
- opérande `{k:'signal',v}` ⇒ la chaîne `v` (clé de signal choisie dans le select) ;
- opérande `{k:'literal',v}` ⇒ la chaîne `v` ;
- opérande `{k:'builtin',fn,arg}` ⇒ l'objet une-clé `{ <fn>: <arg> }` + `op: exists`.

Signal vs littéral se distinguent (comme aujourd'hui) par l'appartenance de la chaîne aux
clés de signaux connues ; on conserve la convention et l'ambiguïté existantes (un littéral
égal à une clé de signal) — hors périmètre de ce design.

## 4. Moteur (Python `src/scripts/bb-workflow` + schéma)

### 4.1 Capabilities — `src/workflow/orchestration-capabilities.yaml`

Nouvelle section `connectors` (distincte de `operators` : les connecteurs ne prennent ni
`left`/`right` ni `types`, mais des sous-conditions) :

```yaml
connectors:
  and: { js_safe: true, standard: true }
  or:  { js_safe: true, standard: true }
  not: { js_safe: true, standard: true }
```

`load_capabilities` expose déjà tout le fichier ; aucune autre matrice n'est codée en dur.

### 4.2 Schéma — `src/workflow/orchestration.schema.json`

`condition` devient un `oneOf` **récursif** (draft-07, `$ref` sur lui-même) :

```json
"condition": {
  "oneOf": [
    { "type": "string" },
    { "type": "object", "required": ["op", "left"],
      "properties": { "op": { "enum": ["==","!=","<",">","<=",">=","contains","matches","exists"] },
                      "left": {}, "right": {} } },
    { "type": "object", "required": ["and"],
      "properties": { "and": { "type": "array", "items": { "$ref": "#/definitions/condition" } } } },
    { "type": "object", "required": ["or"],
      "properties": { "or":  { "type": "array", "items": { "$ref": "#/definitions/condition" } } } },
    { "type": "object", "required": ["not"],
      "properties": { "not": { "$ref": "#/definitions/condition" } } }
  ]
}
```

### 4.3 Validation — `_validate_condition` (récursif)

Le dispatch en tête de fonction :
- chaîne ⇒ escape-hatch (inchangé : standard-only si target js) ;
- dict contenant `and`/`or`/`not` ⇒ **connecteur** :
  - lit `caps["connectors"][k]` ; si target js et non js_safe ⇒ erreur (aujourd'hui aucun
    connecteur n'est standard-only, mais le contrôle reste, cohérent avec la doctrine
    « single source of truth ») ;
  - `not` ⇒ récurse sur l'unique sous-condition ; **exactement 1** cible (erreur si liste) ;
  - `and`/`or` ⇒ récurse sur chaque membre ; **avertissement non-bloquant** si moins de
    2 membres (état transitoire pendant l'édition) ;
- sinon ⇒ chemin **feuille** existant (`op`/`left`/`right`, checks signal/type inchangés),
  **plus** les nouveaux contrôles de complétude (§4.5).

Les contrôles existants (signal inconnu, opérande numérique) se propagent gratuitement par
la récursion.

### 4.4 Rendu — `_render_condition` (récursif)

Produit le texte lisible du SKILL.md, avec parenthésage :
- feuille : `` `left` op `right` `` (inchangé) ; built-in : rendu comme prédicat autonome
  `file_exists("<arg>")` — petit ajustement de la branche `op == exists` pour un opérande
  gauche built-in (aujourd'hui elle rendrait `` `file_exists(<arg>)` exists ``, mot-clé
  redondant) ;
- `and` : membres joints par ` and `, un membre qui est lui-même un groupe/négation est
  parenthésé ;
- `or` : idem avec ` or ` ;
- `not` : `not (<inner>)`.

Exemple rendu :
`` (`recon.waf` == `true` and `scan.risk` > `7`) or not (`scan.status` == `open` and file_exists("/etc/passwd")) ``

`build_orchestration_overlay` (labels des losanges/branches de la cartographie) réutilise
`_render_condition` → **hérite gratuitement** du rendu composite.

### 4.5 Règles de validation (erreurs vs avertissements)

**Erreurs bloquantes** (mini-spec §7) :
- feuille comparaison incomplète : opérande gauche ou droite manquant/vide quand `op ≠ exists` ;
- feuille built-in sans argument.

**Avertissement non-bloquant** :
- groupe `and`/`or` à moins de 2 membres.

## 5. Éditeur web — `src/workflow/templates/webedit/orchestration.js`

On **porte le look & les interactions** du prototype (mini-spec) sur la forme awok
récursive, exactement comme le code des gates l'a fait pour le proto d'origine (« vanilla
DOM + ENGINE block shape »).

### 5.1 Deux vues, une expression

- **Vue grille** (`condEl`/`readNode`) : vignette lecture seule dans l'en-tête du gate `IF`
  — groupes en parenthèses translucides teintées par le connecteur, pastilles connecteur
  entre membres, badge NOT ; retour à la ligne auto ; profondeur 0 sans parenthèses
  externes, MAIS badge NOT racine rendu si la racine est négée.
- **Vue volet** (`build`) : constructeur inline au clic sur le bloc (pas de bouton
  « éditer ») — connecteurs pastilles cliquables (bascule AND/OR du groupe), badges NOT
  toggleables (feuille, groupe, racine), `＋` ajoute une comparaison, `()` ajoute un
  sous-groupe **borné à `depth < 2`**, `✕` supprime.

### 5.2 Sélecteur d'opérande micro-segmenté

`◈ signal` / `"" littéral` / `ƒ built-in`, icônes toujours visibles + tooltips + panneau
d'aide (mini-spec §3). Encodage awok :
- **◈ signal** ⇒ `<select>` des signaux déclarés (mécanisme select-only inchangé) ;
- **"" littéral** ⇒ champ texte libre ;
- **ƒ built-in** ⇒ select fonction (`file_exists`/`dir_exists`) + champ argument ; gauche
  uniquement ; masque op + opérande droite ; encodé `{op: exists, left: {fn: arg}}`.
- opérande **droite** : signal ou littéral seulement.

### 5.3 Helpers de mutation d'arbre

Nouveaux helpers purs (miroir du prototype, mais opérant sur le dict awok et via le
plumbing d'état existant de l'éditeur), unitairement testables dans `editlogic.js` :
`toggleConnector` (and↔or d'un groupe), `toggleNot` (enveloppe/désenveloppe `{not:}`),
`addComparison`, `addGroup` (capé à depth<2), `removeNode`, `setLeafOp`, `setOperand`,
`setOperandKind`.

### 5.4 Placement du gate — récursion des signaux **(à ne pas oublier)**

`condSignalPhases` (aujourd'hui lit `[c.left, c.right]` d'une feuille pour placer la gate au
niveau du producteur de signal) doit **récurser tout l'arbre** et collecter les opérandes
signal de **toutes** les feuilles. Sinon une gate à condition composite se place au mauvais
niveau. Fonction pure ⇒ testable dans `editlogic.js`.

### 5.5 Escape-hatch

`toggleEscape` continue de basculer la condition **racine** entière entre une chaîne libre
et une feuille par défaut (le moteur tolère une chaîne escape-hatch n'importe où par
récursion, mais l'éditeur n'expose l'escape-hatch qu'au niveau racine — inchangé).

## 6. Tests

**Python** :
- `test_workflow_capabilities.py` : présence des connecteurs, tous js_safe/standard.
- `test_workflow_orchestration.py` :
  - validate accepte `and`/`or`/`not` imbriqués valides ;
  - erreur sur feuille incomplète (opérande manquant) et built-in sans argument ;
  - avertissement (non-bloquant) sur groupe < 2 membres ;
  - target js : accepte and/or/not, rejette une escape-hatch **incluse dans un groupe** ;
  - snapshot de `_render_condition` sur l'exemple canonique (parenthésage + `not`) ;
  - overlay : le label de branche porte l'expression composite.
- Fixture : étendre `src/scripts/tests/fixtures/workflows/orchestrated.orchestration.yaml`
  avec un cas `and`/`or`/`not` (et son pendant `.yaml` si un signal manque).

**JS** (`editlogic.js`, copie testée) : collecte récursive des signaux d'une condition,
et les helpers de mutation d'arbre (toggle connector/not, add/remove, cap depth<2).

## 7. Docs & ripple

- Docs à synchroniser : `2026-07-13-portes-logiques-orchestration-design.md` (renvoi vers
  ce design), `docs/dev/bb-workflow.md` (vocabulaire de condition), section
  « Orchestration (portes logiques) » de `CLAUDE.md`, en-tête de
  `orchestration-capabilities.yaml`.
- **Ripple engine/template** : `_render_condition` change ⇒ `awok generate` (tous les
  workflows + index), committer les artefacts régénérés, `awok check` vert, `./install.sh`,
  trailer `Regen:` dans le commit. Les workflows existants n'utilisant pas de composite,
  leur `SKILL.md` ne bouge pas (diff vide, pas de churn).
- Test de régression sur la sortie générée (positif + négatif), comme la garde
  model-imperative.

## 8. Hors périmètre

- **Compilateur/interpréteur JS** (`target: js`) — n'existe pas encore (TODO B1). On se
  contente de marquer les connecteurs `js_safe: true` pour l'avenir.
- **Désambiguïsation signal/littéral** d'un opérande chaîne — inchangée (convention et
  ambiguïté existantes conservées).
- **Refonte du choix des signaux** — explicitement exclue ; on garde le mécanisme actuel.

## 9. Découpage d'implémentation (indicatif)

1. **Moteur** (bien borné) : capabilities + schéma + `_validate_condition` récursif +
   `_render_condition` récursif + contrôles de complétude + tests Python + fixture. À l'issue,
   on peut écrire des conditions composées **à la main en YAML**, valider, générer, voir le
   rendu correct dans SKILL.md et la cartographie.
2. **Éditeur** (centre de coût/risque) : port du prototype sur la forme awok — deux vues
   récursives, sélecteur d'opérande, connecteurs, NOT (racine comprise), cap depth<2,
   récursion du placement de gate + tests JS.
3. **Docs & ripple** : synchro docs, régénération, redéploiement, trailer.
