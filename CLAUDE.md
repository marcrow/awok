# awok — Development Mode

> This file is read when working on **awok** itself.

## Context

**awok** is a workflow compiler for Claude Code. It transforms declarative YAML
files (`src/workflows/<name>.yaml`) into:
- `src/skills/<name>/SKILL.md` — a Claude Code orchestrator invocable via `/<name>`
- `docs/architecture-cartography/<name>.html` — visual cartography (4 tabs)
- `docs/architecture-cartography/<name>-texte.md` — ASCII version

Plus an index `docs/architecture-cartography/index.html` aggregating all
workflows.

It is **not** an execution engine — awok compiles and validates; it is Claude
Code that executes the workflows using the generated SKILL.md files.

**Main component**: `src/scripts/bb-workflow` (Python stdlib + PyYAML + Jinja2 + jsonschema)
**Web editor**: `src/workflow/templates/webedit/` (ES module JS, served locally)
**Demo workflow**: `src/workflows/onboard.yaml`

## When you modify things here

### Multi-workflows

The generator supports **N named workflows** under `src/workflows/`.
Each YAML declares its own `skill: {name, description, title}` and produces its own
SKILL.md + cartography.html (visible in the page header) + an entry in
the index `docs/architecture-cartography/index.html` (generated automatically on
every `awok generate`).

**Current workflows**:
| Workflow | YAML | Generated skill | Cartography |
|---|---|---|---|
| `onboard` | `workflows/onboard.yaml` | `skills/onboard/SKILL.md` | `onboard.html` |
| `create-workflow` | `workflows/create-workflow.yaml` | `skills/create-workflow/SKILL.md` | `create-workflow.html` |
| `workflow-doctor` | `workflows/workflow-doctor.yaml` | `skills/workflow-doctor/SKILL.md` | `workflow-doctor.html` |
| `edit-workflow` | `workflows/edit-workflow.yaml` | `skills/edit-workflow/SKILL.md` | `edit-workflow.html` |

**Commands** (no arg → all; `--workflow NAME|PATH` → a single one):
```bash
awok validate                        # validate all
awok validate --workflow onboard
awok generate                        # regenerate all + index.html
awok generate --workflow onboard
awok check                           # drift check on all
awok new-phase --workflow onboard    # wizard targeting a single workflow
awok assist "<change>" --workflow onboard
```

**Create a new workflow**:

