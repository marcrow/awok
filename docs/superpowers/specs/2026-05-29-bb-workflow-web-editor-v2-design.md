# `bb-workflow edit` — éditeur web v2 (rebuild du front-end)

**Date :** 2026-05-29
**Statut :** design en validation
**Remplace :** le front-end décrit dans `2026-05-28-bb-workflow-web-editor-design.md`
(le back-end : dump/validation/save/routes de base est conservé et étendu).

## Pourquoi un v2

La v1 a été livrée en réactif. Revue adversariale → défauts réels :
drag destructeur (C1), grille incapable de représenter le parallélisme réel
`parallel_with` (C2), XSS via interpolation en contexte JS (C3), création
d'agent absente (C4), ~10 % du schéma éditable, algo de niveaux dupliqué
Python/JS, prompts d'invocation globaux, download mermaid bloquant, **zéro test
front-end**, liens de dépendance invisibles.

## Décisions de design (validées avec le hunter)

1. **Rebuild propre** du front-end. Architecture maintenable, rendu **anti-XSS**
   (construction DOM via `createElement`/`textContent` + `addEventListener` ;
   **aucun** handler inline ni `innerHTML` de données utilisateur).
2. **Modèle « position + affinage »** :
   - La **ligne** = niveau de séquencement. La **colonne** = parallélisme.
   - Au chargement, la ligne d'une phase est calculée depuis `depends_on`
     (plus long chemin). Les phases d'une même ligne sont **parallèles**.
   - Déposer une phase sur une ligne fixe par défaut `depends_on` = phases de la
     **ligne précédente**, **affinable** dans le panneau (décocher) → les
     dépendances fines/croisées (ex. `R6→R2` seul) sont **préservées**.
   - `parallel_with` n'est plus ignoré : il est **dérivé** des voisins de même
     ligne et **écrit** dans le YAML.
   - `depends_on` reste la donnée persistée ; la position est une **vue** dérivée.
3. **Liens de dépendance visibles** : un overlay SVG dessine une flèche de
   chaque phase vers chacune de ses dépendances, recalculé à chaque changement
   de layout.
