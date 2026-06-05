# Opportunistic in the web editor — design

- **Date**: 2026-06-05
- **Status**: Approved (brainstorming) — ready for implementation plan
- **Component**: `src/workflow/templates/webedit/` (front-end) + `src/scripts/bb-workflow` (the `awok edit` HTTP server)
- **Depends on**: the `opportunistic` field (compiler side), shipped in
  `docs/superpowers/specs/2026-06-04-opportunistic-phases-design.md`.

## 1. Context & goal

The `opportunistic` field (top-level default + per-phase override, `bool | object`)
is fully compiled by awok, but is **not editable in the local web editor**
(`awok edit`). Today the only way to set it is hand-editing YAML. This makes the
feature hard to author and to test end-to-end.

Goal: make `opportunistic` **authorable, visible, and previewable** from the web
editor, so the whole loop (set → see the effect → save → generate → run) can be
driven from the UI.

Three surfaces:
1. **Author** — a per-phase editor + a global-default editor.
2. **See** — the DAG grid shows 🧭 / ⛔ badges on phase cards (mirrors the
   cartography), so autonomy zones are visible while building.
3. **Preview** — a live resolved-state line per phase (🧭 short / full, ⛔ locked,
   inherited, off) that updates as you toggle, without regenerating.

No compiler/runtime changes — the backend already serializes `opportunistic`
(`dump_workflow_yaml` preserves key order) and validates it (`validate_schema`)
on save. The only backend addition is exposing the **resolved** state through the
existing `/api/view` endpoint.

## 2. Architecture (existing pieces we build on)

- **Front-end** (ES modules, no bundler): `editor.html`, `editor.js` (state +
  phase panel + tabs + settings), `formfields.js` (widget builders),
  `render-helpers.js`, `editlogic.js`, `editor.css`.
- **State**: `let state={name,model,view,selected,panelTab,...}` — `state.model`
  mirrors the YAML dict; `state.view` is the last `/api/view` response.
- **Load**: `GET /api/workflow/<name>` → `{model, levels}`.
- **Edit loop**: every field `onChange` mutates `state.model` then calls
  `refreshView()` → `POST /api/view` with `state.model` → server returns
  `{levels, edges, errors, ...}` → `renderGrid()` + `renderYaml()`.
- **Save**: `PUT /api/workflow/<name>` with `{model}` → `save_workflow()` runs
  `validate_schema` + `validate_coherence` then `dump_workflow_yaml`.
- **Phase panel tabs** (`selectPhase` → `tabs[]`): General, Dependencies, Files,
  Triggers, Invocations. Adding a tab = add an entry to that array + a
  `tab<Name>(body, p, id)` renderer.
- **Settings tab** (`renderSettings`) edits top-level fields (skill, namespaces,
  groups, conditions, on_demand_agents) — the model for the global default.
- **Widgets**: `fieldText`, `fieldTextarea`, `fieldSelect`, `fieldCheckbox`,
  `ioRefEditor` (list-of-objects). No string-list widget yet.

## 3. Data model & serialization (per-phase)

A 3-state `Mode` control drives `phase.opportunistic`:

| UI Mode | model value |
|---|---|
| **Inherit** (default) | key absent (deleted) |
| **Locked** | `false` |
| **Enabled** | `true` when `when`+`examples` both empty; else `{ when?, examples? }` (only non-empty keys) |

When **Enabled**, show `when` (textarea) and `examples` (string-list). Empty
values are omitted. Clearing all guidance while Enabled collapses back to `true`.

This matches the hand-written `onboard.yaml` (`O2-DEPS` is an object, a bare
`true` is a guidance-less enable, `O4-ARCHITECTURE: false` is the lock), so the
save → reload round-trip is stable and idempotent under `dump_workflow_yaml`.

**Global default** (`renderSettings`): two meaningful states only (there is no
parent to inherit from). A checkbox "Enable opportunistic by default" + `when` +
`examples`. Serialization:
- unchecked → delete top-level `opportunistic` (or leave absent)
- checked + no guidance → `opportunistic: true`
- checked + guidance → `opportunistic: { enabled: true, when?, examples? }`

(`enabled: true` is kept at the global level for readability, matching the
hand-written onboard default; the resolver treats object-present-without-enabled
as enabled too, so both are equivalent.)

## 4. New widget: `stringListEditor`

`formfields.js` gains a small reusable builder for a list of plain strings
(simpler than `ioRefEditor`: no kind, no flags):

```
stringListEditor(label, items, onChange) -> HTMLElement
```
- renders one text input per item with a `✕` delete button, plus a
  `+ <label>` add button;
- `onChange` emits the current array of **non-empty, trimmed** strings (empty
  rows are dropped on emit so we never persist `examples: [""]`).

Used for `examples` in both the per-phase tab and the global settings section.

## 5. Backend: `/api/view` returns resolved marks

The `/api/view` handler in `src/scripts/bb-workflow` currently returns the DAG
view (levels/edges/validation) for the POSTed model. Extend it to also call
`resolve_opportunistic(model)` (on the request's model dict — a throwaway copy,
no persistence) and include:

```json
"opportunistic": {
  "global_enabled": true,
  "phases": {
    "O1-STRUCTURE":    { "mark": null,            "note_kind": null,    "enabled": true },
    "O2-DEPS":         { "mark": "opportunistic", "note_kind": "short", "enabled": true },
    "O4-ARCHITECTURE": { "mark": "locked",        "note_kind": "locked","enabled": false }
  }
}
```

- `mark` ∈ `"opportunistic" | "locked" | null`; `note_kind` ∈
  `"full" | "short" | "locked" | null`; `enabled` is the effective per-phase bool.
