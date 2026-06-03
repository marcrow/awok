# `onboard` Demo Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trivial `demo` workflow with `onboard` — a genuinely useful repo-cartography workflow that exercises a broad subset of awok features (parallel fan-out, multi-parent reduce, a `type: script` phase, `external`/`dir`/`terminal` I/O, three models, on-demand agents).

**Architecture:** A map-reduce pipeline. Two independent `scan` roots (an `haiku` inventory agent + a deterministic git-stats shell script) feed three `explore` agents that run in parallel (`parallel_with` auto-derived), which reduce into an `opus` architecture synthesis, then a `sonnet` getting-started guide. All I/O is role-based via `namespaces: { work: work/onboard }`, per the 2026-06-02 I/O model. One on-demand `deep-diver` agent sits outside the pipeline.

**Tech Stack:** awok (`bb-workflow`, Python stdlib + PyYAML + Jinja2 + jsonschema), Markdown agents/snippets, a Bash script phase. The `awok` CLI is already installed at `~/.local/bin/awok` and run from the repo root.

**Spec:** `docs/superpowers/specs/2026-06-03-onboard-demo-workflow-design.md`

**Migration-triage rule (applies to every task):** the awok baseline is **green** (recorded 2026-06-03: `validate`/`check`/`generate` pass, `generate` idempotent). Therefore any error encountered below is attributable to the new `onboard` content **by default**. To confirm an error is migration/tooling-related instead, revert the suspect change and re-run `awok validate && awok check && awok generate`; if it still fails on the clean tree, log it as a separate migration bug (fix in `claude-setup/scripts/bb-workflow` or templates) rather than working around it in the YAML. Capture stdout/stderr + rc at every awok invocation.

---

### Task 1: Remove the `demo` workflow

Delete only `demo` artifacts. **Keep** `claude-setup/workflow/templates/invocations/test-agent.md` — it is a test fixture referenced by `claude-setup/scripts/tests/` (verified), not a demo artifact.

**Files:**
- Delete: `claude-setup/workflows/demo.yaml`
- Delete: `claude-setup/skills/demo/` (whole dir, incl. `SKILL.md`)
- Delete: `docs/architecture-cartography/demo.html`, `docs/architecture-cartography/demo-texte.md`
- Delete: `claude-setup/agents/collector.md`, `claude-setup/agents/summarizer.md`
- Delete: `claude-setup/workflow/templates/invocations/collector.md`, `claude-setup/workflow/templates/invocations/summarizer.md`

- [ ] **Step 1: Confirm `collector`/`summarizer` are only referenced by demo**

Run:
```bash
cd /home/marc-antoine/Desktop/awok
grep -rl --include='*.yaml' --include='*.md' -E '\b(collector|summarizer)\b' claude-setup/ | grep -v 'invocations/\(collector\|summarizer\).md' | grep -v 'agents/\(collector\|summarizer\).md'
```
Expected: only `claude-setup/workflows/demo.yaml` (and possibly this plan / the spec). If a test fixture references them, stop and reassess.

- [ ] **Step 2: Delete the demo artifacts**

Run:
```bash
cd /home/marc-antoine/Desktop/awok
git rm -r claude-setup/workflows/demo.yaml claude-setup/skills/demo \
  docs/architecture-cartography/demo.html docs/architecture-cartography/demo-texte.md \
  claude-setup/agents/collector.md claude-setup/agents/summarizer.md \
  claude-setup/workflow/templates/invocations/collector.md \
  claude-setup/workflow/templates/invocations/summarizer.md
```
Expected: `git rm` lists 8 paths removed (the skills dir counts as one tree).

- [ ] **Step 3: Verify test fixture survived**

Run: `ls claude-setup/workflow/templates/invocations/test-agent.md`
Expected: the file still exists.

- [ ] **Step 4: Run the awok test suite (migration health)**

Run: `cd /home/marc-antoine/Desktop/awok && python -m pytest claude-setup/scripts/tests/ -q 2>&1 | tail -20`
Expected: all pass (the suite uses the `minimal.yaml` fixture, not `demo`). If a test referenced `demo`, that is a test bug to fix separately — note it.

- [ ] **Step 5: Commit**

```bash
cd /home/marc-antoine/Desktop/awok
git add -A
git commit -m "chore(awok): remove the trivial demo workflow (replaced by onboard)"
```

