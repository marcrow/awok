# Typed signal payloads — `values` (enum) et `of` (list)

**Date** : 2026-07-16
**Statut** : validé (brainstorm Marc-Antoine + Claude)
**Contexte amont** : socle commun pré-dynamic (TODO § S, rattaché à S4) ; design des portes
logiques (`2026-07-13-portes-logiques-orchestration-design.md`) ; signaux sur action
(`2026-07-14-signals-declaration-on-action-design.md`).

## 1. Problème

Deux trous dans le typage des signaux `emits` :

- **`type: enum` ne déclare pas son vocabulaire.** L'instruction d'émission injectée au
  generate rend `SIGNALS name=<one of the allowed values>` sans jamais lister les valeurs
  (l'émetteur invente) ; une condition `sig == "faled"` (typo) passe `validate` et fait
  dérailler la gate silencieusement en standard — et deviendrait un bug déterministe en
  cible JS.
- **`type: list` ne déclare pas le type de ses éléments.** La couture émetteur → body du
  `for_each` est aveugle (le body reçoit la variable `as` sans contrat) ; `contains` est
  invérifiable ; et la future dérivation JSON Schema (S4) ne pourrait produire que
  `{type: array}` sans `items` — alors que le `for_each` de largeur runtime est le cas
  d'usage vedette de la cible dynamique.

Contraintes posées : ne pas rendre la web UI impénétrable, ouvrir la porte aux dynamic
workflows, charge minimale pour les workflows standard. Rappel de mécanique : en standard,
les signaux émis par un subagent lui sont donnés **en instruction lors du call** (via
`render_signal_emission` / `_attach_signal_emissions`) — tout vocabulaire déclaré paie donc
immédiatement dans le prompt.

## 2. Décisions de cadrage (avec alternatives rejetées)

1. **Portée du typage d'élément : scalaires + objets plats, un seul niveau.**
   `of:` = mot-clé scalaire (`string|number|bool|enum`) OU map plate `champ → spec scalaire`.
   Pas de nesting (ni liste ni objet dans un champ).
   - *Rejeté — scalaires seuls* : un item multi-facettes (path + severity) force deux listes
     parallèles corrélées par l'index, implicite et fragile.
   - *Rejeté — échappatoire JSON Schema libre* : invérifiable côté standard, inéditable en
     web UI, contraire au « YAML structuré, pas de DSL ».
   - Garde-fou (doc, et flag doctor plus tard) : signaux = plan de contrôle, fichiers = plan
     de données. Une liste d'objets qui grossit au-delà de quelques champs est de la donnée :
     faire circuler une référence (chemin) à la place.

2. **Strictness : enum strict, list gradué.**
   - `values` **toujours requis** quand `type: enum` (erreur bloquante) — un enum sans
     vocabulaire est exactement le bug à tuer, le coût est une ligne.
   - `of` **optionnel en standard** (défaut documenté : `string`, warning doux) ;
     **requis en cible js** (le warning devient erreur, via la frontière js-safe existante).

3. **Déclaration inline sur chaque `emits`** (pas de section `types:` partagée).
   Zéro indirection, la Wiring UI édite déjà ces lignes. Un vocabulaire dupliqué entre
   actions homonymes est toléré, surveillé par un warning « vocabulaires divergents ».
   Une section partagée pourra s'ajouter plus tard sans casser l'inline.

## 3. Schéma YAML

Deux champs optionnels s'ajoutent à l'item d'`emits` (`workflow.schema.json`) :

```yaml
emits:
  # enum : vocabulaire obligatoire
  - { name: status, type: enum, source: token, values: [ok, degraded, failed] }

  # list de scalaires
  - { name: findings, type: list, source: field, from: report.findings, of: string }

  # list d'enums : values sur l'emit = vocabulaire des éléments
  - { name: verdicts, type: list, source: field, from: report.verdicts, of: enum,
      values: [confirmed, refuted] }

  # list d'objets plats : champs scalaires uniquement, un seul niveau
  - name: findings
    type: list
    source: field
    from: report.findings
    of:
      path: string
      severity: { enum: [low, high, critical] }
```

Règles de forme :

- `values` : liste de strings **uniques**, **non vide**. Portée : vocabulaire du signal si
  `type: enum` ; vocabulaire des éléments si `type: list` + `of: enum`.
- `of` : mot-clé scalaire `string|number|bool|enum`, ou map plate `champ → spec` où
  spec = mot-clé scalaire ou `{enum: [...]}` (liste de strings uniques non vide).
  **Tous les champs déclarés d'un item objet sont requis** (pas de champ optionnel en v1 —
  c'est ce que le mapping JSON Schema du §6 traduit en `required: [tous les champs]`).
- Interdits : nesting dans `of` (liste/objet dans un champ) ; `values` sur un type qui n'en
  prend pas ; `of` sur un type ≠ list.

## 4. Validation (`awok validate`)

**Erreurs bloquantes :**

- `type: enum` sans `values`.
- `values` présent sur un type qui n'en prend pas ; doublons ou liste vide.
- `of` malformé : nesting, mot-clé de type inconnu, spec de champ invalide.
- `of: enum` (scalaire ou champ d'objet) sans son vocabulaire.
- Condition : literal comparé (`==`, `!=`, `contains`…) à un signal enum **hors de son
  vocabulaire** (extension de `_validate_condition` ; les literals des deux côtés). Couvre
  aussi `contains` sur une list `of: enum` : le literal doit appartenir aux `values` des
  éléments.
- Condition : opérateur autre que `exists` sur une list d'objets — une condition ne sait pas
  plonger dans les champs d'un item.

**Warnings :**

- `type: list` sans `of` → « assumed `of: string` » (défaut documenté).
- Deux actions émettant un signal **homonyme** avec des vocabulaires/`of` divergents.

**Cible js** (au branchement de `validate --target js`) : `of` explicite requis — le warning
« of absent » devient une erreur. S'ajoute à la frontière js-safe déclarée dans
`orchestration-capabilities.yaml` sans nouvelle matrice codée en dur.

## 5. Rendu standard (`generate`)

- **Émetteur** (`_value_spec`, `render_signal_emission`) :
  - enum → `SIGNALS status=<ok|degraded|failed>` (fini le `<one of the allowed values>`) ;
  - list → « le champ `findings` est un json array de strings » / « … un json array
    d'objets `{path: string, severity: low|high|critical}` » ;
  - `source: field` : la phrase « votre output json `<role>` DOIT contenir un champ … »
    s'enrichit du même contrat.
- **Consommateur** (nouveau) : le rendu d'un bloc `for_each` injecte la forme de l'item dans
  l'instruction du body — « chaque `finding` est un objet `{path, severity∈low|high|critical}` »
  — la couture émetteur→body cesse d'être aveugle. Idem pour le contexte de signaux que
  l'orchestrateur porte le long du skill (le vocabulaire apparaît là où le signal est évalué).

## 6. Porte ouverte dynamic workflows (mapping S4 — PAS construit ici)

Le design fige la dérivation `emits` → JSON Schema que B1/S4 consommeront telle quelle :

| Déclaration YAML | Fragment JSON Schema (`schema` d'`agent()`) |
|---|---|
| `type: enum, values: [a, b]` | `{ "enum": ["a", "b"] }` |
| `type: list, of: string` | `{ "type": "array", "items": { "type": "string" } }` |
| `type: list, of: enum, values: [a, b]` | `{ "type": "array", "items": { "enum": ["a", "b"] } }` |
| `of: {path: string, severity: {enum: [...]}}` | `{ "type": "array", "items": { "type": "object", "properties": { "path": {"type": "string"}, "severity": {"enum": [...]} }, "required": ["path", "severity"] } }` |

En cible JS la contrainte devient **garantie runtime** : le sub-agent est forcé de passer
par un tool `StructuredOutput` validé au tool-call (retry sur mismatch) — une valeur hors
vocabulaire est impossible par construction.

## 7. Web UI (Wiring, éditeur de signal existant)

Le dropdown de type pilote des inputs conditionnels — mêmes widgets partout, pas de
mini-éditeur d'arbre :

- `enum` → champ **chips** pour `values` ;
- `list` → dropdown « type d'item » (`string|number|bool|enum|object`) ;
  - `enum` → chips `values` ;
  - `object` → **repeater** de lignes : nom du champ + dropdown de type + chips si enum.

Les erreurs/warnings de validation remontent comme aujourd'hui. Le schéma JSON servi à
l'éditeur est le même fichier (`workflow.schema.json`) — pas de duplication.

## 8. Migration & rétro-compatibilité

- Champs **additifs**, pas de bump de `schema_version`.
- Seul durcissement : « enum sans `values` = erreur ». Contenu existant concerné : la seule
  fixture de test `orchestrated.yaml` (`{name: status, type: enum, source: token}`) — une
  ligne à enrichir. Message d'erreur explicite pour guider un contenu legacy
  (« declare the closed vocabulary: values: [...] »).
- Le défaut `of: string` garantit que les workflows standard existants sans `of` continuent
  de générer (avec un warning doux).

## 9. Tests

- **Validation** : un cas par règle bloquante et par warning du §4 (y compris literal hors
  vocabulaire dans une condition composée `and`/`or`/`not`, et l'interdit hors-`exists` sur
  list d'objets).
- **Rendu** : golden des instructions émetteur (`<a|b|c>`, arrays typés) et consommateur
  (contrat d'item dans le body du `for_each`).
- **Fixture** : `orchestrated.yaml` enrichie (values sur `status`), assertions non-vacueuses
  sur le rendu.
- **Web UI** : tests bun des nouveaux inputs (chips, repeater) sur le modèle des tests
  éditeur existants.

## 10. État d'implémentation au 2026-07-16 (travail concurrent sur la branche)

Pendant ce brainstorm, la branche `feat/conditions-and-or-not` a reçu une première tranche
du périmètre enum (commits `b58f5a5`, `18393d7`, agent en cours de travail) :

**Déjà fait** : champ `values` dans `workflow.schema.json` (optionnel) ; `collect_signals`
transporte `values` ; check « literal ∉ values » pour `==`/`!=` (avec tests) ; web UI —
éditeur de `values` (stringListEditor) dans le Wiring + dropdown des valeurs d'enum pour le
literal dans le builder de conditions (fallback texte libre si pas de `values`).

**Divergence à résorber** : l'implémentation actuelle traite `values` comme **optionnel**
(le test `test_enum_values_optional` verrouille ce comportement) ; la décision de ce design
est **enum strict** (§2.2 — `values` requis, erreur bloquante). Le plan d'implémentation
devra inverser ce test et durcir la validation.

**Reste à faire (delta de ce design)** : enum strict (ci-dessus) ; validation de forme de
`values` (doublons/vide/mauvais type porteur) ; extension du check literal à `contains` ;
`_value_spec`/`render_signal_emission` qui rendent le vocabulaire (`<ok|degraded|failed>` —
toujours `<one of the allowed values>` aujourd'hui) ; **tout le volet list `of`** (schéma,
validation, défaut string + warning, UI item-type + repeater objet) ; contrat d'item injecté
au body du `for_each` ; warning « vocabulaires homonymes divergents » ; exigence `of` en
cible js.

**Coordination** : ne pas lancer l'implémentation de ce spec tant que l'agent en cours
travaille sur les mêmes fichiers (`bb-workflow`, `formfields.js`, `orchestration.js`).

## 11. Hors périmètre (YAGNI)

- Section `types:` partagée / `values_ref` (réutilisation de vocabulaires) — plus tard,
  compatible avec l'inline.
- Nesting dans `of` (objets/listes imbriqués) — refusé tant qu'un besoin réel n'existe pas.
- La dérivation JSON Schema elle-même (S4) et le compilateur JS (B1) — ce spec fige le
  mapping, ne l'implémente pas.
- Conditions plongeant dans les champs d'un item de liste — non-sens tant que les conditions
  opèrent sur des signaux scalaires.
