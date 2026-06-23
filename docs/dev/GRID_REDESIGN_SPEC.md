# awok — Grid page redesign spec

Reference implementation: `Awok Editor.dc.html` (this export). This spec is **complementary context** for updating the real awok Grid page; the HTML export is the source of truth for visuals and interactions.

## 1. Intent

Replace the dark fir-green, dense Grid editor with a navy / sky-blue interface aligned with `create-workflow.html`. Priorities: a readable level-based layout, a phase editor that surfaces the most-used fields first, and clear visual feedback (hover, selection, drag, empty states).

## 2. Visual system

- **Background**: `#0b1120`, dotted canvas `radial-gradient(circle at 1px 1px,#16223c 1px,transparent 0) 0 0/24px 24px`.
- **Surfaces**: panels `#0f172a`, inputs/wells `#0b1120`, borders `#243049`.
- **Accent**: sky `#38bdf8` (primary actions, selection, focus). Text `#e2e8f0` / muted `#94a3b8` / faint `#475569`.
- **Type**: system sans for UI; `ui-monospace` for ids, roles, prompts, level numbers.
- **Group colors** (palette, assigned by group order): `#60a5fa #4ade80 #fbbf24 #c084fc #f87171 #38bdf8 #fb923c #a3e635`. Each group's color drives its cards' left border, dot, and labels.
- **Type badges**: main_agent sky, agent emerald, script amber, external slate, workflow_call violet.

## 3. Header & nav

- Left: mascot logo (`awok-mascot.png`, 34px, radius 8) + `awok` wordmark.
- **Workflow selector**: a dropdown (monospace, sky text) to switch the active workflow; subtitle shown beside it.
- Right: `N actions · M groups` count, **+ Action**, **Save**.
- Tab bar: Grid (active) / Dataflow / Settings / YAML. A **Dependencies** toggle sits at the right of the tab bar.

## 4. Grid layout (core)

- Vertical **rail** on the left: each level is a numbered circle (group-colored ring) with an "Lvl" caption, connected by thin `#243049` lines. The number is **inside** the node — no overlapping text.
- **Levels are an explicit, editable property of each action** (its execution stage / ordering). Levels are **NOT** derived from `depends_on`.
  - Adding/removing a dependency never moves a card.
  - An action with no dependencies keeps its stage (does not jump to level 1).
  - Multiple actions can share a level (they stack/wrap in that level's row).
- **Card** (per action): id (mono, bold), type badge, `interactive` / `opportunistic` markers, group label (right), name, 2-line description, and chips for dependencies (`↑ id`), inputs (`in · role`), outputs (`out · role`). Left border = group color.
- **States**: hover lifts the card 2px + accent border; selected = sky ring + glow; dragged source = 0.35 opacity.

## 5. Dependency links (overlay)

Toggled by the **Dependencies** button. Drawn above the cards.
- **Adjacent-level** dependency: curve from source bottom-center to target top-center.
- **Same-level** dependency: connector adapts — vertical edge-to-edge when cards are stacked, horizontal when side by side.
- **Multi-level (skip)** dependency: exits the right edge and bows around the right side; parallel arcs are lane-separated by vertical overlap so they never coincide.
- Arrowheads colored by the dependent action's group.

## 6. Drag & drop

- Drop action A onto action B → A moves to **B's level** (levels renumber to stay contiguous 1..K). Decoupled from dependencies, so no cycles are possible and deps are untouched.
- Drop into the **gap between levels** → creates a new intermediate level. Drop zones appear while dragging; the hovered zone **expands** and shows a "+ new level" label (kept subtle otherwise to avoid clutter).
- Live feedback before release: the hovered target card highlights with a "↔ same level" pill.

## 7. Phase editor (drawer)

Resizable right drawer. When open, the grid reflows responsively to the left (no overlap).

**Priority fields, always visible (top):**
- Editable id (header), Name, Type (select), Group (select), **Interactive** toggle, Description.

**Secondary, segmented tabs:** `Wiring` · `Autonomy` · `Invocations` · `Triggers`.
- **Wiring**: `Depends on` (chips + add-dependency select), Inputs and Outputs (role/path + kind, add/remove). Empty states spelled out.
- **Autonomy**: opportunistic toggle → `when` text + examples list.
- **Invocations** (agent-type only): each invocation picks an agent from a **dropdown of the shared agent registry** (+ "new agent…"), with model select and a per-invocation description. An **✎ Prompt** row (with preview) opens a **full-screen prompt editor** — agent name, model, char count. Prompt edits live in the registry and apply to every action invoking that agent.
- **Triggers**: list of triggers — type (`on dependency complete` / `on output produced` / `on condition` / `manual` / `schedule`) + detail text. Default behavior noted: an action fires when the previous stage completes.

Footer: **Delete action** (left), **Done** (right).

## 8. Data model notes (for the real implementation)

- `action.level: number` — explicit stage. Persist it; do not recompute from deps.
- `action.depends_on: string[]` — independent of level.
- `action.inputs/outputs: { role|path, kind }[]`.
- `action.invocations: { agent, model, description }[]` — `agent` references a shared registry.
- **Agent registry**: `{ [name]: { model, description, prompt } }` — prompt shared across invocations.
- `action.triggers: { type, detail }[]`.
- `action.opportunistic: { when, examples[] } | null`.
- `groups: { id, name, description, risk }[]` — group has a stable `id`; `name` is editable (rename never breaks references). Risk ∈ none/low/medium/high.

## 9. Out of scope (in this export)

Dataflow / Settings / YAML tabs are stubbed (greyed). Workflow switching, agent registry wiring, and Save are demo-level — to be connected to real awok state.
