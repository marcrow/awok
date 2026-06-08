---
name: create-workflow
description: |
  Design and scaffold a new awok workflow from a vague idea. An adversarial
  brainstorming engine (curated techniques + an independent challenge panel) breaks
  the tunnel effect, then the idea is decomposed, reviewed for build-vs-borrow and
  script-vs-agent, scaffolded, generated and quality-reviewed. Use it to create or
  substantially redesign an awok workflow.

---

# /create-workflow — a workflow that designs workflows

> ⚠️ This file is **GENERATED** from `src/workflows/create-workflow.yaml`.
> Do not edit by hand. To change it: edit the YAML then run `bb-workflow generate`.
>
> Implicit convention: each agent invocation `<name>` instructs Claude to read
> `~/.claude/agents/<name>.md` (its full instructions). No need to repeat this in
> every snippet.

Pipeline of 10 phases, organized into 5 groups:
`frame` (Capture the idea and pin the real job-to-be-done), `ideate` (Adversarial brainstorming that breaks the tunnel effect), `shape` (Decompose into a draft DAG and review the blocks), `build` (Scaffold the workflow source and generate its artifacts), `ship` (Quality-review and hand off the generated workflow).

---

## 🧭 Opportunistic autonomy

This workflow permits **scoped improvisation**. Beyond the planned work, you (the
orchestrator) may **author and launch an ad-hoc sub-agent** whenever you spot a
signal the planned agents do not cover.

- **How**: the `Task` tool, `subagent_type: general-purpose` (or `Explore`), with a
  prompt you write yourself from context. These agents do not exist in
  `src/agents/` — you create them on the fly.
- **When**: Early, if the whole idea smells already-built (strong prior art); or in the brainstorm, when a thread needs a provocation the planned panel doesn't cover.
- **Mode**: usually in the **background**, unless the result is needed to continue the current phase.
- **Nesting limit**: a sub-agent cannot itself spawn sub-agents (max depth = 1). After reading the planned sub-agent's report, it is up to you to launch the follow-up.
- **Scope**: all phases, except those marked ⛔.
- **Examples**: whole idea likely already exists → quick build-vs-borrow scout; no panelist fits a gap → author an ad-hoc panelist on the fly

---

## Pipeline phases (DAG)

### S1-FRAME — Frame the idea
> `frame` · main_agent
Capture the maintainer's raw idea and pin the real job-to-be-done with First Principles + How-Might-We. Ask the maintainer to choose the brainstorm depth (light ~15 min, or deep / multi-round) — and note it can switch any time. Write a short frame brief: the job, the chosen depth, known constraints.

> ⏸️ **Interactive checkpoint.** Present your output for this phase, then **STOP and wait** for the maintainer's input/decision before continuing. Do not advance to the next phase, and do not decide on their behalf.



## 🧠 Brainstorm protocol (run this across S2A → S2B → S2C)

This is the heart of the workflow. Your default failure mode as an LLM is
**sycophancy** — reflecting the author's idea back, prettier, then rushing to the
build. Invert it. Your mandate is to **question, contradict, and surprise**, so the
design that survives is better than the one the author walked in with. The author
always holds the vote; you are a forcing function, never the source of the answer.

> ⚠️ **The #1 way this workflow fails:** you do a token amount of pushing, then jump
> straight to naming the tool and listing agents — leaving the author brainstorming
> alone. If you only collected the author's own ideas, the brainstorm **failed its one
> job.** The floor below exists to make that impossible.

### ⏸️ Pacing — one thing, then STOP (read this twice)

This is an **interactive conversation, not a batch to complete.** After every prompt
or artifact you put in front of the maintainer:

- Present **ONE** thing — one question, one shape, one proposed agent, one panelist's
  provocation.
- Then **STOP and WAIT** for their reply. Do **not** continue, do **not** move to the
  next item or the next movement, do **not** decide on the maintainer's behalf.
- **Never stack** several questions in one message. **Never dump** multiple shapes +
  multiple agents + a pivot question at once — it overwhelms; the maintainer can't
  respond calmly and will miss things.
- If you write **"OK?"** you **must** stop and wait for the OK. Asking-then-proceeding
  is the exact anti-pattern to avoid.

The three movements (S2A / S2B / S2C) are deliberate **hard stops**. Never cross one
without the maintainer's explicit go.

### Facilitator stance

- You are a **forcing function for the author's creativity, never the source of
  ideas.** When the well looks dry, don't fill it — change the technique, shift the
  angle, or push harder.
