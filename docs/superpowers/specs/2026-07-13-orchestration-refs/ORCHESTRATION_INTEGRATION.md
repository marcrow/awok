# awok — Orchestration layer: integration & regression guide

Companion to `GRID_REDESIGN_SPEC.md`. Two source files:

- **`Awok Editor.dc.html`** — the redesigned **Grid** (phase DAG). This view is **already implemented** in the real awok editor. It is the baseline that must **not regress**.
- **`Awok Orchestration.dc.html`** — a **focused functional prototype of the orchestration layer only** (logic gates over the phase DAG). It re-draws a *simplified* grid purely to demo the orchestration UX on the `recon-flow` example. Its grid is **not** the source of truth — the real grid already exists.

> The implementing agent must **add the orchestration layer on top of the existing Grid**, not replace the grid with the prototype's simplified grid. Everything in §1 already works today and must survive; §2 is the net-new to bring in; §3 lists the prototype's shortcuts/bugs so they are **not** carried into production.

---

## 1. Existing Grid features the prototype dropped or simplified — **DO NOT REGRESS**

The prototype reimplemented the grid at low fidelity to keep the demo focused. When wiring orchestration into the real editor, keep every item below exactly as it is today.

| Existing Grid feature (in `Awok Editor.dc.html`) | State in orchestration proto | Action on integration |
|---|---|---|
| **Workflow selector** dropdown + subtitle (header) | dropped (hard-coded `recon-flow`) | keep existing |
| **Tab bar** Grid / Dataflow / Settings / YAML | dropped (Grid only) | keep existing; orchestration lives inside Grid |
| **Dataflow** tab + in/out wiring mode (`dfSideIn`/`dfSideOut`/`dfLinkDone`) | dropped | keep existing |
| **Explicit editable `level`** per action (NOT derived from `depends_on`); multiple actions share a level; adding a dep never moves a card | proto fakes "levels" as sequential block order | **keep the explicit level model** — see §4.1 |
| **Drag to reassign level** (`phase.onDragStart/onDrop/onDragEnd`), **new-level drop zones** (`onZoneOver`/`onZoneDrop`, "＋ drop here for a new level"), **"↔ same level" pill** | dropped | keep existing |
| **Dependency overlay** (`dep-svg`): adjacent-level curve, same-level edge-to-edge/side-by-side connector, multi-level **skip** arcs with lane separation, arrowheads colored by dependent group | proto draws only simple gutter curves between level nodes | **keep existing routing**; extend it for the action→block case (§2, §4.3) |
| **Full phase card**: id · type badge · **`interactive`** marker · **`opportunistic`** marker · group label · name · 2-line desc · **dep chips `↑id`** · **input chips `in·role`** · **output chips `out·role`** · group-colored left border | proto card keeps id/type/name/desc/group, **adds `emits` chips**, but **drops** interactive/opportunistic markers and in/out/dep chips | keep full card; **add the new `emits` chip** (§2) |
| **Phase editor drawer**: resizable (`startResize`/`drawerWidthPx`), grid reflows; priority fields (id, name, type, group, **Interactive** toggle, description, command textarea); segmented tabs **Wiring · Autonomy · Invocations · Triggers** | proto has a **stub action panel** (name/type/group/desc/depends_on/delete only) | **reuse the existing drawer** — do not ship the proto's simplified action panel (§3.2) |
| **Wiring** tab: `depends_on` chips + add-dep select; Inputs/Outputs (role/path + kind, add/remove, empty states) | dropped | keep existing |
| **Autonomy** tab: opportunistic toggle → `when` + examples | dropped | keep existing |
| **Invocations** tab: agent dropdown from **shared agent registry** (+ new agent), model select, per-invocation desc, **✎ Prompt full-screen editor** (prompt shared across invocations) | dropped | keep existing |
| **Triggers** tab: trigger list (type + detail), default "fires when previous stage completes" | dropped | keep existing |
| **Groups editor** (legend): rename (refs stable), description, **risk** cycle, palette color per group | dropped (2 groups hard-coded) | keep existing |
| **Issues affordance** in tab bar (`issuesOpen`, `hasErrors`/`hasWarnings`, `errCount`/`warnCount`) | proto adds a clickable **issues popover + toast** | merge: keep existing counter, adopt the popover/toast (§2) |
| **Resizable drawer** drag handle | proto shows a handle but it is **not wired** | keep existing resize |

