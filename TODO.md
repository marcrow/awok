# awok — TODO / features to integrate

> Shared project tracking file. Source of truth for the awok backlog.
> Created 2026-07-13. Check items off as you go; keep each item's context so it stays
> actionable after a `/clear`.

## Sequencing (intended order)

1. **Handle the pending PR first**, then the **effort/frontmatter audit** — do both together,
   because the PR likely touches the same area (doing the audit after the PR is in hand avoids
   stepping on each other). → items [A1] then [A2].
2. Then the orchestration follow-ups (dynamic workflows, web UI blocks, create/doctor/edit).
3. Security and web UI cleanup in parallel where it fits.

---

## A. Priority (PR + effort)

- [ ] **A1 — Handle/integrate the pending pull request.**
  _To specify: PR number / branch / author._ The PR is likely affected by A2 (effort) → handle
  A1 before A2, then do A2 with the PR taken into account.

- [ ] **A2 — Audit the effort model (invocation vs agent frontmatter).**
  `effort` is set **per invocation** in `workflow.yaml`, but `awok deploy` **materializes** it
  into the **deployed** agent's frontmatter (`~/.claude/agents/<name>.md`), because the `Task`
  tool has no `effort` argument. Consequence: an agent **shared** across several workflows with
  different efforts → **the last-deployed workflow overwrites** the frontmatter ("last build
  wins"). A "conflict" guard already covers the *same agent, two efforts, within ONE workflow*
  case (warning, injects nothing) — but the **cross-workflow** case is not covered. Audit and
  decide (namespace the deployed agent per workflow? forbid divergent efforts on a shared agent?
  something else?). Ref: CLAUDE.md § "effort: per-invocation".

---

## B. Orchestration follow-ups (feature shipped 2026-07-13)

> The "standard target" orchestration is shipped on `feat/portes-logiques-orchestration`
> (logic gates + `<name>.orchestration.yaml` + `emits` signals + cartography). These items
> follow directly from it.

- [ ] **B1 — Dynamic workflows (JS compiler).** The `js` target of the same orchestration model.
  `validate_orchestration(target="js")` is **already ready** to reject standard-only bricks
  (file_exists/dir_exists, escape-hatch). Direct logical follow-up (proposed by Claude).
  Ref: plan § "Suivis hors de ce plan" item 1.

- [x] **B2 — Web UI: editing condition blocks.** DONE. The orchestration view is now a
  full authoring canvas: the whole DAG with gates as frames (then/else/body lanes); drag an
  action into a lane to gate it (deps renewed to the block context) or out to ungate; drag/nest
  gates; a gate carries a readable persisted id (COND_n/LOOP_n) shown in its header; an action can
  **depend on a block** via the Wiring "Depends on" picker (top-level blocks, id assigned on
  demand); dependency arrows point at the gate frame; a gate's level follows its condition's
  **signal producer** (evaluated when the signal is ready), not its branch contents; dropping near
  a gated level defaults deps to the block, not the gated action. Signal exposure when placing a
  condition already exists (signal picker + declare-signal, webui plan Task 11).
  _Deliberately NOT done (out of scope, confirmed with maintainer): drawing a dependency edge
  action→block directly on the grid — there is no drag-an-arrow gesture even action→action; deps
  are authored in the Wiring panel. Nested (non-top-level) blocks are not yet offered as depends_on
  targets in the picker (top-level only — always visibility-legal)._

- [ ] **B3 — create-workflow: orchestration + dynamic.** Have it brainstorm/scaffold an
  orchestration, expose signals, and **read `orchestration-capabilities.yaml`** for guidance
  (the capability file was designed to be consumed "later" by create-workflow). Then the changes
  tied to **dynamic workflow** usage (depends on B1).

- [ ] **B4 — workflow-doctor: audit an orchestration.** Today it does **not** audit an
  orchestration file. To add: flag "conditional-in-the-prompt = stale orchestration", flag
  best-effort overuse, flag escaped logic (escape-hatch), and check signal↔condition seams +
  the mandatory `cap`. It should also verify if action in a condition cause an issue for dependancies 
  if the condition is not triggered.
  **Signal-emitter contract check (from the signals-on-action brainstorm, 2026-07-14):** awok
  cannot execute a script, so it cannot prove a signal is actually produced. The doctor should
  warn when a declared signal's emitter is unverifiable: for `source: field`, that the emitting
  action's `<role>` output really is a produced json in the dataflow (and ideally that the field
  is plausibly written); for `source: exit_code`, that the action is a `script`; for
  `source: token`, that the emitting action's prose actually instructs the emission. Goal: catch
  "signal declared but never produced" before runtime.
  Ref: plan § "Suivis hors de ce plan" item 3.

