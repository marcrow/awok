# awok — TODO / features to integrate

> Shared project tracking file. Source of truth for the awok backlog.
> Created 2026-07-13. Check items off as you go; keep each item's context so it stays
> actionable after a `/clear`.
>
> **Status point 2026-07-17:** three features landed and are now **merged to `main` and pushed
> to origin** (merge `11ced9d`, range `2e20a7e..11ced9d`, 65 commits — the whole local backlog
> since the 2026-07-13 portes-logiques merge reached origin for the first time here):
> (1) signals-on-action (declare signals in the Wiring editor + deterministic emitter/validation
> checks — the deterministic part of B4); (2) recursive `and`/`or`/`not` condition connectors;
> (3) typed signal payloads (enum `values` + list `of` — narrows S4). Plus per-invocation `tools`
> (see A2 update). Also shipped in the same range: the web-UI condition-block canvas (**B2 done**)
> and the signals-section contextual help (**C3 signals part done**). Engine redeployed to
> `~/.claude` on 2026-07-17. `awok check` clean, 295 pytest + 73 webedit green.

## Sequencing (intended order)

1. **Handle the pending PR first**, then the **effort/frontmatter audit** — do both together,
   because the PR likely touches the same area (doing the audit after the PR is in hand avoids
   stepping on each other). → items [A1] then [A2].
2. **The pre-dynamic common core** (section S below + B7/D1/D2): everything that both targets
   share, developed and tested entirely on the standard target. → S1..S5.
3. Then the dynamic-specific work (B1: JS compiler, `target` field, deploy to
   `~/.claude/workflows/`, wrapper skill, `check` on `.js`, UI target toggle) and the other
   orchestration follow-ups (B3/B4/B5/B6, web UI).
4. Security and web UI cleanup in parallel where it fits.

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
  **UPDATE 2026-07-17: `tools` are now ALSO per-invocation and materialized into the deployed
  agent frontmatter at deploy** (commit `d8aad65`, same mechanism as `effort`), so the exact
  same last-build-wins cross-workflow blind spot applies to `tools` — the audit must cover both
  axes together, and any fix (per-workflow namespacing / forbid divergence) should apply to both.

---

## S. Pre-dynamic common core (état des lieux 2026-07-16)

> Everything in this section is **shared** by the standard and dynamic (JS) targets, and is
> built/tested **entirely on the standard target** — so it can (and should) land before B1.
> B7, D1 and D2 also belong to this core (tagged in place). Context: the block-tree model,
> the recursive `and`/`or`/`not` conditions (branch `feat/conditions-and-or-not`, done), the
> js-safe frontier in `orchestration-capabilities.yaml` and `validate_orchestration(target=)`
> are already JS-compatible by design.

- [ ] **S1 — Workflow-level I/O contract (inputs/outputs of the workflow itself).**
  Today `skill:` = name/description/title only; inputs/outputs exist per phase/invocation but
  the workflow as a whole declares no contract. Needed NOW to give `workflow_call` something
  verifiable (today the validator only checks the target exists); needed LATER as the
  `args` / return-value mapping of a dynamic workflow, and for standard→dynamic composition.
  To do: schema field, `workflow_call` validation against it, cartography rendering.
  **STATUS 2026-07-17: designed + planned, dev not started.** Branch `feat/workflow-io-contract`.
  Model = a phase-shaped top-level `definition:` block (`params` typed args + single `outputs`
  io_ref list with `produced_by` + `emits` promote/create + optional `formatter` with
  engine-compiled prompt-assist) + `workflow_call args:` binding + a WebUI "Workflow definition"
  tab. Spec `docs/superpowers/specs/2026-07-17-workflow-io-contract-design.md`, plan
  `docs/superpowers/plans/2026-07-17-workflow-io-contract.md` (12 tasks, subagent-driven),
  mockup vendored alongside the spec. Dynamic args/return mapping deferred to B1.

- [ ] **S2 — Extend `orchestration-capabilities.yaml` with an `actions:` section.**
  The js-safe frontier is declared for operators/connectors/builtins/operands but NOT for
  **action types**. Add `actions: {agent: js_safe, script: wrappable, main_agent: standard-only,
  external: via-args, workflow_call: js_safe (1 nesting level)}` so `validate --target js` is
  complete later without touching the model. Small (file + validator + tests), keeps the
  "no hard-coded matrix" philosophy.

