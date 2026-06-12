# Design — Parallelism made imperative in the generated SKILL.md

> Date: 2026-06-12. Engine change to `bb-workflow` + `skill-skeleton.md.jinja`.
> Companion to the model-imperative fix (commit `0586259`): same shape — turn a
> structural intent that the orchestrator silently dropped into an explicit
> instruction it reads at the point of action.

## Problem (measured)

Two real headless runs of a multi-action workflow were transcript-analysed. In
both, the orchestrator **never** emitted more than one tool call per assistant
message (`tool_use per turn = {1: N}`, `multi-Task turns = 0`). Agents declared
to run "in parallel" were launched **one per turn, in series**, followed by a
read/narrate turn each — inflating the orchestrator's turn count (47 and 82),
and with it the dominant cost driver (cache-read/cache-write re-paid every turn).

Root cause: the generated `SKILL.md` expresses parallelism only **structurally**
(several invocations under one action; sibling actions sharing a stage, marked
`∥`) but **never as an imperative**. The orchestrator has to *infer* "emit these
in one message" — reliable interactively, silently dropped headless. This mirrors
the model-tiering loss already fixed: declared-but-not-instructed.

## Grounding — `docs/dev/execution-model.md`

The fix encodes that doc's "Garanti vs suggéré" line, unchanged:

- `depends_on` is **structuring** (hard): ordering exists only between actions, via
  edges. An action must not start until every `⇐` dependency has returned.
- `stage` / `parallel_with` (`∥`) are **hints**: "these are parallelisable" — the
  orchestrator decides. The fix turns the hint into an explicit launch instruction
  **without** weakening the hard rule.

Vocabulary (target, per execution-model.md): **action** = the unit block (the
thing currently keyed `phases:` in YAML); **stage** = the derived DAG depth level;
**group** = transverse category. The word **"phase" is banned from generated
prose**; it stays only as Jinja identifiers (`phase`, `phase_count`) pending the
dedicated rename (Palier 3).

## Design

### Piece A — global "Execution protocol" section

Emitted near the top of the `SKILL.md` (after the convention notes, before the
Opportunistic section), **only when `any_parallelism`** is true. No workflow name
or other concrete example is hardcoded — abstract rules only (traceability).

Exact rendered text:

```
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
```

### Piece B — per-action ⚡ reminder (intra-action parallelism)

The `∥` marker already makes **inter-action** parallelism visible, so Piece A is
enough for it. **Intra-action** parallelism (one action listing several agents) is
otherwise invisible — the invocations just render in sequence. So a targeted
reminder is emitted **only when an action has ≥2 invocations**, right under the
action header, before its invocation blocks:

```
> ⚡ **Parallel — {N} independent agents** (no order between them). Launch all {N}
> in a single message ({N} `Task` blocks), not one at a time; wait for all to
> return before moving on.
```

`{N}` = `phase.invocations|length`. Script / external / workflow_call actions have
< 2 invocations, so the guard excludes them naturally.

### Piece C — vocabulary alignment (bundled, prose only)

Align the user-facing English word "phase"/"phases" in generated prose to
"action"/"actions". Jinja identifiers (`phase`, `phase_count`, `phase.id`, …) are
**untouched** — their rename is the separate Palier 3. Spots in
`skill-skeleton.md.jinja`:

1. `Pipeline of {{ phase_count }} phases, organized into …` → `… actions, organized into …`
2. Opportunistic global: `… continue the current phase` → `… the current action`
3. Opportunistic global: `**Scope**: all phases, except those marked ⛔` → `all actions, …`
4. `## Pipeline phases (DAG)` → `## Pipeline actions (DAG)`
5. Interactive checkpoint: `for this phase … advance to the next phase` → `for this action … the next action`
6. Opportunistic per-action note: `permitted on this phase` → `on this action`

## Gating

- `any_parallelism` (Python, in `generate_skill_md`, computed **after**
  `apply_parallel_with` so `parallel_with` is populated):
  `any(len(p.get("invocations") or []) >= 2 for p in phases)` **or**
  `any(p.get("parallel_with") for p in phases)`. Passed to the template alongside
  the existing `any_invocation_model`.
- Piece B guard: `{% if phase.invocations and phase.invocations|length >= 2 %}` in
  the template, placed once after the action header/notes and before the
  type-specific rendering (so it precedes both the `agent` and `main_agent`
  invocation loops).

## Safety

Piece A **leads with the hard `⇐` rule** before authorising any parallelism, so the
instruction can only narrow, never broaden, what runs early. No risk of launching
an action before its dependencies return.

## Code locations

- `src/workflow/templates/skill-skeleton.md.jinja`: Piece A section (gated), Piece B
  reminder (gated), Piece C wording.
- `src/scripts/bb-workflow` (`generate_skill_md`): `any_parallelism` flag + pass to
  `template.render(...)`.

## Tests (all fixtures/examples from the awok repo — no `loup`)

`src/scripts/tests/test_workflow_generate.py`:

- **Piece A present**: a workflow with sibling actions sharing a stage (the
  `onboard` shape: roots → 3 independent actions → reduce) renders the "Execution
  protocol" heading and the `⇐` / `∥` rules.
- **Piece B present**: a workflow with one action of ≥2 invocations (the
  `create-workflow` `S4-BLOCK-REVIEW` shape) renders `⚡ **Parallel — 2 independent
  agents**` and `2 `Task` blocks`.
- **Negative**: a linear, single-invocation workflow renders **neither** the
  Execution-protocol heading nor any `⚡` line.
- **Vocab**: generated prose contains no standalone word "phase"/"phases" in the
  aligned spots (assert the new "actions" wording; assert "Pipeline phases" absent).

Plus regeneration guards: `awok generate` + `awok check` (no drift on the 3 engine
workflows), full `pytest src/scripts/tests/test_workflow_*.py` green.

## Out of scope

- The deep `phase` → `action` rename of the YAML key and code identifiers (Palier 3).
- Refactoring `loup`'s multi-invocation action into sibling single-invocation actions
  (execution-model.md prefers the latter; this fix renders the existing form
  correctly rather than re-architecting it).
- Suppressing the orchestrator's narration turns (a separate, opt-in lever).

## Verification / external review

After implementation: regenerate engine workflows + `loup`, deploy, then an
independent agent checks the generated `SKILL.md`(s) against this contract —
specifically that (a) the `⇐` hard rule reads unambiguously, (b) parallel launches
are instructed in one message, (c) no "phase" leaks into prose, (d) gating is
correct (no protocol section on a linear workflow).
