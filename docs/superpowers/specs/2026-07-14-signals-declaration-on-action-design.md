# Signals declared on the producing action — design

**Date:** 2026-07-14
**Status:** design approved, spec under review
**Backlog item:** refines **B2** (`TODO.md` — "Web UI: expose a signal when placing a condition")

## Goal

Move signal **declaration** from the *consumer* (a gate's condition operand) to the
*producer* (the action that emits the value), give it a first-class home in the action's
Wiring (next to Inputs/Outputs), and **auto-generate the emission instruction** from the
declaration — across every action nature (agent / script / main_agent), not only agents.
The result: declaring a signal in the editor is *sufficient* — the emitting action is
actually told (or read) to produce it, consistently and without hand-written prose in
descriptions.

## Context and relationship to other work

- **Independent of the `depends_on`-unification** (`2026-07-14-orchestration-depends-on-unification-design.md`,
  already executed on `feat/portes-logiques-orchestration`, which removed the `parallel`
  construct and reframed the overlay as an event-driven Execution protocol). That work
  changed how the **control-flow overlay** renders; this work renders the emission
  instruction on the **content phases** (agent snippet / script section / main_agent
  section), which the unification did not touch. The only shared contract is the golden
  rule — a condition reads a *cheap named signal*, never a whole artifact reload — which
  both designs already honor. The `parallel` nature is therefore absent from this design.
- **Aligns with D1** (`TODO.md` — "Ban multi-agent action blocks"). The one place this
  design needs to name *which* invocation emits a token — a block with several agents — is
  exactly the case D1 would remove. Until D1 lands, we handle it (see Data model). If D1
  lands, that field becomes unnecessary.

## Problem (today)

1. **Declared from the wrong side.** In the web editor a signal is created from a gate's
   condition operand ("＋ Declare a new signal"). But `emits:` already lives *on the phase*
   in the YAML — the UI declares from the consumer, the opposite of where the data model
   puts it.
2. **Declare ≠ emit.** The declaration (`emits:`) tells awok the signal exists (key, type,
   source) — it drives validation, the generated "how to read" guide, and the picker. But
   nothing makes the action actually *produce* it. Today the author must hand-write the
   emission instruction in prose (onboard: *"instruct it to … end its output with a compact
   `SIGNALS has_manifest=…` line"*). Easy to forget, inconsistent, and it pollutes the
   description.
3. **Only agents are covered in practice.** Actions are not only agents — `script`,
   `main_agent`, `workflow_call`, `external` all exist. A signal model that only reasons
   about an agent's prompt is incomplete: a script produces values through its exit code,
   its stdout, or an output file — none of which is an "agent prompt".

## Decision (summary)

- A signal is **declared on the producing action**, in a new **Signals** section of the
  action's Wiring (alongside Inputs/Outputs). On disk this remains the existing `emits:`
  key on the phase — the source of truth does not move.
- The `emits` **`source`** enum gains **`exit_code`**; the allowed sources become
  **nature-dependent**.
- awok **generates the emission instruction** at `generate`, rendered per nature, always
  workflow-scoped (never in the shared `src/agents/<agent>.md`).
- In the editor, **declaration is producer-only**; the gate condition operand becomes a
  **selection** of already-declared signals. The in-condition "declare a new signal"
  feature is **removed**.

## 1. Data model

`emits` stays a list on the phase/action. Item shape (schema `workflow.schema.json`,
`definitions.phase.properties.emits.items`):

| Field | Notes |
|---|---|
| `name` | `^[a-z][a-z0-9_]*$` (unchanged) |
| `type` | `number \| string \| bool \| enum \| list` (unchanged) |
| `source` | **`field` \| `token` \| `exit_code`** — `exit_code` is new |
| `from` | for `source: field` only — `role` or `role.field` of an output this action produces |
| `by` | **optional**, only meaningful for `source: token`/`exit_code` on a **multi-agent** block: the agent whose output carries it. Omitted (and unnecessary) for single-producer actions and for `field`. Becomes dead once D1 bans multi-agent blocks. |

Signal **key** is unchanged: `<phase_id lowercased>.<name>` (e.g. `o0-inventory.has_manifest`).

### Allowed sources per action nature

| Nature | Allowed `source` | The orchestrator reads… |
|---|---|---|
| `agent` | `token`, `field` | the sub-agent's `SIGNALS name=…` line, or a field of its json output |
| `script` | `exit_code`, `token`, `field` | the script's **exit code**, its stdout `SIGNALS` line, or a field of its json output |
| `main_agent` | `token`, `field` | the orchestrator produces the value itself |
| `workflow_call`, `external` | — (none) | out of scope — see B8 |

### Emitter resolution (who produces the signal)

- **`field`** (`from: role[.field]`) → the emitter is the **producer of that output role**,
  derived from the dataflow (awok already tracks producers for validation). Works for a
  specific agent invocation, a script, or main_agent — no ambiguity, and it lets awok
  validate the role exists.
- **`token` / `exit_code`** → the action itself. A single-producer action (script,
  main_agent, single-agent block) → automatic. A multi-agent block → the emitting agent is
  named by `by:` (until D1 removes the multi-agent case).

## 2. Generation (what awok emits at `generate`)

For each declared signal, awok renders an **emission instruction**, targeted at the emitter,
into the **content-phase** rendering of the SKILL.md (never the shared agent file):

- **`agent`** → into the **emitting invocation's snippet**:
  - `token`: "End your output with a compact `SIGNALS <name>=<value-spec>` line."
    (`<value-spec>` is `<true|false>` for bool, the enum set for enum, etc.)
  - `field`: "Your `<role>` json output must contain a field `<name>` of type `<type>`."
- **`script`** → an **orchestrator-facing** instruction in the script's action section:
  "Run this script; the signal `<name>` is its exit code (`0` ⇒ `true`) / its stdout
  `SIGNALS <name>=…` line / the field `<role>.<name>` of its json output."
- **`main_agent`** → an instruction **to the orchestrator** in that action's section:
  "Produce signal `<name>` (`<type>`) as you perform this step, via …".

The generated "**Signals** — how to read each condition operand" section (already emitted
on the reading side) stays; this adds the symmetric **producing** side.

## 3. Web editor UX

1. **Signals section in the action Wiring drawer**, under Inputs/Outputs. One row per
   signal: `name` · `type` · `source` (the `source` dropdown is filtered by the action's
   nature per the table above) and, conditionally:
   - `field` → pick an **existing Output role** of this action + optional field path;
   - `exit_code` → nothing more (implicit `exit 0 ⇒ true`);
   - `token` → nothing more (the name is enough);
   - `by` selector appears only for `token`/`exit_code` on a multi-agent block.
   The action card keeps its `emits ◈ name · type` chip.
2. **The invocation instruction field gets a title** (English): **"Instruction sent to the
   agent at launch (via Task)"**, making explicit that it is the launch prompt the
   orchestrator relays to the sub-agent — not the agent's static file.
3. **The gate condition operand becomes selection-only**: it picks from **already-declared**
   signals (grouped by producing phase). The current in-condition **"＋ Declare a new
   signal" is removed** — declaration happens exclusively from the producing action's
   Wiring.
4. All web-UI strings and documentation are **English**.

## 4. Validation rules (blocking, in `validate` / schema / coherence)

1. **`source: exit_code` ⇒ action nature is `script` AND `type: bool`** (mapping
   `exit 0 = true`). exit_code makes no sense on a non-script or a non-bool signal.
2. **`type: list` ⇒ `source: field`** (a json array field). A `list` over token/exit_code is
   impractical — forbid it.
3. **`source: field` ⇒ the `from` role is produced by this action** (checked via the
   dataflow). Blocking error otherwise. This locks the data contract.
4. **`source: token`/`exit_code` on a multi-agent block ⇒ `by:` names an agent of the
   block** (until D1). Single-producer actions need no `by`.

What awok **cannot** prove — that a script *actually* writes the field / prints the token —
is **not** a generation error; it is a **workflow-doctor warning** (B4, see §6).

## 5. Migration

Existing workflows hand-write the emission instruction in prose (onboard's O0-INVENTORY
description). Once auto-generation exists that would **duplicate**. Implementation therefore
includes:

- Remove the hand-written emission prose from existing workflows (onboard first), letting
  generation produce it from `emits:`.
- Regenerate all artifacts; `awok check` must be green (the regenerated SKILL.md now carries
  the auto-generated emission instruction instead of the hand-written one).

This touches few workflows and is done as part of the rollout, not left to authors.

## 6. Deferred / doctor (out of scope here, tracked in TODO)

- **B4 — workflow-doctor emitter-contract check.** Warn when a declared signal's emitter is
  unverifiable: `field` → the role really is a produced json and the field is plausibly
  written; `exit_code` → the action is a script; `token` → the emitting prose actually
  instructs the emission. Goal: catch "declared but never produced" before runtime.
- **B8 — signal directly from a file (incl. external files).** Let `external` /
  `workflow_call` results be read as signals via a file+field source. Adds complexity →
  later. Stopgap today: a tiny `script`/`main_agent` action reads the file and re-emits a
  normal signal — so this is a convenience, not a blocker.
- **js target (B1).** The new `exit_code` source is deterministic and representable in a
  future JS-compiled runtime (run script, read exit status); confirm it stays inside the
  js-safe frontier when B1 lands. No frontier change needed now.

## 7. Out of scope

- No change to the control-flow overlay render (owned by the `depends_on`-unification work).
- No change to how conditions are *evaluated* — only to how the signals they read are
  *declared and produced*.
- `workflow_call` / `external` emission (→ B8).
- Banning multi-agent blocks (→ D1); this design tolerates them via `by:`.

## 8. Open points (resolve at implementation)

1. Exact placement/wording of the generated emission instruction inside the script /
   main_agent action sections (must read naturally alongside existing prose).
2. Whether `field` with a bare `role` (no `.field`) means "the whole json output is the
   value" vs "a field named `<name>` in it" — pick one and state it in the invocation
   snippet wording (leaning: `role.field` explicit; bare `role` = a field named `<name>`).
3. Coordination: implement on a branch separate from the in-flight unification work to avoid
   collisions.
