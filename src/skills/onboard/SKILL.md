---
name: onboard
description: |
  Map an unfamiliar repository. A cheap inventory pass plus a deterministic
  git-history analysis fan out into parallel explorers (structure, deps, flow),
  then reduce into an architecture doc and a getting-started guide. Run it on
  any repo (including this one) to learn it fast.

---

# /onboard — repo cartography

> ⚠️ This file is **GENERATED** from `src/workflows/onboard.yaml`.
> Do not edit by hand. To change it: edit the YAML then run `bb-workflow generate`.
>
> Implicit convention: each agent invocation `<name>` instructs Claude to read
> `~/.claude/agents/<name>.md` (its full instructions). No need to repeat this in
> every snippet.
>
> **Model is not inherited.** Each invocation shows its model as `[model]` and a ⚙️
> reminder line. When you launch that agent via the `Task` tool you **must pass the
> model explicitly** (`model: <model>`) — otherwise the sub-agent silently runs on
> the session model, often a costlier one.

Pipeline of 7 actions, organized into 3 groups:
`scan` (Cheap initial scan of the target repo), `explore` (Parallel exploration of the codebase), `synthesize` (Synthesis of the deliverables).

---

## ⚙️ Execution protocol — order vs. parallelism

The pipeline below is a **dependency graph**, not a checklist. Two markers on each
action's header drive how you run it:

- `⇐ A, B` — this action **depends on** A and B. **Hard rule: never start it until
  every `⇐` dependency has returned** — its inputs are the files those actions wrote.
- `∥ A` — this action is **independent** of A (same stage, no edge between them).

Within that ordering, **launch independent agents together in a single message**
(one `Task` block each), never one at a time:

- actions on the **same stage** (marked `∥`), once their shared `⇐` dependency has
  returned;
- and, when one action lists several agents, all of them at once (no order between them).

Each separate message re-reads the whole accumulated context, so launching N
independent agents one-per-message multiplies cost and serializes work that could
run concurrently.

---

## 🧭 Opportunistic autonomy

This workflow permits **scoped improvisation**. Beyond the planned work, you (the
orchestrator) may **author and launch an ad-hoc sub-agent** whenever you spot a
signal the planned agents do not cover.

- **How**: the `Task` tool, `subagent_type: general-purpose` (or `Explore`), with a
  prompt you write yourself from context. These agents do not exist in
  `src/agents/` — you create them on the fly.
- **When**: When an explorer surfaces a signal the planned reduce won't chase.
- **Mode**: usually in the **background**, unless the result is needed to continue the current action.
- **Nesting limit**: a sub-agent cannot itself spawn sub-agents (max depth = 1). After reading the planned sub-agent's report, it is up to you to launch the follow-up.
- **Scope**: all actions, except those marked ⛔.
- **Examples**: detected framework/CMS → ad-hoc specialised recon

---

---

## Execution protocol

Drive the pipeline by data dependency, not by list order. Track each action as pending / running / done.

1. An action is **ready** when every action in its `depends_on` is **done**.
2. Launch **all currently ready actions together, in one message** — that is where parallelism comes from; there is no explicit parallel construct.
3. When a launched batch returns, mark **every** action in that batch **done** *before* recomputing readiness. Never react to one completion at a time: if two finish together you must see both as done, or you will skip an action whose two dependencies just completed, or stall the run.
4. Then re-examine only the **dependents** of the just-finished actions and launch any that became ready. Repeat until nothing is left.
5. **Branches / loops** below gate *which* actions enter the ready set:

### Control flow

- **If** `o0-inventory.has_manifest` == `true`:
  - Action **O2-DEPS** participates (in its depends_on position).

**Signals** (how to read each condition operand):

- `o0-inventory.has_manifest` (bool, from **O0-INVENTORY**) — read the ending `SIGNALS` line of its output.

## Pipeline actions (DAG)

### O0-INVENTORY — Inventory
> `scan` · agent · ∥ OG-GITSTATS
When launching repo-inventory, also instruct it to decide whether the repo declares a dependency manifest (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, pom.xml, Gemfile, composer.json, …). The orchestration program reads that signal to gate the dependency audit.

#### Invocation `repo-inventory`


**repo-inventory** [haiku] · Inventories the repo tree, languages and build/config files.
- Reads : `.` (dir) → .
- Writes : `work:inventory` (md) → work/onboard/inventory.md

**Task**: Walk the target repo and write the `inventory`: top-level layout, detected languages, build/config/manifest files, candidate entry points, and rough sizes (file counts, LOC ballpark). Factual and compact — the explorers read it.

> ⚙️ **Run on `haiku`** — launch via the `Task` tool with `model: haiku` (not inherited from the session model).

