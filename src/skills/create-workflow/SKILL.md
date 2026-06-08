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

Pipeline of 8 phases, organized into 5 groups:
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
- **Examples**: whole idea likely already exists → éclair build-vs-borrow scout; no panelist fits a gap → author an ad-hoc panelist on the fly

---

## Pipeline phases (DAG)

### S1-FRAME — Frame the idea
> `frame` · main_agent
Capture the maintainer's raw idea and pin the real job-to-be-done with First Principles + How-Might-We. Ask the maintainer to choose the brainstorm depth (light ~15 min, or deep / multi-round) — and note it can switch any time. Write a short frame brief: the job, the chosen depth, known constraints.




### S2-BRAINSTORM — Adversarial brainstorm
> `ideate` · main_agent · ⇐ S1-FRAME
Run the brainstorm protocol below (injected after this phase): an adversarial, generative engine that questions, contradicts and surprises the maintainer rather than eliciting and rubber-stamping. You MUST hit the protocol's mandatory floor — reframe, ≥2 structurally different shapes, ≥2 agents the maintainer did not name, ≥1 generative AND ≥1 adversarial panelist fired, ≥1 challenge that moved the design — BEFORE naming or decomposing, even in light mode. Drive the curated techniques, convene the panel (premortem, devils-advocate, cross-pollinator, rolestormer) via the Task tool, run the double-diamond light/deep loop. The maintainer always holds the vote. Close by naming → new-name.

> 🧭 **Opportunistic lead here.** A brainstorm thread needs a provocation the planned panel doesn't cover. — e.g. no panelist fits → author an ad-hoc panelist on the fly



## 🧠 Brainstorm protocol (run this during S2)

This is the heart of the workflow. Your default failure mode as an LLM is
**sycophancy** — reflecting the author's idea back, prettier, then rushing to the
build. Invert it. Your mandate is to **question, contradict, and surprise**, so the
design that survives is better than the one the author walked in with. The author
always holds the vote; you are a forcing function, never the source of the answer.

> ⚠️ **The #1 way this workflow fails:** you do a token amount of pushing, then jump
> straight to naming the tool and listing agents — leaving the author brainstorming
> alone. If you only collected the author's own ideas, the brainstorm **failed its one
> job.** The floor below exists to make that impossible.

### ⛔ Mandatory floor — every session, even *light*

You may **NOT** move to the naming ritual or to S3-decompose until you have done **all
five**:

1. **Reframe** — restate the *real* job (First Principles / HMW) in your own words and
   check it with the author. Don't accept the framing as given.
2. **≥2 genuinely different shapes** — generate and show at least two *structurally*
   different ways to build it (different decomposition/flow, not cosmetic variants),
   not one-and-done.
3. **Propose agents they didn't name** — surface **≥2 candidate agents/blocks the
   author hadn't thought of**, each with a one-line why. This is the *generative* duty:
   bring options from outside their frame.
4. **Fire the panel** — convene **≥1 generative panelist** (`cross-pollinator` or
   `rolestormer`) **and ≥1 adversarial panelist** (`premortem` or `devils-advocate`) as
   independent sub-agents, and weave their returns back into the dialogue.
5. **Land ≥1 real challenge** — surface at least one objection that actually *moved*
   the design (changed a choice or forced a defense), not a rhetorical one.

If you catch yourself drifting toward the name or the agent list before these five are
done, **STOP and go back.**

### Facilitator stance

- You are a **forcing function for the author's creativity, never the source of
  ideas.** When the well looks dry, don't fill it — change the technique, shift the
  angle, or push harder.
- **No multiple-choice menus** of ideas — a menu invites lazy picking and pulls the
  author out of generating. Ask one open prompt at a time.
- **Diverge/converge firewall** — never judge during generation (premature judgment
  kills ideas); converge in a distinct pass, on the author's verdict — never rank for
  them.

### Generative duty (the half that's easy to skip)

Adversarial is only half the job — and it's the half that tends to show up while the
*generative* half goes missing. You must also **GENERATE**: actively propose
alternative structures, alternative agent sets, techniques pulled from the on-demand
library, and cross-domain analogies the author would not reach alone — **without being
asked.** "Hand them an option they didn't have" is a deliverable of every session, not
a bonus.

### Session depth (the author chooses in S1; switchable any time)

- **Light** (~15 min): the **mandatory floor above, run briskly** — one
  diverge/converge pass. *Light means fewer rounds, NOT less pushing.* The floor is the
  floor.
- **Deep** (multi-round): *First Principles* + *Starbursting* to pin the real job and
  per-block I/O → *Morphological Analysis* for more shape variants → broader panel
  critique (all four panelists + Six Hats) → converge, then re-diverge.
- **Escalation invariant** — *the convergence artifact of round N becomes the
  divergence seed of round N+1.* At any convergence point, offer "go deeper?": to
  escalate, re-enter divergence **on the survivor** (Starburst each node, spawn
  variants). No state is lost — the author can start light and deepen the moment the
  idea proves more ambitious than it looked.

### The challenge panel — mandatory, not optional

You are *inside* the author's frame — you share the conversation. Genuinely surprising
provocations come from **independent sub-agents** that never lived the framing. Convene
them with the `Task` tool (usually in the **background**), feed them the current
`design-intent`, and weave their returns back. The floor requires **at least one
generative + one adversarial**; fire more as the design grows.

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

### Closing ritual — name the workflow (only once the floor is met)

With the mandatory floor done, close S2 by **naming the thing** (it's a
convergence/commitment moment — by now you know what it *is*). Propose a few candidate
slugs, check each against the skill-name pattern `^[a-z][a-z0-9-]*$` and for
**uniqueness** against existing `src/workflows/*.yaml`, and let the **author pick**.
Emit the chosen slug as `new-name` — it is the single source of truth for scaffold (S5)
and generate (S6).

---
*Facilitator stance adapted from BMAD-METHOD `bmad-brainstorming` (BMad Code LLC,
MIT). See THIRD_PARTY.md.*



### S3-DECOMPOSE — Decompose into blocks
> `shape` · main_agent · ⇐ S2-BRAINSTORM
Translate the converged design intent into a draft awok DAG: stages, groups, action blocks, and per-block I/O roles. Before settling on one, render 2-3 alternative DAG shapes as a small self-contained HTML (mermaid diagrams) at work/create-workflow/dag-alternatives.html, each with a one-line note on what differs (what's parallelized, where the reduce sits, which blocks split/merge) — open it and let the maintainer pick the shape (a table hides parallelism; a diagram shows it). Keep the result a draft — the block review (S4) and the maintainer will revise it. Inherit the workflow name chosen in S2.




### S4-BLOCK-REVIEW — Review the blocks
> `shape` · agent · ⇐ S3-DECOMPOSE

#### Invocation `workflow-scout`


**workflow-scout** [sonnet] · Searches reputable skills/agents/registries for prior art on each draft block.
- Reads : `work:draft-dag` (md) → work/create-workflow/draft-dag.md
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
- Reads : `skills` (dir) → src/skills/
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

