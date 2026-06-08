# Workflow `create-workflow` — a workflow that designs workflows

**Date:** 2026-06-08
**Status:** design approved (brainstormed with the maintainer)
**Goal:** a meta-workflow `/create-workflow` that takes a vague idea and walks the
maintainer end-to-end to a **validated, generated, reviewed** awok workflow. Its
heart is an **adversarial, generative brainstorming engine** whose explicit job is
to *break the tunnel effect* — to question, contradict, and surprise the author,
not just elicit and rubber-stamp their first idea.

This is the **second workflow** in the repo (the first being `onboard`), so it also
re-introduces the multi-workflow surface (`index.html` aggregation) that `onboard`
deferred. It is the workflow `onboard`'s spec explicitly anticipated.

**Language:** all authored content — `create-workflow.yaml`, agents, invocation
snippets, manual sections, the generated `SKILL.md` — is in **English**, per repo
convention.

---

## 1. Design pillars (the non-negotiables)

1. **Anti-tunnel, adversarial-by-mandate.** The default failure mode of an LLM is
   sycophancy: it reflects the author's idea back, prettier. This workflow inverts
   that — the engine has a *mandate to push back*: pre-mortems, devil's advocate,
   inversion, out-of-frame analogies, persona stress-tests. The point is the
   *friction* that produces a better design.
2. **The human always holds the vote.** Every agent here is **advisory**. The
   brainstorm converges on the author's verdict; reuse, block-nature, and review
   are recommendations the author *tranche*. No agent imposes.
3. **Out-of-frame ideas come from independent sub-agents.** The conversational main
   agent is *inside* the author's frame (it shares the dialogue). Genuinely
   surprising provocations come from **independent panel sub-agents** that never
   "lived" the author's framing — this is why the panel is structural, not cosmetic.
4. **Curated core + on-demand library.** A small opinionated set of techniques the
   main agent drives adaptively, plus a large library pulled in on demand — never a
   passive menu the author lazily picks from.
5. **Borrow before build.** Most of the brainstorming substance is borrowable from
   reputable MIT sources (BMAD, the-fool, superpowers). We vendor/adapt, we don't
   re-author. And the workflow *itself* contains a scout that enforces this rule for
   every future workflow.

---

## 2. The brainstorming engine (the heart)

### 2.1 Curated core (main agent drives, adaptively)

Six techniques matched to a *specification* task (decompose / define I/O / cover the
space / stress-test) rather than pure quantity-divergence:

| Technique | Cognitive move | Typical use in the flow |
|---|---|---|
| **First Principles** | strip assumptions, reason from the irreducible | early — pin the real job-to-be-done |
| **HMW + SCAMPER** | reframe the problem, then mutate a nearby workflow | early — reframe; mutate `onboard`-like priors |
| **Starbursting (5W1H)** | interrogate, don't answer | per candidate block — expose unknown I/O |
| **Morphological Analysis** | enumerate parameters, recombine | mid — generate DAG variants systematically |
| **Pre-mortem / Inversion** | assume failure, work backward | before converging — surface design errors |
| **Six Thinking Hats (AI-rotated)** | parallel-thinking lenses | review pass — facts / risk / optimism over a draft |

### 2.2 The challenge panel (independent sub-agents, the anti-tunnel engine)