- [ ] **S3 — Deterministic signal-reachability check in `awok validate`.**
  The deterministic slice of B4 that does NOT need the doctor: a condition consuming a signal
  whose **emitter is not guaranteed to have run** at evaluation time — emitter scheduled after
  the gate, or living exclusively inside a conditional branch (incl. the gate's own then/else).
  Pure graph analysis over orchestration + `depends_on` + `resolve_signal_emitter`. Blocking
  error when the emitter is ordered after; warning "guard with `exists`" when the emitter is
  conditional. Note: `_validate_signals` + condition validation ALREADY block unknown-signal
  refs, field-role-not-produced, exit_code-on-non-script, multi-agent-token-without-`by` —
  and `render_signal_emission`/`_attach_signal_emissions` already inject the emission
  instructions at generate (by construction). S3 is the missing deterministic piece.

- [ ] **S4 — Derive a JSON Schema from each action's `emits` (canonical output contract).**
  The standard-side half (emission instructions injected into prompts/SKILL.md) is shipped;
  what's missing is the machine-readable artifact: `emits` → JSON Schema per invocation.
  In standard it can strengthen the orchestrator's extraction prose + doctor checks; in JS it
  becomes verbatim the `schema` option of `agent()` (typed returns are the ONLY channel a
  dynamic script can read — no filesystem in the Workflow runtime). Design constraint to
  settle here: `token`-sourced signals must map to a schema field; `exit_code` needs the
  script wrapped in an agent (see S2).
  **Update 2026-07-16: typed signal payloads are implemented** on `feat/conditions-and-or-not`
  (enum-strict `values` + list `of`, incl. condition checks, js-target `of` requirement,
  payload warnings, emitter/`for_each` rendering, fixture, web editor `of` UI — design doc
  `docs/superpowers/specs/2026-07-16-typed-signal-payloads-design.md` §10). S4's remaining
  scope narrows to the `emits` → JSON Schema derivation itself; the mapping table is already
  frozen in that design's §6.

- [ ] **S5 — Exercise an orchestrated workflow end-to-end (standard).**
  `onboard.orchestration.yaml` exists but the orchestration semantics (gates, signals, loops,
  deps-into-blocks, else-lane, signal evaluation timing) have not been proven in real use.
  The standard target is best-effort so semantic bugs are recoverable; the JS target will
  execute the SAME semantics deterministically. Fix the semantics while there is one backend,
  not two.

---

## B. Orchestration follow-ups (feature shipped 2026-07-13)

> The "standard target" orchestration is shipped on `feat/portes-logiques-orchestration`
> (logic gates + `<name>.orchestration.yaml` + `emits` signals + cartography). These items
> follow directly from it.

- [ ] **B1 — Dynamic workflows (JS compiler).** The `js` target of the same orchestration model.
  `validate_orchestration(target="js")` is **already ready** to reject standard-only bricks
  (file_exists/dir_exists, escape-hatch). Direct logical follow-up (proposed by Claude).
  Ref: plan § "Suivis hors de ce plan" item 1.
  **Prerequisites: the pre-dynamic common core (section S) + B7 + D1/D2.** Dynamic-specific
  scope (do NOT start before the core lands): `target: standard|js` schema field + plumbing;
  the block-tree → `Workflow`-script renderer (pure-literal `meta`, DAG→`pipeline()`/
  `parallel()` codegen from the existing level analysis, `if→if`, `while/until→while+cap`,
  `for_each→pipeline/parallel`, loop output→JS accumulator; runtime constraints: no fs, no
  `Date.now()`/`Math.random()`, 1 nesting level for `workflow()`); `agent()` calls emit
  `agentType` (agents already deployed to `~/.claude/agents`) + per-invocation
  `effort`/`model` as call options (partially dissolves A2 for this target); deploy generated
  scripts to `~/.claude/workflows/` + a thin generated wrapper SKILL.md (`/<name>` → Workflow
  tool call = the user opt-in path); extend `awok check` to the generated `.js`; golden tests
  (+ optional `node --check`). Out of scope: importing hand-written JS (`migrate-from-js`,
  assist-based, separate).

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
  **Signal-emitter contract check (from the signals-on-action brainstorm, 2026-07-14) —
  UPDATED 2026-07-16 after code audit: most of it is already deterministic and DONE.**
  `_validate_signals` already blocks: `source: field` whose from-role is not produced by the
  action; `source: exit_code` on a non-script (+ type rules); multi-agent `token` without
  `by`. Condition validation already blocks references to unknown signals. And
  `render_signal_emission`/`_attach_signal_emissions` inject the emission instruction into
  the emitter's prompt at generate — so "the prose doesn't instruct the emission" cannot
  happen in a *generated* skill (by construction). The remaining deterministic piece is
  **S3** (emitter reachability/ordering vs the consuming gate) → belongs in `validate`, not
  here. What is LEFT for the doctor (LLM-judgment residue only): is the value *meaningfully*
  produced (field plausibly written with real content, not filler); does the agent's own
  hand-written .md contradict/preempt the injected instruction; conditional-in-the-prompt =
  stale orchestration; best-effort overuse; escaped logic.
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

- [ ] **B7 — Loop `output` role as a first-class dataflow node.** _[pre-dynamic common core:
  this role is exactly the JS accumulator variable — fix it before B1]_ Deferred from the
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
- [ ] **C4 — Generalize the Definition-tab front-door hero to Settings.** The `.def-hero`
  pattern (radial glow, accent eyebrow, mode badge, then identity fields) built on the
  Definition tab (commit `5a36dfb`) is deliberately self-contained and reusable — lift the
  same visual treatment onto the **Settings** panel's identity/skill header. User validated
  the hero and asked to carry it over (not urgent).
- [ ] **C5 — Editable, documented vocabularies for prompt-assist knobs.** The formatter
  style choices (tone `direct…zero-knowledge`, format `prose…table`, audience
  `maintainer/external stakeholder/downstream workflow`, length scale) are currently a
  **fixed list mirrored from YAML**. Wanted: a short **definition per option** (what
  "maintainer" vs "external stakeholder" means), shown in the UI (tooltip/inline), and
  **editable + extensible** — the user can reword a definition and add new options as
  needed. Needs a design decision on where the vocabulary + its definitions live (engine
  constant vs a declarable block the workflow/user owns) before build. Related: C3 help layer.
- [ ] **C3 — Help & accessibility of the web UI for the uninitiated user.**
  **Persona (reference for all UI help work): someone who has never read a workflow
  YAML nor the awok docs** — they must understand each concept and fill each field
  without leaving the editor. Help is in English, layered (always-visible one-line
  intro + mini field labels + native ⓘ tooltips), and must stay compact — readability
  without crowding the controls. The **signals section is done** (2026-07-17, spec
  `docs/superpowers/specs/2026-07-17-webedit-signals-help-design.md`); extend the same
  treatment to the rest of the Wiring panel (io refs `role (ns:name)` / `path override`,
  triggers, on-demand agents…) and the other panels/tabs.

---

## D. awok model / conventions

- [ ] **D1 — Ban multi-agent action blocks.** _[pre-dynamic common core: the JS codegen maps
  1 block → 1 `agent()` call; multi-invocation blocks would break that mapping. Every week of
  delay adds content to migrate — do it before B1]_ An action block (`phase`) can currently hold
  **several invocations** (`invocations: [ ... ]`, multiple agents). Leaning decision: **forbid
  it** — 1 block = 1 action = 1 agent. Rationale: multi-agent within a block causes problems
  down the line, hurts readability, and runs counter to what awok is meant to offer. Needs
  thought, but the leaning is to ban (blocking validation + migration of existing workflows that
  use it). **Aligns with the target vocabulary** ("an action is a single unit, no intra-action
  ordering" → see D2).

- [ ] **D2 — Vocabulary migration action/stage/group** (Palier 1 doc done). Remaining:
  Palier 2 (retire inert fields) + Palier 3 (rename `phase`→`action`).
  Ref: memory `awok-vocab-migration`. Overlaps with D1. _[pre-dynamic common core: a
  vocabulary rename costs double once a second compiler backend exists — do it before B1]_

---

## E. Security

- [ ] **E1 — Security review of the application** (from the README TBD). Not done yet.
  Security review of the app **and of `awok edit`** (the web editor service). Current rule:
  **do not expose the `awok edit` service.**
