# Cartographie (généré depuis workflow.yaml)

> Auto-généré par `bb-workflow generate`. Ne pas éditer à la main.

## Vue d'ensemble

7 phases, organisées en 3 groupes.

## Groupes

- **`scan`** — Cheap initial scan of the target repo (risque : none)
- **`explore`** — Parallel exploration of the codebase (risque : none)
- **`synthesize`** — Synthesis of the deliverables (risque : none)

## DAG

```
Niveau 0 : O0-INVENTORY || OG-GITSTATS
Niveau 1 : O1-STRUCTURE || O2-DEPS || O3-FLOW
Niveau 2 : O4-ARCHITECTURE
Niveau 3 : O5-GETTING-STARTED
```

## Phases

### O0-INVENTORY — Inventory

- Groupe : `scan`
- Type : `agent`- Invocations :
  - `repo-inventory` (haiku)
### OG-GITSTATS — Git history stats

- Groupe : `scan`
- Type : `script`
### O1-STRUCTURE — Structure mapping

- Groupe : `explore`
- Type : `agent`- Dépend de : O0-INVENTORY- Invocations :
  - `structure-mapper` (sonnet)
### O2-DEPS — Dependency audit

- Groupe : `explore`
- Type : `agent`- Dépend de : O0-INVENTORY- Invocations :
  - `deps-auditor` (sonnet)
### O3-FLOW — Flow tracing

- Groupe : `explore`
- Type : `agent`- Dépend de : O0-INVENTORY- Invocations :
  - `flow-tracer` (sonnet)
### O4-ARCHITECTURE — Architecture synthesis

- Groupe : `synthesize`
- Type : `agent`- Dépend de : O1-STRUCTURE, O2-DEPS, O3-FLOW, OG-GITSTATS- Invocations :
  - `architecture-writer` (opus)
### O5-GETTING-STARTED — Getting-started guide

- Groupe : `synthesize`
- Type : `agent`- Dépend de : O4-ARCHITECTURE- Invocations :
  - `onboarding-writer` (sonnet)