> **Recommended path: `/create-workflow`.** The bundled meta-workflow brainstorms the
> design with you (adversarial + generative — it pushes back and proposes options you
> didn't name), then scaffolds the YAML + agents + snippets, validates, generates and
> quality-reviews it. The manual steps below are the fallback and the reference for
> what it produces. After building — or before trusting any workflow — audit it with
> **`/workflow-doctor`** (static health-check: agent fitness, semantic seam continuity,
> prose↔declared drift).

1. Create `src/workflows/<name>.yaml` with at minimum:
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
3. `./install.sh` → the skill `/my-workflow` becomes invocable

**Shared agents**: all agents in `src/agents/` are available
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
- The target must exist (`src/workflows/<target>.yaml`)
- A workflow **cannot call itself** (loop forbidden)

**Rendering**:
- In the SKILL.md → a block "🔗 This phase dispatches another workflow" with an instruction
- In the mermaid cartography → a node with a purple border to distinguish it

### Opportunistic phases: `opportunistic` field

Grants the **main orchestrator** a scoped licence to *author and dispatch ad-hoc
sub-agents* (via the `Task` tool, `general-purpose`/`Explore`, with a prompt
written on the fly) when it spots something the planned agents don't cover —
e.g. on `onboard`'s `O2-DEPS`, noticing an old dependency and spinning up an
ad-hoc CVE lookup; in pentest recon, detecting WordPress and launching
specialised recon.

awok has no runtime, so this is purely **instructions injected into `SKILL.md`**,
scoped to the phase. The spawning power belongs to the main agent only — a
sub-agent cannot itself spawn sub-agents (Claude Code nesting limit = 1), so the
licence is exercised at the orchestration seam, after the planned sub-agent
returns.

`opportunistic` is `bool | object`, available at two levels:

```yaml
# top-level (workflow-wide default)
opportunistic:
  enabled: true
  when: |
    When you spot a signal the planned agents don't cover.
  examples:
    - "detected tech/CMS → specialised recon"

phases:
  - id: O2-DEPS
    opportunistic:                 # override: adds targeted guidance → 🧭
      when: "A dependency looks old / abandoned."
      examples: ["old dependency → ad-hoc agent that looks up known CVEs"]
  - id: O4-ARCHITECTURE
    opportunistic: false           # lock a deterministic reduce → ⛔
```

Resolution: a phase with `opportunistic: false` is locked; `true`/object is
enabled; absent inherits the global default. `false` is the only way to disable.

Rendering: a global "🧭 Opportunistic autonomy" section (when the global default
is on) + per-phase notes (🧭 lead / ⛔ locked). The cartography marks 🧭 phases
that carry their own content and ⛔ locked phases.

**vs `on_demand_agents`**: those are out-of-DAG agents triggered by `when:`/
`triggered_by:` (hooks, skills); `opportunistic` is in-DAG, attached to a phase,
and the agents are authored on the fly rather than pre-written in `src/agents/`.

### Completeness-gate pattern (`completeness-critic`)

A **reusable thoroughness gate** you drop after any hunt/validation agent so a rushed
sub-agent (one that stops at the first WAF/403/no-IDOR and declares "not exploitable") is
caught and looped until it has really tried. It is a shared agent
(`src/agents/completeness-critic.md`) plus a wiring idiom — **no engine feature**. Full recipe:
`docs/superpowers/specs/2026-07-03-completeness-critic-design.md`.

Wire it as **two forward phases** after the watched phase (the DAG stays acyclic; the loop is
prose in the gate, so no back-edge):

1. **Enable the attempt-log** — add one line to the *watched phase's* `description` telling the
   orchestrator to inject "log every attempt AND abandonment to `work/<ns>/attempt-log.md`" at
   launch. This edits the phase prose, **never the watched agent's `.md`** — the critic judges what
   was *tried*, not just what was *found* (a findings draft is positives-only, so judging from
   absence would false-loop).
2. **The critic** (`type: agent`, `depends_on` the watched phase): reads the attempt-log + draft
   (+ optional skill/reference via a `path:` input, + optional watched spec) and returns ONE line —
   `COMPLETENESS <SUFFICIENT|INSUFFICIENT|INCONCLUSIVE> | DIR=<PROCEED|RE-DISPATCH|RE-TEST-METHOD> | … | GAPS=<path>`.
   It writes depth to `gaps.md` + an append-only `ledger.jsonl` (the file-backed pass counter that
   bounds the loop and survives compaction).
3. **The gate** (`type: main_agent`, `depends_on` the critic): a PURE ROUTER — reads only the
   token, and on `DIR=RE-DISPATCH` (and `ATTEMPT<cap`) re-launches the watched agent with the gaps
   *path* appended; on `PROCEED`/cap/unparseable it advances. It never re-reads or re-judges the
   output — the judgment lives entirely in the critic. Nesting=1 holds: the gate (main agent)
   re-dispatches, the critic never spawns.

Its domain knowledge lives in **four layers**, so the body stays generic and reusable across
seams (even beyond pentest): (1) a POSTURE doctrine in the agent body — *not* an attack catalog,
the model already knows the classes; (2) the model's native attack knowledge; (3) an optional
skill/reference file per placement (`{ path: "refs/ssti.md", kind: md, optional: true, external: true }`);
(4) the per-invocation `description` (`stage`/`frame`/`cap`/rigor-bar). Pin it on `sonnet`. The
same agent + gate skeleton, with an inverted doctrine, later gives you a false-positive *validator*.

### Add or modify a pipeline phase

> **Modular workflow**: each workflow is defined in
> `src/workflows/<name>.yaml`. The corresponding `SKILL.md` and the
> HTML cartography are derived from it. **Never edit a SKILL.md by hand**.

**Add a phase using a new agent**:

1. **Create the agent**: `src/agents/<name>.md` with frontmatter
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

2. **Create the invocation snippet**: `src/workflow/templates/invocations/<name>.md`
   ```markdown
   ---
   agent: my-agent
   generated: false      # false = hand-editable, the generator does not overwrite it
   ---

   **my-agent** [sonnet]{% if background %} (bg){% endif %} · Short description.
   {{ inputs_outputs_compact }}

   **Task**: Dense 1-3 sentence description of the work to do.
   ```

3. **Add the phase** in the target workflow (`src/workflows/<workflow>.yaml`):
   ```yaml
   phases:
     - id: TXX-NAME
       name: Readable name
       group: <collect | process | publish>
       depends_on: [UPSTREAM-PHASE]
       invocations:
         - agent: my-agent
           model: sonnet
           effort: high          # optional — reasoning effort; omit to inherit the main agent's
           description: Description specific to this invocation
           inputs:
             - { role: work:endpoints, kind: json }
           outputs:
             - { role: work:report, kind: md, terminal: true }
   ```

   > **I/O model (role + namespaces — read `docs/dev/bb-workflow.md`)**: an
   > `io_ref` is identified by a **`role`**, not a hardcoded path. The concrete
   > path is derived at `generate` from the top-level **`namespaces`** map and
   > the `kind` extension:
   > - `role: ns:name` + `namespaces: { ns: work/foo }` → `work/foo/name<ext>`
   >   (`ext` from `kind`: `json→.json`, `md→.md`, `yaml→.yaml`, `text→.txt`,
   >   `jsonl→.jsonl`, `sqlite→.sqlite`; `kind: dir` → `work/foo/name/`;
   >   `binary` → no extension). Example from `onboard.yaml`: `namespaces: { work: work/onboard }`
   >   + `role: work:getting-started, kind: md` → `work/onboard/getting-started.md`.
   > - The namespace can be a `role` prefix (`ns:name`) or a separate
   >   `namespace: ns` field with a bare `role: name`.
   > - **`path:` still works as an override/escape hatch** (out-of-convention
   >   files like `scope.md`); when present it wins over `role`.
   > - The YAML stays role-based (source of truth); resolution to concrete paths
   >   happens at `generate` for the SKILL.md, dataflow and validation. Each
   >   io_ref requires `kind`. Flags: `optional`, `external`, `terminal`.
   > - **Validation**: a `role` whose namespace is not declared in `namespaces`
   >   is a **blocking error**.

   > **Dataflow**: `validate` emits a warning if a `work/…` input has no
   > producer or a `work/…` output has no consumer (dir↔file matching
   > included). For a legitimate orphan, mark the I/O item: `external: true`
   > (input coming from outside the DAG) or `terminal: true`
   > (final output read outside the pipeline). See `docs/dev/bb-workflow.md`.

4. **Validate**: `awok validate` (schema + consistency + dataflow warnings)
5. **Regenerate**: `awok generate` (produces SKILL.md + cartography.html + cartography-texte.md)
6. **Deploy**: `./install.sh` (CLI wrappers to `~/.local/bin/` + skills/agents to `~/.claude/`; restart Claude Code to register new agents)
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

1. Edit `src/agents/<agent>.md` (instructions + tools)
2. **If the short description changes**: also align the frontmatter description AND the snippet
   `src/workflow/templates/invocations/<agent>.md` (the 1st line after the frontmatter)
3. **If the inputs/outputs change**: edit `workflow.yaml` (the corresponding invocation)
4. Regenerate: `awok generate`
5. Deploy: `./install.sh`
6. Test the skill in Claude Code

## Architecture

- **Source of truth**: `src/` (agents, skills, workflows, templates)
- **Deployment**: `./install.sh` → venv + `~/.local/bin/{awok,bb-workflow}` wrappers, and deploys `src/skills/*` → `~/.claude/skills/` + `src/agents/*` → `~/.claude/agents/` (additive; override target via `CLAUDE_HOME`)
- **NEVER edit directly in `~/.local/`** — always edit in `src/`
- **Design**: `docs/superpowers/specs/` and `docs/superpowers/plans/`
- **Cartography**: `docs/architecture-cartography/`

## Engine vs content root (`--workdir`)

awok separates two roots so private workflows can live in a **separate repo**
while reusing this engine:

- **ENGINE_ROOT** — this awok repo. Owns the engine: `src/scripts/bb-workflow`,
  the Jinja templates `src/workflow/templates/*.jinja`, `workflow.schema.json`,
  `html-wrapper.html`, webedit.
- **CONTENT_ROOT** — `--workdir DIR` (or `$AWOK_WORKDIR`); defaults to ENGINE_ROOT,
  so with no flag everything behaves as before. Owns the content: `src/workflows/`,
  `src/agents/`, `src/workflow/templates/invocations/`, `src/workflow/manual/`,
  and the generated `src/skills/` + `docs/architecture-cartography/`.

A content workdir is "an awok repo minus the engine" — it mirrors `src/` and its
agents are **self-sufficient** (resolved only from the workdir; templates + schema
come from the engine).

```bash
awok init   --workdir ~/pentest-workflows   # scaffold (idempotent)
awok --workdir ~/pentest-workflows validate
awok --workdir ~/pentest-workflows generate
awok deploy --workdir ~/pentest-workflows   # → ~/.claude/{skills,agents}
```

Precedence: `--workdir` > `$AWOK_WORKDIR` > engine. `$BB_WORKFLOW_REPO` still
overrides ENGINE_ROOT only.

## Workflow conventions (read before modifying)

### Vocabulary: action / stage / group

Three distinct axes (see `docs/dev/execution-model.md` for the full execution model):

| Term | What it is | Declared? |
|---|---|---|
| **action** | The unit block of work: one agent, one script, one direct main-agent action, or one `workflow_call`. The thing you edit. | Yes |
| **stage** | The "row" / depth level: actions at the same topological distance from a root. A *reading* of the DAG, not a container. | **No — derived** from `depends_on` |
| **group** | The transverse colored band (e.g. `scan`/`explore`/`synthesize`). A semantic category that may span several stages. | Yes |

Key facts: an action is a single unit (no intra-action ordering); order exists
**only between actions** via `depends_on`; a stage is never declared (it is
recomputed from the edges, and describes graph shape, not timing).

> ⚠️ **Transition note**: the YAML/code still call the action block `phase`
> (`phases:` key, `phase` identifiers). **Read "phase" as "action".** The rename
> to `action`/`stage` is planned but not yet applied.

### Single source: workflows/<name>.yaml generates its SKILL.md

| File | Status | Role |
|---|---|---|
| `src/workflows/<name>.yaml` | **Single source** (editable, one per workflow) | `skill: {name, description, title}` + `namespaces` (role→base-path map) + phase DAG + agent invocations + I/O by role + brainstormings + manual sections + on_demand_agents |
| `src/workflow/templates/invocations/<agent>.md` | Editable (one per agent, shared) | Detailed prompt included in the generated SKILL.md |
| `src/workflow/manual/<section>.md` | Editable | Non-generated sections of the SKILL.md |
| `src/workflow/workflow.schema.json` | Editable | Shared JSON-Schema (validation `validate_schema`) |
| `src/skills/<workflow>/SKILL.md` | **GENERATED** (one per workflow) | NEVER edit by hand — overwritten on the next `awok generate` |
| `docs/architecture-cartography/<workflow>.html` | **GENERATED** (one per workflow) | Multi-tab view (Workflow + Dataflow + On-demand) with skill header, 100% offline |
| `docs/architecture-cartography/<workflow>-texte.md` | **GENERATED** (one per workflow) | ASCII version of the cartography |
| `docs/architecture-cartography/index.html` | **GENERATED** | Index of all workflows (clickable cards) |

### Orchestration (portes logiques)

A workflow's DAG (`depends_on`) says *what can run once its deps are done*; it
cannot express a loop or a branch. **Orchestration is a separate, optional
sibling file**: `src/workflows/<name>.orchestration.yaml`, a plain list of
control-flow blocks. `load_workflow` grafts it under `model["orchestration"]`
if present. **Absent ⇒ no key ⇒ pure DAG, identical output** — nothing about
existing workflows changes until you add the file.

**Five constructs** (block-tree, nestable): `ref` (run one phase), `if/then/else`,
`while`, `until`, `for_each` (+ `as`, iterates a list signal). Every `while`/`until`/`for_each`
**requires a mandatory `cap`** (max iterations) — `validate_orchestration` rejects an uncapped
loop.

There is no explicit `parallel` construct: concurrency comes from `depends_on` — two
actions with no dependency between them (same scope or not) run together by default,
exactly like in the plain DAG. A dependency may only target the **same scope, an
ancestor scope, or a sibling block** — it can never reach *into* a block from outside;
depend on the whole block instead, via its `id`. A loop (`while`/`until`/`for_each`) may
declare an `output:` role that downstream phases read — a directory for `for_each`'s
per-iteration fan-out, or an appended jsonl for `while`/`until`'s accumulator pattern.

See `docs/superpowers/specs/2026-07-14-orchestration-depends-on-unification-design.md`
for the full depends_on-unification design (removal of `parallel`, the visibility rule,
block `id`, loop `output`).

**Signals**: a phase opts in to emitting one with `emits: [{name, type, source,
from?}]` — `source: field` (a field of a json output, `from: <path>`) or
`source: token` (a compact end-of-output line, e.g. `SIGNALS: status=vuln`).
Nothing is emitted unless declared. The signal's key is
**`<phase_id_lowercase>.<name>`** (e.g. `RECON` emitting `endpoints` → the
condition operand `recon.endpoints`).

**Golden rule**: a condition reads **only a named signal field or a compact
token — never a whole artifact reload**. This keeps loop/branch evaluation
cheap and keeps the orchestrator from re-parsing a large report just to check
one status.

`src/workflow/orchestration-capabilities.yaml` is the **single source of
truth** for the js-safe vs standard-only frontier (which operators/builtins/
operand-kinds are allowed per compile target — `standard` is Claude-Code-only,
`js` must also run in a browser-side interpreter). `validate_orchestration`
reads it; nothing else hardcodes that matrix. `render_orchestration` turns the
block tree into the SKILL.md's "## Execution protocol" section — the
event-driven ready-set protocol followed by the nested "### Control flow"
branch/loop program; `build_orchestration_overlay` feeds the cartography's
branch diamonds and loop subgraphs.

**Authoring in the web editor (`awok edit`)**: the orchestration view renders the
whole DAG with gates as frames (then/else/body lanes). Drag an action into a lane
to gate it (its `depends_on` is renewed to the block context) or onto the grid to
ungate it; drag/nest gates; an action depends on a whole block by picking the
block (by its persisted `COND_n`/`LOOP_n` id) in the Wiring "Depends on" list. A
gate is placed at the level of its condition's **signal producer** (when the
condition can be evaluated), not its branch contents. The frame position is
display-only — real ordering is always `depends_on`; the "⤳ Dependencies" arrows
carry it, including an arrow into a gate frame from a deeper blocking dependency.

