# Modèle I/O bb-workflow — qui sait quoi / produit quoi / vérifie quoi

**Date :** 2026-06-02
**Statut :** modèle figé (décisions de design validées avec le hunter)
**But :** verrouiller le contrat de circulation des I/O entre YAML, agents,
orchestrateur et sous-agents **avant** d'écrire du code. Schéma : `2026-06-02-bb-workflow-io-model.mermaid`.

## Principes figés

- **P1 — Le YAML est la source de vérité structurée des I/O.** Les `inputs`/`outputs`
  (chemin + rôle + kind + flags) vivent dans l'invocation YAML. C'est ce qui rend
  possibles la **visualisation** (dataflow/cartographie) et la **validation**
  (orphelins, review). Jamais en prose libre comme seule source.
- **P2 — Les chemins sont des conventions du repo target, pas des paramètres.**
  `notes/findings.md`, `work/extraction/endpoints.json`… ne varient pas selon le
  workflow. Donc les graver (miroir) dans le `.md` d'un agent est sûr.
- **P3 — Les I/O sont portés par RÔLE (posture B).** La prose de tâche référence les
  **rôles** (`écris les \`endpoints\``), jamais les chemins en dur. Source unique des
  chemins = le bloc I/O. Supprime la duplication et le drift.
- **P4 — Relais VERBATIM (en dur).** Le générateur produit le prompt de tâche
  **complet** (chemins inclus, dérivés des rôles→chemins). L'orchestrateur le passe
  tel quel au Task tool. → zéro paraphrase, zéro token gaspillé, zéro agent qui
  redemande une info.
- **P5 — Contrat I/O miroir dans `agents/<name>.md`.** Une rubrique générée (rôles +
  sens + kind) rend l'agent **auto-documenté** et **appelable en direct**. Elle ne
  remplace pas le YAML — elle en est un reflet.
- **P6 — Dérivation = exception.** Forker un agent ne se justifie que pour un vrai
  **cas B** (contrat sémantiquement différent). Pas de machinerie de dérivation
  systématique : on garde « un agent, source unique de comportement, réutilisé ».
- **P7 — Deux couches de vérification.** Déterministe (code, dans `validate`) +
  sémantique (agent LLM Sonnet, on-demand). On ne met jamais le check mécanique
  dans un agent LLM.

### Cas A vs cas B (départage la dérivation)
- **Cas A** — même rôle, chemins différents → géré par le binding rôle→chemin de
  l'invocation, **aucune dérivation**. (Rare ici car les chemins sont conventionnels.)
- **Cas B** — contrat différent (I/O sémantiquement autres) → agent dérivé/nouveau
  légitime.

## Qui SAIT quoi

| Acteur | Connaît | Aveugle à |
|---|---|---|
| `workflows/<name>.yaml` | DAG complet, invocations, I/O (rôle+chemin+kind+flags), groups, conditions | — (c'est la source) |
| `agents/<name>.md` | son comportement + son **contrat I/O par rôle** (rubrique générée) | les chemins des autres phases, le DAG |
| Orchestrateur (`/skill`) | le DAG + les I/O déclarés (ordonnancement, skip, staleness, verify) | le détail interne des agents |
| Sous-agent dispatché | **seulement** son `.md` (system prompt) + le prompt verbatim reçu | **le SKILL.md et le YAML** |

## Qui PRODUIT quoi

| Producteur | Produit |
|---|---|
| Hunter (+ Claude) | édite le **YAML**, les **bodies** d'agent, les **snippets** de tâche |
| `bb-workflow generate` | `SKILL.md` (prompts verbatim, chemins inclus) · rubrique **contrat I/O** dans `agents/*.md` · cartographie + dataflow |
| Orchestrateur (runtime) | les **prompts Task** (copie verbatim) · le **manifeste** (`work/.manifest.yaml`) |
| Sous-agents (runtime) | les **fichiers outputs** déclarés (`work/…`, `notes/…`) |

## Qui VÉRIFIE quoi

| Vérificateur | Nature | Contrôle |
|---|---|---|
| `bb-workflow validate` | **déterministe** (code, à chaque generate) | schema · cohérence · orphelins dataflow · **couverture rôle↔prose** (rôle cité dans la tâche ∈ I/O déclarés, et inversement) |
| Agent de review | **sémantique** (LLM Sonnet, on-demand) | la tâche accomplit-elle le rôle ? les I/O sont-ils **suffisants** ? qualité du prompt · placeholders non résolus · cohérence body↔tâche |
| Orchestrateur | **runtime** | staleness (hash des inputs) · l'output déclaré a-t-il été produit (sinon phase échouée) |

## Conséquences pour le dev (non figé ici, juste les implications)
- `_format_io_compact` doit rendre le **kind** + une légende des flags, et le **rôle**
  (aujourd'hui il jette kind/external/terminal et le `?` est cryptique).
- Ajouter `role` aux `io_ref` du schema.
- Générer la rubrique contrat dans `agents/*.md` (idempotent, zone balisée).
- Nouveau check déterministe rôle↔prose dans `validate`.
- Spécifier l'agent de review **après** avoir figé ce modèle (son job dépend de P3/P4).
- [x] Lot 1 livré : role + namespaces + dérivation + _format_io_compact enrichi.
