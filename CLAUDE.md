# awok — Development Mode

> This file is read when working on **awok** itself.

## Context

**awok** is a workflow compiler for Claude Code. It transforms declarative YAML
files (`claude-setup/workflows/<name>.yaml`) into:
- `claude-setup/skills/<name>/SKILL.md` — a Claude Code orchestrator invocable via `/<name>`
- `docs/architecture-cartography/<name>.html` — visual cartography (4 tabs)
- `docs/architecture-cartography/<name>-texte.md` — ASCII version

Plus an index `docs/architecture-cartography/index.html` aggregating all
workflows.

It is **not** an execution engine — awok compiles and validates; it is Claude
Code that executes the workflows using the generated SKILL.md files.

**Main component**: `claude-setup/scripts/bb-workflow` (Python stdlib + PyYAML + Jinja2 + jsonschema)
**Web editor**: `claude-setup/workflow/templates/webedit/` (ES module JS, served locally)
**Demo workflow**: `claude-setup/workflows/demo.yaml`

## When you modify things here

### Multi-workflows

The generator supports **N named workflows** under `claude-setup/workflows/`.
Each YAML declares its own `skill: {name, description, title}` and produces its own
SKILL.md + cartography.html (visible in the page header) + an entry in
the index `docs/architecture-cartography/index.html` (generated automatically on
every `awok generate`).

**Current workflows**:
| Workflow | YAML | Generated skill | Cartography |
|---|---|---|---|
| `demo` | `workflows/demo.yaml` | `skills/demo/SKILL.md` | `demo.html` |

**Commands** (no arg → all; `--workflow NAME|PATH` → a single one):
```bash
awok validate                        # validate all
awok validate --workflow demo
awok generate                        # regenerate all + index.html
awok generate --workflow demo
awok check                           # drift check on all
awok new-phase --workflow demo       # wizard targeting a single workflow
awok assist "<change>" --workflow demo
```

**Create a new workflow**:
1. Create `claude-setup/workflows/<name>.yaml` with at minimum:
   ```yaml
   schema_version: 1
   skill:
     name: my-workflow               # → /my-workflow callable, required (kebab-case)
     description: |                   # shown by Claude Code AND in the HTML header, required
       One to three lines: what + when to use it.
     title: "/my-workflow — H1 Title"    # optional (default: "/my-workflow — my-workflow")
   groups: { ... }
   phases: [ ... ]
   on_demand_agents: [ ... ]         # optional
   ```
2. `awok validate` then `awok generate`
3. `./claude-setup/install.sh` → the skill `/my-workflow` becomes invocable

**Shared agents**: all agents in `claude-setup/agents/` are available
for all workflows. An agent can be referenced in N workflows. The invocation
snippet (`workflow/templates/invocations/<agent>.md`) is also shared.

### Workflow chaining: `type: workflow_call` phase

A workflow can **dispatch another workflow** like a skill via a dedicated
phase. No inlining (phases do not merge) — it is a simple call-out
that tells Claude to launch `/<other-workflow>` via the Skill tool, then return.

```yaml
phases:
  - id: W4-HANDOFF
    name: Switch to another workflow
    group: handoff
    type: workflow_call
    workflow: other-workflow    # ← name of the target workflow (≠ self)
    depends_on: [W1-PHASE]
    description: >
      Describes when and why this call-out is triggered.
```

**Consistency guarantees** (checked by `awok validate`):
- The `workflow:` field is mandatory for `type: workflow_call`
- The target must exist (`claude-setup/workflows/<target>.yaml`)
- A workflow **cannot call itself** (loop forbidden)

**Rendering**:
- In the SKILL.md → a block "🔗 This phase dispatches another workflow" with an instruction
- In the mermaid cartography → a node with a purple border to distinguish it

### Add or modify a pipeline phase

> **Modular workflow**: each workflow is defined in
> `claude-setup/workflows/<name>.yaml`. The corresponding `SKILL.md` and the
> HTML cartography are derived from it. **Never edit a SKILL.md by hand**.

**Add a phase using a new agent**:

1. **Create the agent**: `claude-setup/agents/<name>.md` with frontmatter
   ```yaml
   ---
   name: my-agent
   description: |
     Short sentence explaining what the agent does (reused in the generated SKILL.md).
   model: inherit          # ← ALWAYS "inherit", never a fixed value (see Conventions)
   tools:
     - Read
     - Grep
     - ...
   ---
   ```
   + body with the agent's full instructions.

