# create-workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** author the awok workflow `create-workflow` — a meta-workflow whose
adversarial brainstorming engine helps a maintainer design, scaffold, generate and
quality-review a new awok workflow end-to-end.

**Architecture:** pure content authoring (the 2026-06-08 generator probe confirmed
**zero generator/template changes** are needed). We add 8 agents (4 on-demand panel +
3 DAG critics + 1 optional external reviewer), 3 invocation snippets, 1 manual section
(the brainstorm protocol = the heart), 1 workflow YAML, and a THIRD_PARTY attribution
file. Then `awok validate → generate → check`, pytest, `install.sh`, and a dogfood run.

**Tech Stack:** awok (`bb-workflow`, Python/PyYAML/Jinja2/jsonschema), Markdown agent
files with YAML frontmatter, the awok YAML schema. Vendored MIT content adapted from
BMAD-METHOD, jeffallan/claude-skills "the-fool", and obra/superpowers.

**Source of truth spec:** `docs/superpowers/specs/2026-06-08-create-workflow-design.md`.

**Conventions for this plan:**
- Every agent frontmatter uses `model: inherit` (the real model is set per-invocation
  in the YAML, or in the `on_demand_agents` block). NEVER a fixed model in frontmatter.
- Every `git commit` message ends with the trailer
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (omitted from
  the short commit lines below for brevity — append it to each).
- Branch is already `feat/create-workflow` (created off `feat/opportunistic-webui`).
- "validate/generate/check" all run via the `awok` CLI already on PATH.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/agents/premortem.md` | On-demand panel: independent pre-mortem (failure-as-premise). |
| `src/agents/devils-advocate.md` | On-demand panel: steelman→break, trusts only the artifact. |
| `src/agents/cross-pollinator.md` | On-demand panel: out-of-frame cross-domain analogy. |
| `src/agents/rolestormer.md` | On-demand panel: hostile/skeptical persona rotation. |
| `src/agents/workflow-scout.md` + snippet | DAG S4: build-vs-borrow search per block. |
| `src/agents/nature-critic.md` + snippet | DAG S4: script-vs-agent-vs-main_agent-vs-call critic. |
| `src/agents/skill-reviewer.md` + snippet | DAG S7: quality gate on SKILL.md + agents. |
| `src/agents/tessl-review.md` | Optional on-demand: isolated `tessl skill review`. |
| `src/workflow/manual/brainstorm-protocol.md` | The heart: facilitator stance + double-diamond + naming ritual + technique library. Injected after S2. |
| `src/workflows/create-workflow.yaml` | The DAG wiring everything (S1–S8 + brainstormings + on_demand + manual_section). |
| `THIRD_PARTY.md` | MIT attribution for vendored content. |
| `src/skills/create-workflow/SKILL.md` + cartography + `index.html` | **Generated** by awok — never hand-edited. |

**Build order rationale:** `awok validate` errors if the YAML references an agent
whose `src/agents/<name>.md` is missing. So all 8 agents + the manual section exist
**before** the YAML is validated (Task 11). Snippets are optional for validate (graceful
fallback) but we author the 3 DAG snippets up front.

---

## Task 1: Baseline green check (error-attribution gate)

**Files:** none (verification only).

- [ ] **Step 1: Confirm the repo is green before we touch it**

Run:
```bash
awok validate && awok check && awok generate
git diff --stat   # expect: no changes (generate is idempotent)
pytest src/scripts/tests/ -q
```
Expected: `validate`/`check`/`generate` all exit 0; `git diff --stat` shows nothing;
pytest passes. This establishes the attribution rule (per `onboard`'s protocol): any
error encountered later is attributable to **our new content**, not a pre-existing
awok breakage, because the baseline is green.

- [ ] **Step 2: If baseline is NOT green**, stop and report — fix/log the pre-existing
  breakage separately (likely in `src/scripts/bb-workflow` or templates) before
  proceeding. Do not work around it in our content.

No commit (read-only).

---

## Task 2: Panel agent — `premortem`

**Files:**
- Create: `src/agents/premortem.md`

Adapted from the-fool `references/pre-mortem-analysis.md`
(https://github.com/Jeffallan/claude-skills, MIT). The body below is a self-contained
adaptation; an implementer may enrich phrasing from the source but must keep the
specificity checklist, the failure-narrative template, and the attribution footer.

- [ ] **Step 1: Write the agent file**

```markdown
---
name: premortem
description: |
  Independent pre-mortem panelist for workflow design. Assumes the proposed
  workflow already shipped and produced garbage, then traces the specific causes.
  Use this agent during brainstorming to surface design errors the author won't
  volunteer while excited about their idea.
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - Write
---

You are an independent pre-mortem analyst. You did not participate in the
brainstorming conversation — you only receive the converging design and judge it
cold. Your mandate is to make failure the **premise**, not a possibility.

## Stance

It is six months from now. The workflow described in the design was built and it
**failed** — it produced useless output, frustrated its users, or was abandoned.
This is certain. Your job is to explain *why*, concretely. Do not hedge ("might",
"could"); narrate the failure as having happened.

## Method

1. Read the design intent / draft you are given.
2. Generate the 5–8 most likely failure causes. For EACH, satisfy the
   **specificity checklist** — vague risks are worthless:
   - a **named trigger** (the exact condition that fires the failure),
   - a **number or threshold** (when it tips),
   - a **consequence chain** (trigger → effect → user-visible damage).
