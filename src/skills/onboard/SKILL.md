---
name: onboard
description: |
  Map an unfamiliar repository. A cheap inventory pass plus a deterministic
  git-history analysis fan out into parallel explorers (structure, deps, flow),
  then reduce into an architecture doc and a getting-started guide. Run it on
  any repo (including this one) to learn it fast.

---

# /onboard — repo cartography

> ⚠️ Ce fichier est **GÉNÉRÉ** depuis `src/workflows/onboard.yaml`.
> Ne pas éditer à la main. Pour modifier : éditer le YAML puis `bb-workflow generate`.
>
> Convention implicite : chaque invocation d'agent `<name>` instruit Claude de lire
> `~/.claude/agents/<name>.md` (ses instructions complètes). Ne pas re-mentionner
> dans chaque snippet.

Pipeline en 7 phases, organisées en 3 groupes :
`scan` (Cheap initial scan of the target repo), `explore` (Parallel exploration of the codebase), `synthesize` (Synthesis of the deliverables).


---

## Pipeline phases (DAG)

### O0-INVENTORY — Inventory
> `scan` · agent

#### Invocation `repo-inventory`


**repo-inventory** [haiku] · Inventories the repo tree, languages and build/config files.
- Reads : `.` (dir) → .
- Writes : `work:inventory` (md) → work/onboard/inventory.md

**Task**: Walk the target repo and write the `inventory`: top-level layout, detected languages, build/config/manifest files, candidate entry points, and rough sizes (file counts, LOC ballpark). Factual and compact — the explorers read it.



### OG-GITSTATS — Git history stats
> `scan` · script
Deterministic git-history analysis (no LLM): commit volume, contributors, churn hotspots, commits per month. Demonstrates a type:script phase whose output feeds the synthesis reduce.

```bash
mkdir -p work/onboard
{
  echo "# Git history stats"; echo
  echo "## Activity"
  echo "- Total commits: $(git rev-list --count HEAD)"
  echo "- First commit:  $(git log --reverse --format=%ad --date=short | head -1)"
  echo "- Last commit:   $(git log -1 --format=%ad --date=short)"
  echo "- Contributors:  $(git shortlog -sne --all | wc -l)"; echo
  echo "## Top 15 hotspots (most-changed files)"
  git log --pretty=format: --name-only | grep . | sort | uniq -c | sort -rn | head -15; echo
  echo "## Commits per month (last 12)"
  git log --format=%ad --date=format:%Y-%m | sort | uniq -c | tail -12
} > work/onboard/git-stats.md

```



### O1-STRUCTURE — Structure mapping
> `explore` · agent · ⇐ O0-INVENTORY

#### Invocation `structure-mapper`


**structure-mapper** [sonnet] · Maps modules, responsibilities and boundaries.
- Reads : `work:inventory` (md) → work/onboard/inventory.md
- Writes : `work:structure` (md) → work/onboard/structure.md

**Task**: From the `inventory`, group the code into modules (by directory or cohesive unit). For each: name, one-line responsibility, and boundaries (what it owns, what it depends on). Write the `structure`.



### O2-DEPS — Dependency audit
> `explore` · agent · ⇐ O0-INVENTORY

#### Invocation `deps-auditor`


**deps-auditor** [sonnet] · Audits dependencies, build and tooling.
- Reads : `work:inventory` (md) → work/onboard/inventory.md
- Writes : `work:deps` (md) → work/onboard/deps.md

**Task**: From the `inventory`, audit dependencies and tooling: package manager(s) and manifests, declared deps (grouped), build system and scripts, and lint/test/CI config. Write the `deps`.



### O3-FLOW — Flow tracing
> `explore` · agent · ⇐ O0-INVENTORY

#### Invocation `flow-tracer`


**flow-tracer** [sonnet] · Traces entry points and the main execution flow.
- Reads : `work:inventory` (md) → work/onboard/inventory.md
- Writes : `work:flow` (md) → work/onboard/flow.md

**Task**: From the `inventory`, identify the real entry points (CLI, main, server) and trace the main execution path from startup to exit, naming the key functions/modules it passes through. Write the `flow`.



### O4-ARCHITECTURE — Architecture synthesis
> `synthesize` · agent · ⇐ O1-STRUCTURE, O2-DEPS, O3-FLOW, OG-GITSTATS

#### Invocation `architecture-writer`


**architecture-writer** [opus] · Synthesizes the architecture doc from explorers + git stats.
- Reads : `work:structure` (md) → work/onboard/structure.md, `work:deps` (md) → work/onboard/deps.md, `work:flow` (md) → work/onboard/flow.md, `work:git-stats` (md) → work/onboard/git-stats.md
- Writes : `work:architecture` (md) → work/onboard/architecture.md

**Task**: Synthesize the `architecture` from the `structure`, `deps`, `flow` and `git-stats`. Sections: Overview, Components (how they fit), Dataflow (grounded in `flow`), Activity hotspots (grounded in `git-stats`). Cite real names.



### O5-GETTING-STARTED — Getting-started guide
> `synthesize` · agent · ⇐ O4-ARCHITECTURE

#### Invocation `onboarding-writer`


**onboarding-writer** [sonnet] · Writes the getting-started / first-contribution guide.
- Reads : `work:architecture` (md) → work/onboard/architecture.md, `work:inventory` (md) → work/onboard/inventory.md
- Writes : `work:getting-started` (md) → work/onboard/getting-started.md

**Task**: Using the `architecture` and `inventory`, write the `getting-started` guide: Prerequisites, Install/Setup (concrete commands), First run, and Where to contribute first (2-4 concrete low-risk starting points). Practical and concrete.




---

## Agents on-demand (hors pipeline)

Ces agents sont disponibles mais ne sont **pas** invoqués automatiquement dans le pipeline.

### `deep-diver` [sonnet]
> Zoom into one specific module/subsystem on demand and produce a focused
> deep-dive note, after the cartography is done.

**Quand l'invoquer** : The user wants to drill into a specific module after reading the architecture doc.