See `docs/superpowers/specs/2026-07-13-portes-logiques-orchestration-design.md`
for the full design, and the fixture pair
`src/scripts/tests/fixtures/workflows/orchestrated.(yaml|orchestration.yaml)`
for a minimal worked example.

### `model: inherit` convention

All agents have `model: inherit` in their frontmatter — NEVER a fixed value.
The actual model is set **per invocation** in `workflow.yaml` (`model: haiku/sonnet/opus`).
This lets the same agent be invoked with different models depending on the phase, and keeps the frontmatter
independent of orchestration. The source of truth for the model = `workflow.yaml`.

### `effort:` per-invocation (optional)

Alongside `model:`, an invocation may pin a reasoning **`effort`** —
`low | medium | high | xhigh | max` (the Claude effort levels) — in `workflow.yaml`. The
**source** agent frontmatter stays clean (`model: inherit`, no effort). **Omit it (or
`inherit`)** and the sub-agent runs at the main agent's effort — that is the default, and
it is fine.

**Runtime mechanism — different from `model`.** The `Task` tool has **no** `effort`
argument, so effort cannot be a launch arg the way `model` is. Instead `awok deploy`
**materializes** the pinned effort into the *deployed* agent frontmatter
(`~/.claude/agents/<name>.md` → `effort: <level>`), which overrides the session effort; the
sub-agent then applies it on its own. The SKILL.md ⚙️ line only records it for reference.
Deploy re-derives from the clean source every time, so removing the pin and re-deploying
clears the key. Two guard rails (both emit a warning and inject nothing):
- **Conflict** — the same agent invoked with two different efforts can't fit one frontmatter.
- **Model gating** — effort errors on the `haiku` tier (and any model that doesn't support it).

Settable per invocation in the web editor (the dropdown beside the model dropdown) and on
on-demand agents — the YAML/UI stays the source of truth; only `deploy` writes frontmatter.

### Descriptions convention

Each agent has 3 descriptions to keep aligned (semantic consistency, not verbatim):

| Location | Audience | Format |
|---|---|---|
| `agents/<name>.md` frontmatter `description` | Claude Code (Task tool selector) | Short sentence + "Use this agent to..." (English, CC convention) |
| `workflow.yaml` invocation `description` | The generated SKILL.md (phase overview) | Short sentence, contextual to the phase |
| Snippet `templates/invocations/<name>.md` 1st line | Included in the SKILL.md (per invocation) | "**name** [model] · Short description" |

**When you modify an agent's description**, check all 3 locations. If a gap is detected,
align all 3.

### Prompt-assist vocabularies (`vocab.yaml` + `custom/` overlay)

The formatter's prompt-assist knobs (`length`, `tone`, `format`, `audience`,
`language`, `stance`) are a **data-driven vocabulary**, global to the engine
(not per-workflow). Two layers, merged by `load_vocab()`:

