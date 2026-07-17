# Design — aide contextuelle de la section signaux (webedit)

**Date** : 2026-07-17
**Statut** : validé (mini-brainstorm)
**Portée** : éditeur web uniquement (`src/workflow/templates/webedit/`) — aucun impact engine/Python, aucun ripple SKILL.md.

## 1. Problème et persona

La section « emits » du panneau Wiring est une rangée compacte de contrôles sans
titres (placeholders seuls) et sans aucune explication du concept. Le **persona
cible** : un utilisateur qui n'a **jamais lu le YAML d'un workflow ni la doc
awok**. Il doit pouvoir comprendre ce qu'est un signal et remplir chaque champ
sans quitter l'éditeur.

Ce persona devient la référence pour l'accessibilité de toute la web UI
(item backlog dédié dans TODO.md) ; cette passe ne traite que les signaux.

## 2. Exigences

- **Langue : anglais** — cohérent avec le reste de l'UI ; les mots-clés YAML
  (`emits`, `source`, `values`, `of`…) restent tels quels.
- **Compacité (premier rang)** : l'aide ne doit ni élargir sensiblement le
  panneau ni noyer les contrôles. La lisibilité vient de mini-labels discrets ;
  la profondeur pédagogique vit dans les tooltips (invisible tant qu'on ne
  survole pas). Pas de bloc dépliable (écarté : bruit > gain).
- Zéro dépendance, zéro JS de tooltip custom : `title=` natif (convention déjà
  présente dans `formfields.js`).

## 3. Les trois couches

### 3.1 Intro sous le titre `emits` (toujours visible, 1 ligne)

Style `muted-note`, texte :

> A signal is a small typed value (status, number, list…) this action publishes
> when it finishes — the orchestration can branch or loop on it.
> Key: `<action_id>.<name>`.

Quand la liste est vide, la même ligne sert d'état vide (pas de doublon).

### 3.2 Mini-labels au-dessus de chaque contrôle

Chaque contrôle de la rangée principale (**name**, **type**, **source**) et des
sous-rangées (**from** : role + field, **by**, **values**, **of**, champs du
répéteur object : **field name**, **field type**) reçoit un mini-label
au-dessus : petite casse, taille réduite, couleur `--dim` — même famille
visuelle que les labels existants du panneau. La rangée devient une grille de
petites colonnes label-au-dessus-du-contrôle, sans élargissement notable.

Le bouton ✕ et le chip d'avertissement regex ne reçoivent pas de label.

### 3.3 Tooltips ⓘ par champ

À côté de chaque mini-label, un glyphe ⓘ portant un `title=` natif. Contenus
(formulations finales à ajuster à l'implémentation, l'esprit est fixé) :

| Champ | Tooltip (anglais) |
|---|---|
| name | Lowercase identifier (`^[a-z][a-z0-9_]*$`). The orchestration reads this signal as `<action_id>.<name>`. |
| type | Value shape: string, number, bool, enum (closed vocabulary), or list. |
| source | How the value is produced — token: the agent ends its output with a compact `SIGNALS: name=value` line; field: read from a field of a JSON output file; exit_code: the script's exit status (0 ⇒ true). |
| from (role) | Which declared JSON output the value is read from. |
| from (field) | Optional field path inside that JSON (defaults to the whole file). |
| by | When several agents run in this action: which one emits the token. |
| values | The closed vocabulary — the agent must emit exactly one of these. |
| of | Element type of the list items; `object` declares a flat field map. |
| object field name/type | One required field of each list item (flat — no nesting). |

## 4. Implémentation

- `formfields.js` : un petit helper réutilisable
  `labeled(labelText, tooltipText, controlEl)` (label + ⓘ + contrôle empilés) ;
  `signalsEditor` l'applique à tous les contrôles listés en 3.2 ; l'intro/état
  vide s'insère sous le heading.
- `editor.css` : styles des mini-labels, du glyphe ⓘ et de la grille de
  colonnes ; réutiliser les variables existantes (`--dim`, `--border`…).
- Aucune modification du modèle de données ni des événements existants — l'aide
  est purement présentationnelle (les tests de comportement existants doivent
  passer inchangés).

## 5. Tests

Bun (`src/scripts/tests/webedit/formfields.test.js`) : présence de l'intro,
présence des mini-labels attendus par configuration (p. ex. `of` visible pour
un type list, `values` pour enum), présence des `title` sur les ⓘ ; suite
webedit complète verte + `node --check`.

## 6. Hors périmètre / suites

- Le reste du panneau Wiring (io refs `role (ns:name)` / `path override`,
  triggers…) et le reste de l'éditeur → item backlog TODO.md avec le persona
  ci-dessus (ajouté dans l'arbre de travail, non commité avec ce spec).
- Toute aide dépliable / visite guidée.