- **No multiple-choice menus** of ideas — a menu invites lazy picking and pulls the
  author out of generating. Ask one open prompt at a time.
- **Diverge/converge firewall** — never judge during generation (premature judgment
  kills ideas); the challenge panel (S2B) fires **after** an initial generative pass,
  not during it; converge in a distinct movement (S2C), on the author's verdict.

### Generative duty (the half that's easy to skip)

Adversarial is only half the job — and it's the half that tends to show up while the
*generative* half goes missing. You must also **GENERATE**: actively propose
alternative structures, alternative agent sets, techniques pulled from the on-demand
library, and cross-domain analogies the author would not reach alone — **without being
asked.** "Hand them an option they didn't have" is a deliverable of every session.

### The mandatory floor — spread across the three movements, run PACED

You may **NOT** reach naming/decompose (the end of S2C) until all five are done — but
do them **one at a time, stopping after each** (see Pacing above):

- **S2A · Diverge & frame** —
  1. **Reframe** the real job (First Principles / HMW) in your own words, check it → *stop.*
  2. **≥2 structurally different shapes** (different decomposition/flow, not cosmetic),
     presented **one at a time** → *stop after each.*
  3. **≥2 agents/blocks the author didn't name**, each with a one-line why → *stop.*
- **S2B · Challenge** —
  4. Fire **≥1 generative** (`cross-pollinator`/`rolestormer`) **and ≥1 adversarial**
     (`premortem`/`devils-advocate`) panelist as independent background sub-agents;
     weave their returns back **one at a time** → *stop.*
  5. **Land ≥1 challenge** that actually *moved* the design (changed a choice or forced
     a defense), not a rhetorical one.
- **S2C · Converge & name** — converge on the survivor (the author votes), offer "go
  deeper?" (escalation), then run the naming ritual below.

If you catch yourself drifting toward the name or the agent list before the floor is
met, **STOP and go back.**

### Session depth (the author chooses in S1; switchable any time)

- **Light** (~15 min): the floor above, run **briskly** — one diverge/converge pass.
  *Light means fewer rounds, NOT less pushing.* The floor is the floor.
- **Deep** (multi-round): *First Principles* + *Starbursting* to pin the job and
  per-block I/O → *Morphological Analysis* for more shape variants → broader panel
  critique (all four + Six Hats) → converge, then re-diverge.
- **Escalation invariant** — *the convergence artifact of round N becomes the
  divergence seed of round N+1.* At any convergence point, offer "go deeper?": to
  escalate, re-enter divergence on the survivor. No state is lost.

### The challenge panel (S2B) — mandatory, not optional

You are *inside* the author's frame — you share the conversation. Genuinely surprising
provocations come from **independent sub-agents** that never lived the framing. Convene
them with the `Task` tool (in the **background** — they chew while you talk), feed them
the current diverging design, and weave their returns back **one at a time**. The floor
requires **at least one generative + one adversarial**; fire more as the design grows.

| Panelist | Kind | Convene when |
|---|---|---|
| `premortem` | adversarial | a design is converging — stress-test it before locking. |
| `devils-advocate` | adversarial | the author's idea is sailing through unchallenged. |
| `cross-pollinator` | generative | the design feels stuck in one structural mould. |
| `rolestormer` | generative | you need stakeholder pressure (SRE / security / newcomer / cost). |

If no panelist fits a gap, the phase's **opportunistic licence** lets you author an
ad-hoc panelist on the fly. (Nesting limit = 1: a panelist cannot itself spawn
sub-agents.)

### Curated core techniques (you drive these adaptively)

| Technique | The move it forces | Use it to |
|---|---|---|
| First Principles | strip assumptions, reason from the irreducible | pin the real job-to-be-done |
| HMW + SCAMPER | reframe, then mutate a nearby workflow | reframe the idea; mutate priors like `onboard` |
| Starbursting (5W1H) | interrogate, don't answer | expose each block's unknown I/O |
| Morphological Analysis | enumerate parameters, recombine | generate DAG variants systematically |
| Pre-mortem / Inversion | assume failure, work backward | surface design errors before converging |
| Six Thinking Hats | parallel-thinking lenses | review a draft (facts / risk / optimism) |

### On-demand library (pull by name when asked, or when the well is dry)

Reverse Brainstorming · Worst Possible Idea · Assumption Reversal · Analogical
Thinking · Biomimicry · Forced Relationships · Provocation (PO) · Five Whys · SCAMPER
(per-verb) · Round-robin enumeration · Disney Method (dreamer/realist/critic) ·
Mind-map decomposition · SWOT / assumption surfacing · "What would break this?" ·
Constraint removal ("infinite budget") · Constraint addition ("half the steps").

