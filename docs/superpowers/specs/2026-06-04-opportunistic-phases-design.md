# Opportunistic phases — design

- **Date**: 2026-06-04
- **Status**: Approved (brainstorming) — ready for implementation plan
- **Component**: `src/scripts/bb-workflow` (compiler), schema, Jinja templates
- **Scope**: a new `opportunistic` field that grants the main orchestrator a
  scoped licence to author and dispatch *ad-hoc* sub-agents on selected phases.

## 1. Context & problem

awok compiles a declarative `workflow.yaml` into a `SKILL.md` orchestrator. The
generated pipeline is **deterministic**: the main agent dispatches exactly the
planned sub-agents, in DAG order. That rigidity is a feature for reproducibility,
but it leaves no room for **opportunism** — reacting to something the planned
agents did not anticipate.

Two motivating cases:

- **onboard / `O2-DEPS`**: the `deps-auditor` reports that several dependencies
  look old/abandoned. Nothing in the pipeline checks for known CVEs. The main
  agent should be allowed to spin up an ad-hoc agent that looks them up.
- **pentest recon**: recon reveals the target runs WordPress. No `wordpress-recon`
  agent exists in the pipeline. The main agent should be able to author one on
  the fly and run specialised recon.

The key insight: the main agent already *technically* has the `Task`/`Agent`
tool, but a deterministic workflow implicitly forbids using it off-script. We
want a declarative way to say **"on this phase, improvisation is permitted —
and here is the spirit of it."**

### What this is (and is not)

awok has **no runtime**. The `SKILL.md` it emits *is* the orchestrator's prompt.
So this feature is, fundamentally, **a scoped block of instructions injected into
the right place of that prompt** — nothing more. There is no execution-time
enforcement; we are encoding *permission + guidance*, anchored to a phase.

### Architectural constraint: no recursive nesting

