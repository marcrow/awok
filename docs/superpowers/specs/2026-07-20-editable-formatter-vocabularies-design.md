# Editable, documented vocabularies for the formatter prompt-assist knobs (C5)

> Status: design approved 2026-07-20. Implementation via
> `superpowers:writing-plans` → `superpowers:subagent-driven-development`.
> Related: TODO.md **C5**; the io-contract spec
> `docs/superpowers/specs/2026-07-17-workflow-io-contract-design.md` §4d
> (prompt-assist, engine-owned compile → prose); C3 help layer.

## 1. Problem

The formatter's **prompt-assist knobs** — `length`, `tone`, `format`, `audience`,
`language`, `stance` — are today a **fixed list, hardcoded twice**:

- **Engine** (`src/scripts/bb-workflow`): `compile_style()` turns a `style` dict into
  prose lines using three ad-hoc mechanisms — pure word interpolation (`tone`,
  `audience`, `language`: `f"Write in a {tone} tone."`), a per-value sentence map
  (`_FMT_PROSE` for `format`, inline strings for `stance`), and a template-plus-hint
  (`_LEN_HINT` for `length`).
- **Web UI** (`src/workflow/templates/webedit/definition.js`, lines ~29-39): a **parallel,
  drift-prone** copy of the option lists — `LEN_SCALE`, `LEN_HINT`, `TONE_SCALE`,
  `TONE_LABELS`, `FMT_SCALE`, `FMT_LABELS`, `AUD_SCALE`, `AUD_LABELS`, `LANGS`,
  `LANG_LABELS`, `STANCE`.

Two problems: (a) the two copies can diverge (the engine never declares the ordinal
scale the UI hardcodes); (b) **no option carries a human definition** — a user cannot
learn, in the UI, what a `beginner` tone or an `external stakeholder` audience actually
means, and cannot extend or reword the vocabulary.

**Goal.** Make the vocabularies **data-driven, documented, and user-extensible**: one
engine-owned store (a canonical base plus a user overlay that survives engine upgrades),
each option carrying a human `definition` and its injected `prose`; the engine's
`compile_style()` and the UI both read from the merged store; and an in-editor surface
to view / reword / add options — user layer only, base stays read-only.

## 2. Decisions already fixed (context, not re-litigated)

From TODO.md C5 and the 2026-07-20 dialogue:

- Vocabularies are **global to the awok engine**, not per-workflow (they are not declared
  inside any single workflow YAML).
- **Two conceptual layers**: an awok-defined **base** (ships with the engine) plus a
  **user overlay** that an engine upgrade never clobbers.
- The store must be editable from the Web UI **without the UI writing outside the project
  directory** (no `~/.config`, no home). The overlay lives inside the project / the
  `--workdir`.

## 3. Storage — three layers, project-scoped

### 3.1 Files

| Layer | Path | Writable? | Purpose |
|---|---|---|---|
| **base** | `ENGINE_ROOT/src/workflow/vocab.yaml` | engine source (git) | Canonical knobs + options + definitions + prose. Read-only in the UI. |
| **engine overlay** | `ENGINE_ROOT/custom/vocab.yaml` | user (UI writes) | The user's global variations, made while working in awok itself — this is the "global to the engine" layer. **gitignored.** |
| **workdir overlay** | `CONTENT_ROOT/custom/vocab.yaml` | user (UI writes) | Extra variations for a specific external content root, only when `--workdir` differs from `ENGINE_ROOT` — "ce répertoire en plus". |

`custom/` is a **new, gitignored** directory at the project root, deliberately generic so
future awok-level config can join it (not just vocab). A `.gitignore` rule (`/custom/`) is
added in the awok repo. Neither `install.sh` (writes only `~/.local/bin` +
`~/.claude/{skills,agents}`) nor `git pull` touches an untracked/ignored `custom/`, so the
overlay **survives engine upgrades** — the hard constraint.

### 3.2 Merge semantics

Resolution order, each later layer extending / overriding the earlier, **keyed by
`(knob, option-value)`**:

```
base  ←  engine overlay (ENGINE_ROOT/custom)  ←  workdir overlay (CONTENT_ROOT/custom)
```

- When there is no `--workdir` (developing awok), `ENGINE_ROOT == CONTENT_ROOT`, so the
  engine and workdir overlays are the **same file** → the model collapses to `base ←
  overlay`. No duplicate application.