2. **Create the invocation snippet**: `claude-setup/workflow/templates/invocations/<name>.md`
   ```markdown
   ---
   agent: my-agent
   generated: false      # false = hand-editable, the generator does not overwrite it
   ---

   **my-agent** [sonnet]{% if background %} (bg){% endif %} · Short description.
   {{ inputs_outputs_compact }}

   **Task**: Dense 1-3 sentence description of the work to do.
   ```

3. **Add the phase** in the target workflow (`claude-setup/workflows/<workflow>.yaml`):
   ```yaml
   phases:
     - id: TXX-NAME
       name: Readable name
       group: <collect | process | publish>
       depends_on: [UPSTREAM-PHASE]
       invocations:
         - agent: my-agent
           model: sonnet
           description: Description specific to this invocation
           inputs:
             - { path: path/in.json, kind: json }
           outputs:
             - { path: path/out.json, kind: json }
   ```

   > **Dataflow**: `validate` emits a warning if a `work/…` input has no
   > producer or a `work/…` output has no consumer (dir↔file matching
   > included). For a legitimate orphan, mark the I/O item: `external: true`
   > (input coming from outside the DAG) or `terminal: true`
   > (final output read outside the pipeline). See `docs/dev/bb-workflow.md`.

4. **Validate**: `awok validate` (schema + consistency + dataflow warnings)
5. **Regenerate**: `awok generate` (produces SKILL.md + cartography.html + cartography-texte.md)
6. **Deploy**: `./claude-setup/install.sh` (copies to `~/.local/bin/`)
7. **Test**: invoke the generated skill in Claude Code

**Modify an existing phase**: same as steps 3-7. For heavy changes, use
`awok assist "<description of the change>"` which prepares a prompt for
a Claude sub-agent that proposes consistent changes to the YAML + snippets.

**Rename an agent**: `awok rename-agent <old> <new>` updates
workflow.yaml + the snippet + `agents/<name>.md`. Then `awok generate`.

**Spec and plan**:
- Spec: `docs/superpowers/specs/2026-05-21-workflow-modulable-yaml-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-21-workflow-modulable-yaml.md`
- awok user doc: `docs/dev/bb-workflow.md`

### Modify an existing agent (without changing the phase)

1. Edit `claude-setup/agents/<agent>.md` (instructions + tools)
2. **If the short description changes**: also align the frontmatter description AND the snippet
   `claude-setup/workflow/templates/invocations/<agent>.md` (the 1st line after the frontmatter)
3. **If the inputs/outputs change**: edit `workflow.yaml` (the corresponding invocation)
4. Regenerate: `awok generate`
5. Deploy: `./claude-setup/install.sh`
6. Test the skill in Claude Code

## Architecture

- **Source of truth**: `claude-setup/` (agents, skills, workflows, templates)
- **Deployment**: `./claude-setup/install.sh` → `~/.local/bin/awok` (+ `bb-workflow` alias) + templates to `~/.local/share/bb-workflow/`
- **NEVER edit directly in `~/.local/`** — always edit in `claude-setup/`
- **Design**: `docs/superpowers/specs/` and `docs/superpowers/plans/`
- **Cartography**: `docs/architecture-cartography/`

## Workflow conventions (read before modifying)

### Single source: workflows/<name>.yaml generates its SKILL.md

| File | Status | Role |
|---|---|---|
| `claude-setup/workflows/<name>.yaml` | **Single source** (editable, one per workflow) | `skill: {name, description, title}` + phase DAG + agent invocations + I/O + brainstormings + manual sections + on_demand_agents |
| `claude-setup/workflow/templates/invocations/<agent>.md` | Editable (one per agent, shared) | Detailed prompt included in the generated SKILL.md |
| `claude-setup/workflow/manual/<section>.md` | Editable | Non-generated sections of the SKILL.md |
| `claude-setup/workflow/workflow.schema.json` | Editable | Shared JSON-Schema (validation `validate_schema`) |
| `claude-setup/skills/<workflow>/SKILL.md` | **GENERATED** (one per workflow) | NEVER edit by hand — overwritten on the next `awok generate` |
| `docs/architecture-cartography/<workflow>.html` | **GENERATED** (one per workflow) | Multi-tab view (Workflow + Dataflow + On-demand) with skill header, 100% offline |
| `docs/architecture-cartography/<workflow>-texte.md` | **GENERATED** (one per workflow) | ASCII version of the cartography |
| `docs/architecture-cartography/index.html` | **GENERATED** | Index of all workflows (clickable cards) |

### `model: inherit` convention