Confirmed against the official Claude Code docs
([sub-agents](https://code.claude.com/docs/en/sub-agents.md)): **a sub-agent
cannot spawn sub-agents** (max nesting depth = 1). Listing `Task` in a custom
agent's `tools:` does not change this — the restriction is architectural.

Consequence for the design: the spawning power belongs **exclusively to the main
orchestrator**. In a `type: agent` phase, the planned sub-agent (e.g.
`deps-auditor`) cannot itself spawn the CVE follow-up. The opportunism therefore
happens at the **orchestration seam around the phase**: the main agent reads the
planned sub-agent's report, applies its whole-workflow view, and *then* dispatches
the ad-hoc agent.

```
main agent ──dispatch──▶ planned sub-agent (e.g. deps-auditor)
                              │  returns report (+ optional flagged leads)
main agent ◀──────────────────┘
     │  reads result + whole-workflow context
     ▼  if uncovered signal → authors & launches an ad-hoc agent
        (Task, general-purpose/Explore, freeform prompt, usually background)
```

This constraint *reinforces* anchoring the licence to a phase: that seam is the
only place the main agent holds both the phase result and the global context.

## 2. Goals / non-goals

**Goals**
- Declarative, per-phase licence for the main agent to author + dispatch ad-hoc
  sub-agents, with author-supplied guidance.
- A workflow-wide default (one switch) plus per-phase override (including an
  explicit *disable* for deterministic/sensitive phases).
- Render the licence into `SKILL.md` at the correct scope.
- Surface the "autonomy zones" in the cartography (HTML + text).
- Validate the new field (schema + coherence warnings).

**Non-goals (YAGNI — may come later)**
- A curated pool of pre-written agents to pick from. (Explicitly rejected: the
  main agent *authors* agents on the fly; we grant permission, not a catalogue.)
- Rich execution discipline fields: `max:` (soft cap), `outputs_to:` (output
  namespace), configurable `background:`. Background-by-default is conveyed as
  prose, not a field.
- The "planned sub-agent flags its uncrawled leads" convention — that lives in
  the agent's own prompt (`src/agents/<name>.md`), not in awok.
- The Web UI editor surface (a dedicated tab) — handled later; the YAML model
  defined here is the contract that tab will read/write.
- Any runtime enforcement (awok does not execute).

## 3. Data model

A single field name, `opportunistic`, available at **two levels**, accepting
**`boolean | object`** at both.

### Top-level (workflow default)

```yaml
opportunistic:                 # absent or false → disabled by default
  enabled: true                # master switch (optional in object form, default true)
  when: |                      # general guidance (optional)
    When you spot a signal the planned agents don't cover.
  examples:                    # general examples (optional)
    - "detected tech/CMS → specialised recon"
```

### Per-phase (override)

```yaml
phases:
  - id: O2-DEPS
    # ...
    opportunistic:             # bool | object
      when: "A dependency looks old / abandoned."
      examples:
        - "old dependency → ad-hoc agent that looks up known CVEs"

  - id: O4-ARCHITECTURE
    opportunistic: false       # explicit lock (deterministic reduce)
```

### Form semantics

- `opportunistic: true` ≡ `{ enabled: true }` — enabled, no guidance.
- `opportunistic: false` — disabled. **The only way to turn it off.**
- object present ⇒ enabled, unless `enabled: false` is explicit.
- object fields: `enabled?: bool` (default `true`), `when?: string`,
  `examples?: string[]`. `additionalProperties: false`.

### Resolution (computed in Python at `generate`, not in Jinja)

Per phase, awok combines the global default and the phase override into a single
resolved struct attached to the phase (mirroring how awok already resolves
`role→path`, derives `parallel_with`, and pre-renders invocations before the
templates run). Templates stay logic-free — they read the resolved struct.

| `phase.opportunistic` | global `opportunistic` | phase active? | guidance shown |
|---|---|---|---|
| `false` | (any) | **no** (lock) | "not allowed here" note |
| `true` / object | (any) | **yes** | phase's own (or generic) |
| *absent* | enabled | **yes** (inherited) | global's |
| *absent* | absent / disabled | **no** | — |

Resolved struct (illustrative):

```python
phase["_opp"] = {
    "enabled": bool,              # effective (global + override combined)
    "explicitly_disabled": bool,  # phase.opportunistic == false while global on
    "needs_full_grant": bool,     # enabled AND global not enabled → self-sufficient block
    "has_own_content": bool,      # phase declared its own enable/when/examples
    "mark": str | None,           # "opportunistic" | "locked" | None (cartography, see §5)
    "when": str | None,
    "examples": list[str],
}
# plus a top-level context var:
opportunistic_global = { "enabled": bool, "when": str|None, "examples": [...] }
```

`needs_full_grant` exists because a phase-enabled block must be **self-sufficient**
when the global default is off (global → phase ON): in that case the phase block
must carry the full permission text, not just the guidance.

## 4. Rendering — `SKILL.md`

### 4a. Global section (rendered once, only if `opportunistic_global.enabled`)

Inserted after the pipeline intro, before the phase list (i.e. between the intro
block at lines ~16-21 and the `## Pipeline phases (DAG)` heading in
`skill-skeleton.md.jinja`).

```markdown
## 🧭 Opportunistic autonomy

This workflow permits **scoped improvisation**. Beyond the planned work, you
(the orchestrator) may **author and launch an ad-hoc sub-agent** whenever you
spot a signal the planned agents do not cover.

- **How**: the `Task` tool, `subagent_type: general-purpose` (or `Explore`),
  with a prompt you write yourself from context. These agents do not exist in
  `src/agents/` — you create them on the fly.
- **When**: {{ when }}
- **Mode**: usually in the **background**, unless the result is needed to
  continue the current phase.
- **Nesting limit**: a sub-agent cannot itself spawn sub-agents (max depth = 1).
  So it is up to you, after reading the planned sub-agent's report, to launch
  the follow-up.
- **Scope**: all phases, except those marked ⛔.

Examples: {{ examples }}
```

### 4b. Per-phase block (inside `### PHASE`, orthogonal to `type`)

A new conditional in the phase loop (alongside the existing `workflow_call`
branch but **additive** — it renders in addition to the type block, not instead
of it). Four cases driven by `phase._opp`:

| Case | Rendered output |
|---|---|
| `explicitly_disabled` (global on) | `> ⛔ **No opportunistic autonomy here.** If the need is compelling, ask the user.` |
| `enabled` + `needs_full_grant` (global off, phase on) | full self-sufficient permission block (same content as 4a, scoped to this phase) + the phase's `when`/`examples` |
| `enabled`, covered by global, **with** `when`/`examples` | `> 🧭 **Opportunistic lead here.** {{ when }} — e.g. {{ examples }}` |
| `enabled`, covered by global, **without** guidance | *nothing* (already covered by the global section — avoid noise) |

Example "short note" on `O2-DEPS`:

```markdown
> 🧭 **Opportunistic lead here.** A dependency looks old / abandoned.
> e.g. old dependency → ad-hoc agent that looks up known CVEs.
```

The "not allowed here" note is deliberately one line, with an explicit escape
hatch (ask the user) for the rare compelling case.

## 5. Rendering — cartography (HTML mermaid + text)

**Inverted marking** for readability:

- **Global enabled** → nearly every phase is an autonomy zone; marking them all
  is noise. Mark the **exception**: phases with `opportunistic: false` get a ⛔
  lock badge. A graph subtitle reads "🧭 Opportunistic workflow (except ⛔)".
- **Global disabled** → only the tagged phases stand out: dashed border + 🧭,
  the way `workflow_call` has its purple border. Others render normally.

**Marking rule** (unifies both modes — mark only what carries phase-specific
intent, never the blanket-covered majority):

- phase has **its own** opportunistic content — a standalone enable
  (`opportunistic: true`/object when global is off) **or** an override that adds
  `when`/`examples` (even under global-on, e.g. `O2-DEPS`) → 🧭 `opportunistic`.
- phase is `explicitly_disabled` → ⛔ `opp_locked`.
- phase enabled purely by **inheritance** from the global default, with no own
  content → **unmarked** (avoid noise).

This is computed in Python (a `_opp.mark ∈ {"opportunistic", "locked", None}`
field); the template only picks the class from `mark`.

Mermaid (`cartography.mermaid.jinja`) — two new `classDef`s:

```jinja
classDef opportunistic stroke-dasharray:5 4,stroke:#f59e0b,stroke-width:2px
classDef opp_locked stroke:#6b7280,stroke-width:1px,color:#9ca3af
```

- `mark == "opportunistic"` → `:::opportunistic`, label prefixed `🧭`.
- `mark == "locked"` → `:::opp_locked`, label prefixed `⛔`.

Amber `#f59e0b` is chosen to stay distinct from the `workflow_call` purple
(`#a78bfa`) and the group fills.

Text cartography (`-texte.md`, `cartography-texte.md.jinja`): one line per
affected phase, plus a header mention when global is enabled. e.g.

```
🧭 O2-DEPS — opportunistic autonomy (old deps → CVE)
⛔ O4-ARCHITECTURE — opportunism locked (deterministic reduce)
```

The **On-demand** cartography tab is unchanged — it concerns `on_demand_agents`,
a distinct mechanism.

## 6. Validation (`awok validate`)

**Schema** (`workflow.schema.json`): add an `opportunistic` definition accepting
`boolean | object`; reference it from both the top-level `properties` and the
`phase` definition.

```json
"opportunistic": {
  "oneOf": [
    { "type": "boolean" },
    {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled":  { "type": "boolean" },
        "when":     { "type": "string" },
        "examples": { "type": "array", "items": { "type": "string" } }
      }
    }
  ]
}
```

**Coherence checks** (beyond schema):

| Rule | Level |
|---|---|
| `opportunistic` set on a `type: workflow_call` phase | ⚠️ warning — the dispatch leaves the workflow; opportunism belongs to the called workflow |
| `opportunistic: false` on a phase while global is already off | ⚠️ warning — redundant (nothing to lock) |
| global object with `enabled: false` and no phase enabling it | ⚠️ warning — dead config |
| malformed shape (wrong type, unknown key) | ❌ error (schema) |

Allowed on every `type:` (`agent`, `main_agent`, `script`, `external`) — the main
agent always reads the phase output and can react — except the `workflow_call`
warning above.

## 7. Integration points (files to touch)

| File | Change |
|---|---|
| `src/workflow/workflow.schema.json` | add `opportunistic` definition; reference from top-level + `phase` |
| `src/scripts/bb-workflow` | parse/normalise top-level + per-phase `opportunistic`; compute `phase._opp` + `opportunistic_global` in the phase pre-render loop (near the existing `rendered_invocations` loop); add coherence warnings; pass class selection to the mermaid renderer |
| `src/workflow/templates/skill-skeleton.md.jinja` | global section (after intro); per-phase 4-case block in the phase loop |
| `src/workflow/templates/cartography.mermaid.jinja` | `classDef`s + per-node class/label prefix from `_opp`; optional subtitle |
| `src/workflow/templates/cartography-texte.md.jinja` | per-phase lines + header mention |
| `src/workflows/onboard.yaml` | demo wiring (see §8) |

## 8. Demo wiring in `onboard.yaml`

`onboard` is the showcase workflow, so it should demonstrate the feature
end-to-end. **Decision: enable the global default**, so all three paths render:
the global section (4a), a targeted 🧭 override, and a ⛔ lock.

```yaml
# top-level
opportunistic:
  enabled: true
  when: "When an explorer surfaces a signal the planned reduce won't chase."
  examples:
    - "detected framework/CMS → ad-hoc specialised recon"

phases:
  - id: O2-DEPS
    opportunistic:            # override → carries own guidance → gets 🧭
      when: "A dependency looks old / abandoned."
      examples:
        - "old dependency → ad-hoc agent that looks up known CVEs"
  - id: O4-ARCHITECTURE
    opportunistic: false      # deterministic reduce → ⛔ lock
```

Resulting cartography: `O2-DEPS` → 🧭 (own guidance), `O4-ARCHITECTURE` → ⛔, the
other inherited phases unmarked, graph subtitle "🧭 Opportunistic workflow
(except ⛔)".

## 9. Documentation to update

- `CLAUDE.md` — author guide: a new subsection under "When you modify things
  here" describing the `opportunistic` field (two levels, bool|object, resolution
  table, rendering, the nesting constraint, when to use vs `on_demand_agents`).
- `README.md` — a short mention in the feature list (the compiler also encodes
  scoped opportunistic autonomy zones).
- `docs/dev/bb-workflow.md` — user doc: field reference + example.

## 10. Tests (`src/scripts/tests/`)

- schema accepts `opportunistic` as bool and as object at both levels; rejects
  unknown keys / wrong types.
- resolution/precedence: the §3 table (4 rows) produces the expected `_opp`
  structs (inherited, override, lock, off).
- SKILL.md rendering: global section present iff global enabled; each of the 4
  per-phase cases renders the expected marker/text; `needs_full_grant` produces a
  self-sufficient block.
- cartography: correct `classDef`/class selection and label prefix for 🧭 and ⛔
  under both global-on (inverted marking) and global-off.
- coherence warnings fire for the three documented cases.

## 11. Resolved decisions (from brainstorming)

- Free authoring, **not** a curated pool — the main agent creates agents on the fly.
- Global default **+** per-phase override (option "b"), not global-only.
- Permission anchored to phases (justified further by the no-nesting constraint).
- Disabled-phase note: **one concise line** + "ask the user if compelling".
- Cartography: **inverted marking**, amber `#f59e0b`.
- Rich tier (`max`/`outputs_to`/`background`), Web UI tab, and the planned-agent
  "flag your leads" convention are out of scope for this spec.