- An overlay may **add** a new option to a knob, or **override/reword** the fields
  (`definition`, `label`, `prose`, `hint`) of an existing option — a shallow per-option
  field merge (overlay field wins; unspecified fields inherit the lower layer).
- An overlay may **not delete** a base option. A shipped workflow could already reference
  a base value; removing it from the vocab would silently orphan that workflow's style.
  (A non-destructive `hidden: true` is the safe future extension if ever needed — out of
  scope for v1, YAGNI.)
- The **set of knobs is fixed** (each maps 1:1 to `compile_style` logic and a specific UI
  control). Overlays extend the **options within** a knob, never add or remove knobs.

## 4. Vocabulary model

### 4.1 Base file shape (`vocab.yaml`)

```yaml
version: 1
knobs:
  length:
    kind: ordinal                                    # → slider in the UI
    optional: false
    prose_template: "Keep the answer {value} ({hint})."   # fallback (§4.3)
    options:
      - value: terse
        hint: "~40 words"
        definition: "Just the answer, no elaboration or supporting reasoning."
        prose: "Keep the answer terse (~40 words)."
      - value: brief
        hint: "~150 words"
        definition: "A short answer that still gives the key reasoning, not only the verdict."
        prose: "Keep the answer brief (~150 words)."
      # standard, detailed, exhaustive …
  tone:
    kind: ordinal
    supports_custom: true                            # the tone=custom / toneCustom escape hatch
    prose_template: "Write in a {value} tone."
    options:
      - value: direct
        label: direct
        definition: "Straight to the point; no preamble, hedging, or throat-clearing."
        prose: "Write in a direct tone."
      # professional, didactic, beginner, zero-knowledge …
  format:
    kind: ordinal
    prose_template: "Format as {value}."
    options:
      - value: prose
        definition: "Flowing paragraphs, no lists or headers."
        prose: "Write as flowing prose."
      # tldr, bullets, sections, table …
  audience:
    kind: ordinal
    optional: true
    prose_template: "Written for a {value}."
    options:
      - value: maintainer
        definition: "A developer who owns this code and knows the domain."
        prose: "Written for a maintainer."
      # external stakeholder, downstream workflow …
  language:
    kind: nominal                                    # → chips in the UI
    prose_template: "Respond in {value}."
    options:
      - value: inherit
        label: "↩ inherit"
        definition: "Follow the session / default language; inject nothing."
        prose: ""                                     # empty ⇒ nothing injected
      - value: English
        label: "🇬🇧 English"
        definition: "Answer in English regardless of the input language."
        prose: "Respond in English."
      # French, German, Spanish …
  stance:
    kind: nominal
    optional: true
    prose_template: "{value}"
    options:
      - value: recommend
        definition: "Commit to one clear pick rather than laying out choices."
        prose: "Give a clear recommendation."
      - value: present
        definition: "Lay out the options and their trade-offs without choosing."
        prose: "Present options rather than a single pick."
```

Per-option fields:

| field | meaning | used by |
|---|---|---|
| `value` | the stored key written into `formatter.style.<knob>` | engine + UI |
| `definition` | **human** explanation; shown in the UI (tooltip/inline). Never injected. | UI |
| `prose` | the **exact sentence injected** by `compile_style`. Empty string ⇒ inject nothing. | engine |
| `label` | short UI label (slider tick, flag emoji). Defaults to `value`. | UI |
| `hint` | optional readout (e.g. `~150 words` for length). | UI + `prose_template` |