---

## 2. Net-new orchestration features to integrate (from the prototype)

These are the intended additions. Visual system: **violet = control flow** (`if/while/until/for_each`), **sky ◈ = signal**, **amber = literal & cap**.

1. **`◆ Orchestration` toggle** in the Grid toolbar, behaving exactly like the existing **`⤳ Dependencies`** toggle (both can be ON at once). OFF ⇒ no orchestration overlay ⇒ byte-identical to today (backward-compat).
2. **Target selector** `standard | dynamic` in the top band (dynamic = JS, disabled/"soon" for now; drives the capability-frontier greying later).
3. **Gates** = named, op-forward containers wrapping the phase cards they govern:
   - conditional (`if`): **solid** violet border + **◆ diamond** icon; `then` / `else` lanes.
   - loop (`while` / `until` / `for_each`): **dashed** violet border + **↻** icon; single `body`; **amber `cap`** chip.
   - Header leads with the operation + condition (the condition is the identity — **no "Gate N" numbering**).
   - Nesting supported (e.g. `if` inside `for_each`).
4. **`＋ Gate`** toolbar button (menu: **Condition** / **Loop**) — creates an empty selected gate, like `＋ Action`.
5. **"drag into a gate"** palette strip (draggable action chips) + **`＋ add / drag` drop zones** inside every `then` / `else` / `body`.
6. **Gate edit panel** (in the drawer): construct switch; **condition builder** = `operand · operator · operand` with per-operand kind (`◈ signal` / `literal` / `builtin`), color-segregated boxes and hover help; operator select (9 ops); **escape-hatch** free-text mode (standard-only); `for_each` list-signal + `as`; **`cap` field, required, with live validation**.
7. **Expose-a-signal**: signal picker grouped by phase + **"＋ Declare a new signal on a phase"** form (name/type/source/from) that writes an `emits` entry back to `<phase>.yaml`. Declared signals surface as **`emits ◈ name · type` chips** on the phase card.
8. **Live validation** (mirror `validate_orchestration()`): loop without a valid `cap`, incomplete condition, missing `for_each` list → inline gate marker + a **clickable issues popover** and a **spontaneous top-right toast** when a new error appears.
9. **Dependency rule** (see §4.3): action→action dependency kept **only within the same block**; across blocks it becomes an **action → block** relationship (arrowhead to the gate).
10. **`ⓘ demo` list** — in the prototype this enumerates what is stubbed; use it as the running "not-yet-implemented" tracker (mirror of §3).

---

## 3. Prototype shortcuts / bugs — fix on integration (regression risks)

1. **Drag = copy, not move (the reported bug).** Dropping into a gate currently *adds a new ref*; dragging an **existing** ref leaves the original in place (duplicate). Decide the two gestures explicitly:
   - **palette → gate** = *reference an action* (add a `{ref}`),
   - **existing ref → another container** = *move* (remove from source, insert in target). Implement the move; today it does not.
2. **Action editing is a stub.** Clicking an action opens a simplified panel (name/type/group/desc/deps). In production, clicking an action — **even nested inside a gate** — must open the **existing full phase drawer** (Wiring/Autonomy/Invocations/Triggers), optionally with a small "in `for_each` › body" breadcrumb. Do not fork a second editor.
3. **Deleting an action** must stay possible from that drawer (proto lost it, now restored via `Delete action`); keep parity with the existing card/drawer delete.
4. **The proto grid is `React.createElement`-rendered** (opaque, demo-only). The real grid already exists as template markup — integrate gates into that renderer, not the proto's tree.
5. **Levels are faked** as block order in the proto. Preserve the real **explicit `level`** model (§4.1).
6. **Dependency arrows are simplified** (gutter curves between level nodes). Reuse the existing `dep-svg` routing and only add the action→block variant.
7. **Groups/colors hard-coded** to `scan`/`exploit`. Use the real groups + palette.
8. **`Save` and `＋ Action` are stubbed**; wire to the backend (§5).
9. **`parallel` construct intentionally omitted** — product decision (awok is parallel-by-default via dependencies). Confirm before removing from the schema/UX surface.
10. Not a bug: `<select>` controls show their first option in html-to-image screenshots; the bound value is correct at runtime.