---

### Task 2: Author `workflows/onboard.yaml`

**Files:**
- Create: `claude-setup/workflows/onboard.yaml`

- [ ] **Step 1: Write the workflow YAML**

Create `claude-setup/workflows/onboard.yaml` with exactly:

```yaml
schema_version: 1
skill:
  name: onboard
  description: |
    Map an unfamiliar repository. A cheap inventory pass plus a deterministic
    git-history analysis fan out into parallel explorers (structure, deps, flow),
    then reduce into an architecture doc and a getting-started guide. Run it on
    any repo (including this one) to learn it fast.
  title: "/onboard — repo cartography"
namespaces:
  work: work/onboard
groups:
  scan:
    description: Cheap initial scan of the target repo
    risk: none
  explore:
    description: Parallel exploration of the codebase
    risk: none
  synthesize:
    description: Synthesis of the deliverables
    risk: none
phases:
  - id: O0-INVENTORY
    name: Inventory
    group: scan
    type: agent
    invocations:
      - agent: repo-inventory
        model: haiku
        description: Inventory the repo tree, languages, build/config files and entry points
        inputs:
          - { path: ".", kind: dir, external: true }
        outputs:
          - { role: work:inventory, kind: md }
  - id: OG-GITSTATS
    name: Git history stats
    group: scan
    type: script
    description: >
      Deterministic git-history analysis (no LLM): commit volume, contributors,
      churn hotspots, commits per month. Demonstrates a type:script phase whose
      output feeds the synthesis reduce.
    inputs:
      - { path: ".git", kind: dir, external: true }
    outputs:
      - { role: work:git-stats, kind: md }
    cmd: |
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
  - id: O1-STRUCTURE
    name: Structure mapping
    group: explore
    type: agent
    depends_on: [O0-INVENTORY]
    invocations:
      - agent: structure-mapper
        model: sonnet
        description: Map modules/directories, responsibilities and boundaries
        inputs:
          - { role: work:inventory, kind: md }
        outputs:
          - { role: work:structure, kind: md }
  - id: O2-DEPS
    name: Dependency audit
    group: explore
    type: agent
    depends_on: [O0-INVENTORY]
    invocations:
      - agent: deps-auditor
        model: sonnet
        description: Audit dependencies, package manager, build, scripts, lint/test/CI
        inputs:
          - { role: work:inventory, kind: md }
        outputs:
          - { role: work:deps, kind: md }
  - id: O3-FLOW
    name: Flow tracing
    group: explore
    type: agent
    depends_on: [O0-INVENTORY]
    invocations:
      - agent: flow-tracer
        model: sonnet
        description: Trace entry points, commands/CLI and the main execution flow
        inputs:
          - { role: work:inventory, kind: md }
        outputs:
          - { role: work:flow, kind: md }
  - id: O4-ARCHITECTURE
    name: Architecture synthesis
    group: synthesize
    type: agent
    depends_on: [O1-STRUCTURE, O2-DEPS, O3-FLOW, OG-GITSTATS]
    invocations:
      - agent: architecture-writer
        model: opus
        description: Synthesize the architecture doc from the explorers and git stats
        inputs:
          - { role: work:structure, kind: md }
          - { role: work:deps, kind: md }
          - { role: work:flow, kind: md }
          - { role: work:git-stats, kind: md }
        outputs:
          - { role: work:architecture, kind: md }
  - id: O5-GETTING-STARTED
    name: Getting-started guide
    group: synthesize
    type: agent
    depends_on: [O4-ARCHITECTURE]
    invocations:
      - agent: onboarding-writer
        model: sonnet
        description: Write the getting-started / first-contribution guide
        inputs:
          - { role: work:architecture, kind: md }
          - { role: work:inventory, kind: md }
        outputs:
          - { role: work:getting-started, kind: md, terminal: true }
on_demand_agents:
  - agent: deep-diver
    model: sonnet
    description: |
      Zoom into one specific module/subsystem on demand and produce a focused
      deep-dive note, after the cartography is done.
    when: The user wants to drill into a specific module after reading the architecture doc.
```

- [ ] **Step 2: Sanity-check YAML parses**