- [ ] **B5 — edit-workflow: orchestration-aware.** Reason about orchestration seams when editing
  a workflow (currently blind to the orchestration layer).

- [ ] **B6 — Orchestration-graph generator to assist the main-agent's live orchestration.**
  (Idea by Marc-Antoine, 2026-07-14.) A generated artifact/graph that helps the main agent
  *decide* orchestration at runtime **as a function of the observed states of the actions** — i.e.
  given which actions have run / their emitted signals, surface what can/should run next and how.
  Decision aid for the orchestrator, not a new runtime. **⚠️ Check overlap with B1 (dynamic /
  JS workflows)** before building — a fully dynamic (JS) workflow may already subsume most of this;
  the value here is specifically for the *standard* (LLM-driven) target where there is no runtime.
  _To specify: is it a static generated view, or a per-run state-aware helper? How does it read
  action states (signals/ledger)? Where does it live (SKILL.md section vs cartography overlay)?_

- [ ] **B7 — Loop `output` role as a first-class dataflow node.** Deferred from the
  depends_on-unification plan (`2026-07-14-orchestration-depends-on-unification.md`, Task 6/8):
  a loop block may declare `output: {role, kind}`, but `build_dataflow_graph` is NOT taught that
  this role is a **producer** (the body writes it) and the downstream action is its **consumer**.
  Consequence: the orphan-io dataflow warning may fire on that role, and the Dataflow cartography
  tab won't draw the producer→consumer edge. To add: teach `build_dataflow_graph` about loop
  outputs (+ optionally an explicit `collect` construct, spec §6 reserve). Stopgap until then:
  mark the downstream input `external: true`.

- [ ] **B8 — Emit a signal directly from a file (incl. external files).** (Deferred from the
  signals-on-action brainstorm, 2026-07-14.) Today a signal is emitted by an *action* (agent /
  script / main_agent). Some useful values live in **files outside the project** (external
  inputs) or in the output of a `workflow_call` — neither of which is a signal-emitting action.
  Idea: allow a signal whose source is a **file + field** directly, so `external` and
  `workflow_call` results become readable as signals. Adds complexity (typing, existence checks,
  who reads it) → **later**. **Stopgap (works today):** insert a tiny `script` or `main_agent`
  action that reads the file and re-emits the value as a normal signal — so this is a convenience,
  not a blocker.

> Note: B3/B4/B5 = the 3 meta-workflows **untouched** by the orchestration work (their SKILL.md
> are byte-identical, `awok check` green) — they work but are not orchestration-aware.

---

## C. Web UI (workflow editor)

- [ ] **C1 — Improve the web editor** (from the README TBD, partially done). Remaining:
  - Make the **prompt visualization** of invoked agents more **user-friendly** in the
    **first tab**.
  - _To specify: other remaining web UI changes._
- [x] **C2 — fix invocation file in web UI.** ✅ Done (removed from TBD).

---

## D. awok model / conventions

- [ ] **D1 — Ban multi-agent action blocks.** An action block (`phase`) can currently hold
  **several invocations** (`invocations: [ ... ]`, multiple agents). Leaning decision: **forbid
  it** — 1 block = 1 action = 1 agent. Rationale: multi-agent within a block causes problems
  down the line, hurts readability, and runs counter to what awok is meant to offer. Needs
  thought, but the leaning is to ban (blocking validation + migration of existing workflows that
  use it). **Aligns with the target vocabulary** ("an action is a single unit, no intra-action
  ordering" → see D2).

- [ ] **D2 — Vocabulary migration action/stage/group** (Palier 1 doc done). Remaining:
  Palier 2 (retire inert fields) + Palier 3 (rename `phase`→`action`).
  Ref: memory `awok-vocab-migration`. Overlaps with D1.

---

## E. Security

- [ ] **E1 — Security review of the application** (from the README TBD). Not done yet.
  Security review of the app **and of `awok edit`** (the web editor service). Current rule:
  **do not expose the `awok edit` service.**