---

## 4. Architecture reconciliation

### 4.1 Levels vs gates — DECISION
Orchestration is a **layer over** the phase DAG; the block tree **references** phases and carries control flow. It must **not** replace `depends_on` or the explicit `level`.

**Decision:** the two views are mutually exclusive states of the same canvas, driven by the `◆ Orchestration` toggle.
- **Toggle OFF** → the existing **phase-library grid**, unchanged: each phase appears **once**, at its explicit `level`, with drag-to-reassign + dependency overlay. This is the source of truth (and the only view when no `.orchestration.yaml` exists).
- **Toggle ON** → render the **program** (the block tree) as the layout: gates + `{ref}` cards in program order; the rail numbers the **top-level blocks**. A `{ref}` renders the phase's real vignette. Because the program *references* phases, **the same phase can appear in several gates** (e.g. `SCAN` in `then`, `else`, a loop body) — this is why gates cannot simply "wrap the library cards in place": a card can't be in two places at once. The program is therefore its own ordering, exactly as the prototype shows.
- **Reason this isn't ambiguous:** multiple references per phase make in-place wrapping impossible; the program must be its own layout.
- **Edge to handle:** phases not referenced by any block need a home while the overlay is ON — a small "unused actions / library" tray to drag from (the palette already is that drag source).

### 4.2 Backward-compat
No `<name>.orchestration.yaml` ⇒ overlay OFF ⇒ the Grid, generated output, and DAG tab behave exactly as today.

### 4.3 Dependency rule — DECISION
The rule: *an action→action dependency is kept only when both actions are in the same block; across blocks it is expressed as an action→block dependency.*

**Decision — enforce at edit time (model rule), not just rendering:**
- The UI **prevents creating** an action→action dependency whose endpoints live in different blocks; the user instead gets an **action→block** dependency (the arrow targets the enclosing gate).
- `depends_on` at the **library level stays the DAG source of truth** (used when the overlay is OFF and for generation). It is only **re-expressed** as action→block **when it crosses a gate boundary** in the overlay — the underlying library DAG is not silently rewritten.
- `validate_orchestration()` flags any dependency that violates the rule so the author fixes it (inline error + issues popover).
- No bulk migration needed *inside* the program: orchestration is opt-in/new. The only case to handle is a pre-existing library dep whose two phases end up in different blocks — surface it as action→block, don't drop the data.

### 4.4 Editor reuse
One drawer, two block kinds: an **action** selection opens the existing phase drawer; a **gate** selection opens the new gate panel (§2.6). The drawer's resize/reflow is shared.

---

## 5. Backend contract (from the design brief — still to build)

- `GET /api/workflow/<name>` (~3131): merge the orchestration sibling under `model["orchestration"]` (reuse `load_workflow()`), instead of `yaml.safe_load` of `<name>.yaml` only.
- `POST /api/workflow` (clone/blank) and `PUT /api/workflow/<name>` (~3194): read/write `<name>.orchestration.yaml` alongside `save_workflow(...)`, plus `emits` write-back to `<name>.yaml`.
- `POST /api/view` (~3146) / `POST /api/preview` (~3156): inject `build_orchestration_overlay(workflow)` (branch diamonds + loop subgraphs) and surface `validate_orchestration()` errors inline (the view path already returns `validate_schema` errors — extend it).
- Capability frontier: read `src/workflow/orchestration-capabilities.yaml` to drive offered bricks and mark standard-only ones (relevant once the JS target lands). `file_exists`/`dir_exists` and the escape-hatch predicate are standard-only.
- Every `while`/`until`/`for_each` **requires** a `cap` — enforce server-side too.

## 6. Out of scope
JS compiler; workflow-doctor / create-workflow orchestration awareness; general web-UI polish (agent-prompt visualization in tab 1). Those are separate TODO items.
