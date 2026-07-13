# Orchestration layer in the awok web editor — integration design

**Date:** 2026-07-13
**Branch:** `feat/portes-logiques-orchestration`
**Status:** approved, ready for implementation plan

## Purpose

The orchestration engine (logic gates: `if` / `while` / `until` / `for_each`,
signals, caps) already exists in `src/scripts/bb-workflow` and in the generated
SKILL.md / cartography. It is **not** yet reachable from the **web editor**
(`awok edit`): the server never merges the `.orchestration.yaml` sibling into the
editor model, never persists it back, and the front-end has no UI for it.

This spec adds the orchestration layer to the web editor, **on top of** the
existing Grid, without regressing any current Grid feature.

## Companion documents (source of truth for UX — do not duplicate here)

- `~/Downloads/ORCHESTRATION_INTEGRATION.md` — the integration & regression guide.
  Its §1 (do-not-regress list), §2 (net-new features), §3 (proto bugs to fix on
  integration), §4 (architecture reconciliation + DECISIONs), §5 (backend
  contract), §6 (out of scope) are authoritative for **what** the UI does.
- `~/Downloads/Awok Orchestration.dc.html` — a functional but low-fidelity
  prototype (React.createElement, hard-coded `recon-flow`, faked levels). It
  demonstrates the UX; it is **not** the implementation target and its grid must
  **not** replace the real grid.
- `docs/superpowers/specs/2026-07-13-portes-logiques-orchestration-design.md` —
  the engine/data-model design (block tree, signals, capability frontier).

This spec is the **reconciliation layer**: it maps the guide onto the *real*
codebase (modular vanilla-DOM webedit + the Python server) and fixes the slicing,
module boundaries, and verification. Where this spec and the guide agree, the
guide governs UX detail; this spec governs *where the code goes*.

## Non-goals (guide §6)

- JS / `dynamic` compile target and its capability-frontier greying. The
  `standard | dynamic` selector ships, but `dynamic` is disabled ("soon").
- `workflow-doctor` / `create-workflow` orchestration awareness.
- General web-UI polish unrelated to orchestration.

## Architecture reconciliation with the real editor

The guide describes the baseline as `Awok Editor.dc.html`; the **production**
editor is the modular ES-module app under `src/workflow/templates/webedit/`:

| File | Role |
|---|---|
| `editor.js` (~800 lines) | app shell: load/view, grid render, drawer, save |
| `editlogic.js` | pure model logic (dep safety, opportunistic, validation) |
| `dataflow.js`, `settings.js` | the other tabs (own modules) |
| `render-helpers.js`, `formfields.js` | shared DOM builders |
| `editor.css`, `editor.html` | styles + shell markup |

**Structural decision (approved): orchestration gets its own module
`webedit/orchestration.js`**, mirroring `dataflow.js` / `settings.js`. `editor.js`
does **not** grow the orchestration renderer inline; it gains only a small
integration seam (state flags + a branch in `renderGrid` + toolbar buttons). The
new module reuses `makeCard` (from `render-helpers.js`) for `{ref}` vignettes so
cards stay pixel-identical between views, and reuses `formfields.js` builders in
the gate panel.

> Rationale (maintainer): keep it a separate module **for now** to avoid
> destabilising the working editor; a later merge into `editor.js` is possible
> once the layer is proven. Design the seam so that merge is a mechanical move
> (no hidden coupling beyond the documented state flags + render branch).

### View model (guide §4.1 DECISION — program-as-layout)

The `◆ Orchestration` toggle switches the canvas between two mutually-exclusive
states of the **same** model:

- **OFF** (and always, when no `.orchestration.yaml` exists) → today's
  phase-library grid: each phase once, at its explicit derived `level`, with
  drag-to-reassign + dependency overlay. Unchanged. This is the DAG source of
  truth.
- **ON** → render the **program** (`model.orchestration`, a block tree) as the
  layout: gates + `{ref}` cards in program order; the rail numbers the
  **top-level blocks**. A `{ref}` renders the referenced phase's real vignette.
  Because the program *references* phases, the **same phase may appear in several
  gates** — in-place wrapping is impossible, so the program is its own ordering
  (exactly as the prototype shows). Phases referenced by no block get a
  **"unused actions / library" tray** to drag from.

`◆ Orchestration` is independent of `⤳ Dependencies`; both can be ON at once.
OFF ⇒ no overlay ⇒ backward-identical to today.

### Dependency rule (guide §4.3 DECISION)

