---
name: edit-workflow
description: |
  Safely modify an EXISTING awok workflow — from a raw change idea (a new feature,
  or a fix for a defect met in use) to a validated, regenerated, non-regressing
  implementation. awok's mechanics and the target workflow are loaded up front; a
  cheap, parallel value gate challenges whether the change is even worth doing
  (early-exit) before an impact pass predicts its blast-radius; then implement, regenerate,
  sync the human docs, and hand off to /workflow-doctor. Domain-agnostic — the target
  workflow may be about anything. Use it to change an awok workflow instead of an
  ad-hoc /brainstorm → /write-plan → /execute-plan pass that is blind to awok's seams.

---

# /edit-workflow — safely evolve an existing awok workflow

> ⚠️ This file is **GENERATED** from `src/workflows/edit-workflow.yaml`.
> Do not edit by hand. To change it: edit the YAML then run `bb-workflow generate`.
>
> Implicit convention: each agent invocation `<name>` instructs Claude to read
> `~/.claude/agents/<name>.md` (its full instructions). No need to repeat this in
> every snippet.
>
> **Model is not inherited.** Each invocation shows its model as `[model]` and a ⚙️
> reminder line. When you launch that agent via the `Task` tool you **must pass the
> model explicitly** (`model: <model>`) — otherwise the sub-agent silently runs on
> the session model, often a costlier one.

