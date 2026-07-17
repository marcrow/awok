# Workflow-level I/O contract (`definition:` block) — design

> **Status**: approved design (brainstorm 2026-07-17), pre-implementation.
> **TODO item**: S1 — *Workflow-level I/O contract (inputs/outputs of the workflow itself)*.
> **Branch**: `feat/workflow-io-contract`.
> **Companion mockup** (vendored, the WebUI target): `2026-07-17-workflow-io-contract-maquette.html`
> (React/Babel; sections §1 hero, §2 params, §3 return, §4 formatter, §5 caller preview, §6 stats, §7 validation banner).

## 1. Motivation

Today `skill:` carries only `name` / `description` / `title`. Inputs and outputs exist
per phase/invocation (`io_ref`) and signals per action (`emits`), but the **workflow as a
whole declares no contract**. Two consequences:

- **Now** — `type: workflow_call` is unverifiable: `validate_coherence` only checks the
  target file exists and is not self (`bb-workflow` ~line 1407). A caller cannot bind
  anything, and a called workflow produces **nothing** in the dataflow graph (its
  consumers look like orphans) nor in the signal graph (you cannot branch on a
  sub-workflow's result).
- **Later** — a dynamic (JS) workflow is invoked as `workflow(name, args)` and **returns a
  value**. That `args`/return seam has no home in the model, and standard→dynamic
  composition needs it. Critically, a dynamic script's `args` and return value are **not
  files** — they cannot be derived from `io_ref`s.

## 2. Core model — the `definition:` block

The workflow's boundary is modelled as **the action-interface the workflow presents to a
caller**, described with awok's *existing* vocabulary (`io_ref` for files, the signal
type-system for typed values). It is a new top-level, **phase-shaped** block:

```yaml
definition:
  params:   [ … ]   # input side — typed values (the args)
  outputs:  [ … ]   # output side — io_ref files (the deliverables), single contract list
  emits:    [ … ]   # output side — signals (the return values)
  formatter: { … }  # optional closing action that produces the deliverable (format mode)
```

Key properties:

- It is a **real terminal phase of the DAG**, "disguised": reserved id **`DEFINITION`**,
  executed last, `depends_on` **derived** from the phases it reads/promotes. It renders as
  a distinct boundary node in the cartography and gets its own WebUI tab.
- **Mode is structural, never a declared enum.** Presence of a `formatter` body ⇒ *format*
  capability; each `emit` independently chooses **promote** (project an internal signal) or
  **create** (read the formatter's output). A workflow may **mix** (e.g. a formatted report
  that also promotes an internal `status` enum).
- **The channel split** (holds in both targets): **files = the data plane shared between
  sub-agents** (sub-agents in a dynamic workflow have real Read/Write; only the JS *script*
  can't read files); **signals/return = the plane the orchestrator/caller reads** (in JS the
  only readable channel).

### Dynamic mapping (designed here, built later with B1)