- The `phases` map contains **one entry per phase** (including inherited/unmarked
  ones), keyed by phase `id` — so the front-end preview/badge logic is purely
  view-driven and never inspects `state.model` for resolution.
- The view-building should be factored so a Python unit test can assert the
  `opportunistic` block directly (without going through HTTP), mirroring how the
  resolver is already unit-tested.

This keeps resolution logic in one place (Python). The front-end never
re-implements the precedence rules — it reads `state.view.opportunistic`.

## 6. UI surfaces

### 6a. Phase panel — new "🧭 Autonomy" tab

Add a 6th tab `{key:"autonomy", label:"🧭 Autonomy", render:b=>tabAutonomy(b,p,id)}`.
`tabAutonomy` renders:
- the **Mode** 3-state control — a `fieldSelect` with options
  `inherit` / `enabled` / `locked` (labels "Inherit (default)" / "Enabled" /
  "Locked"), wired to the §3 serialization;
- when Enabled: `when` textarea + `examples` `stringListEditor`;
- the **resolved preview** line (§7), read from `state.view`.

Each change mutates `state.model`, calls `refreshView()`, then re-renders the
tab (so the preview + Enabled-conditional fields update). Help icons explain the
3 modes and the nesting constraint (a sub-agent cannot spawn sub-agents).

### 6b. Settings — "Opportunistic (global default)" section

A new section in `renderSettings`, placed near `on_demand_agents`: an Enable
checkbox; when enabled, a `when` textarea + an `examples` `stringListEditor`.
Serialized per §3 (global).

### 6c. DAG grid — phase-card badges

In `renderGrid`, each phase card gets a small badge prefix when
`state.view.opportunistic.phases[id].mark` is set: `🧭` for `"opportunistic"`,
`⛔` for `"locked"`. Styled via a CSS class in `editor.css` (amber / grey, to
echo the cartography). No badge for inherited/none.

## 7. Resolved preview (per-phase)

In the Autonomy tab, a read-only line derived from
`state.view.opportunistic` for the selected phase:

| condition (from view) | label |
|---|---|
| `note_kind == "short"` | 🧭 Targeted lead (global on) |
| `note_kind == "full"` | 🧭 Full grant (global off) |
| `note_kind == "locked"` | ⛔ Locked |
| `mark == null` and `enabled == true` | Inherited from global (no marker) |
| `enabled == false` | Off |

(all four fields — `mark`, `note_kind`, `enabled`, plus the top-level
`global_enabled` — come straight from `state.view.opportunistic`; the front-end
does no resolution of its own.)

Because `refreshView()` runs on every edit, the preview reflects the combined
global + per-phase resolution live, with no regeneration.

## 8. Integration points (files to touch)

| File | Change |
|---|---|
| `src/workflow/templates/webedit/formfields.js` | add `stringListEditor` |
| `src/workflow/templates/webedit/editor.js` | `tabAutonomy` + register the tab; global section in `renderSettings`; grid badges in `renderGrid` |
| `src/workflow/templates/webedit/editor.css` | badge styles (🧭 amber / ⛔ grey), autonomy-tab layout |
| `src/scripts/bb-workflow` | `/api/view` (and the view-builder function) include the `opportunistic` block via `resolve_opportunistic` |
| `src/scripts/tests/webedit/formfields.test.js` | `stringListEditor` + per-phase serialization mapping |
| `src/scripts/tests/webedit/render.test.js` | grid badges from view data; autonomy tab; settings section |
| `src/scripts/tests/test_workflow_*.py` | view-builder returns resolved `opportunistic` block |

## 9. Tests

**Front (`bun test` in `src/scripts/tests/webedit/`)**
- `stringListEditor`: renders existing items, add appends a row, delete removes,
  emit drops empty/whitespace rows.
- per-phase Mode mapping: Inherit → key deleted; Locked → `false`; Enabled + no
  guidance → `true`; Enabled + `when`/`examples` → object with only non-empty
  keys; clearing guidance in Enabled → back to `true`.
- grid badge: a phase whose view `mark` is `"opportunistic"`/`"locked"` renders
  the 🧭/⛔ badge; none otherwise.
- resolved-preview label mapping from a stubbed `state.view`.

**Backend (`pytest`)**
- the view-builder returns `opportunistic.global_enabled` and per-phase
  `mark`/`note_kind` matching `resolve_opportunistic` for a representative model
  (global on + a short-override phase + a locked phase + an inherited phase).

**Visual (manual, MCP chrome)**
- `awok edit`, open `onboard`: toggling `O2-DEPS` shows a 🧭 badge + "Targeted
  lead" preview; `O4-ARCHITECTURE` shows ⛔ + "Locked"; save → reload round-trips
  the YAML unchanged (`awok check` still clean).

## 10. Non-goals (future / out of scope)

- Per-DAG-level sub-tabs / bulk editing across a level (the hunter's "peut-être
  ensuite" idea).
- Rendering the generated SKILL.md opportunistic section inside the editor.
- Any change to the `awok edit` security posture (still loopback-only, no auth;
  the README's "don't expose the service" note stands).
- No new compiler/runtime behavior — this is an authoring/visualization layer
  over the existing `opportunistic` field.

## 11. Resolved decisions (from brainstorming)

- Scope = full: authoring + grid visibility + live resolved preview.
- Per-phase editor lives in a **dedicated "🧭 Autonomy" tab** (per-level
  organization deferred).
- Resolution stays server-side (`resolve_opportunistic` via `/api/view`); the
  front-end never re-implements precedence.
- 3-state per-phase Mode (Inherit / Enabled / Locked) with minimal-YAML
  serialization (`true` for a guidance-less enable, object only when guidance is
  present, `false` for lock, absent for inherit).