### Closing ritual — name the workflow (end of S2C, only once the floor is met)

With the mandatory floor done, close S2C by **naming the thing** (it's a
convergence/commitment moment — by now you know what it *is*). Propose a few candidate
slugs, check each against the skill-name pattern `^[a-z][a-z0-9-]*$` and for
**uniqueness** against existing `src/workflows/*.yaml`, and let the **author pick**.
Emit the chosen slug as `new-name` — it is the single source of truth for scaffold (S5)
and generate (S6).

---
*Facilitator stance adapted from BMAD-METHOD `bmad-brainstorming` (BMad Code LLC,
MIT). See THIRD_PARTY.md.*



### S2A-DIVERGE — Brainstorm — diverge & frame
> `ideate` · main_agent · ⇐ S1-FRAME
Movement 1 of the brainstorm (see the protocol above). Reframe the real job (First Principles / HMW) and check it; then generate ≥2 structurally different shapes and propose ≥2 agents/blocks the maintainer did not name. PACING IS MANDATORY: present ONE thing at a time — one prompt, one shape, one proposed agent — then STOP and WAIT for the maintainer before the next. Never stack questions, never dump everything at once, never advance on their behalf.

> ⏸️ **Interactive checkpoint.** Present your output for this phase, then **STOP and wait** for the maintainer's input/decision before continuing. Do not advance to the next phase, and do not decide on their behalf.




### S2B-CHALLENGE — Brainstorm — challenge
> `ideate` · main_agent · ⇐ S2A-DIVERGE
Movement 2 of the brainstorm. Convene the independent challenge panel on the diverging design — ≥1 generative (cross-pollinator/rolestormer) AND ≥1 adversarial (premortem/devils-advocate), as background Task sub-agents — and weave their provocations back ONE AT A TIME, stopping for the maintainer's reaction after each. Land at least one challenge that actually moves the design. Same pacing rule: one thing → STOP → wait; never advance on the maintainer's behalf.

> ⏸️ **Interactive checkpoint.** Present your output for this phase, then **STOP and wait** for the maintainer's input/decision before continuing. Do not advance to the next phase, and do not decide on their behalf.

> 🧭 **Opportunistic lead here.** A brainstorm thread needs a provocation the planned panel doesn't cover. — e.g. no panelist fits → author an ad-hoc panelist on the fly