Run: `cd /home/marc-antoine/Desktop/awok && python -c "import yaml; yaml.safe_load(open('claude-setup/workflows/onboard.yaml')); print('yaml ok')"`
Expected: `yaml ok` (no traceback). Do **not** run `awok validate` yet — the agent snippets/files don't exist, so generation-time checks would fail for the wrong reason.

---

### Task 3: Author the 6 invocation snippets

Each snippet's first line is the short description (kept semantically aligned with the agent frontmatter, per the descriptions convention). `generated: false` so `generate` never overwrites them.

**Files:**
- Create: `claude-setup/workflow/templates/invocations/repo-inventory.md`
- Create: `claude-setup/workflow/templates/invocations/structure-mapper.md`
- Create: `claude-setup/workflow/templates/invocations/deps-auditor.md`
- Create: `claude-setup/workflow/templates/invocations/flow-tracer.md`
- Create: `claude-setup/workflow/templates/invocations/architecture-writer.md`
- Create: `claude-setup/workflow/templates/invocations/onboarding-writer.md`

- [ ] **Step 1: `repo-inventory.md`**

```markdown
---
agent: repo-inventory
generated: false
---

**{{ agent }}** [{{ model }}] · Inventories the repo tree, languages and build/config files.
{{ inputs_outputs_compact }}

**Task**: Walk the target repo and write the `inventory`: top-level layout, detected languages, build/config/manifest files, candidate entry points, and rough sizes (file counts, LOC ballpark). Factual and compact — the explorers read it.
```

- [ ] **Step 2: `structure-mapper.md`**

```markdown
---
agent: structure-mapper
generated: false
---

**{{ agent }}** [{{ model }}] · Maps modules, responsibilities and boundaries.
{{ inputs_outputs_compact }}

**Task**: From the `inventory`, group the code into modules (by directory or cohesive unit). For each: name, one-line responsibility, and boundaries (what it owns, what it depends on). Write the `structure`.
```

- [ ] **Step 3: `deps-auditor.md`**

```markdown
---
agent: deps-auditor
generated: false
---

**{{ agent }}** [{{ model }}] · Audits dependencies, build and tooling.
{{ inputs_outputs_compact }}

**Task**: From the `inventory`, audit dependencies and tooling: package manager(s) and manifests, declared deps (grouped), build system and scripts, and lint/test/CI config. Write the `deps`.
```

- [ ] **Step 4: `flow-tracer.md`**

```markdown
---
agent: flow-tracer
generated: false
---

**{{ agent }}** [{{ model }}] · Traces entry points and the main execution flow.
{{ inputs_outputs_compact }}

**Task**: From the `inventory`, identify the real entry points (CLI, main, server) and trace the main execution path from startup to exit, naming the key functions/modules it passes through. Write the `flow`.
```

- [ ] **Step 5: `architecture-writer.md`**

```markdown
---
agent: architecture-writer
generated: false
---

**{{ agent }}** [{{ model }}] · Synthesizes the architecture doc from explorers + git stats.
{{ inputs_outputs_compact }}

**Task**: Synthesize the `architecture` from the `structure`, `deps`, `flow` and `git-stats`. Sections: Overview, Components (how they fit), Dataflow (grounded in `flow`), Activity hotspots (grounded in `git-stats`). Cite real names.
```

- [ ] **Step 6: `onboarding-writer.md`**

```markdown
---
agent: onboarding-writer
generated: false
---

**{{ agent }}** [{{ model }}] · Writes the getting-started / first-contribution guide.
{{ inputs_outputs_compact }}

**Task**: Using the `architecture` and `inventory`, write the `getting-started` guide: Prerequisites, Install/Setup (concrete commands), First run, and Where to contribute first (2-4 concrete low-risk starting points). Practical and concrete.
```

---

### Task 4: Author the 7 agent definitions

All agents use `model: inherit` in frontmatter (the real model is set per-invocation in the YAML). Task prose references roles, never hardcoded paths.

**Files:**
- Create: `claude-setup/agents/repo-inventory.md`
- Create: `claude-setup/agents/structure-mapper.md`
- Create: `claude-setup/agents/deps-auditor.md`
- Create: `claude-setup/agents/flow-tracer.md`
- Create: `claude-setup/agents/architecture-writer.md`
- Create: `claude-setup/agents/onboarding-writer.md`
- Create: `claude-setup/agents/deep-diver.md`

