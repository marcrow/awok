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