Pipeline of 8 actions, organized into 4 groups:
`frame` (Load awok's mechanics and the target workflow, capture the change), `decide` (Gate the change on value first, then predict its impact), `build` (Implement the change and regenerate the artifacts), `ship` (Sync the human docs and hand off to the doctor).

---

## 🧭 Opportunistic autonomy

This workflow permits **scoped improvisation**. Beyond the planned work, you (the
orchestrator) may **author and launch an ad-hoc sub-agent** whenever you spot a
signal the planned agents do not cover.

- **How**: the `Task` tool, `subagent_type: general-purpose` (or `Explore`), with a
  prompt you write yourself from context. These agents do not exist in
  `src/agents/` — you create them on the fly.
- **When**: In the value gate, when a change's worth is empirically questionable and no planned probe settles it; or in the impact pass, when a risk category surfaces that the planned risk analysis does not cover.
- **Mode**: usually in the **background**, unless the result is needed to continue the current action.
- **Nesting limit**: a sub-agent cannot itself spawn sub-agents (max depth = 1). After reading the planned sub-agent's report, it is up to you to launch the follow-up.
- **Scope**: all actions, except those marked ⛔.
- **Examples**: change's value is unclear → author an ad-hoc research/probe agent to settle it cheaply; an unforeseen risk class appears → spin up a targeted check before deciding

---

## Pipeline actions (DAG)

### S1-FRAME — Load the target + capture the change
> `frame` · main_agent
Load awok's mechanics LIVE so nothing drifts: read src/workflow/workflow.schema.json (the authoritative shape of a workflow — phase types, io_ref, invocation fields) and the relevant parts of CLAUDE.md + docs/dev/bb-workflow.md, rather than trusting any pre-baked prose. Then read the TARGET workflow directly — its src/workflows/<target>.yaml, its generated SKILL.md, and the agent files it references — so you (the orchestrator) carry its full context into the gates yourself (a sub-agent summary would be lossy). Capture the maintainer's RAW change request (the problem or idea, in their words) — deliberately NOT yet a locked spec with acceptance criteria, so the value gate has a live idea to challenge. Write the target workflow's name to target-name for the generate step.

> ⏸️ **Interactive checkpoint.** Present your output for this action, then **STOP and wait** for the maintainer's input/decision before continuing. Do not advance to the next action, and do not decide on their behalf.




### S2-VALUE — Gate 1 — pertinence & value
> `decide` · main_agent · ⇐ S1-FRAME
The CHEAP gate, run FIRST so a bad idea is killed before any impact tokens are spent. Launch, in parallel and in the background (one message, several Task calls): the independent challenge panel — devils-advocate + premortem (they never lived the framing, so they genuinely challenge "should we even do this") — AND worth-verifier, which proposes a LOW-COST empirical way to settle whether the change is worth it (a financial backtest is only one special case; it must generalize to any domain). Force the maintainer to weigh alternatives — do-nothing / smaller-scope / different-approach — then converge with them on a verdict: ABANDON, REFORMULATE (loop back here), or PROCEED. Only on PROCEED, firm the raw request into a written change-intent (what / why / acceptance criteria). Present ONE thing at a time and STOP for the maintainer; never advance on their behalf.

> ⏸️ **Interactive checkpoint.** Present your output for this action, then **STOP and wait** for the maintainer's input/decision before continuing. Do not advance to the next action, and do not decide on their behalf.




### S3-IMPACT — Gate 2 — predict the blast-radius
> `decide` · main_agent · ⇐ S2-VALUE
Runs only after S2 returns PROCEED. Launch risk-cartographer to PREDICT the change's blast-radius from the change-intent + the target workflow: which I/O roles and producer→consumer seams it touches, and the risk CATEGORIES it opens (cost/tokens, cadence mismatch, regression on a downstream seam, redundancy with an existing phase, idempotency breakage, model/effort mismatch, and any class the maintainer did not enumerate). This is prediction, not measurement — the deterministic structural checks fire later where they can actually see the change: awok validate's dataflow warning in S5 (an output nobody consumes) and /workflow-doctor's seam audit in S7. Aggregate the prediction with the maintainer and decide: proceed to implement, revise the intent, or STOP if the impact is prohibitive. Present findings, then STOP for the maintainer.

> ⏸️ **Interactive checkpoint.** Present your output for this action, then **STOP and wait** for the maintainer's input/decision before continuing. Do not advance to the next action, and do not decide on their behalf.




### S4-IMPLEMENT — Implement the change
> `build` · main_agent · ⇐ S3-IMPACT
Make the maintainer's design concrete. Edit the target src/workflows/<target>.yaml, any new or changed src/agents/<agent>.md files, and their invocation snippets in src/workflow/templates/invocations/ — following the conventions you loaded in S1 and honouring the change-intent + impact-report. You may reuse the scaffold that `awok assist "<change>" --workflow <target>` prints as a starting point (but verify it against the live schema — its structure summary can lag). If the change touches a SHARED agent or an engine/template, flag the ripple (every workflow re-renders) before editing. Confirm choices as you go.




### S5-GENERATE — Validate + generate
> `build` · script · ⇐ S4-IMPLEMENT
Validate then regenerate the modified workflow. `awok validate` also emits the dataflow warnings — the free, post-implementation structural check (an output no phase consumes = the orphan-artifact anti-pattern). The target name is read from the target-name artifact written in S1.

```bash
NAME="$(tr -d '[:space:]' < work/edit-workflow/target-name.txt)"
echo "Validating + generating modified workflow: $NAME"
awok validate "$NAME"
awok generate --workflow "$NAME"

```



### S6-DOCSYNC — Sync the human docs
> `ship` · agent · ⇐ S5-GENERATE

#### Invocation `docsync-writer`


**docsync-writer** [sonnet] · Syncs the human-maintained docs the change actually touched, proportionally.
- Reads : `work:change-intent` (md) → work/edit-workflow/change-intent.md, `work:impact-report` (md) → work/edit-workflow/impact-report.md
- Writes : `work:docsync-report` (md) → work/edit-workflow/docsync-report.md

**Task**: After the modified workflow is regenerated, find the HUMAN docs that drifted
(CLAUDE.md's workflow table, docs/dev/bb-workflow.md, relevant specs/plans, a changelog) and
update exactly what the change made stale — exhaustive but never over-documented. Edit
surgically (`Edit`, never a wholesale rewrite of a long doc). Report every doc touched and
every doc deliberately left alone with its proportionality reason. Advisory; the maintainer commits.

> ⚙️ **Run on `sonnet`** — launch via the `Task` tool with `model: sonnet` (not inherited from the session model).



### S7-VERIFY — Verify with the doctor
> `ship` · workflow_call · ⇐ S6-DOCSYNC
Dispatch /workflow-doctor on the modified target workflow. This is the real, post-generation seam / agent-fitness / prose↔declared-drift audit — it runs here (not in S3) because only now does the regenerated SKILL.md reflect the change. Tell the doctor which workflow to audit (the target name).

> 🔗 **This phase dispatches another workflow**: `/workflow-doctor`.
>
> Launch it via the **Skill tool** (`skill: workflow-doctor`). The target
> workflow runs in the same target/cwd; read its outputs from its usual tree.
> Return to `/edit-workflow` once `/workflow-doctor` is complete.



### S8-HANDOFF — Hand off
> `ship` · main_agent · ⇐ S7-VERIFY
Read the doctor's verdict. If it surfaces a defect introduced by the change, loop back to S4 with the fix list. Otherwise hand off: summarize what changed (YAML, agents, docs), offer to run ./install.sh and smoke-test the modified /skill, and note whether any ripple (shared agent / engine change) still needs the maintainer's attention.





---

## On-demand agents (outside the pipeline)

These agents are available but are **not** invoked automatically in the pipeline.

### `worth-verifier` [sonnet]
> Value prober for a proposed workflow change. Given the raw change request, proposes the
> cheapest empirical way to settle whether the change is worth doing — light research plus
> a concrete low-cost test/probe — domain-agnostic (a financial backtest is only one case).

**When to invoke it**: In the value gate (S2), to settle empirically whether a change earns its cost.

**Triggered by**: S2-VALUE


### `risk-cartographer` [sonnet]
> Blast-radius predictor for a proposed workflow change. From the change-intent + the target
> workflow, maps the I/O roles and producer→consumer seams it touches and surfaces the risk
> CATEGORIES it opens — generatively, not against a fixed checklist.

**When to invoke it**: In the impact gate (S3), to predict what the change touches and what could go wrong.

**Triggered by**: S3-IMPACT


### `devils-advocate` [sonnet]
> Independent devil's-advocate panelist. Steelmans the change, then attacks the strongest
> version; trusts only the artifact, never the author's framing.

**When to invoke it**: In the value gate (S2), when the change idea is going unchallenged (the tunnel effect).

**Triggered by**: S2-VALUE


### `premortem` [sonnet]
> Independent pre-mortem panelist. Assumes the change shipped and broke the workflow, then
> traces specific causes (named trigger, threshold, consequence).

**When to invoke it**: In the value gate (S2), to stress-test the change before committing to it.

**Triggered by**: S2-VALUE