- `params` → the `args` object of `workflow(name, args)` / the script `args` global.
- `emits` → the `schema` option / typed return value of `agent()`/`workflow()`.
- `outputs` (files) → standard-only ambient artifacts (JS script can't read them; sub-agents can).

## 3. Params — the input side (the args)

Typed **values** supplied at invocation (a research question, a repo path, a mode flag).
**Not** `io_ref`. Named `params` (not `inputs`) to avoid overloading `io_ref` `inputs` used
on every phase. File *seeds* stay the existing `external: true` mechanism — not re-invented
here (decision A of the brainstorm: forbidding file-inputs at the boundary avoids duplication
and keeps `definition` = exactly the dynamic `args`/return contract; the only thing lost is a
weak "caller produces the seed" check, deferrable via `external:true` reconciliation).

Each param:

| field | rule |
|---|---|
| `name` | `^[a-z][a-z0-9_]*$`, unique within params |
| `type` | `number \| string \| bool \| enum \| list` (signal type-system) |
| `values` | **required iff `enum`**; a `default` (if any) must be ∈ `values` |
| `of` | **required iff `list`** — a scalar keyword (`string\|number\|bool\|enum`) **or** an object map `field→spec` (flat, no nesting), **identical to typed-payloads `of`** (see `2026-07-16-typed-signal-payloads-design.md` §6). List-with-object declaration must use the same editor/shape as everywhere else. |
| `required` | boolean |
| `default` | typed; **`required` + `default` is forbidden** (a default makes the param optional); must match `type`; for `enum` ∈ `values`; for `list` disallowed (or strict JSON) |
| `description` | recommended (persona: never read a YAML) |

## 4. Return — the output side

### 4a. Outputs (io_ref) — a SINGLE contract list

**Pitfall resolved (#1).** There is **one** output list — `definition.outputs`. Each entry
declares *who produces it*:

- `produced_by: promote` → references a `role` **already produced by an internal phase**
  (brick mode; the boundary only declares "this internal artifact is a public deliverable").
- `produced_by: formatter` → produced by the `formatter` body (§4c).

The formatter does **not** own a second, independent output list. Any file the formatter
writes is an entry of `definition.outputs` with `produced_by: formatter`; the WebUI's
"formatter outputs" surface edits **that same list filtered to `formatter`**, never a
parallel copy. This kills the mockup's duplication (`o1` and `fo1` both = `report:summary`).

io_ref fields as usual: `role` (`ns:name`, namespace declared in `namespaces`) or `path`
override, `kind` (required), `terminal` (a deliverable → true by nature), `optional`.

### 4b. Emits (signals) — the return values

| field | rule |
|---|---|
| `name` | signal name `^[a-z][a-z0-9_]*$`, unique |
| `type` (+ `values`/`of`) | same rules as params §3 |
| `source` | **promote** or **create** |

- **promote** — `from: <phase_id_lowercase>.<signal>`. **Pitfall #4**: keys follow the engine
  convention `<phase_id_lowercase>.<name>` (`RECON` → `recon.endpoints`), **not** uppercase.
  The referenced internal signal must exist (`collect_signals`); its type should match the
  emit's type (warn on mismatch).
- **create** — reads a **formatter output**. **Pitfall #2**: mirrors the action
  `emits source: field` rules — the read output must be **`kind: json`** and the emit must
  carry a **`field`** selector (which json field). A `number` emit cannot be sourced from a
  `md` file. (`source: token` — a compact end-of-output line — remains an alternative but
  `field`+json is the boundary default.) Requires a formatter (else blocking error). Ties to S4.

**Pitfall #3 — the caller key is not owned here.** A boundary emit is read by a caller as
`<caller's workflow_call phase id>.<name>`, which **varies per caller**. The tab shows a
**placeholder** `‹caller_phase›.<name>`, never a concrete id. Internally the boundary emits
are keyed `definition.<name>`; the caller re-keys.

**Pitfall #14 — reachability (S3).** Promoting a signal whose emitter lives in a conditional
branch means the return may be **absent** at the boundary. Minimum: a warning ("emitter is
conditional — guard with `exists`"). Full treatment is S3.

### 4c. Formatter (optional) — format vs promote

Presence ⇒ *format* mode. Three surfaces, **all editable in this tab**:

- **Prompt** — prose about *how* to gather and shape the final answer. **Never lists files**
  (soft lint if a path is detected): the wired inputs are injected at build (§4d).
- **Wired inputs** — **editable** (pitfall #6 resolved): the formatter is a phase and needs a
  real input-wiring surface embedded in this tab (io_ref inputs), not a read-only view.
- **Outputs** — the `definition.outputs` entries with `produced_by: formatter` (§4a; not a
  separate list).
- **Invocation meta** — `type` (`main_agent | agent`); if `agent`: agent, model, effort,
  tools. `main_agent` hides model/effort/tools (the orchestrator itself writes the answer).

**Pitfall #13 — A2 interaction.** A formatter that invokes a **shared** agent inherits the
cross-workflow last-build-wins blind spot for `effort`+`tools` (TODO A2); `effort` on the
`haiku` tier is gated (warning, injects nothing). The UI must apply the same guard rails.

### 4d. Prompt-assist (compile → prose) — engine-owned

Structured knobs that **compile to prose injected into the prompt at `generate`**. Source of
truth = the fields; the free prompt is concatenated **last** and can override.

| knob | injected (example) |
|---|---|
| **length** (slider: `terse→brief→standard→detailed→exhaustive`) | "Keep the answer brief (~150 words)." — soft/approximate target |
| **tone** (`didactic, professional, direct, beginner, zero-knowledge, custom`) | "Write in a didactic tone." (`custom` → free text) |
| **format** (`prose, bullets, table, sections+headers, TL;DR-then-detail`) | "Structure as bullets." |
| **language** (`inherit, English, French, …`) | "Respond in French." |
| **audience** *(opt.)* / **must-include** / **avoid** / **stance** *(opt.)* | oriented prose lines |

**Pitfall #5 (+#5 bis) — no dual implementation.** `compile_style()` and the injected
**input/output file listing** both live in the **engine** (reuse `inputs_outputs_compact`);
the WebUI **preview is server-rendered via `refreshView`** (or calls the same function), never
a parallel JS copy. The generated prompt / call **must explicitly list the input and output
files** — the preview shows exactly what the build produces: *wired inputs line + output
files line + compiled knobs + free prompt*. Store as `definition.formatter: { prompt, style:
{ length, tone, format, language, … } }`; render composes `inputs_outputs_compact +
compile_style(style) + prompt`.

## 5. `workflow_call` wiring (caller side)

This lives on the **caller's** `workflow_call` phase (Wiring panel / grid), **not** in the
Definition tab (pitfall #8). S1 scope covers it:

- **Bind params** via an `args:` mapping on the `workflow_call` phase (`param → value | signal-ref`).
  Validation: every **required** param of the target is bound; unknown params rejected.
- The target's `outputs` become **dataflow producers** at the caller — teach
  `build_dataflow_graph` (fixes the orphan; adjacent to B7).
- The target's `emits` become **readable signals** keyed `<workflow_call phase id>.<name>`
  (via `collect_signals`/`resolve_signal_emitter`).

The Definition tab renders only the **read-only Caller preview** (§5 of the mockup): required
params to bind + readable signal keys. Reverse index ("who calls this") is out of v1 scope.

## 6. Rendering

- **SKILL.md** — the `DEFINITION` phase renders as the closing action: the composed prompt
  (with the file listing, §4d) in format mode, or the promotion statement in promote mode.
- **Cartography** — a distinct boundary node; `workflow_call` edges draw the target's outputs
  as producers into the caller's dataflow tab.

## 7. WebUI — "Workflow definition" tab

New top-level view (`state.tab = "definition"`), sibling of grid/dataflow/orchestration. The
vendored mockup is the reference; the field inventory and all pitfall resolutions above apply.
Layered C3 help throughout (always-visible one-liner + mini-labels + native ⓘ), English,
compact, persona = *never read a YAML nor the awok docs*.

**Pitfall #7 — identity source of truth.** `skill.name/description/title` are already edited
in `settings.js`. The tab edits the **same model fields** (no fork); Definition absorbs,
Settings delegates. `namespaces` are **read live** (edited in Settings), used by `roleField`.

**Pitfall #12 — stats.** "external inputs" counts `external:true` io_refs across all phases,
**not** the formatter's wired inputs (distinct notions). Stats are derived live
(`compute_levels`, model/effort per invocation defaulting when unset), never editable.

## 8. Validation (consolidated)

Schema (`workflow.schema.json`) + `validate_coherence` / `_validate_signals` additions:

- params: name pattern + uniqueness; `enum`→`values`; `list`→`of`; `required`⊕`default`;
  `default` type/enum-membership.
- outputs: `kind` required; namespace declared; `produced_by ∈ {promote, formatter}`;
  `promote` role produced by an internal phase; `formatter` requires a formatter body.
- emits: name pattern + uniqueness; `promote.from` resolves (lowercase key) + type match warn;
  `create` requires a **json** output + `field`, and a formatter; conditional-emitter warning (S3-lite).
- reserved id `DEFINITION`: **no existing phase may use it** (pitfall #11).
- `workflow_call`: required params bound; unknown params rejected; harvest ⊆ target contract.
- live banner mirrors these (same checks as `awok check`).

## 9. Scope

**In this lot (S1):** the `definition:` schema block; params/outputs/emits + formatter with
prompt-assist; engine-owned compile + server-rendered preview; `workflow_call` `args` binding
+ dataflow producers + signal rekey; SKILL.md + cartography rendering; the **WebUI tab** (the
maintainer's way to visualise and test — explicitly in scope); validation + tests.

**Designed, not built here:** the dynamic (JS) `args`/return materialisation (depends on B1);
the reverse "who calls this" index; the deferred `external:true` seed-provision check.

## 10. Testing

- pytest: schema accept/reject; validation positive+negative for each rule §8; rendering
  (SKILL.md boundary phase, prompt composition, cartography producer edges); `workflow_call`
  binding.
- webedit: the Definition tab (field conditionals, promote/create, formatter editable inputs,
  server-rendered preview parity with the engine compile).
- a fixture workflow exercising `definition` + a `workflow_call` against it.
- **Ripple**: engine/template change ⇒ regenerate all + commit artifacts + `Regen:` trailer +
  redeploy (CLAUDE.md § "Patching the engine or a template").