### S2C-CONVERGE — Brainstorm — converge & name
> `ideate` · main_agent · ⇐ S2B-CHALLENGE
Movement 3 of the brainstorm. Converge on the surviving design — the maintainer votes; offer "go deeper?" (escalation re-seeds divergence on the survivor, no state lost). Only once the mandatory floor is met, run the closing naming ritual (propose slugs, check the skill-name pattern + uniqueness against src/workflows/*.yaml, the maintainer picks) → new-name. The pacing rule still holds: one thing → STOP → wait.

> ⏸️ **Interactive checkpoint.** Present your output for this phase, then **STOP and wait** for the maintainer's input/decision before continuing. Do not advance to the next phase, and do not decide on their behalf.




### S3-DECOMPOSE — Decompose into blocks
> `shape` · main_agent · ⇐ S2C-CONVERGE
Translate the converged design intent into a draft awok DAG: stages, groups, action blocks, and per-block I/O roles. Before settling on one, render 2-3 alternative DAG shapes as a small self-contained HTML at work/create-workflow/dag-alternatives.html — match the visual style of awok's generated cartography (reuse the palette/CSS from src/workflow/templates/html-wrapper.html), one mermaid diagram per alternative, and give each node a hover tooltip that explains what that action actually does (not just its id). Add a one-line note per alternative on what differs (what's parallelized, where the reduce sits, which blocks split/merge) — open it and let the maintainer pick the shape (a table hides parallelism; a diagram shows it). Keep the result a draft — the block review (S4) and the maintainer will revise it. Inherit the workflow name chosen in S2C.




### S4-BLOCK-REVIEW — Review the blocks
> `shape` · agent · ⇐ S3-DECOMPOSE

> ⏸️ **Interactive checkpoint.** Present your output for this phase, then **STOP and wait** for the maintainer's input/decision before continuing. Do not advance to the next phase, and do not decide on their behalf.

#### Invocation `workflow-scout`


**workflow-scout** [sonnet] · Searches reputable skills/agents/registries for prior art on each draft block.
- Reads : `work:draft-dag` (md) → work/create-workflow/draft-dag.md, `agents` (dir) → src/agents/
- Writes : `work:reuse-report` (md) → work/create-workflow/reuse-report.md

**Task**: For each block in the draft DAG, find whether a reputable, adaptable
resource (skill/agent/library) already does the work. Report candidates with URL,
license, reputation and a borrow/build-fresh recommendation. Advisory only — the
maintainer decides per block.

#### Invocation `nature-critic`


**nature-critic** [sonnet] · Recommends each block's optimal awok nature (script / agent / main_agent / workflow_call).
- Reads : `work:draft-dag` (md) → work/create-workflow/draft-dag.md, `work:reuse-report` (md) → work/create-workflow/reuse-report.md
- Writes : `work:nature-report` (md) → work/create-workflow/nature-report.md

**Task**: For each block in the draft DAG (skipping ones the reuse-report flags as
borrowable), recommend its optimal awok action nature, hunting especially for
LLM-where-a-script-suffices and script-where-judgment-is-needed. Advisory only.



### S5-SCAFFOLD — Scaffold the workflow
> `build` · main_agent · ⇐ S4-BLOCK-REVIEW
With the maintainer's per-block decisions (reuse vs build, and each block's nature), write the new workflow source: src/workflows/<name>.yaml, the needed src/agents/<agent>.md files, and their invocation snippets — reusing awok templates and conventions. Encode borrowed resources with attribution. This is the maintainer's design made concrete; confirm choices as you go.




### S6-GENERATE — Validate and generate
> `build` · script · ⇐ S5-SCAFFOLD
Validate then generate the new workflow. The name is read from the new-name artifact written in S2.

```bash
NAME="$(tr -d '[:space:]' < work/create-workflow/new-name.txt)"
echo "Validating + generating workflow: $NAME"
awok validate "$NAME"
awok generate --workflow "$NAME"

```



### S7-REVIEW — Quality review
> `ship` · agent · ⇐ S6-GENERATE

#### Invocation `skill-reviewer`


**skill-reviewer** [opus] · Scores the generated SKILL.md and the new agent files against Anthropic's rubric.
- Reads : `skills` (dir) → src/skills/, `agents` (dir) → src/agents/
- Writes : `work:review-report` (md) → work/create-workflow/review-report.md

**Task**: Review the generated SKILL.md and every referenced agent file against the
Anthropic skill-authoring rubric (description quality, conciseness-for-an-orchestrator,
structure; agent frontmatter + body). Emit per-artifact scores, severity-tagged issues
with concrete fixes, and an overall PASS / NEEDS-FIX / REWORK verdict.



### S8-HANDOFF — Hand off
> `ship` · main_agent · ⇐ S7-REVIEW
If the review verdict is NEEDS-FIX or REWORK, loop back to S5 with the fix list. On PASS, hand off: offer to run ./install.sh and smoke-test the new /skill, and optionally chain the writing-plans skill to plan the new workflow's own content.





---

## On-demand agents (outside the pipeline)

These agents are available but are **not** invoked automatically in the pipeline.

### `premortem` [sonnet]
> Independent pre-mortem panelist. Assumes the workflow shipped and produced
> garbage, then traces specific causes (named trigger, threshold, consequence).

**When to invoke it**: During S2, to stress-test a converging design and surface design errors.


### `devils-advocate` [sonnet]
> Independent devil's-advocate panelist. Steelmans the idea, then attacks the
> strongest version; trusts only the artifact, never the author's framing.

**When to invoke it**: During S2, when the author's idea is going unchallenged (the tunnel effect).


### `cross-pollinator` [sonnet]
> Independent analogy panelist. Injects an out-of-frame, cross-domain pattern to
> surface workflow shapes the author would not reach alone.

**When to invoke it**: During S2, when the design feels stuck in one structural mould.


### `rolestormer` [sonnet]
> Independent persona panelist. Rotates hostile/skeptical stakeholders (SRE,
> security reviewer, newcomer, cost owner) to stress-test the design from outside.

**When to invoke it**: During S2, to pressure-test the design against stakeholder perspectives.


### `tessl-review` [inherit]
> Optional, experimental external second opinion. Runs `tessl skill review`
> isolated (telemetry off, read-only, never --optimize) on the generated SKILL.md.

**When to invoke it**: Optionally after S7, if the maintainer wants an external score. Experimental.


---

## Pipeline brainstormings

- **`design`** (brainstorm-light, 15 min) — after `S1-FRAME`, before `S3-DECOMPOSE`.

See the shared protocol above.