- [ ] **Step 1: `repo-inventory.md`**

```markdown
---
name: repo-inventory
description: Inventories a repository's tree, languages, build/config files and entry points into the work namespace. Use this agent to produce the shared inventory the explorers fan out from.
model: inherit
tools:
  - Read
  - Glob
  - Bash
---

You inventory an unfamiliar repository so downstream explorers can work in parallel.

Walk the repo from its root and produce a compact, factual inventory:
- Top-level directory layout (one line each, with purpose if obvious).
- Detected languages and their rough proportion.
- Build / config / manifest files (package.json, pyproject, Makefile, etc.).
- Candidate entry points (CLI, main, server, index).
- Rough size signals: file counts per area, LOC ballpark.

Use Glob and Bash (`ls`, `find`, `wc`) for breadth; Read only when a file's role is
unclear. Do not analyze logic deeply — that is the explorers' job. Write the result
to the `inventory` output declared for your invocation.
```

- [ ] **Step 2: `structure-mapper.md`**

```markdown
---
name: structure-mapper
description: Maps a codebase into modules with responsibilities and boundaries, reading the shared inventory. Use this agent for the structural view of an unfamiliar repo.
model: inherit
tools:
  - Read
  - Glob
  - Grep
---

You map an unfamiliar codebase into modules. Read the `inventory` first.

Using Glob/Grep/Read, group the code into modules (by directory or cohesive unit).
For each module write: its name, its responsibility in one line, and its boundaries —
what it owns and which other modules it depends on or is used by. Write the
`structure`. Stay structural: do not trace runtime flow (flow-tracer's job) or audit
dependencies (deps-auditor's job).
```

- [ ] **Step 3: `deps-auditor.md`**

```markdown
---
name: deps-auditor
description: Audits a repository's dependencies, package manager, build system and lint/test/CI tooling. Use this agent for the dependency-and-tooling view of an unfamiliar repo.
model: inherit
tools:
  - Read
  - Glob
  - Grep
  - Bash
---

You audit a repository's dependencies and tooling. Read the `inventory` first.

Identify: the package manager(s) and dependency manifests, the declared runtime and
dev dependencies (grouped), the build system and scripts, and the lint/test/CI
configuration. Use Read/Grep/Glob, and Bash to inspect lockfiles or list installed
tools when helpful. Write the `deps`. Do not map module structure or runtime flow.
```

- [ ] **Step 4: `flow-tracer.md`**

```markdown
---
name: flow-tracer
description: Traces a program's entry points and main execution flow from startup to exit, reading the shared inventory. Use this agent for the runtime view of an unfamiliar repo.
model: inherit
tools:
  - Read
  - Glob
  - Grep
---

You trace how a program actually runs. Read the `inventory` first.

Identify the real entry points (CLI commands, `main`, server bootstrap, index). Pick
the primary one and trace the main execution path from startup to exit/response,
naming the key functions/modules it passes through. Use Grep/Glob/Read. Write the
`flow`. Keep to the main path(s); do not enumerate every branch.
```

- [ ] **Step 5: `architecture-writer.md`**

```markdown
---
name: architecture-writer
description: Synthesizes an architecture document from the structure, deps, flow and git-stats analyses. Use this agent as the reduce step of a repo cartography.
model: inherit
tools:
  - Read
  - Write
---

You synthesize an architecture document from prior analyses. Read the `structure`,
`deps`, `flow` and `git-stats`.

Produce a coherent `architecture` document with these sections:
- Overview — what the project is and does.
- Components — each major module and how they fit together.
- Dataflow — how data/control moves, grounded in `flow`.
- Activity hotspots — the most-churned files and active areas, grounded in
  `git-stats`.

Be specific and cite real names. Write the `architecture`.
```

- [ ] **Step 6: `onboarding-writer.md`**

```markdown
---
name: onboarding-writer
description: Writes a getting-started / first-contribution guide from the architecture doc and inventory. Use this agent as the final deliverable step of a repo cartography.
model: inherit
tools:
  - Read
  - Write
---

You write a getting-started guide for a newcomer. Read the `architecture` and
`inventory`.

Produce a `getting-started` guide with:
- Prerequisites.
- Install / Setup — concrete commands.
- First run — how to see it work.
- Where to contribute first — 2-4 concrete, low-risk starting points grounded in the
  architecture.

Be practical and concrete: a new contributor should be productive after reading it.
Write the `getting-started`.
```