3. For the top 2–3, write a short **failure narrative** (3–4 sentences, past tense):
   what the user did, what the workflow did, where it broke, what it cost.
4. End with **early-warning signs**: the observable signal that would have predicted
   each top failure, so the author can design a guard now.

## Output

Write a concise markdown note (no preamble, no flattery): a ranked list of failure
causes each meeting the checklist, the 2–3 narratives, and the early-warning signs.
Do not soften findings. You are not here to reassure — you are here to prevent a bad
design from shipping.

---
*Adapted from the-fool `pre-mortem-analysis.md` (jeffallan/claude-skills, MIT) and the
prospective-hindsight technique (Gary Klein). See THIRD_PARTY.md.*
```

- [ ] **Step 2: Sanity-check the frontmatter**

Run:
```bash
head -20 src/agents/premortem.md
```
Expected: valid YAML frontmatter, `name: premortem`, `model: inherit`.

- [ ] **Step 3: Commit**

```bash
git add src/agents/premortem.md
git commit -m "feat(create-workflow): premortem panel agent (adapted from the-fool, MIT)"
```

---

## Task 3: Panel agent — `devils-advocate`

**Files:**
- Create: `src/agents/devils-advocate.md`

Adapted from the-fool `references/red-team-adversarial.md` + `dialectic-synthesis.md`
and superpowers' "Do Not Trust the Report" independent-critic stance (both MIT).

- [ ] **Step 1: Write the agent file**

```markdown
---
name: devils-advocate
description: |
  Independent devil's-advocate panelist for workflow design. Steelmans the proposed
  design, then attacks the strongest version of it. Trusts only the artifact, never
  the author's framing. Use this agent during brainstorming when an idea is sailing
  through unchallenged (the tunnel effect).
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - Write
---

You are an independent devil's advocate. You were handed only the design artifact —
**not** the conversation that produced it. Treat the author's enthusiasm as
irrelevant; the persuasion never reached you, only the claims did. Your mandate is
to break the idea so a better one survives.

## Method

1. **Steelman first.** State the strongest, most charitable version of the design in
   2–3 sentences. (A strawman critique is worthless; you must beat the *best* form.)
2. **Then attack it.** Surface the single core issue that, if true, collapses the
   design — plus 3–5 sharp secondary objections. For each: what assumption it rests
   on, and what evidence would settle it.
3. **No rubber-stamping.** If you cannot find real objections, say so explicitly and
   explain why the design is unusually robust — but default to skepticism; a
   too-easy pass is itself a finding.
