---
name: demo
description: |
  Exemple minimal awok : un pipeline collecte → résumé. Montre les phases,
  les dépendances, et les I/O par rôle résolus via la carte `namespaces`.

---

# /demo — exemple awok

> ⚠️ Ce fichier est **GÉNÉRÉ** depuis `claude-setup/workflows/demo.yaml`.
> Ne pas éditer à la main. Pour modifier : éditer le YAML puis `bb-workflow generate`.
>
> Convention implicite : chaque invocation d'agent `<name>` instruit Claude de lire
> `~/.claude/agents/<name>.md` (ses instructions complètes). Ne pas re-mentionner
> dans chaque snippet.

Pipeline en 2 phases, organisées en 2 groupes :
`collect` (Collecte des sources), `publish` (Production du livrable).


---

## Pipeline phases (DAG)

### D0-COLLECT — Collecte
> `collect` · agent

#### Invocation `collector`


**collector** [haiku] · Récupère les sources dans le namespace work.
- Writes : `work:notes` (md) → work/demo/notes.md

**Task** : Lis les sources et écris les `notes`.



### D1-SUMMARIZE — Résumé
> `publish` · agent · ⇐ D0-COLLECT

#### Invocation `summarizer`


**summarizer** [sonnet] · Produit un digest concis depuis les notes.
- Reads : `work:notes` (md) → work/demo/notes.md
- Writes : `work:digest` (md) → work/demo/digest.md

**Task** : Lis les `notes` et écris le `digest`.





