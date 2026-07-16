# awok — Blocs logiques de condition (AND / OR / NOT)

Réf. d'implémentation : `condition-builder-prototype.dc.html` (source de vérité pour le
visuel et les interactions). Ce document résume les décisions retenues côté éditeur.

## 1. Intention

Permettre des conditions booléennes composées (`AND` / `OR` / `NOT`), avec imbrication
libre, ex. `(A and B) or not(C and D)`. Un seul rendu compact partagé entre **la grille**
(lecture) et **le volet d'édition** (écriture). Édition = **expression inline** (on édite
là où on lit).

## 2. Modèle de données (représentation ÉDITEUR)

Arbre récursif. Un nœud est soit une **comparaison**, soit un **groupe**.

```
node =
  | { t:'cmp', neg?:bool, left:Operand, op:Op, right:Operand }   // comparaison
  | { t:'cmp', neg?:bool, left:{k:'builtin', fn, arg} }          // prédicat built-in (autonome)
  | { t:'grp', bool:'and'|'or', neg?:bool, kids:node[] }         // groupe = parenthèses

Operand =
  | { k:'signal',  v:string }   // ex. "scan.risk" — valeur émise par une phase
  | { k:'literal', v:string }   // valeur fixe saisie
  | { k:'builtin', fn:string, arg:string }   // uniquement à gauche

Op ∈ [ ==  !=  <  >  <=  >=  contains  matches  exists ]
```

Règles :
- `neg` (NOT) peut se poser sur **n'importe quelle comparaison ou groupe** (racine comprise).
- Un **groupe** porte un seul connecteur `bool` (`and` ou `or`) qui relie tous ses enfants.
- Imbrication libre (le builder limite l'ajout de sous-groupe à 2 niveaux de profondeur, ajustable).
- `op === 'exists'` → pas d'opérande droite.
- **built-in** (`k:'builtin'`) = prédicat booléen autonome : réservé à l'opérande **gauche**, et
  **supprime l'opérateur + l'opérande droite**. Fonctions : `file_exists`, `dir_exists`
  (+ argument). Standard-only.
- Opérande **droite** : `signal` ou `literal` uniquement (pas de built-in).

> NOTE d'intégration awok : cette forme est la représentation **interne de l'éditeur telle
> que prototypée**. Sur disque, awok persiste la forme canonique récursive
> (`{and|or:[…]}` / `{not: …}` / `{op,left,right}` / string escape-hatch). Le flag `neg`
> devient l'enveloppe `{not: …}`. Voir le design d'intégration.

## 3. Types d'opérande — sélecteur micro-segmenté

| Icône | Type | Couleur | Contrôle de valeur |
|------|------|---------|--------------------|
| `◈` | signal | sky `#7dd3fc` | menu déroulant des signaux (`phase.name`) |
| `“”` | littéral | ambre `#fcd34d` | champ texte libre |
| `ƒ` | built-in | violet `#c4b5fd` | menu déroulant de fonction + champ argument |

- Icônes toujours visibles → accès direct en 1 clic, aucun menu caché.
- **Tooltip au survol** sur chaque segment (libellé du type).
- Une **aide** dans le volet d'édition liste et explique les symboles (`◈ / “” / ƒ`, `AND/OR`, `( )`, `NOT`).

## 4. Connecteurs & groupes (inline)

- Connecteur `AND` (bleu `#93c5fd`) / `OR` (rose `#fda4af`) affiché en **pastille cliquable**
  entre les enfants ; clic = bascule du connecteur du groupe.
- Groupe imbriqué = **parenthèses** avec fond translucide teinté par le connecteur → la
  profondeur reste visible.
- `NOT` = petit bouton **écrit en toutes lettres** (pas de symbole), rouge quand actif,
  posable sur toute condition ou groupe.
- Boutons d'ajout par groupe : `＋` (condition) et `()` (sous-groupe).
- L'expression **retourne à la ligne** automatiquement — jamais de débordement sur la vignette.

## 5. Rendu sur la grille

Même expression compacte, en lecture seule, dans l'en-tête du bloc `IF` (au-dessus de
THEN / ELSE). Exemples :
- `( ◈ recon.waf == true AND ◈ scan.risk > 7 ) OR NOT ( ◈ scan.status == open AND ƒ file_exists("/etc/passwd") )`
- Pas de bouton « éditer » : **le clic sur le bloc ouvre le volet**.

## 6. Couleurs (rappel palette)

Fond `#0b1120`, surfaces `#0f172a`, puits/inputs `#0b1120`, bordures `#243049`, mono
`ui-monospace`. Signal sky, littéral ambre, built-in violet, AND bleu, OR rose, NOT rouge
`#fca5a5`, gate/parenthèses violet `#a78bfa`.

## 7. Validation (à câbler côté backend)

- Comparaison incomplète (opérande gauche/droite manquant) → erreur.
- built-in sans argument → erreur.
- Mêmes contrôles côté `validate_orchestration()`.