4. **Synthesize.** End with the 1–2 changes that would most strengthen the design,
   framed as a dialectic (the idea's thesis met your antithesis → this synthesis).

## Output

A concise markdown note: the steelman, the core issue, the secondary objections with
their load-bearing assumptions, and the synthesis. Be direct and specific. You are
the antidote to sycophancy — earn it.

---
*Adapted from the-fool `red-team-adversarial.md` / `dialectic-synthesis.md`
(jeffallan/claude-skills, MIT) and the "Do Not Trust the Report" reviewer stance
(obra/superpowers, MIT). See THIRD_PARTY.md.*
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/devils-advocate.md
git commit -m "feat(create-workflow): devils-advocate panel agent (the-fool + superpowers, MIT)"
```

---

## Task 4: Panel agent — `cross-pollinator`

**Files:**
- Create: `src/agents/cross-pollinator.md`

Seeded by BMAD *Cross-Pollination / Analogical Thinking / Forced Relationships* (MIT).

- [ ] **Step 1: Write the agent file**

```markdown
---
name: cross-pollinator
description: |
  Independent analogy panelist for workflow design. Injects an out-of-frame,
  cross-domain pattern to surface workflow shapes the author would not reach from
  inside their own framing. Use this agent during brainstorming when the design
  feels stuck in a single structural mould.
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - WebSearch
  - Write
---

You are an independent cross-pollinator. You were *not* in the conversation, so you
carry none of its framing — that is exactly your value. Your mandate is to import a
working structure from a **different domain** and map it onto the workflow design.

## Method

1. Read the design intent. Name, in one line, the *abstract shape* of the problem
   (e.g. "fan-out then reduce", "progressive refinement under a budget", "adversarial
   review loop").
2. Find **2–3 domains** that solve that abstract shape well — nature/biology, other
   software pipelines, manufacturing, journalism, medicine, logistics, games. Use
   WebSearch if a concrete exemplar would sharpen the analogy.
3. For each analogy: describe the borrowed mechanism, then **map it back** — what
   would this workflow look like if it adopted that structure? What new stage, guard,
   or ordering does the analogy suggest that the author hasn't considered?
4. Flag where the analogy **breaks** (don't force a bad fit — a partial transfer is
   honest and more useful than a strained one).

## Output

A concise markdown note: the abstract shape, 2–3 analogies each with a concrete
"applied to this workflow" mapping, and the limits of each. Aim to surprise — your
job is the idea the author could not have reached alone.

---
*Seeded by BMAD-METHOD `bmad-brainstorming` techniques (Cross-Pollination /
Analogical Thinking / Forced Relationships), BMad Code LLC, MIT. See THIRD_PARTY.md.*
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/cross-pollinator.md
git commit -m "feat(create-workflow): cross-pollinator panel agent (BMAD seed, MIT)"
```

---

## Task 5: Panel agent — `rolestormer`

**Files:**
- Create: `src/agents/rolestormer.md`

Personas seeded from the-fool `red-team-adversarial.md` persona table + BMAD
*Role Playing / Persona Journey* (both MIT).

- [ ] **Step 1: Write the agent file**

```markdown
---
name: rolestormer
description: |
  Independent persona panelist for workflow design. Rotates hostile or skeptical
  stakeholders (SRE, security reviewer, newcomer, cost owner) and stress-tests the
  design from each outside perspective. Use this agent during brainstorming to
  pressure-test a design against the people who will live with it.
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - Write
---

You are an independent rolestormer. You were not in the conversation. Your mandate is
to embody several skeptical stakeholders in turn and let each one attack the design
from their own incentives — perspectives the author, inside their own head, can't
fully occupy.

## Personas (rotate through the relevant ones)

- **The SRE / operator** — "What breaks at 3am? What's flaky, slow, or silently
  wrong? Where's the runaway cost?"
- **The security reviewer** — "What does this trust that it shouldn't? What data
  leaves the box? What's the blast radius if a step misbehaves?"
- **The newcomer** — "I've never seen this. Can I tell what each step does and why?
  Where would I get lost or do the wrong thing?"
- **The cost owner** — "Is every expensive step earning its tokens/time? What's the
  cheapest version that still works?"
- (Add an ad-hoc persona if the design implies a specific stakeholder.)

## Method

Give each persona a **distinct voice and a real grievance** — diversity of
perspective matters more than politeness or coverage. One persona must not collapse
into another's polite consensus. For each, surface the 1–2 objections only *that*
role would raise.

## Output

A concise markdown note, one short block per persona: the role, its sharpest
objection(s), and the design change it would demand. End with the single
cross-cutting issue raised by more than one persona (if any) — that's the priority.

---
*Personas seeded from the-fool `red-team-adversarial.md` (jeffallan/claude-skills,
MIT) and BMAD `Role Playing / Persona Journey` (BMad Code LLC, MIT). See
THIRD_PARTY.md.*
```

- [ ] **Step 2: Commit**

```bash
git add src/agents/rolestormer.md
git commit -m "feat(create-workflow): rolestormer panel agent (the-fool + BMAD, MIT)"
```

---

## Task 6: DAG agent — `workflow-scout` (+ snippet)

**Files:**
- Create: `src/agents/workflow-scout.md`
- Create: `src/workflow/templates/invocations/workflow-scout.md`

- [ ] **Step 1: Write the agent file**

```markdown
---
name: workflow-scout
description: |
  Build-vs-borrow scout for awok workflow design. Given a draft set of action
  blocks, searches reputable skills/agents/registries to find prior art that already
  does the work, so the maintainer can decide reuse vs. build. Use this agent after
  a workflow is decomposed into blocks, or on demand whenever a concrete need is
  identified.
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - WebSearch
  - WebFetch
  - Write
---

You are a build-vs-borrow scout. You advise — **the maintainer always decides.** Given
a draft DAG of action blocks, your job is to find, for each block, whether a reputable
resource already does the work, so nothing is rebuilt from scratch needlessly.

## Method

1. Read the draft DAG / block list you are given.
2. For each block, derive a precise capability query (not the vague idea — the
   concrete job: "a pre-mortem that emits failure narratives with thresholds").
3. Search reputable sources: existing `src/agents/` in this repo first (local reuse),
   then the Claude Code / agent ecosystem — GitHub, agentskills.io, the Tessl
   Registry, "awesome-claude-code", obra/superpowers, BMAD-METHOD, the-fool.
4. For each candidate, capture: name, URL, **license** (can it be adapted? MIT/Apache
   vs unclear), **reputation** (stars, maintenance), and a one-line "what we'd borrow".
5. Be honest about misses — if nothing reputable exists, say "build fresh" and why.
   Flag low-star / no-license one-offs as inspiration-only, not vendorable.

## Output

Write `reuse-report` (markdown): a table per block — candidate(s), URL, license,
reputation, "borrow / build-fresh" recommendation, and the one-line rationale. End
with a ranked shortlist of the highest-ROI reuses. This is **advice**; flag every
recommendation as the maintainer's call.
```

- [ ] **Step 2: Write the invocation snippet**

```markdown
---
agent: workflow-scout
generated: false
---

**workflow-scout** [sonnet] · Searches reputable skills/agents/registries for prior art on each draft block.
{{ inputs_outputs_compact }}

**Task**: For each block in the draft DAG, find whether a reputable, adaptable
resource (skill/agent/library) already does the work. Report candidates with URL,
license, reputation and a borrow/build-fresh recommendation. Advisory only — the
maintainer decides per block.
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/workflow-scout.md src/workflow/templates/invocations/workflow-scout.md
git commit -m "feat(create-workflow): workflow-scout agent + snippet (build-vs-borrow)"
```

---

## Task 7: DAG agent — `nature-critic` (+ snippet)

**Files:**
- Create: `src/agents/nature-critic.md`
- Create: `src/workflow/templates/invocations/nature-critic.md`

- [ ] **Step 1: Write the agent file**

```markdown
---
name: nature-critic
description: |
  Action-type critic for awok workflow design. Given a draft set of action blocks,
  recommends for each its optimal awok nature — deterministic script, LLM agent,
  direct main_agent action, or workflow_call. Use this agent after decomposition to
  catch blocks that are wastefully modelled (an LLM where a script would be cheaper
  and more reliable, or vice versa).
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - Write
---

You are an awok action-type critic. You advise — **the maintainer always decides.**
In awok, an *action* (block) is one of four natures:

- **`script`** — deterministic, no LLM. Cheapest and most reliable. Right when the
  work is mechanical: parsing, aggregation, file I/O, running a CLI, math over data.
- **`agent`** — an LLM sub-agent. Right when the work needs judgment, synthesis,
  reading unstructured input, or open-ended search. Costs tokens; less reproducible.
- **`main_agent`** — the orchestrator does it directly (no sub-agent). Right for
  interactive/conversational steps, or trivial glue that doesn't warrant a sub-agent.
- **`workflow_call`** — dispatch another whole awok workflow. Right when an existing
  workflow already does this block end-to-end.

## Method

1. Read the draft DAG and (if provided) the `reuse-report` — skip blocks already
   flagged borrowable wholesale, or note that a `workflow_call` may apply there.
2. For each remaining block, judge its optimal nature against the four definitions.
   Look hard for **LLM-where-a-script-suffices** (the most common waste) and
   **script-where-judgment-is-needed** (the most common brittleness).
3. Where you'd switch a block's nature, say what the script would compute (or what
   judgment the agent needs) concretely enough to act on.

## Output

Write `nature-report` (markdown): a table per block — proposed nature, current/implied
nature, switch? (yes/no), and a one-line justification anchored in the four
definitions. Flag every recommendation as the maintainer's call.
```

- [ ] **Step 2: Write the invocation snippet**

```markdown
---
agent: nature-critic
generated: false
---

**nature-critic** [sonnet] · Recommends each block's optimal awok nature (script / agent / main_agent / workflow_call).
{{ inputs_outputs_compact }}

**Task**: For each block in the draft DAG (skipping ones the reuse-report flags as
borrowable), recommend its optimal awok action nature, hunting especially for
LLM-where-a-script-suffices and script-where-judgment-is-needed. Advisory only.
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/nature-critic.md src/workflow/templates/invocations/nature-critic.md
git commit -m "feat(create-workflow): nature-critic agent + snippet (script-vs-agent)"
```

---

## Task 8: DAG agent — `skill-reviewer` (+ snippet)

**Files:**
- Create: `src/agents/skill-reviewer.md`
- Create: `src/workflow/templates/invocations/skill-reviewer.md`

Rubric from Anthropic's official "Skill authoring best practices" checklist
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

- [ ] **Step 1: Write the agent file**

```markdown
---
name: skill-reviewer
description: |
  Quality gate for generated awok artifacts. Scores a generated SKILL.md AND the
  workflow's agent files against Anthropic's skill-authoring rubric, and returns a
  prioritized fix list. Unlike external tools it also reviews agent files and never
  penalizes a legitimately long orchestrator skill. Use this agent after generation,
  before handoff.
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - Write
---

You are a skill/agent quality reviewer. You score the **generated** artifacts of a
new awok workflow against a concrete rubric and return actionable fixes. You judge the
artifact, not the author's intent.

## What to review

- The generated `src/skills/<name>/SKILL.md`.
- Every `src/agents/*.md` the new workflow references.

## Rubric (Anthropic skill-authoring best practices)

For the **SKILL.md**:
1. **Description** — specific, with concrete trigger terms; says *what* and *when to
   use*; distinct enough not to collide with other skills.
2. **Conciseness & actionability** — steps are actionable, not vague; workflow is
   clear; progressive disclosure (details deferred, not dumped).
3. **Structure** — consistent terminology; concrete examples; no time-sensitive info.
   NOTE: an orchestrator SKILL.md is legitimately longer than a leaf skill — judge
   conciseness *relative to an orchestrator*, do not penalize necessary DAG content.

For each **agent .md**:
4. **Frontmatter** — `name` kebab-case and matches the file; `description` says what +
   "use this agent to…"; `model: inherit`; tools are the minimal necessary set.
5. **Body** — single clear responsibility; concrete output contract; no padding; tools
   declared actually used.

## Method

Score each artifact 0–100 against its rubric, list the specific issues by severity
(blocking / important / cosmetic), and give a concrete fix for each. Set an overall
verdict: PASS (ship), NEEDS-FIX (list blocks), or REWORK.

## Output

Write `review-report` (markdown): per-artifact score + issues + fixes, then the overall
verdict. This gates handoff: a NEEDS-FIX/REWORK verdict should loop back to scaffold.
```

- [ ] **Step 2: Write the invocation snippet**

```markdown
---
agent: skill-reviewer
generated: false
---

**skill-reviewer** [opus] · Scores the generated SKILL.md and the new agent files against Anthropic's rubric.
{{ inputs_outputs_compact }}

**Task**: Review the generated SKILL.md and every referenced agent file against the
Anthropic skill-authoring rubric (description quality, conciseness-for-an-orchestrator,
structure; agent frontmatter + body). Emit per-artifact scores, severity-tagged issues
with concrete fixes, and an overall PASS / NEEDS-FIX / REWORK verdict.
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/skill-reviewer.md src/workflow/templates/invocations/skill-reviewer.md
git commit -m "feat(create-workflow): skill-reviewer agent + snippet (Anthropic rubric)"
```

---

## Task 9: Optional agent — `tessl-review`

**Files:**
- Create: `src/agents/tessl-review.md`

On-demand only, experimental. Not on the critical path. Runs `tessl skill review`
isolated (telemetry off, read-only, never `--optimize`).

- [ ] **Step 1: Write the agent file**

````markdown
---
name: tessl-review
description: |
  Optional, experimental external second opinion on a generated SKILL.md via
  `tessl skill review`, run in an isolated sandbox (telemetry disabled, read-only,
  never --optimize). Use this agent only when the maintainer explicitly wants an
  external score; it cannot review agent files and may under-score long orchestrators.
model: inherit
tools:
  - Bash
  - Read
  - Write
---

You run an **optional, experimental** external review of a generated SKILL.md using
the `tessl skill review` CLI. This is a second opinion only — the homegrown
`skill-reviewer` is the real gate. tessl reviews **skills only** (not agent files) and
its conciseness scoring can unfairly penalize a long-but-legitimate orchestrator;
weight its verdict accordingly.

## Safety rules (non-negotiable)

- Run in an **isolated sandbox** so nothing global is polluted and telemetry is off.
- **Opt out of telemetry BEFORE reviewing** (tessl uploads file contents by default).
- **Read-only**: never pass `--optimize` or `--yes` — our SKILL.md is generated and
  any in-place rewrite would be clobbered on the next `awok generate` anyway.

## Method

```bash
mkdir -p /tmp/tessl-sandbox
export HOME=/tmp/tessl-sandbox
export npm_config_cache=/tmp/tessl-sandbox/.npm
npx --cache /tmp/tessl-sandbox/.npm @tessl/cli config set shareUsageData false
npx --cache /tmp/tessl-sandbox/.npm @tessl/cli skill review --json /abs/path/to/src/skills/<name>
```

If `npx`/network is unavailable, report "tessl unavailable" — do not fail the workflow.

## Output

Summarize tessl's score and critique, explicitly noting it covers only the SKILL.md
(not agents) and flagging any conciseness penalty likely caused by orchestrator length.
Frame it as advisory.

---
*tessl is a third-party tool; see https://docs.tessl.io and THIRD_PARTY.md. Status:
experimental pending the maintainer's hands-on evaluation.*
````

- [ ] **Step 2: Commit**

```bash
git add src/agents/tessl-review.md
git commit -m "feat(create-workflow): optional tessl-review agent (isolated, experimental)"
```

---

## Task 10: Manual section — `brainstorm-protocol` (the heart)

**Files:**
- Create: `src/workflow/manual/brainstorm-protocol.md`

Injected into the SKILL.md after S2 (`insert_at: after:S2-BRAINSTORM`). Adapts BMAD's
facilitator stance (MIT). This file IS the adversarial engine the main agent runs.

- [ ] **Step 1: Write the manual section**

```markdown
## 🧠 Brainstorm protocol (run this during S2)

This is the heart of the workflow. Your default failure mode as an LLM is
**sycophancy** — reflecting the author's idea back, prettier. Invert it. Your mandate
here is to **question, contradict, and surprise**, so the design that survives is
better than the one the author walked in with. The author always holds the vote; you
are a forcing function, never the source of the answer.

### Facilitator stance

- You are a **forcing function for the author's creativity, never the source of
  ideas.** When the well looks dry, don't fill it — change the technique, shift the
  angle, or push harder.
- **No multiple-choice menus** of ideas — a menu invites lazy picking and pulls the
  author out of generating. Ask one open prompt at a time.
- **Diverge/converge firewall:** never judge during generation (premature judgment
  kills ideas); converge in a distinct pass, on the author's verdict — never rank for
  them.

### Session depth (the author chooses in S1; switchable any time)

- **Light** (~15 min, one diamond): reframe with *How Might We* → a fast burst of 6–8
  candidate workflow shapes (no polish) → the author picks. Output: a chosen rough DAG.
- **Deep** (multi-round): *First Principles* + *Starbursting* to pin the real job and
  per-block I/O → *Morphological Analysis* for DAG variants → panel critique
  (pre-mortem, hats) → converge.
- **Escalation invariant** — *the convergence artifact of round N becomes the
  divergence seed of round N+1.* At any convergence point, offer "go deeper?": to
  escalate, re-enter divergence **on the survivor** (Starburst each node, spawn
  variants). No state is lost — the author can start light and deepen the moment the
  idea proves more ambitious than it looked.

### The challenge panel (where out-of-frame ideas come from)

You are *inside* the author's frame — you share the conversation. Genuinely surprising
provocations come from **independent sub-agents** that never lived the framing.
Convene them with the `Task` tool (usually in the **background**), feeding them the
current `design-intent`, and weave their returns back into the dialogue:

| Panelist | Convene when |
|---|---|
| `premortem` | a design is converging — stress-test it before locking. |
| `devils-advocate` | the author's idea is sailing through unchallenged. |
| `cross-pollinator` | the design feels stuck in one structural mould. |
| `rolestormer` | you need stakeholder pressure (SRE / security / newcomer / cost). |

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

### Closing ritual — name the workflow

Close S2 by **naming the thing** (it's a convergence/commitment moment — by now you
know what it *is*). Propose a few candidate slugs, check each against the skill-name
pattern `^[a-z][a-z0-9-]*$` and for **uniqueness** against existing
`src/workflows/*.yaml`, and let the **author pick**. Emit the chosen slug as
`new-name` — it is the single source of truth for scaffold (S5) and generate (S6).

---
*Facilitator stance adapted from BMAD-METHOD `bmad-brainstorming` (BMad Code LLC,
MIT). See THIRD_PARTY.md.*
```

- [ ] **Step 2: Commit**

```bash
git add src/workflow/manual/brainstorm-protocol.md
git commit -m "feat(create-workflow): brainstorm-protocol manual section (BMAD-adapted, MIT)"
```

---

## Task 11: The workflow YAML — `create-workflow.yaml`

**Files:**
- Create: `src/workflows/create-workflow.yaml`

This wires everything. Dataflow is clean by construction: `main_agent` phase-level I/O
emits no warnings; S4 invocation outputs (`reuse-report`, `nature-report`) have
consumers; the real deliverables (`src/workflows/`, `src/skills/`) live outside `work/`
so the dataflow check ignores them.

- [ ] **Step 1: Write the YAML**

```yaml
schema_version: 1
skill:
  name: create-workflow
  description: |
    Design and scaffold a new awok workflow from a vague idea. An adversarial
    brainstorming engine (curated techniques + an independent challenge panel) breaks
    the tunnel effect, then the idea is decomposed, reviewed for build-vs-borrow and
    script-vs-agent, scaffolded, generated and quality-reviewed. Use it to create or
    substantially redesign an awok workflow.
  title: "/create-workflow — a workflow that designs workflows"
namespaces:
  work: work/create-workflow
opportunistic:
  enabled: true
  when: >
    Early, if the whole idea smells already-built (strong prior art); or in the
    brainstorm, when a thread needs a provocation the planned panel doesn't cover.
  examples:
    - "whole idea likely already exists → éclair build-vs-borrow scout"
    - "no panelist fits a gap → author an ad-hoc panelist on the fly"
groups:
  frame:
    description: Capture the idea and pin the real job-to-be-done
    risk: none
  ideate:
    description: Adversarial brainstorming that breaks the tunnel effect
    risk: none
  shape:
    description: Decompose into a draft DAG and review the blocks
    risk: low
  build:
    description: Scaffold the workflow source and generate its artifacts
    risk: medium
  ship:
    description: Quality-review and hand off the generated workflow
    risk: low
phases:
  - id: S1-FRAME
    name: Frame the idea
    group: frame
    type: main_agent
    description: >
      Capture the maintainer's raw idea and pin the real job-to-be-done with First
      Principles + How-Might-We. Ask the maintainer to choose the brainstorm depth
      (light ~15 min, or deep / multi-round) — and note it can switch any time. Write
      a short frame brief: the job, the chosen depth, known constraints.
    outputs:
      - { role: work:frame-brief, kind: md }
  - id: S2-BRAINSTORM
    name: Adversarial brainstorm
    group: ideate
    type: main_agent
    depends_on: [S1-FRAME]
    opportunistic:
      when: A brainstorm thread needs a provocation the planned panel doesn't cover.
      examples:
        - "no panelist fits → author an ad-hoc panelist on the fly"
    description: >
      Run the brainstorm protocol below (injected after this phase): an adversarial,
      generative engine that questions, contradicts and surprises the maintainer
      rather than eliciting and rubber-stamping. Drive the curated techniques, convene
      the independent challenge panel (premortem, devils-advocate, cross-pollinator,
      rolestormer) via the Task tool, and run the double-diamond light/deep loop. The
      maintainer always holds the vote. Close by naming the workflow → new-name.
    inputs:
      - { role: work:frame-brief, kind: md }
    outputs:
      - { role: work:design-intent, kind: md }
      - { role: work:new-name, kind: text }
  - id: S3-DECOMPOSE
    name: Decompose into blocks
    group: shape
    type: main_agent
    depends_on: [S2-BRAINSTORM]
    description: >
      Translate the converged design intent into a draft awok DAG: stages, groups,
      action blocks, and per-block I/O roles. Keep it a draft — the block review (S4)
      and the maintainer will revise it. Inherit the workflow name chosen in S2.
    inputs:
      - { role: work:design-intent, kind: md }
    outputs:
      - { role: work:draft-dag, kind: md }
  - id: S4-BLOCK-REVIEW
    name: Review the blocks
    group: shape
    type: agent
    depends_on: [S3-DECOMPOSE]
    invocations:
      - agent: workflow-scout
        model: sonnet
        description: For each block, find reputable skills/agents that already do the work
        inputs:
          - { role: work:draft-dag, kind: md }
        outputs:
          - { role: work:reuse-report, kind: md }
      - agent: nature-critic
        model: sonnet
        description: For each block, recommend its optimal awok action nature
        inputs:
          - { role: work:draft-dag, kind: md }
          - { role: work:reuse-report, kind: md }
        outputs:
          - { role: work:nature-report, kind: md }
  - id: S5-SCAFFOLD
    name: Scaffold the workflow
    group: build
    type: main_agent
    depends_on: [S4-BLOCK-REVIEW]
    description: >
      With the maintainer's per-block decisions (reuse vs build, and each block's
      nature), write the new workflow source: src/workflows/<name>.yaml, the needed
      src/agents/<agent>.md files, and their invocation snippets — reusing awok
      templates and conventions. Encode borrowed resources with attribution. This is
      the maintainer's design made concrete; confirm choices as you go.
    inputs:
      - { role: work:design-intent, kind: md }
      - { role: work:draft-dag, kind: md }
      - { role: work:reuse-report, kind: md }
      - { role: work:nature-report, kind: md }
      - { role: work:new-name, kind: text }
    outputs:
      - { path: "src/workflows/", kind: dir, terminal: true, external: true }
  - id: S6-GENERATE
    name: Validate and generate
    group: build
    type: script
    depends_on: [S5-SCAFFOLD]
    description: >
      Validate then generate the new workflow. The name is read from the new-name
      artifact written in S2.
    inputs:
      - { role: work:new-name, kind: text }
    cmd: |
      NAME="$(tr -d '[:space:]' < work/create-workflow/new-name.txt)"
      echo "Validating + generating workflow: $NAME"
      awok validate "$NAME"
      awok generate --workflow "$NAME"
  - id: S7-REVIEW
    name: Quality review
    group: ship
    type: agent
    depends_on: [S6-GENERATE]
    invocations:
      - agent: skill-reviewer
        model: opus
        description: Score the generated SKILL.md and the new agent files against the rubric
        inputs:
          - { path: "src/skills/", kind: dir, external: true }
        outputs:
          - { role: work:review-report, kind: md }
  - id: S8-HANDOFF
    name: Hand off
    group: ship
    type: main_agent
    depends_on: [S7-REVIEW]
    description: >
      If the review verdict is NEEDS-FIX or REWORK, loop back to S5 with the fix list.
      On PASS, hand off: offer to run ./install.sh and smoke-test the new /skill, and
      optionally chain the writing-plans skill to plan the new workflow's own content.
    inputs:
      - { role: work:review-report, kind: md }
brainstormings:
  - id: design
    after_phase: S1-FRAME
    before_phase: S3-DECOMPOSE
    timebox_minutes: 15
    protocol: brainstorm-light
    output:
      - { role: work:design-intent, kind: md }
on_demand_agents:
  - agent: premortem
    model: sonnet
    description: |
      Independent pre-mortem panelist. Assumes the workflow shipped and produced
      garbage, then traces specific causes (named trigger, threshold, consequence).
    when: During S2, to stress-test a converging design and surface design errors.
  - agent: devils-advocate
    model: sonnet
    description: |
      Independent devil's-advocate panelist. Steelmans the idea, then attacks the
      strongest version; trusts only the artifact, never the author's framing.
    when: During S2, when the author's idea is going unchallenged (the tunnel effect).
  - agent: cross-pollinator
    model: sonnet
    description: |
      Independent analogy panelist. Injects an out-of-frame, cross-domain pattern to
      surface workflow shapes the author would not reach alone.
    when: During S2, when the design feels stuck in one structural mould.
  - agent: rolestormer
    model: sonnet
    description: |
      Independent persona panelist. Rotates hostile/skeptical stakeholders (SRE,
      security reviewer, newcomer, cost owner) to stress-test the design from outside.
    when: During S2, to pressure-test the design against stakeholder perspectives.
  - agent: tessl-review
    model: inherit
    description: |
      Optional, experimental external second opinion. Runs `tessl skill review`
      isolated (telemetry off, read-only, never --optimize) on the generated SKILL.md.
    when: Optionally after S7, if the maintainer wants an external score. Experimental.
manual_sections:
  - name: brainstorm-protocol
    path: src/workflow/manual/brainstorm-protocol.md
    insert_at: "after:S2-BRAINSTORM"
```

- [ ] **Step 2: Validate the workflow**

Run:
```bash
awok validate create-workflow
```
Expected: exits 0, no schema/coherence errors, **no dataflow warnings**.
(`awok validate` takes a **positional** workflow arg, not `--workflow`; only
`awok generate` takes `--workflow`.) If you see
"agent '<x>' not found", an agent file from Tasks 2–9 is missing/misnamed — fix the
file, not the YAML. If you see a dataflow warning, re-check that the warned role is a
`main_agent` phase-level I/O (should be silent) or an S4 invocation I/O with a matching
producer/consumer.

- [ ] **Step 3: Commit**

```bash
git add src/workflows/create-workflow.yaml
git commit -m "feat(create-workflow): the create-workflow.yaml DAG (validates clean)"
```

---

## Task 12: Generate, drift-check, and run the test suite

**Files:**
- Generated (do not hand-edit): `src/skills/create-workflow/SKILL.md`,
  `docs/architecture-cartography/create-workflow.html`, `...-texte.md`,
  `docs/architecture-cartography/index.html`.

- [ ] **Step 1: Generate**

Run:
```bash
awok generate --workflow create-workflow
```
Expected: produces `src/skills/create-workflow/SKILL.md`, the cartography HTML +
`-texte.md`, and refreshes `index.html` (now **two** cards: onboard + create-workflow).

- [ ] **Step 2: Inspect the generated SKILL.md**

Run:
```bash
sed -n '1,40p' src/skills/create-workflow/SKILL.md
grep -n "Brainstorm protocol" src/skills/create-workflow/SKILL.md
grep -n "On-demand agents" src/skills/create-workflow/SKILL.md
grep -n "Pipeline brainstormings" src/skills/create-workflow/SKILL.md
```
Expected: frontmatter name/description present; the brainstorm-protocol section
appears **after the S2 block**; the 5 on-demand agents render; the brainstormings list
renders. No `_(snippet missing: ...)_` placeholders for workflow-scout / nature-critic
/ skill-reviewer (panel + tessl agents are on-demand and need no snippet).

- [ ] **Step 3: Drift check**

Run:
```bash
awok check
```
Expected: exits 0 (no drift — the committed SKILL.md matches a fresh generate).

- [ ] **Step 4: Run the auto-discovered tests**

Run:
```bash
pytest src/scripts/tests/test_workflow_realfile.py src/scripts/tests/test_workflow_io_roles.py -q
```
Expected: PASS. `test_workflow_realfile.py` auto-adds 3 parametrized cases for
`create-workflow` (schema, coherence, no-drift) — they pass because we generated in
Step 1. No test files need manual edits.

- [ ] **Step 5: Commit the generated artifacts**

```bash
git add src/skills/create-workflow/ docs/architecture-cartography/create-workflow.html docs/architecture-cartography/create-workflow-texte.md docs/architecture-cartography/index.html
git commit -m "feat(create-workflow): generate SKILL.md + cartography + 2-card index"
```

---

## Task 13: Attribution, install, and dogfood smoke test

**Files:**
- Create: `THIRD_PARTY.md`

- [ ] **Step 1: Write the attribution file**

```markdown
# Third-party attributions

The `create-workflow` workflow adapts content from these MIT-licensed projects. Each
adapted file also carries an inline attribution footer. We retain the original
copyright and MIT permission notices.

| Project | Copyright | URL | Used in |
|---|---|---|---|
| BMAD-METHOD (`bmad-brainstorming`) | © 2025 BMad Code, LLC (MIT) | https://github.com/bmad-code-org/BMAD-METHOD | brainstorm-protocol facilitator stance + technique library; cross-pollinator; rolestormer |
| claude-skills "the-fool" | © Jeffallan (MIT) | https://github.com/Jeffallan/claude-skills | premortem; devils-advocate; rolestormer personas |
| superpowers | © 2025 Jesse Vincent (MIT) | https://github.com/obra/superpowers | devils-advocate "Do Not Trust the Report" stance; skill-reviewer framing; handoff tail |

tessl (`tessl-review`, optional/experimental) is a third-party tool, not vendored:
https://docs.tessl.io .
```

- [ ] **Step 2: Commit**

```bash
git add THIRD_PARTY.md
git commit -m "docs(create-workflow): THIRD_PARTY attribution for vendored MIT content"
```

- [ ] **Step 3: Install and register**

Run:
```bash
./install.sh
```
Expected: deploys `src/skills/*` → `~/.claude/skills/` and `src/agents/*` →
`~/.claude/agents/` (additive). Restart Claude Code to register the new agents and the
`/create-workflow` skill. (If `./install.sh` is not at repo root, use the repo's
documented install script path.)

- [ ] **Step 4: Dogfood smoke test (manual, after restart)**

Invoke `/create-workflow` and drive it with a small, known target — e.g. "a workflow
that summarizes a directory of markdown notes." Confirm, as a smoke test (not a full
build):
- S1/S2 actually **push back** — the brainstorm asks sharp questions and at least one
  panelist fires (premortem or devils-advocate returns provocations).
- the depth switch (light→deep) is offered and works.
- S2 closes by proposing a **name** and writing `new-name`.
- S4 produces a `reuse-report` and a `nature-report` (advisory).
- S5→S6 scaffold + `awok validate`/`generate` succeed for the toy workflow.
- S7 `skill-reviewer` returns a scored report.

Capture any agent/runtime error and attribute it per Task 1's baseline-green rule.

- [ ] **Step 5: Final drift + test sweep**

Run:
```bash
awok check && pytest src/scripts/tests/ -q
```
Expected: no drift, full suite green. Commit any stray generated changes if `awok
generate` was re-run during dogfooding.

---

## Self-review notes (author)

- **Spec coverage:** S1–S8 + brainstormings + on_demand panel + manual protocol +
  build-vs-borrow scout (S4) + script-vs-agent critic (S4) + homegrown skill-reviewer
  gate (S7) + optional tessl (Task 9) + MIT vendoring (Tasks 2–5, 10, 13) + dogfood
  (Task 13) — all spec sections map to a task.
- **No placeholders:** every file's full content is in its task; vendored agents carry
  complete adapted bodies + attribution (enrichable from source, not deferred).
- **Type consistency:** roles are stable across tasks — `frame-brief`, `design-intent`,
  `new-name`, `draft-dag`, `reuse-report`, `nature-report`, `review-report`; agent
  names match between frontmatter, snippets, YAML invocations, and `on_demand_agents`.
- **Known nuance carried from the probe:** `new-name` is a `text` artifact at
  `work/create-workflow/new-name.txt`, read by S6's script via `tr -d '[:space:]'`.
```