All agents have `model: inherit` in their frontmatter — NEVER a fixed value.
The actual model is set **per invocation** in `workflow.yaml` (`model: haiku/sonnet/opus`).
This lets the same agent be invoked with different models depending on the phase, and keeps the frontmatter
independent of orchestration. The source of truth for the model = `workflow.yaml`.

### Descriptions convention

Each agent has 3 descriptions to keep aligned (semantic consistency, not verbatim):

| Location | Audience | Format |
|---|---|---|
| `agents/<name>.md` frontmatter `description` | Claude Code (Task tool selector) | Short sentence + "Use this agent to..." (English, CC convention) |
| `workflow.yaml` invocation `description` | The generated SKILL.md (phase overview) | Short sentence, contextual to the phase |
| Snippet `templates/invocations/<name>.md` 1st line | Included in the SKILL.md (per invocation) | "**name** [model] · Short description" |

**When you modify an agent's description**, check all 3 locations. If a gap is detected,
align all 3.

## bb-workflow / awok (SKILL.md generator)

`SKILL.md` is generated from `claude-setup/workflows/<name>.yaml` via the
`awok` CLI (alias: `bb-workflow`). NEVER edit `SKILL.md` by hand.

**Commands**:
| Command | Effect |
|---|---|
| `awok validate` | Validates workflow.yaml (schema + consistency + dataflow warnings) |
| `awok generate` | Regenerates all artifacts (SKILL.md + cartography.html + cartography-texte.md) |
| `awok check` | Detects drift (exit 1 if SKILL.md ≠ generated) — used by pre-commit hook |
| `awok diff <phase>` | See what would change for a phase if regenerated |
| `awok assist "<change>"` | Prepares a sub-agent prompt for complex changes |
| `awok new-phase --interactive` | Sub-agent wizard to add a phase cleanly |
| `awok rename-agent <old> <new>` | Renames everywhere (YAML + snippet + agents/) |
| `awok edit [--workflow NAME]` | Launches the local web editor |
| `awok migrate-from-skill` | One-shot migration from an old manual SKILL.md |

**Modify bb-workflow itself**:
1. Source of truth: `claude-setup/scripts/bb-workflow` (Python stdlib + PyYAML + Jinja2 + jsonschema)
2. Templates: `claude-setup/workflow/templates/*.jinja` (skill-skeleton, cartography mermaid, etc.)
3. Tests: `pytest claude-setup/scripts/tests/test_workflow_*.py -v`
4. JSON schema: `claude-setup/workflow/workflow.schema.json` (validate on change)
5. Deployment: `./claude-setup/install.sh` copies to `~/.local/bin/awok` + templates to `~/.local/share/bb-workflow/`

**Spec and plan**:
- Spec: `docs/superpowers/specs/2026-05-21-workflow-modulable-yaml-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-21-workflow-modulable-yaml.md`
- User doc: `docs/dev/bb-workflow.md`

## superpowers plugin

The `superpowers@claude-plugins-official` plugin is recommended for awok dev:
- `/brainstorm` — design a new agent or an improvement
- `/write-plan` — plan the implementation
- `/execute-plan` — execute the plan with subagents

## What you must NOT do here

- Do NOT edit a `SKILL.md` by hand — it will be overwritten on the next `awok generate`
- Do NOT modify `CLAUDE.md` without a reason related to awok itself
- Do NOT fix a model in an agent's frontmatter (`model: inherit` always)
- Do NOT write in `~/.local/` directly — go through `install.sh`

## Spec / Plan / Doc — pointers

**Specs**:
- `docs/superpowers/specs/2026-05-21-workflow-modulable-yaml-design.md`
- `docs/superpowers/specs/2026-05-28-bb-workflow-web-editor-design.md`
- `docs/superpowers/specs/2026-05-29-bb-workflow-web-editor-v2-design.md`
- `docs/superpowers/specs/2026-06-02-bb-workflow-io-model.md`
- `docs/superpowers/specs/2026-06-02-prior-art-research.md`

**Plans**:
- `docs/superpowers/plans/2026-05-21-workflow-modulable-yaml.md`
- `docs/superpowers/plans/2026-05-28-bb-workflow-web-editor.md`
- `docs/superpowers/plans/2026-05-29-bb-workflow-web-editor-v2-lot1.md`
- `docs/superpowers/plans/2026-05-29-bb-workflow-web-editor-v2-lot2.md`
- `docs/superpowers/plans/2026-05-29-bb-workflow-web-editor-v2-lot3.md`
- `docs/superpowers/plans/2026-06-02-bb-workflow-io-model-lot1.md`

**User doc**:
- `docs/dev/bb-workflow.md`