Pre-written agents in `src/agents/`, dispatched **during the brainstorm** by the
main agent (via `on_demand_agents` + the phase's `opportunistic` licence). Each
returns provocations the main agent weaves back into the dialogue:

| Panel agent | Stance | Borrowed from |
|---|---|---|
| `premortem` | "It shipped and produced garbage — why?" specificity checklist + failure narrative | the-fool `pre-mortem-analysis.md` (MIT) |
| `devils-advocate` | steelman → break; "Do Not Trust the Report" independent critic | the-fool `red-team-adversarial.md` + superpowers spec-reviewer (MIT) |
| `cross-pollinator` | inject an out-of-frame analogy / cross-domain pattern | BMAD *Cross-Pollination / Analogical Thinking* seed (MIT) |
| `rolestormer` | rotate hostile/skeptical personas (SRE, security reviewer, newcomer) | the-fool persona table + BMAD *Role Playing* (MIT) |

These four are the curated panel. The phase's `opportunistic` licence lets the main
agent **author additional ad-hoc panelists** for a technique the panel doesn't cover.

### 2.3 On-demand technique library

A curated subset of BMAD's `brain-methods.csv` (~15–20 of the best, adapted) is
**embedded directly in the `brainstorm-protocol` manual section** as a markdown
table — awok has no skill-asset deployment mechanism, so the library must be
self-contained in the SKILL.md (and each panel agent self-contains its own protocol
in its `.md` body, which *is* deployed to `~/.claude/agents/`). The main agent pulls
a technique by name when the author asks ("do a reverse brainstorming now") or when
it judges the well is dry. This is data the main agent applies, **not** a sub-agent —
only the *panel* are sub-agents.

### 2.4 Session depth & the escalation seam (short ↔ long, switchable mid-session)

Modeled on the **Double Diamond**: repeated diverge/converge episodes, time-boxed,
with the author forcing convergence (never the AI).

- **Light** (default, ~15 min, one diamond): HMW reframe → fast candidate burst →
  author picks. Produces a chosen rough DAG.
- **Deep** (multi-round): First Principles + Starbursting to pin job + I/O →
  Morphological Analysis for variants → panel (pre-mortem / hats) → converge.
- **The escalation invariant:** *the convergence artifact of round N becomes the
  divergence seed of round N+1.* To go deeper, re-enter divergence **on the
  survivor** — no state is lost. At any convergence point the main agent offers
  "go deeper?", so the author can start short and escalate the moment the idea turns
  out more ambitious than it looked.

Declared natively via awok's `brainstormings` block (`brainstorm-light` /
`brainstorm-deep`); the full protocol lives in a `manual_section`
(`brainstorm-protocol`) adapted from BMAD's facilitator stance:

> *"You are a forcing function for the author's creativity, never the source of
> ideas. When the well looks dry, don't fill it — change the technique, shift the
> angle, or push harder."* — no multiple-choice menus (they invite lazy picking);
> strict diverge/converge firewall (premature judgment kills ideas).

### 2.5 Naming the workflow (closing ritual of the brainstorm)