`depends_on` at the **library level stays the DAG source of truth** (used when
the overlay is OFF and for generation). When the overlay is ON, an action→action
dependency whose endpoints live in **different blocks** is *re-expressed* as an
**action→block** dependency (arrow targets the enclosing gate); same-block
deps stay action→action. The UI **prevents creating** a cross-block action→action
dep (offers action→block instead). A pre-existing library dep whose phases end up
in different blocks is surfaced as action→block, never silently dropped.
`validate_orchestration()` flags violations (inline + issues popover).

## Slicing (approved execution order)

One spec, three phases, executed in order. Each phase is independently
verifiable and leaves the tree green.

### Phase 1 — Backend wiring (`src/scripts/bb-workflow`)

Reuse existing engine functions; add **no** new orchestration logic.

1. **`GET /api/workflow/<name>`** (~3131): replace
   `yaml.safe_load(fp.read_text())` with `load_workflow(fp)` so
   `model["orchestration"]` is present when the sibling exists. `compute_levels`
   ignores the key.
2. **`POST /api/view`** (~3146): add to the response
   `"orchestration_overlay": build_orchestration_overlay(data)` and
   `"orchestration_warnings": validate_orchestration(data)` (kept **separate**
   from `validate_schema` so the UI labels control-flow issues distinctly and
   treats them as **warnings**, never blockers — see save semantics below). Both
   are empty/no-op when there is no `orchestration` key ⇒ byte-identical response
   for today's workflows.
3. **`save_workflow`** (~389): before serializing, `pop("orchestration", None)`
   off a copy of the model. Write the base `<name>.yaml` **without** it (via the
   existing `dump_workflow_yaml`). If the popped value is a non-empty list, write
   it to `orchestration_path_for(workflows_dir / f"{name}.yaml")`; if it is
   absent/empty, **delete** that sibling if it exists. `emits` lives on phases, so
   it rides along in the base file naturally. `PUT /api/workflow/<name>` and
   `POST /api/workflow` (clone/blank) inherit this automatically.
4. **Orchestration validation on save is WARNING-ONLY, never blocking**
   (maintainer decision — never lose in-progress work). The split:
   - **Structural** orchestration-schema validation (the `jsonschema.validate` in
     `validate_schema`, lines ~450-454) stays **blocking** — a malformed block
     tree that can't be serialized safely must not be written.
   - **Semantic** `validate_orchestration` results (loop without valid `cap`,
     unknown signal, cross-block dep, JS-frontier) are returned as a **separate
     `warnings` channel** from `save_workflow`; the files are **still written**
     (base `<name>.yaml` + sibling), and the response is `200` with
     `{"errors": [], "warnings": [...]}` rather than a `422`. So a workflow with a
     capless loop **saves successfully** and the author is warned, not stopped.
   - The front-end surfaces these warnings **prominently and on-brand** — not a
     quiet `#status` line. Reuse the existing issues affordance (the amber `⚠`
     `#issues-badge` counter + the popover/toast introduced in Phase 3) styled
     with the site's warning tokens (amber, matching `validateModel` warnings and
     the loop `cap required` chip), so a post-save warning is impossible to miss
     yet costs no work.

**Tests:** new pytest in `src/scripts/tests/` — (a) `load_workflow`→`save_workflow`
round-trip splits the sibling and the base file is orchestration-free; (b) absent
key ⇒ no sibling written / existing sibling removed; (c) `/api/view` includes the
overlay + orchestration errors only when the key is present. `awok check` stays
green (no generated-artifact drift — this touches the server, not templates, but
run it to be sure).

### Phase 2 — Front-end read-path

New module `webedit/orchestration.js` + minimal `editor.js` seam.

- **State** (`editor.js`): `state.showOrch` (toggle), `state.selectedGate`,
  `state.view.orchestration_overlay` (from the server).
- **Toolbar** (`editor.html` / `editor.js`): `◆ Orchestration` button beside
  `⤳ Dependencies` (same `btn-ghost .on` idiom); the `standard | dynamic` target
  selector (dynamic disabled); `＋ Gate` menu is added in Phase 3.
- **`renderGrid()` branch**: OFF → existing `rowsFromView()` path (untouched);
  ON → `renderProgram(...)` from the new module. Gates render as op-forward
  containers (solid violet + ◆ for `if`; dashed violet + ↻ + amber cap chip for
  loops), header led by op + condition (no "Gate N" numbering), nesting
  supported. `{ref}` cards use `makeCard`. The "unused actions" tray lists phases
  no block references.
