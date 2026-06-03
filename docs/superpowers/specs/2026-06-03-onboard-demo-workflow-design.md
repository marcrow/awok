# Workflow `onboard` — rich repo-cartography demo

**Date:** 2026-06-03
**Status:** design approved (brainstormed with the maintainer)
**Goal:** **replace** the trivial `demo` workflow (collect → summarize) with a
genuinely useful workflow `onboard` that **exercises a broad subset of awok
features**, so it doubles as an end-to-end test of the
`validate → generate → install → invoke` chain (it can be run **on the awok repo
itself**).

`demo` is **removed** (its `demo.yaml`, generated `skills/demo/`, cartography
artifacts, and the `collector` / `summarizer` agents + snippets are deleted).
`onboard` becomes the sole workflow for now. A future second workflow ("a workflow
that designs workflows") will re-introduce the multi-workflow / `workflow_call`
surface; that is out of scope here.

**Language:** all authored content — `onboard.yaml`, agents, invocation snippets,
descriptions, and the generated `SKILL.md` — is in **English**.

## What `onboard` does

Pointed at an unfamiliar repo, it produces two real deliverables:
- `work/onboard/architecture.md` — architecture doc (overview, components,
  dataflow, activity hotspots).
- `work/onboard/getting-started.md` — "getting started / first contribution" guide.

It is a **map-reduce**: a cheap inventory pass plus a deterministic git-history
analysis, then a **fan-out** of concurrent explorers, then a **reduce** that needs
all of their results.

## DAG

```
  scan                       explore  (∥ parallel)         synthesize
  ────────────────────       ──────────────────────       ──────────────────────
  O0-INVENTORY [haiku] ─┐     ┌─ O1-STRUCTURE ─┐
                         ├──   ├─ O2-DEPS ──────┼──→ O4-ARCHITECTURE ──→ O5-GETTING-STARTED
  OG-GITSTATS [script] ─┘     └─ O3-FLOW ───────┘        [opus]   ⇑          [sonnet]
   analyze .git                                     work:git-stats┘
```

- `O0-INVENTORY` and `OG-GITSTATS` are two **independent roots** of the `scan`
  group (no `depends_on`) → concurrent from t0.
- `O1/O2/O3` depend on `O0` and carry `parallel_with` referencing each other
  (the `∥` fan-out).
- `O4` is the **reduce**: `depends_on: [O1, O2, O3]`, and also consumes `git-stats`.
- `O5` depends on `O4`.

## Namespaces & I/O (carried by ROLE, per the 2026-06-02 I/O model)

`namespaces: { work: work/onboard }` — a role `work:name` (kind `k`) resolves to
`work/onboard/name.<k>`. Task prose references **roles**, never hardcoded paths.

| Phase | Type | Agent | Model | Inputs (role) | Outputs (role) |
|---|---|---|---|---|---|
| `O0-INVENTORY` | agent | `repo-inventory` | haiku | `.` `kind:dir` `external:true` (target repo) | `work:inventory` md |
| `OG-GITSTATS` | script | — (shell cmd) | — | `.git` `kind:dir` `external:true` | `work:git-stats` md |
| `O1-STRUCTURE` | agent | `structure-mapper` | sonnet | `work:inventory` | `work:structure` md |
| `O2-DEPS` | agent | `deps-auditor` | sonnet | `work:inventory` | `work:deps` md |
| `O3-FLOW` | agent | `flow-tracer` | sonnet | `work:inventory` | `work:flow` md |
| `O4-ARCHITECTURE` | agent | `architecture-writer` | opus | `work:structure` + `work:deps` + `work:flow` + `work:git-stats` | `work:architecture` md |
| `O5-GETTING-STARTED` | agent | `onboarding-writer` | sonnet | `work:architecture` + `work:inventory` | `work:getting-started` md `terminal:true` |
| _on-demand_ | — | `deep-diver` | sonnet | out of pipeline | out of pipeline |

**Dataflow coherence (`awok validate`)**: every `work:` role has both a producer and
a consumer, except `work:getting-started` (marked `terminal:true`). The external
inputs (`.`, `.git`) are marked `external:true` → no orphan warnings.

## Script phase `OG-GITSTATS`

`type: script`, `cmd` rendered verbatim as a bash block in the SKILL.md.
Deterministic aggregates over `.git` (no LLM), written to the `work:git-stats` role:

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

## The 7 agents (all `model: inherit` in their frontmatter)

| Agent | Tools | Role |
|---|---|---|
| `repo-inventory` | Read, Glob, Bash | Tree, languages, build/config files, candidate entry points, sizes → `inventory`. |
| `structure-mapper` | Read, Glob, Grep | Modules/directories, responsibilities, boundaries → `structure`. |
| `deps-auditor` | Read, Glob, Grep, Bash | Dependencies, package manager, build, scripts, lint/test/CI → `deps`. |
| `flow-tracer` | Read, Glob, Grep | Entry points, commands/CLI, main execution flow → `flow`. |
| `architecture-writer` | Read, Write | Synthesis: overview, components, dataflow, hotspots → `architecture`. |
| `onboarding-writer` | Read, Write | Prerequisites, install, first run, where to contribute first → `getting-started`. |
| `deep-diver` (on-demand) | Read, Glob, Grep | Zoom into one specific module on demand, after the cartography. |

Each pipeline agent also gets an invocation snippet
`workflow/templates/invocations/<name>.md` (`generated: false`, first line = a short
description aligned with the frontmatter). `deep-diver` has no snippet (rendered
directly from `on_demand_agents`).

## awok feature coverage (vs. the old `demo`)

| Feature | Covered by | Was in `demo`? |
|---|---|---|
| Parallel fan-out + `parallel_with` | O1/O2/O3 | no |
| Multi-parent `depends_on` (reduce) | O4 ⇐ O1,O2,O3 | no |
| `type: script` + `cmd` | OG-GITSTATS | no |
| Dataflow edge script → agent | git-stats → O4 | no |
| Mixed agent + script group | `scan` (O0 + OG) | no |
| I/O `external:true` + `kind:dir` | O0, OG | no |
| I/O `terminal:true` | O5 | yes |
| 3 models haiku/sonnet/opus | O0 / explorers / O4 | partial (2) |
| `on_demand_agents` | deep-diver | no |

(Multi-workflow + `index.html` aggregation is **not** exercised here since `demo` is
removed and `onboard` is the only workflow — deferred to the future second workflow.)

## Build protocol: error tracing & migration triage

awok was extracted from a private BB template into this repo. Every build phase must
**trace errors and attribute them** to either (a) the new `onboard` content, or
(b) a pre-existing awok-migration breakage.

**Baseline established 2026-06-03 (GREEN):** on the repo as-is, `awok validate`,
`awok check`, and `awok generate` all pass and `generate` is idempotent (zero git
diff). awok itself is healthy post-migration.

**Triage rule per phase:** any error encountered while building `onboard` is, by
default, attributable to the new content — **not** the migration — because the
baseline is green. To confirm an error is migration-related rather than mine,
re-run `awok validate && awok check && awok generate` after reverting the suspect
`onboard` change; if it still fails, it is a migration/tooling bug to be logged
separately (and likely fixed in `claude-setup/scripts/bb-workflow` or templates),
not worked around in the workflow YAML.

**Checkpoints (capture stdout/stderr + rc at each):**
1. After authoring agents + snippets + `onboard.yaml`, before generate → `awok validate`.
2. After `awok generate` → confirm `skills/onboard/SKILL.md`, cartography HTML/text,
   and `index.html` are produced; inspect for template/render errors.
3. `awok check` → no drift.
4. `./claude-setup/install.sh` → capture install errors.
5. Invoke `/onboard` on the awok repo → confirm both deliverables are produced;
   trace any agent/runtime error.

## Out of scope (YAGNI for this iteration)

- `type: workflow_call` / workflow chaining (needs a 2nd workflow; the "workflow that
  designs workflows" idea is noted for later).
- Multiple `background` invocations within one phase (Way B): phase-level fan-out
  (Way A) is enough to illustrate parallelism and is more readable.
- `brainstormings`, `conditions`, `triggers`, `manual_sections`.

## Delivery & end-to-end test

1. Delete `demo`: `workflows/demo.yaml`, `skills/demo/`, cartography `demo*.{html,md}`,
   `agents/{collector,summarizer}.md`, `invocations/{collector,summarizer}.md`.
   **Keep** `invocations/test-agent.md` — it is a **test fixture** referenced by
   `claude-setup/scripts/tests/` (not a demo artifact).
2. Create 7 `agents/*.md` + 6 `invocations/*.md` snippets + `workflows/onboard.yaml`.
3. `awok validate` (schema + coherence + clean dataflow).
4. `awok generate` → `skills/onboard/SKILL.md` + cartography HTML/text + `index.html`.
5. `awok check` → no drift.
6. `./claude-setup/install.sh`.
7. Invoke `/onboard` **on the awok repo** → verify both deliverables are produced.