Naming happens **at the end of S2**, not in decomposition — by then the author knows
*what the thing is*, so baptizing it is a natural convergence/commitment moment, and
the slug then flows cleanly through decompose → scaffold → generate. The main agent
proposes a few candidate names, checks the slug against the skill-name pattern
(`^[a-z][a-z0-9-]*$`) and for **uniqueness** against existing `src/workflows/*.yaml`
(a quick reuse-of-the-scout reflex catches "a `/skill` with that name already
exists"), and the **author picks**. The chosen slug is emitted as `work:new-name`,
the single source of truth consumed by scaffold (S5) and the generate script (S6).

---

## 3. Pipeline (8 actions)

```
  frame            ideate                shape                      build                  ship
  ───────────      ──────────────        ─────────────────         ──────────────────     ─────────────
  S1-FRAME ──→ S2-BRAINSTORM ──→ S3-DECOMPOSE ──→ S4-BLOCK-REVIEW ──→ S5-SCAFFOLD ──→ S6-GENERATE ──→ S7-REVIEW ──→ S8-HANDOFF
  [main]          [main+panel]        [main]            [scout→critic]      [main]          [script]        [skill-reviewer]   [main]
                  ↑ light↔deep loop                    ↑ both advisory                                        │ fail→S5 ↑
```

| Action | Type | Group | Role |
|---|---|---|---|
| **S1-FRAME** | `main_agent` | frame | Capture the raw idea, choose depth (light/deep), pin the job-to-be-done (First Principles + HMW). → `frame-brief`. |
| **S2-BRAINSTORM** | `main_agent` | ideate | The adversarial engine: curated techniques + independent panel + double-diamond. `opportunistic: true` (dispatch panel + ad-hoc panelists). **Closes by naming the workflow** (convergence ritual, see §2.5). → `design-intent`, `new-name`. |
| **S3-DECOMPOSE** | `main_agent` | shape | Translate the intent into a draft DAG: stages, groups, blocks, I/O roles (inherits the name from S2). → `draft-dag`. |
| **S4-BLOCK-REVIEW** | `agent` (2 invocations) | shape | Two advisory critics on the draft blocks. **Author tranches block by block.** |
| **S5-SCAFFOLD** | `main_agent` | build | Write `src/workflows/<name>.yaml` + agents + invocation snippets, reusing awok templates / CLI. Encodes the author's reuse + block-nature decisions. |
| **S6-GENERATE** | `script` | build | `awok validate --workflow <name> && awok generate --workflow <name>` (name read from `new-name`). |
| **S7-REVIEW** | `agent` | ship | `skill-reviewer` scores SKILL.md **and** agents against the Anthropic rubric. `fail → S5` (instructions, not a DAG edge). |
| **S8-HANDOFF** | `main_agent` | ship | `./install.sh`, smoke-test the new `/skill`, optionally chain `writing-plans`. |

**S4 detail** — one phase, two invocations:
- `workflow-scout` [sonnet] — for each block, search reputable skills/agents/registries
  → *does this already exist?* → `reuse-report`.
- `nature-critic` [sonnet] — for each block, recommend its optimal awok **action type**
  (`script` vs `agent` vs `main_agent` vs `workflow_call`) → `nature-report`. It takes
  `reuse-report` **as an input**, which both *orders it after* the scout and lets it
  skip blocks already flagged borrowable. (Ordering is encoded via I/O rather than the
  `depends_on_invocation` field, which awok validates but does not render in the
  SKILL.md.)

**Loops (instructions in the SKILL, not DAG edges):** light→deep escalation in S2;
review-fail→fix between S7 and S5.

**Opportunistic licence (global + S2):** macro prior-art éclair-scout early if the
whole workflow smells already-built; ad-hoc panelists in S2.

---

## 4. Namespaces & I/O (carried by ROLE)

`namespaces: { work: work/create-workflow }`

| Producer | Role | kind | Consumer(s) |
|---|---|---|---|
| S1-FRAME | `work:frame-brief` | md | S2 |
| S2-BRAINSTORM (also `brainstormings.output`) | `work:design-intent` | md | S3, S5 |
| S2-BRAINSTORM (closing naming ritual) | `work:new-name` | text | S5, S6 |
| S3-DECOMPOSE | `work:draft-dag` | md | S4, S5 |
| S4 · workflow-scout | `work:reuse-report` | md | S4 · nature-critic, S5 |
| S4 · nature-critic | `work:nature-report` | md | S5 |
| S5-SCAFFOLD | the new workflow source tree (`src/workflows/<name>.yaml`, agents, snippets) | dir | S6 (terminal deliverable) |
| S6-GENERATE | the generated `SKILL.md` + cartography | dir | S7 (terminal deliverable) |
| S7-REVIEW | `work:review-report` | md | S8 |

**Dynamic-path note (implementation detail for the plan):** the created files live
under a runtime-chosen `<name>`, which a static `io_ref path` can't express. S5/S6
I/O over the source tree are represented as a representative `dir` marked
`external`/`terminal` to keep `awok validate`'s dataflow check clean; the concrete
name flows at runtime via the `work:new-name` text artifact (read by S6's script).
This is the one spot where the YAML's static I/O model meets a runtime-dynamic target
— resolved by the name-file indirection, not by inventing path templating.

---

## 5. Agents to create (`src/agents/`, all `model: inherit` in frontmatter)

| Agent | Tools | Role | Source |
|---|---|---|---|
| `workflow-scout` | Read, Grep, Glob, WebSearch, WebFetch, Write | Build-vs-borrow search (planned S4 + on-demand at component granularity). | new |
| `nature-critic` | Read, Grep, Glob, Write | Script-vs-agent-vs-main_agent-vs-workflow_call critic over draft blocks. | new (awok-aware) |
| `skill-reviewer` | Read, Grep, Glob, Write | Quality gate on generated SKILL.md **and** agent files (Anthropic rubric). | Anthropic skill checklist |
| `premortem` | Read, Grep, Glob, Write | Panel: adversarial pre-mortem. | the-fool (MIT) |
| `devils-advocate` | Read, Grep, Glob, Write | Panel: steelman→break, independent critic. | the-fool + superpowers (MIT) |
| `cross-pollinator` | Read, Grep, Glob, Write | Panel: out-of-frame analogy injector. | BMAD (MIT) |
| `rolestormer` | Read, Grep, Glob, Write | Panel: hostile/skeptical persona rotation. | the-fool + BMAD (MIT) |
| `tessl-review` *(optional, on-demand)* | Bash, Read | External second-opinion via isolated `tessl skill review` (telemetry-off, read-only, never `--optimize`). | external, experimental |

`workflow-scout`, `nature-critic`, `skill-reviewer` get invocation snippets and are
planned phases. The four panel agents + `tessl-review` are listed in
`on_demand_agents` (dispatched during S2 / on the maintainer's call).

**Note on `tessl-review`:** kept **optional and experimental** pending the
maintainer's hands-on test of tessl. It is not on the critical path; the homegrown
`skill-reviewer` is the real gate (it also covers agent files, which tessl cannot,
and avoids tessl's telemetry and its conciseness bias against long-but-legitimate
orchestrator skills).

---

## 6. Vendoring plan (all sources MIT — retain notices + attribute)

| Source | License / reputation | What we vendor/adapt | Into |
|---|---|---|---|
| BMAD `bmad-brainstorming` | MIT, 48.8k★ | `brain-methods.csv` (subset + full library) + facilitator stance | skill asset + `brainstorm-protocol` manual section |
| `jeffallan/claude-skills` "the-fool" | MIT, 9.7k★ | `pre-mortem-analysis.md`, `red-team-adversarial.md`, persona table | `premortem`, `devils-advocate`, `rolestormer` |
| `obra/superpowers` | MIT, 220k★ | `writing-plans` tail + "Do Not Trust the Report" critic framing | S8 handoff + `devils-advocate`/`skill-reviewer` |

Attribution: a `THIRD_PARTY/` note (or per-file header) crediting BMad Code LLC,
Jeffallan, Jesse Vincent with repo URLs and the MIT notice. Confirm license from the
source GitHub repo (not the marketplace listing).

---

## 7. awok feature coverage (this workflow as a self-test)

**Build note:** a generator probe (2026-06-08) confirmed **every feature below is
already wired and rendered** — this workflow is **pure content authoring, zero
generator/template changes**. The only adjustments vs. a naive reading: ordering of
the two S4 critics is encoded via I/O (not the unrendered `depends_on_invocation`),
and the technique library is embedded in the manual section (no skill-asset
deployment exists). `brainstorming.output` is dataflow-invisible, so `design-intent`
is tracked as the S2 phase-level output.

| Feature | Exercised by | New vs `onboard` |
|---|---|---|
| `type: main_agent` phases | S1, S2, S3, S5, S8 | **new** |
| `brainstormings` block (light/deep) | S2 | **new** (onboard deferred it) |
| Multi-invocation phase + `depends_on_invocation` | S4 (scout → critic) | **new** |
| `opportunistic` per-phase (enabled) + ad-hoc authoring | S2 | extends onboard |
| `on_demand_agents` (4 panel + tessl) | panel | extends onboard |
| `type: script` with runtime-dynamic input | S6 (name-file indirection) | extends onboard |
| Multi-workflow + `index.html` aggregation | 2nd workflow exists | **new** |
| `manual_sections` | `brainstorm-protocol` | **new** |

`type: workflow_call` is **not** used by `/create-workflow` itself (the *created*
workflows may use it; the creator does not).

---

## 8. End-to-end test (dogfood)

Mirror `onboard`'s "run it on the awok repo itself" ethos:

1. Author the 7 core agents (+ optional `tessl-review`) + snippets +
   `create-workflow.yaml` + the `brainstorm-protocol` manual section + the vendored
   `brain-methods` asset.
2. `awok validate --workflow create-workflow` (schema + coherence + clean dataflow).
3. `awok generate` → `skills/create-workflow/SKILL.md` + cartography + refreshed
   `index.html` (now two cards).
4. `awok check` → no drift.
5. `./install.sh`.
6. **Dogfood:** invoke `/create-workflow` and use it to *re-design a known target*
   (e.g. reconstruct an `onboard`-shaped workflow from a vague prompt) — confirm the
   brainstorm actually pushes back (panel fires), the two S4 critics produce
   advice, scaffold+generate succeed, and the review gate scores the output.

---

## 9. Out of scope (YAGNI for v1)

- **Deep webedit/API integration** for scaffolding — S5 uses main-agent `Write` +
  awok CLI; the webedit stays a separate manual tool.
- **tessl as a core gate** — optional/experimental on-demand only.
- **Generating into a separate `--workdir` CONTENT_ROOT** — supported by awok, but v1
  targets this engine repo; cross-workdir authoring is a later concern.
- **Automatic deploy** — S8 *offers* `install.sh` + smoke-test; it does not force it.
- **Persisting brainstorm transcripts as durable artifacts** beyond `design-intent`
  (BMAD's `memlog` idea) — noted for a later iteration.
