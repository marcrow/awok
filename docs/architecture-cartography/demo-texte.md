# Cartographie (généré depuis workflow.yaml)

> Auto-généré par `bb-workflow generate`. Ne pas éditer à la main.

## Vue d'ensemble

2 phases, organisées en 2 groupes.

## Groupes

- **`collect`** — Collecte des sources (risque : none)
- **`publish`** — Production du livrable (risque : none)

## DAG

```
Niveau 0 : D0-COLLECT
Niveau 1 : D1-SUMMARIZE
```

## Phases

### D0-COLLECT — Collecte

- Groupe : `collect`
- Type : `agent`- Invocations :
  - `collector` (haiku)
### D1-SUMMARIZE — Résumé

- Groupe : `publish`
- Type : `agent`- Dépend de : D0-COLLECT- Invocations :
  - `summarizer` (sonnet)