- **`emits` chips**: extend `makeCard` (render-helpers) to show
  `emits ◈ name · type` chips; keep the full existing card (id, type badge,
  interactive/opportunistic markers, group, name, desc, dep/in/out chips).
- **Dependency overlay**: extend the existing `dep-svg` routing in `editor.js`
  for the action→block variant (arrowhead to the gate) per §4.3; keep the
  adjacent/same-level/skip-arc routing untouched.

**Verification:** boot `awok edit`, load a workflow with an
`.orchestration.yaml` (start from the fixture
`src/scripts/tests/fixtures/workflows/orchestrated.*`), drive via Chrome DevTools
MCP: toggle ON/OFF, confirm gates + tray render and that **toggle OFF is
identical to today** (screenshot the §1 do-not-regress items: workflow selector,
tabs, levels, drag, dep overlay, full drawer).

### Phase 3 — Front-end edit-path

- **`＋ Gate`** menu (Condition / Loop) → creates an empty selected gate.
- **Gate panel** in the existing drawer (`#edit-panel`): construct switch;
  condition builder `operand · operator · operand` with per-operand kind
  (`◈ signal` / `literal` / `builtin`), colour-segregated boxes (sky/amber/violet)
  + hover help; 9-op select; escape-hatch free-text mode (labelled standard-only);
  `for_each` list-signal + `as`; **required `cap`** field with live validation.
  Selecting an **action** (even nested in a gate) opens the **existing full phase
  drawer** (Wiring/Autonomy/Invocations/Triggers) — no forked editor (§3.2), with
  an optional "in `for_each` › body" breadcrumb. Delete stays available from the
  drawer (§3.3).
- **Signals**: picker grouped by phase + "＋ Declare a new signal on a phase"
  form (name / type / source / from) that writes an `emits` entry onto the phase
  (persisted into `<name>.yaml` via the Phase-1 save path). Name must match
  `^[a-z][a-z0-9_]*$`. Signal key = `<phase_id_lowercase>.<name>`.
- **Drag = MOVE** (fixes proto bug §3.1): palette/tray → gate = *reference*
  (add a `{ref}`); existing `{ref}` → another container = *move* (remove from
  source, insert in target). No duplicates.
- **Live validation**: mirror `validate_orchestration` client-side (loop without
  valid cap, incomplete condition, missing `for_each` list, cross-block dep) →
  inline gate marker + clickable issues popover + spontaneous top-right toast when
  a new warning appears. Merge with the existing `#issues-badge` counter (keep the
  counter, adopt the popover/toast), styled with the site's amber warning tokens.
  These are **warnings, never blockers** — editing and saving are never gated by
  them. The server remains the authority (`orchestration_warnings` from
  `/api/view`); the client mirror is for instant feedback only.
- **ⓘ "not-yet-implemented" tracker**: keep an accurate list (guide §2.10 / §3)
  so manual testers know what is real.

**Verification:** MCP browser — add a condition gate and a loop gate; build a
condition via the builder and via the escape hatch; declare a signal and confirm
the `emits` chip + persistence to `<name>.yaml`; drag a palette action into a
`then` lane, then drag that ref into a loop body (confirm **move**, not copy);
remove the cap and confirm the toast + inline marker + issues popover; Save and
confirm `<name>.orchestration.yaml` is written and re-loads. Maintainer runs an
independent manual pass afterward.

## Backward-compatibility contract

No `<name>.orchestration.yaml` ⇒ no `orchestration` key ⇒ toggle defaults OFF ⇒
the Grid, `/api/view` response, generated SKILL.md, and cartography behave
exactly as today. This is the acceptance floor for Phase 1 and Phase 2.

## Ripple / discipline

This changes the **server** and **webedit templates**, not the Jinja templates
that produce SKILL.md/cartography, so it does **not** re-render workflow
artifacts. `awok check` should stay green throughout. No `Regen:` trailer is
required unless a template change sneaks in; if one does, follow the ripple
discipline in `CLAUDE.md` (regenerate all, commit artifacts, redeploy, add the
trailer). Deploy path for testing the editor: `./install.sh` (the server serves
from `src/`, so `awok edit` from the repo picks up edits directly).

## Open questions (resolve during planning, not blocking)

1. ~~Should `validate_orchestration` be blocking on save or warning-only?~~
   **RESOLVED: warning-only** (never lose in-progress work). Structural schema
   stays blocking; semantic orchestration issues are prominent, on-brand warnings.
   See Phase 1 item 4.
2. Exact placement of the `standard | dynamic` selector (header vs grid toolbar).
   Guide shows it in the top band; confirm during Phase 2.