- **Emit signal `o0-inventory.has_manifest`**: end your output with a compact line `SIGNALS has_manifest=<true|false>`.



### OG-GITSTATS — Git history stats
> `scan` · script · ∥ O0-INVENTORY
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
> `explore` · agent · ⇐ O0-INVENTORY · ∥ O2-DEPS, O3-FLOW

#### Invocation `structure-mapper`


**structure-mapper** [sonnet] · Maps modules, responsibilities and boundaries.
- Reads : `work:inventory` (md) → work/onboard/inventory.md
- Writes : `work:structure` (md) → work/onboard/structure.md

**Task**: From the `inventory`, group the code into modules (by directory or cohesive unit). For each: name, one-line responsibility, and boundaries (what it owns, what it depends on). Write the `structure`.

> ⚙️ **Run on `sonnet`** — launch via the `Task` tool with `model: sonnet` (not inherited from the session model).



### O2-DEPS — Dependency audit
> `explore` · agent · ⇐ O0-INVENTORY · ∥ O1-STRUCTURE, O3-FLOW

> 🧭 **Opportunistic lead here.** A dependency looks old / abandoned. — e.g. old dependency → ad-hoc agent that looks up known CVEs

#### Invocation `deps-auditor`


**deps-auditor** [sonnet] · Audits dependencies, build and tooling.
- Reads : `work:inventory` (md) → work/onboard/inventory.md
- Writes : `work:deps` (md) → work/onboard/deps.md

**Task**: From the `inventory`, audit dependencies and tooling: package manager(s) and manifests, declared deps (grouped), build system and scripts, and lint/test/CI config. Write the `deps`.

> ⚙️ **Run on `sonnet`** — launch via the `Task` tool with `model: sonnet` (not inherited from the session model).



### O3-FLOW — Flow tracing
> `explore` · agent · ⇐ O0-INVENTORY · ∥ O1-STRUCTURE, O2-DEPS

#### Invocation `flow-tracer`


**flow-tracer** [sonnet] · Traces entry points and the main execution flow.
- Reads : `work:inventory` (md) → work/onboard/inventory.md
- Writes : `work:flow` (md) → work/onboard/flow.md

**Task**: From the `inventory`, identify the real entry points (CLI, main, server) and trace the main execution path from startup to exit, naming the key functions/modules it passes through. Write the `flow`.

> ⚙️ **Run on `sonnet`** — launch via the `Task` tool with `model: sonnet` (not inherited from the session model).



### O4-ARCHITECTURE — Architecture synthesis
> `synthesize` · agent · ⇐ O1-STRUCTURE, O3-FLOW, OG-GITSTATS

> ⛔ **No opportunistic autonomy here.** If the need is compelling, ask the user.

#### Invocation `architecture-writer`


**architecture-writer** [opus] · Synthesizes the architecture doc from explorers + git stats.
- Reads : `work:structure` (md) → work/onboard/structure.md, `work:deps` (md, optionnel) → work/onboard/deps.md, `work:flow` (md) → work/onboard/flow.md, `work:git-stats` (md) → work/onboard/git-stats.md
- Writes : `work:architecture` (md) → work/onboard/architecture.md
- _(optionnel = peut être absent)_

**Task**: Synthesize the `architecture` from the `structure`, `deps`, `flow` and `git-stats`. Sections: Overview, Components (how they fit), Dataflow (grounded in `flow`), Activity hotspots (grounded in `git-stats`). Cite real names.

> ⚙️ **Run on `opus`** — launch via the `Task` tool with `model: opus` (not inherited from the session model).



### O5-GETTING-STARTED — Getting-started guide
> `synthesize` · agent · ⇐ O4-ARCHITECTURE

#### Invocation `onboarding-writer`


**onboarding-writer** [sonnet] · Writes the getting-started / first-contribution guide.
- Reads : `work:architecture` (md) → work/onboard/architecture.md, `work:inventory` (md) → work/onboard/inventory.md
- Writes : `work:getting-started` (md) → work/onboard/getting-started.md

**Task**: Using the `architecture` and `inventory`, write the `getting-started` guide: Prerequisites, Install/Setup (concrete commands), First run, and Where to contribute first (2-4 concrete low-risk starting points). Practical and concrete.

> ⚙️ **Run on `sonnet`** — launch via the `Task` tool with `model: sonnet` (not inherited from the session model).




---

## On-demand agents (outside the pipeline)

These agents are available but are **not** invoked automatically in the pipeline.

### `deep-diver` [sonnet]
> Zoom into one specific module/subsystem on demand and produce a focused
> deep-dive note, after the cartography is done.

**When to invoke it**: The user wants to drill into a specific module after reading the architecture doc.