4. **Couverture quasi-complète du schéma** (éditable depuis l'UI) :
   - Phase : `id`, `name`, `type`, `group`, `description`, `depends_on`,
     `parallel_with` (dérivé), `cmd` (si `script`), `workflow` (si
     `workflow_call`, picker des workflows), `triggers`, `inputs`/`outputs`.
   - Invocation : `agent`, `model`, `description`, `background`, `skip_if`
     (picker des conditions), `depends_on_invocation`, `inputs`/`outputs`.
   - io_ref : éditeur `path` + `kind` + flags `optional`/`external`/`terminal`.
   - Top-level : `skill.{name,description,title}`, `groups` (ajout/edit/risk),
     `conditions`, `on_demand_agents`.
   - Hors couverture éditable (lecture YAML seule, documenté) : `brainstormings`,
     `manual_sections` (rares, structurels).
5. **Création d'agent depuis la GUI** : bouton « + nouvel agent » → formulaire
   (name/description/tools/model/prompt) → `POST /api/agent`. L'agent apparaît
   ensuite dans le picker d'invocation. Lève le piège « workflow référençant un
   agent inexistant → save impossible ».
6. **Logique unique côté serveur** : le calcul des niveaux, la dérivation
   position→`depends_on`/`parallel_with`, la normalisation, la validation
   vivent en **Python** (testées en pytest). Plus de réimplémentation JS de
   l'algo de niveaux. Le client appelle un endpoint de « vue » pour obtenir
   `{levels, columns, edges, parallel_with}`.
7. **Mermaid non bloquant** : `ThreadingHTTPServer` + **pré-téléchargement** de
   `mermaid.min.js` (avec timeout) dans `cmd_edit` **avant** `serve_forever`,
   puis service depuis le cache. Offline → message clair, éditeur reste utilisable
   (le Dataflow dégrade en texte).
8. **Tests front-end obligatoires** (la lacune n°1 de la v1) : harnais
   **bun/node + linkedom** (jsdom-like) testant le rendu anti-XSS, le tracé des
   liens, et le dispatch des actions d'édition. + un smoke test live piloté via
   Chrome.

## Architecture

### Backend (Python, dans `claude-setup/scripts/bb-workflow`)
Conservé : `dump_workflow_yaml`, `compute_levels`, `is_valid_slug`,
`save_workflow`, `create_agent`, `render_cartography_mermaid`,
`render_dataflow_mermaid`.

Nouveau / modifié :
- `derive_columns(workflow, levels) -> {phase_id: column_index}` : ordre stable
  des phases dans une ligne.
- `derive_parallel_with(workflow, levels) -> {phase_id: [ids]}` : voisins de
  même niveau.
- `build_edges(workflow) -> [{from, to}]` : arêtes `depends_on` pour l'overlay.
- `default_depends_on_for_level(workflow, levels, level) -> [ids]` : phases de la
  ligne précédente (utilisé par le client comme défaut au drop ; exposé pour test).
- `apply_parallel_with(model, levels)` : écrit `parallel_with` dans le modèle
  avant save (dérivé des lignes).
- Endpoint **`POST /api/view`** : reçoit un modèle, renvoie
  `{levels, columns, parallel_with, edges, dataflow, mermaid, errors}`
  (errors = validation non bloquante pour feedback live).
- `cmd_edit` : `ThreadingHTTPServer`, pré-fetch mermaid, ouvre `?workflow=`.

### Front-end (`claude-setup/workflow/templates/webedit/`)
- `editor.html` : structure (topbar, onglets Grille/Dataflow/YAML, panneau,
  modales prompt + nouvel-agent), conteneur grille + overlay SVG.
- `editor.css` : thème (réutilise les tokens cartographie), pas de polish.
- `editor.js` : **un module sans handler inline**. Découpé en :
  - `api.js`-like section : fetch wrappers.
  - rendu : `renderGrid`, `renderEdges` (SVG), `renderPanel` — DOM via
    `createElement`, listeners via `addEventListener`.
  - état : modèle courant + vue serveur ; chaque édition structurelle → `POST
    /api/view` → re-render ; édition de champ → local, persistée au save.
- Les **fonctions pures** extractibles (ex. helpers de rendu indépendants du
  DOM) sont testées sous bun/node ; le rendu DOM sous linkedom.

## Sécurité / robustesse
- 127.0.0.1 uniquement ; slugs validés avant tout accès disque (déjà en place).
- Rendu : aucune donnée utilisateur dans `innerHTML`/attribut d'événement →
  XSS (C3) éliminé par construction.
- Save : validation (schema + cohérence) avant écriture (déjà en place) ;
  `parallel_with` dérivé écrit au save.

## Round-trip YAML
Inchangé (dumper canonique idempotent, contenu préservé). `parallel_with`
ajouté/retiré reflète les lignes. 1er save = diff cosmétique one-time
(documenté).

## Tests
**pytest** : `derive_columns`, `derive_parallel_with`, `build_edges`,
`default_depends_on_for_level`, `apply_parallel_with`, `POST /api/view`
(structure + errors non bloquantes), agent creation déjà couverte, io_ref
round-trip, save validé. Round-trip de `demo` et `demo`
(contenu préservé, idempotent) — incluant `parallel_with`.
**bun/node + linkedom** : rendu d'une phase nommée `x');alert(1)` est inerte
(anti-XSS) ; `renderEdges` produit N `<line>`/`<path>` pour N dépendances ;
un clic « + phase » / drag déclenche le bon appel `fetch`.
**Live (Chrome, piloté par l'agent)** : charger demo, vérifier
niveaux + colonnes + liens visibles + Dataflow mermaid rendu + édition io_ref +
création d'agent + save → fichier valide.

## Découpage des unités
- Backend : fonctions de dérivation regroupées dans la section `# Web editor`
  existante ; endpoint `/api/view` dans le handler.
- Front : `editor.js` reste un fichier mais **structuré en sections claires** ;
  si > ~400 lignes, extraire `editor-render.js` + `editor-state.js` (servis
  inlinés comme aujourd'hui).
- Tests : `tests/test_workflow_edit.py` (pytest) + `tests/webedit/*.test.js`
  (bun).