- [ ] **Step 7: `deep-diver.md`**

```markdown
---
name: deep-diver
description: On-demand agent that deep-dives one specific module or subsystem and produces a focused note. Use this agent when the user wants to drill into a module after the cartography.
model: inherit
tools:
  - Read
  - Glob
  - Grep
---

You are an on-demand deep-dive agent. Given a specific module or subsystem named by
the user (with the existing architecture doc as context), read that module closely
with Read/Glob/Grep and produce a focused deep-dive note: its internal structure, key
types/functions, invariants, and gotchas. Scope strictly to the requested module —
do not re-map the whole repo.
```

---

### Task 5: Validate the workflow

**Files:** none (verification gate).

- [ ] **Step 1: Run `awok validate`**

Run: `cd /home/marc-antoine/Desktop/awok && awok validate 2>&1; echo "rc=$?"`
Expected: `✅ [onboard] valid (...)` and `rc=0`, with **no** dataflow orphan warnings (every `work:` role has a producer and a consumer except `work:getting-started`, which is `terminal:true`; `.` and `.git` are `external:true`).

- [ ] **Step 2: Triage any failure**

If validate fails: read the message. Schema/coherence/role-prose errors → fix the YAML, snippet, or agent body (the role cited in a `**Task**` line must appear in that invocation's declared I/O, and vice-versa). If you suspect a tooling bug, apply the migration-triage rule: revert `onboard.yaml` aside, run `awok validate` on the clean tree (expect green), and only then log a separate tooling issue. Re-run Step 1 until green.

---

### Task 6: Generate artifacts and check drift

**Files (generated — do not hand-edit):**
- `claude-setup/skills/onboard/SKILL.md`
- `docs/architecture-cartography/onboard.html`
- `docs/architecture-cartography/onboard-texte.md`
- `docs/architecture-cartography/index.html`

- [ ] **Step 1: Generate**

Run: `cd /home/marc-antoine/Desktop/awok && awok generate 2>&1; echo "rc=$?"`
Expected: lines for `[onboard] SKILL.md`, `cartography-texte.md`, `cartography.html`, and `[index] ... (1 workflow(s))`, then `✅ 1 workflow(s) generated.` and `rc=0`.

- [ ] **Step 2: Inspect the generated SKILL.md for parallelism + script + on-demand**

Run:
```bash
cd /home/marc-antoine/Desktop/awok
grep -nE '∥|parallel|OG-GITSTATS|```bash|Agents on-demand|deep-diver' claude-setup/skills/onboard/SKILL.md | head -30
```
Expected: O1/O2/O3 show a `∥` parallel annotation; O0 and OG-GITSTATS show `∥` with each other; the `OG-GITSTATS` phase renders a ```` ```bash ```` block with the git script; an "Agents on-demand" section lists `deep-diver`. If any are missing, fix the YAML and re-generate.

- [ ] **Step 3: Verify no Jinja/template leakage**

Run: `cd /home/marc-antoine/Desktop/awok && grep -nE '\{\{|\{%|Undefined' claude-setup/skills/onboard/SKILL.md || echo "clean"`
Expected: `clean` (no unrendered template tokens).

- [ ] **Step 4: Drift check**

Run: `cd /home/marc-antoine/Desktop/awok && awok check 2>&1; echo "rc=$?"`
Expected: `✅ [onboard] no drift` and `rc=0`.

- [ ] **Step 5: Commit the source + generated artifacts**

```bash
cd /home/marc-antoine/Desktop/awok
git add claude-setup/workflows/onboard.yaml \
  claude-setup/workflow/templates/invocations/repo-inventory.md \
  claude-setup/workflow/templates/invocations/structure-mapper.md \
  claude-setup/workflow/templates/invocations/deps-auditor.md \
  claude-setup/workflow/templates/invocations/flow-tracer.md \
  claude-setup/workflow/templates/invocations/architecture-writer.md \
  claude-setup/workflow/templates/invocations/onboarding-writer.md \
  claude-setup/agents/repo-inventory.md claude-setup/agents/structure-mapper.md \
  claude-setup/agents/deps-auditor.md claude-setup/agents/flow-tracer.md \
  claude-setup/agents/architecture-writer.md claude-setup/agents/onboarding-writer.md \
  claude-setup/agents/deep-diver.md \
  claude-setup/skills/onboard/SKILL.md \
  docs/architecture-cartography/onboard.html \
  docs/architecture-cartography/onboard-texte.md \
  docs/architecture-cartography/index.html
git commit -m "feat(awok): add the onboard demo workflow (repo cartography, parallel fan-out + git script)"
```

---

### Task 7: Install and run end-to-end on the awok repo

This is the real end-to-end test: install the skill, then invoke `/onboard` on this repo and confirm both deliverables are produced. Runtime outputs land under `work/onboard/` and are **not** committed.

**Files (runtime, not committed):** `work/onboard/{inventory,git-stats,structure,deps,flow,architecture,getting-started}.md`

- [ ] **Step 1: Install**

Run: `cd /home/marc-antoine/Desktop/awok && ./claude-setup/install.sh 2>&1 | tail -20; echo "rc=$?"`
Expected: install completes `rc=0`; `~/.claude/skills/onboard/SKILL.md` exists (`ls ~/.claude/skills/onboard/SKILL.md`) and the 7 agents exist under `~/.claude/agents/`. Capture any error; triage per the migration rule (a broken `install.sh` is a tooling/migration concern, not an `onboard` content bug).

- [ ] **Step 2: Smoke-test the git script in isolation**

Run: `cd /home/marc-antoine/Desktop/awok && mkdir -p work/onboard && bash -c 'git rev-list --count HEAD && git log --pretty=format: --name-only | grep . | sort | uniq -c | sort -rn | head -5'`
Expected: a commit count and a short hotspots list (confirms the `OG-GITSTATS` `cmd` works against this repo before the agent run).

- [ ] **Step 3: Invoke `/onboard` on this repo**

In Claude Code, run the skill: `/onboard` targeting `/home/marc-antoine/Desktop/awok`. The orchestrator should run O0 + OG-GITSTATS (level 0), then O1/O2/O3 in parallel, then O4, then O5.
Expected outputs exist:
```bash
ls -la work/onboard/inventory.md work/onboard/git-stats.md work/onboard/structure.md \
       work/onboard/deps.md work/onboard/flow.md work/onboard/architecture.md \
       work/onboard/getting-started.md
```

- [ ] **Step 4: Sanity-read the two deliverables**

Open `work/onboard/architecture.md` (has Overview / Components / Dataflow / Activity hotspots, with the hotspots grounded in real git data) and `work/onboard/getting-started.md` (Prerequisites / Install / First run / Where to contribute). Confirm they describe awok correctly. Trace any agent/runtime error to its phase; apply the migration-triage rule before assuming a tooling fault.

- [ ] **Step 5: Confirm runtime outputs are not committed**

Run: `cd /home/marc-antoine/Desktop/awok && git status --porcelain work/ ; git check-ignore work/onboard/inventory.md || echo "NOT ignored — add work/ to .gitignore if needed"`
Expected: either `work/` is git-ignored, or it shows as untracked. Do not `git add` `work/onboard/` outputs. If `work/` is not ignored, add `work/` to `.gitignore` in a small follow-up commit.

---

## Self-review notes (author)

- **Spec coverage:** demo removal (T1), `onboard.yaml` with all phases/groups/namespaces (T2), 6 snippets (T3), 7 agents incl. on-demand (T4), `external`+`dir` I/O (O0/OG in T2), `terminal` (O5 in T2), `type:script`+`cmd` (OG in T2), three models haiku/sonnet/opus (T2), validate/generate/check gates (T5/T6), install + end-to-end on awok repo (T7), migration-triage rule (header + T5/T7). All spec sections map to a task.
- **`parallel_with`:** intentionally NOT declared in YAML — it is auto-derived by `generate` from topological levels and asserted present in T6 Step 2.
- **Naming consistency:** roles `inventory / git-stats / structure / deps / flow / architecture / getting-started` are used identically across YAML I/O, snippet `**Task**` prose, and agent bodies. Agent names match across `agents/<name>.md`, `invocations/<name>.md` frontmatter, and YAML `agent:` fields.
```