- **Base** — `src/workflow/vocab.yaml` (engine, canonical, versioned). Each option
  carries a human `definition` and the injected `prose`.
- **User overlay** — `custom/vocab.yaml` at the project root (**gitignored**, survives
  engine upgrades and `install.sh`). Resolution: base ← `ENGINE_ROOT/custom` (shared by
  ALL projects) ← `CONTENT_ROOT/custom` (this `--workdir` only; workdir wins). An overlay
  may **add** or **reword** options, never delete a base one; the knob set is fixed. Each
  option carries a `weight` — the engine sorts options by it (the editor's slider order).

`compile_style()` reads the merged store (no hardcoded maps); unknown values fall back
to the knob's `prose_template`, so `def_formatter.style` stays schema-open. The web
editor (dedicated awok settings page, the ⚙ button) reads it via `GET /api/vocab` and
writes both overlays via `PUT /api/vocab` — each option has a **scope** toggle (this
project → `CONTENT_ROOT/custom`, or shared → `ENGINE_ROOT/custom`); with no `--workdir`
the two collapse to one file and the toggle is hidden. Custom options are deletable in
the UI (base ones are not). Never hand-edit a generated SKILL.md. Design:
`docs/superpowers/specs/2026-07-20-editable-formatter-vocabularies-design.md`.

### Patching the engine or a template — the change ripples to every workflow

Editing one workflow's `.yaml` is **local**. Editing the **engine**
(`src/scripts/bb-workflow`) or a **shared template** (`src/workflow/templates/*.jinja`)
is **global**: it re-renders **every** `SKILL.md` and cartography on the next
`generate`. So an engine fix is transparent to workflow authors (no YAML edit needed),
but it does **not** propagate on its own. After any engine/template change:

1. **Regenerate everything** — `awok generate` (no `--workflow` → all workflows + index).
2. **Commit the regenerated artifacts in the same commit** — the `src/skills/*/SKILL.md`
   and `docs/architecture-cartography/*` diffs are part of the patch. The `awok check`
   pre-commit gate fails the commit if you forget one.
3. **Redeploy** — `./install.sh`. Regenerating the source is not enough: the runtime
   reads `~/.claude/skills/<wf>/SKILL.md`, not `src/skills/`.
4. **Add a regression test** in `src/scripts/tests/` (positive + negative) whenever the
   change alters generated output — see the model-imperative guard
   (`test_generate_skill_emits_model_imperative`) in `test_workflow_generate.py`.

**`awok check` / drift is the signal.** After the engine changes, any workflow whose
committed `SKILL.md` was built by the old engine goes red until regenerated; green again
means the ripple reached every artifact — it doubles as your to-do list.

**Private workdirs do NOT ripple automatically.** Workflows in a separate content root
(`--workdir`, e.g. the pentest / invest repos) keep their own generated `SKILL.md`;
pulling this engine changes nothing for them. Their owner must run, in the workdir:
`awok --workdir DIR generate && awok deploy --workdir DIR`.

**Covering the specific case — commit-message discipline.** Any engine/template patch
that changes generated output carries, in its commit body, a `Regen:` trailer naming
what re-renders and the one-line action workdir owners must run — so it is discoverable
from `git log --grep '^Regen:'`:

```
Regen: all SKILL.md (per-invocation model imperative);
       workdir owners run `awok generate && awok deploy`.
```

Worked example of the whole loop: commit `0586259` (per-invocation model rendered as an
imperative, not a decorative label — the headless-tiering fix).

## bb-workflow / awok (SKILL.md generator)

`SKILL.md` is generated from `src/workflows/<name>.yaml` via the
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
1. Source of truth: `src/scripts/bb-workflow` (Python stdlib + PyYAML + Jinja2 + jsonschema)
2. Templates: `src/workflow/templates/*.jinja` (skill-skeleton, cartography mermaid, etc.)
3. Tests: `pytest src/scripts/tests/test_workflow_*.py -v`
4. JSON schema: `src/workflow/workflow.schema.json` (validate on change)
5. Deployment: `./install.sh` installs the `~/.local/bin/awok` wrapper + deploys skills/agents to `~/.claude/`
6. **Ripple**: an engine/template change re-renders **every** workflow — regenerate all,
   commit the regenerated artifacts, redeploy, and add the `Regen:` commit trailer. See
   *Patching the engine or a template* under Workflow conventions. `awok check` gates it.

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
- `docs/superpowers/specs/2026-06-03-onboard-demo-workflow-design.md`

**Plans**:
- `docs/superpowers/plans/2026-05-21-workflow-modulable-yaml.md`
- `docs/superpowers/plans/2026-05-28-bb-workflow-web-editor.md`
- `docs/superpowers/plans/2026-05-29-bb-workflow-web-editor-v2-lot1.md`
- `docs/superpowers/plans/2026-05-29-bb-workflow-web-editor-v2-lot2.md`
- `docs/superpowers/plans/2026-05-29-bb-workflow-web-editor-v2-lot3.md`
- `docs/superpowers/plans/2026-06-02-bb-workflow-io-model-lot1.md`
- `docs/superpowers/plans/2026-06-03-onboard-demo-workflow.md`

**User doc**:
- `docs/dev/bb-workflow.md`