Knob-level fields: `kind` (`ordinal` → slider / `nominal` → chips), `optional`
(the knob may be cleared to "none"), `supports_custom` (tone's free-voice escape),
`prose_template` (§4.3).

**`definition` and `prose` are both user-editable** in an overlay.

### 4.2 Overlay file shape

Same shape, **partial**: only the knobs / options being added or reworded, only the
fields that change.

```yaml
version: 1
knobs:
  tone:
    options:
      - value: beginner            # reword an existing base option
        definition: "Explain like the reader is smart but new to this exact topic."
      - value: warm                # add a brand-new option
        definition: "Friendly and encouraging, like helping a colleague."
        prose: "Write in a warm, encouraging tone."
```

- **Ordering of added ordinal options.** Ordinality is purely a UI affordance (the slider
  position); the engine only ever looks up `prose` by value, never reasons about order.
  Merged order = base options in base order, then overlay-added options appended in file
  order. An added ordinal option therefore lands at the far end of the slider. Documented,
  acceptable for v1.

### 4.3 `compile_style` reads the merged store (fallback = no schema tightening)

`compile_style(style)` resolves each set knob against the merged vocab:

1. Look up the option by `(knob, value)`. If found and it has a `prose`, append that
   `prose` verbatim (empty string ⇒ append nothing — e.g. `language: inherit`).
2. If the value is **not** in the vocab, or the option has no `prose`, fall back to the
   knob's `prose_template`, interpolating `{value}` (and `{hint}` when present). This
   reproduces today's behavior for any value authored outside the vocab.
3. `tone: custom` + `toneCustom` (free voice) and the free lists `mustInclude` / `avoid`
   are **unchanged** — they are not vocab knobs (they are arbitrary user text). The vocab
   covers the closed-set knobs only.

Because unknown values degrade gracefully, `def_formatter.style` in
`src/workflow/workflow.schema.json` **stays open** (`{"type": "object"}`) — no
tightening, so no existing workflow can be invalidated (relevant if a workflow authored
elsewhere carries an overlay-only value the local machine lacks).

### 4.4 Base prose is chosen for prompt-efficiency

No shipped workflow uses `formatter.style` yet (verified: no `definition:`/`formatter:`
block in `src/workflows/*.yaml`), so the base `prose` is free to be **optimal and
compact** — effective in a prompt without wasting context — rather than bound to the old
hardcoded strings. The current strings (`"Write in a professional tone."`, `"Structure
as bullet points."`, `"Keep the answer brief (~150 words)."`) are already concise and are
kept as the optimal baseline; any deliberate wording change updates the pinned test
(§8). The base **must** cover at minimum `length`, `tone`, `format`, `audience`,
`language`; `stance` is included too (it is already compiled today).

## 5. Engine module (reusable, not buried in the Definition tab)

A cohesive block of functions in `src/scripts/bb-workflow`, decoupled from any single
consumer so the future agent-style editor reuses it as-is:

- `vocab_overlay_paths()` → the ordered list of overlay paths to apply
  (`ENGINE_ROOT/custom/vocab.yaml`, then `CONTENT_ROOT/custom/vocab.yaml` when distinct).
- `load_vocab()` → the **merged** vocab dict, each option tagged with provenance
  `source: "base" | "overlay"` and `overridden: true` when an overlay reworded a base
  option. Used by both `compile_style` and the `GET /api/vocab` endpoint.
- `save_vocab_overlay(patch, root)` → writes **only** the overlay for the current root
  (`<root>/custom/vocab.yaml`), creating `custom/` if absent. Base is never written.
- `compile_style(style)` → refactored to consult `load_vocab()` (§4.3). The three
  hardcoded maps (`_LEN_HINT`, `_FMT_PROSE`, inline tone/audience/language/stance strings)
  are **removed**; their content moves into `vocab.yaml`. `prose_template` values become
  the fallback map.

`load_vocab()` reads small YAML files each call — no caching needed at `generate` scale;
the server calls it per `GET /api/vocab` request (vocab changes rarely).

## 6. HTTP API (`awok edit` server)

The vocab is global and does not change per keystroke, so it is **not** folded into the
per-edit `build_view_payload` (`/api/view`). Two dedicated routes, added to the existing
`_route_get` / `_route_put` in the `_Handler` closure (which already carries the project
dirs, so writes stay project-scoped):

- **`GET /api/vocab`** → the merged vocab (§5 `load_vocab()`), with per-option provenance
  so the UI knows base (read-only) vs overlay (editable / overridden).
- **`PUT /api/vocab`** → body = the overlay patch; writes only
  `<current-root>/custom/vocab.yaml` via `save_vocab_overlay`. Returns `{ok, errors}`
  after a light shape validation (known knob names, option-value slugs, string fields).

**Path safety.** The overlay path is fixed (derived from the server's root, not from the
request body) — no user-supplied path, no traversal. Consistent with the standing rule
that `awok edit` is local and not exposed (TODO.md E1).

The server-rendered `definition_preview` (compiled style prose) in `build_view_payload`
is **unchanged** — D5 holds, the UI never recompiles style in JS.

## 7. Web UI

### 7.1 `vocab.js` — a generic, reusable module

New `src/workflow/templates/webedit/vocab.js`, exporting:

1. **A data-driven control renderer** — given a merged knob spec + current value, render
   the right control (`ordinal` → the existing `bigSlider`; `nominal` → `chipsControl`)
   with each option's `definition` surfaced as a tooltip / inline help. This is what lets
   `definition.js` drop its local `LEN_SCALE` / `TONE_SCALE` / … constants and render the
   knobs from `GET /api/vocab` instead.
2. **The vocabulary editor component** — lists each knob's options, base ones shown
   read-only, overlay ones editable, with "add option" and "reword" actions that build the
   overlay patch and `PUT /api/vocab`.

`definition.js` consumes (1); the global panel (7.2) hosts (2). The future agent-style
editor reuses both. The client fetches `/api/vocab` once on load (and re-fetches after a
successful `PUT`).

**Add-option prefill.** When the user adds an option, `prose` and `definition` are
**pre-filled** with a sensible, directly usable starter derived from the knob's
`prose_template` (e.g. a new tone `warm` → `prose: "Write in a warm tone."`). The starter
is **never phrased as an example** (`"e.g. …"`) so it does not pollute the compiled prompt
if left as-is.

### 7.2 Global awok settings panel

The current tab strip (`Grid / Dataflow / Definition / Settings / YAML`) is
**workflow-scoped** — there is already a per-workflow `Settings` tab. The vocabulary is
**awok-global**, so it must not be a peer tab there. Instead:

- A new **⚙ button in the topbar `brand` zone** (`editor.html`, next to the awok
  wordmark — the awok-level zone, distinct from the workflow picker and the per-workflow
  `Save`). Title e.g. "awok settings".
- It opens a **full-viewport global panel** reusing the existing `.notice-overlay` chrome
  (as `openPrompt` / `openAgentForm` do). First and only section for now: **Vocabulary**
  (the `vocab.js` editor). The panel is structured to accommodate future awok-level config
  sections, per the user's note that a dedicated awok surface is the right long-term home.

## 8. Tests

**Engine** (`pytest src/scripts/tests/test_workflow_*.py`):

- `load_vocab` merge: overlay **adds** a new option; overlay **overrides** a base option's
  `definition`/`prose`; provenance tags (`source`, `overridden`) are correct.
- **Upgrade survival**: re-loading / regenerating the base does not rewrite or drop the
  overlay file (the overlay is only ever written via `save_vocab_overlay`).
- `compile_style` via vocab: a base value yields its `prose`; `language: inherit` yields
  nothing; an **unknown** value falls back to the knob `prose_template` (reproducing the
  legacy interpolation); `tone: custom` and `mustInclude`/`avoid` unchanged.
- `save_vocab_overlay` writes only `<root>/custom/vocab.yaml`, never the base.
- Update the golden-substring assertions in `test_workflow_definition.py`
  (`test_definition_demo_fixture_renders_golden_substrings`, lines ~227-229) if the base
  prose wording is deliberately changed; otherwise they pass unchanged. Add a test pinning
  the base `prose` for the five required knobs so future wording changes are deliberate.

**Web UI** (`bun test` in `src/scripts/tests/webedit/`):

- `vocab.js` renders an ordinal knob as a slider and a nominal knob as chips from a merged
  vocab payload, surfacing definitions.
- The editor builds a correct overlay patch (add + reword) and issues `PUT /api/vocab`;
  base options are non-editable in the UI.

## 9. Ripple discipline

Per CLAUDE.md "Patching the engine or a template": `compile_style` is engine code, so the
change is global. However, since **no shipped workflow uses `formatter.style`**,
`awok generate` produces **zero SKILL.md diff** and `awok check` stays green. Still run
the full loop after implementation: `awok validate && awok generate && awok check`,
commit any (test-fixture-only) regenerated artifacts in the same commit, and add a
`Regen:` trailer noting the compile_style vocab refactor and the workdir-owner one-liner
(`awok generate && awok deploy`). `./install.sh` to redeploy; restart Claude Code is not
needed (no new agent). Do **not** hand-edit any generated `SKILL.md`.

## 10. Out of scope (v1)

- Deleting / hiding base options (`hidden: true`) — deferred, YAGNI.
- Adding or removing **knobs** (the knob set is fixed; only options extend).
- Precise ordinal placement of overlay-added options (append-at-end is documented).
- Reusing the store for the agent-style editor — the module is built to allow it, but that
  wiring is a separate follow-up.
- Tightening `def_formatter.style` in the JSON-Schema (kept open by design, §4.3).
