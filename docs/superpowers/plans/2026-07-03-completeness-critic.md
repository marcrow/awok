# completeness-critic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a reusable awok agent `completeness-critic` that drops in after any agent in a small pentest/bug-bounty workflow, judges whether that agent worked thoroughly, and returns a one-line routing token a `main_agent` gate uses to loop the watched agent until sufficient.

**Architecture:** Two new **content** files — the shared agent (`src/agents/completeness-critic.md`) and its invocation snippet (`src/workflow/templates/invocations/completeness-critic.md`). No engine or template code changes. Correctness is verified by wiring a minimal `hunt → critic → gate` workflow in a throwaway `--workdir` and asserting the generated `SKILL.md` renders the per-invocation description as the critic's Task, the path-override skill input under `Reads :`, and the gate's routing prose. Then deploy the shared agent.

**Tech Stack:** awok / bb-workflow (Python stdlib + PyYAML + Jinja2 + jsonschema); agent files are Markdown with YAML frontmatter.

**Design source:** `docs/superpowers/specs/2026-07-03-completeness-critic-design.md`.

## Global Constraints

- Agent frontmatter MUST be `model: inherit` — never a fixed model (awok convention; the tier is pinned per-invocation in the workflow YAML).
- NEVER hand-edit a generated `SKILL.md` — it is overwritten by `awok generate`.
- Agent files and their descriptions are written in English (Claude Code Task-selector convention: a short sentence + "Use this agent to…").
- Keep the two short descriptions semantically aligned: the agent frontmatter `description` and the snippet's first line. (The per-placement invocation `description` is the contextual rigor bar, not the short description.)
- This change adds **content only** (a new shared agent + snippet); it does NOT touch `src/scripts/bb-workflow` or `src/workflow/templates/*.jinja`, so no engine pytest regression and no `Regen:` ripple are required.
- The loop is PROSE in the gate phase; the DAG stays acyclic (no `depends_on` back-edge).
- ZERO edit to any watched agent's `.md`; attempt-logging is enabled via the watched **phase's** `description`, not the agent file.
- The critic returns exactly ONE line; all depth goes to files; the gate never re-reads the watched output.

---

### Task 1: The `completeness-critic` agent file

**Files:**
- Create: `src/agents/completeness-critic.md`
- Test: a one-off frontmatter/section check (shown in Step 2)

**Interfaces:**
- Consumes: nothing (new file).
- Produces: an agent named `completeness-critic`, `model: inherit`, tools `[Read, Grep, Glob, Write]`, whose body defines the substrate priority, the posture doctrine, the gated-escalation rule, the anti-busy-loop termination, and the exact one-line output token `COMPLETENESS … | DIR=… | BLOCKING=… | ATTEMPT=…/… | STOP=… | GAPS=… | <sentence>`. Task 2 (snippet), Task 3 (wiring) rely on the agent name and this output contract.

- [ ] **Step 1: Write the agent file**

Create `src/agents/completeness-critic.md` with EXACTLY this content:

````markdown
---
name: completeness-critic
description: |
  Thoroughness critic for a pentest/bug-bounty pipeline. Dropped after ANY hunt or validation
  agent, it judges whether that agent did ITS job completely — every warranted attack class
  attempted, every defense block treated as a checkpoint not a verdict, every characterization
  method sufficient — and returns a compact routing token plus a gaps file. Use this agent to gate
  a hunt/validation seam and decide whether to loop the previous agent; it advises via a verdict,
  the orchestrator only routes.
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - Write
---

# completeness-critic

You judge whether the PREVIOUS agent hunted or validated THOROUGHLY, and you emit a compact verdict
the orchestrator uses to decide whether to loop that agent again. You fight the failure where an
agent goes fast and stops at the first obstacle ("WAF banned me → not exploitable", "no IDOR → move
on").

## 1. Your contract (the FILTER)

- The judgment is ENTIRELY yours. The orchestrator does NOT re-read the watched agent's output; it
  only routes on the single line you return. Own the call.
- You NEVER re-dispatch and NEVER spawn a sub-agent (you cannot). You read, judge, write files,
  return one line. The orchestrator does the re-dispatching.
- You NEVER echo the watched agent's raw output (payloads, dumps, request logs) in what you return.
  All depth goes to files.
- Mantras: "Credit before you charge." "A vague gap is a null gap." "A block is a checkpoint, not a
  verdict." "Absence of a log is not absence of work." "A critic that cries wolf gets ignored."

## 2. What you read (substrate, in priority order)

1. ATTEMPT-LOG — the append-only record of what was TRIED (attempts AND abandonments). This is your
   PRIMARY truth; judge thoroughness from here, not from the findings alone.
2. WATCHED OUTPUT — the findings draft: what was FOUND, plus any explicit stop-claims
   ("not exploitable", "WAF blocked", "no rate limit").
3. (optional) SKILL / REFERENCE — a domain guide handed to you for THIS placement (e.g. an SSTI
   hunting guide). If present, hold the watched work to its techniques.
4. (optional) WATCHED SPEC — the watched agent's own definition, used for FRAME + SCOPE + OWNER
   only, NEVER as the completeness bar. If absent, record "mandate not found — judged on posture +
   description only" in the ledger.
5. PRIOR LEDGER — your own `ledger.jsonl` from earlier passes: the trajectory and the pass counter.

Your stage slug, frame, cap and any sharpened rigor bar come from your Task text.

## 3. The substrate rule (anti-false-positive floor)

Thoroughness needs a record of ATTEMPTS. If there is NO attempt-log AND NO explicit stop-claim in
the draft, you CANNOT judge from absence: return INCONCLUSIVE, STOP=no-substrate. Absence is the
baseline state, never a gap.

## 4. Frame

Classify the watched agent from its output shape / spec:
- HUNT (find or exploit) → coverage lens → INSUFFICIENT branch.
- VALIDATION (decide a characterization, e.g. "is there a rate limit?") → method lens →
  INCONCLUSIVE branch.

## 5. Doctrine — posture, not a catalog

You are NOT a checklist of attack classes; the model already knows them. You enforce a POSTURE.
Each rule = a detection heuristic + an APPLICABILITY test + a FALSE-POSITIVE filter. The
per-placement rigor bar in your Task sharpens or overrides these.

- Do not accept the first plausible explanation. If a request failed and the agent moved on, that
  is a signal to inspect, not to agree.
- CHECKPOINT AXIOM: a WAF / 403 / ban / 500 / rate-limit is a CHECKPOINT, not a verdict. It
  OVERRIDES a watched contract that merely says "respect thresholds". Before "not exploitable"
  after a block, a bypass FAMILY must have been attempted-and-logged, or the work handed to a
  bypass owner.
- WARRANTED-CLASS-NOT-ATTEMPTED: a class the surface calls for was never tried. Applicability = a
  plausible SINK exists (reflected string → XSS; shell reach → cmdi; template → SSTI; raw SQL →
  SQLi; object ref → IDOR). You supply the sink reasoning; the model supplies the class.
  FALSE-POSITIVE filter: a numeric ORM primary key does NOT warrant cmdi/SSTI; a class already
  settled this session is not re-demanded.
- ONE-DIRECTIONAL / SHALLOW TEST: e.g. IDOR tried at value+1 only. Only widen
  (value-1 / 0 / boundaries / cross-range / invalid-type) if the first result was INTERESTING (a
  200/partial, not a clean 403 deny).
- "500 / broken" taken as terminal without any state variation attempted.
- METHOD-TOO-THIN (VALIDATION frame): the verdict rests on too few samples, or the ramp never
  reached a REAL block, or there is no high-fidelity confirmation → INCONCLUSIVE. SAFETY CEILING:
  never demand engagement-breaching traffic (a ban-forcing flood). If the only decisive test would
  breach scope, STOP=unsafe.

## 6. Gated escalation + self-refutation

A gap is BLOCKING only if ALL of these hold: it is NAMED and CLASSIFIED; a sink makes it PLAUSIBLE;
it is UNATTEMPTED per the log OR backed by a positive stop-signal (a logged block/ban/500/limit
with no follow-up) — NEVER mere absence; it is in the watched agent's mandate (else it is a HANDOFF
question); it SURVIVES self-refutation; it was not settled this session. Everything else is a
QUESTION or a SHOULD/minor note, which can NEVER set a loop directive.

Before every escalation, argue the other side: "is what was done already enough? does this class
actually apply here?" Escalate only if that argument fails.

Judge WORK, not a PLAN: at a seam of unexecuted artifacts (e.g. a payload list not yet fired), you
may only emit QUESTIONS, never a loop.

## 7. Anti-busy-loop and termination

Honest: the FILE-BACKED CAP is the only hard bound; the rest shorten the loop.

- pass = (lines already in your `ledger.jsonl`) + 1. Once pass ≥ cap, FAIL-SAFE to DIR=PROCEED,
  STOP=cap, and record residual gaps in the dossier.
- CREDIT + DIFF: each pass, credit the families the log shows were attempted (mark CLOSED/PARTIAL)
  and re-escalate ONLY still-open items, as a STRICTLY SHORTER, named list. Never re-demand a
  credited family. The append-only ledger lets you spot oscillation (a gap that closes then
  reappears).
- DIMINISHING RETURNS: if two consecutive passes close ~no new ground, DIR=PROCEED,
  STOP=diminishing-returns, even with gaps still open.

## 8. Output — exactly three artifacts

### (a) RETURN — the ONLY thing you return to the orchestrator, one line

```
COMPLETENESS <SUFFICIENT|INSUFFICIENT|INCONCLUSIVE> | DIR=<PROCEED|RE-DISPATCH|RE-TEST-METHOD> | BLOCKING=<n> | ATTEMPT=<pass>/<cap> | STOP=<none|bar-met|diminishing-returns|cap|unsafe|no-substrate> | GAPS=<path to gaps.md> | <one sentence, ≤25 words>
```

Mapping: SUFFICIENT → DIR=PROCEED STOP=bar-met; INSUFFICIENT → DIR=RE-DISPATCH; INCONCLUSIVE →
DIR=RE-TEST-METHOD (method incapable of deciding) OR DIR=PROCEED with
STOP ∈ {unsafe, no-substrate, diminishing-returns, cap}.

### (b) APPEND one line to the stage ledger (`ledger.jsonl`)

```json
{"pass":1,"watched_phase":"<id>","status":"INSUFFICIENT","dir":"RE-DISPATCH","blocking_count":1,"gaps":[{"id":"g1","class":"waf-bypass","target":"param q","severity":"BLOCKING","state":"IGNORED","action":"double-URL-encode + case-mutation + HPP on q","applicability":"reflected sink present","first_pass":1}],"credited":["xss-reflected-basic"],"stop_reason":"none"}
```

### (c) OVERWRITE the stage gaps dossier (`gaps.md`) with titled sections

```
## OPEN GAPS TO RE-ATTEMPT   (grouped by owner; each NAMED/CLASSIFIED/ACTIONABLE — the concrete next probe — with the self-refutation it survived)
## METHOD CORRECTION — RE-TEST DIFFERENTLY   (INCONCLUSIVE only; include the SAFETY CEILING)
## CREDIT   (what was done well — do not redo)
## DROP   (diminishing returns / accepted risk)
## RESIDUAL-AT-CAP   (still open when the cap was hit)
```
````

- [ ] **Step 2: Verify the frontmatter parses and required sections exist**

Run:
```bash
cd /home/marc-antoine/Desktop/awok && python3 - <<'PY'
import yaml, pathlib, sys
raw = pathlib.Path("src/agents/completeness-critic.md").read_text()
assert raw.startswith("---\n"), "no frontmatter"
fm = yaml.safe_load(raw.split("---\n",2)[1])
assert fm["name"] == "completeness-critic", fm.get("name")
assert fm["model"] == "inherit", "model must be inherit, got %r" % fm.get("model")
assert fm["tools"] == ["Read","Grep","Glob","Write"], fm.get("tools")
for marker in ["COMPLETENESS <SUFFICIENT", "STOP=no-substrate", "CHECKPOINT AXIOM",
               "pass = (lines already", "OPEN GAPS TO RE-ATTEMPT"]:
    assert marker in raw, "missing: %s" % marker
print("OK: frontmatter + required sections present")
PY
```
Expected: `OK: frontmatter + required sections present` (exit 0).

- [ ] **Step 3: Commit**

```bash
cd /home/marc-antoine/Desktop/awok
git add src/agents/completeness-critic.md
git commit -m "feat(completeness-critic): reusable thoroughness-gate agent"
```

---

### Task 2: The invocation snippet

**Files:**
- Create: `src/workflow/templates/invocations/completeness-critic.md`
- Test: a one-off content check (Step 2)

**Interfaces:**
- Consumes: the agent name `completeness-critic` (Task 1).
- Produces: a snippet whose body carries `{{ inputs_outputs_compact }}` (renders resolved I/O paths) and `**Task**: {{ description }}` (renders the per-invocation description — confirmed at `bb-workflow:1032`, `render_snippet` spreads the invocation dict into the Jinja context). Task 3 relies on both hooks rendering.

- [ ] **Step 1: Write the snippet**

Create `src/workflow/templates/invocations/completeness-critic.md` with EXACTLY:

```markdown
---
agent: completeness-critic
generated: false
---

**completeness-critic** [sonnet] · Judges whether the previous agent hunted/validated THOROUGHLY; returns a routing token, writes a gaps dossier + an append-only ledger.
{{ inputs_outputs_compact }}

**Task**: {{ description }}
```

- [ ] **Step 2: Verify the snippet carries both Jinja hooks and aligns with the agent**

Run:
```bash
cd /home/marc-antoine/Desktop/awok && python3 - <<'PY'
import pathlib
s = pathlib.Path("src/workflow/templates/invocations/completeness-critic.md").read_text()
assert "agent: completeness-critic" in s
assert "generated: false" in s
assert "{{ inputs_outputs_compact }}" in s
assert "**Task**: {{ description }}" in s
assert "THOROUGHLY" in s   # short description aligned with the agent's intent
print("OK: snippet hooks + alignment present")
PY
```
Expected: `OK: snippet hooks + alignment present` (exit 0).

- [ ] **Step 3: Commit**

```bash
cd /home/marc-antoine/Desktop/awok
git add src/workflow/templates/invocations/completeness-critic.md
git commit -m "feat(completeness-critic): invocation snippet (description-driven rigor bar)"
```

---

### Task 3: End-to-end render check in a throwaway `--workdir`

Proves the whole wiring generates correctly WITHOUT polluting the engine repo, and exercises the exact content-workdir path the user will use in a real workflow.

**Files:**
- Create (temp, discarded): `/tmp/claude-1000/-home-marc-antoine-Desktop-awok/ef00c539-13ac-4481-817b-f792e9a15c6f/scratchpad/critic-smoke/` workdir
- Uses: `src/agents/completeness-critic.md` (Task 1), the snippet (Task 2)

**Interfaces:**
- Consumes: the agent + snippet.
- Produces: a passing assertion that the generated `SKILL.md` contains the description-as-Task, the path-override input under `Reads :`, and the gate routing prose. Nothing persists in the engine repo.

- [ ] **Step 1: Scaffold the throwaway workdir and mirror the agent + snippet**

```bash
SMOKE=/tmp/claude-1000/-home-marc-antoine-Desktop-awok/ef00c539-13ac-4481-817b-f792e9a15c6f/scratchpad/critic-smoke
rm -rf "$SMOKE"
cd /home/marc-antoine/Desktop/awok
awok init --workdir "$SMOKE"
mkdir -p "$SMOKE/src/agents" "$SMOKE/src/workflow/templates/invocations" "$SMOKE/src/workflows"
cp src/agents/completeness-critic.md "$SMOKE/src/agents/"
cp src/workflow/templates/invocations/completeness-critic.md "$SMOKE/src/workflow/templates/invocations/"
```
Expected: `awok init` reports scaffold done; copies succeed.

- [ ] **Step 2: Write the smoke workflow (hunt script → critic → gate)**

Create `$SMOKE/src/workflows/critic-smoke.yaml`:
```yaml
schema_version: 1
skill:
  name: critic-smoke
  description: |
    Smoke test for the completeness-critic wiring (fake hunt -> critic -> gate).
namespaces: { work: work/critic-smoke }
groups:
  hunt: { description: "Fake hunt + completeness gate" }
phases:
  - id: P1-HUNT
    name: Fake hunt
    group: hunt
    type: script
    cmd: |
      mkdir -p work/critic-smoke
      echo "# findings draft (stub)" > work/critic-smoke/findings-draft.md
      : > work/critic-smoke/attempt-log.md
    outputs:
      - { role: work:findings-draft, kind: md }
      - { role: work:attempt-log, kind: md }
  - id: P1C-COMPLETE
    name: Completeness critic
    group: hunt
    type: agent
    depends_on: [P1-HUNT]
    invocations:
      - agent: completeness-critic
        model: sonnet
        description: >
          stage=smoke · frame=hunt · cap=3. Substrate = attempt-log + findings-draft; if the log is
          absent AND no stop-claim, return INCONCLUSIVE STOP=no-substrate. A guide is at ssti-guide
          input: hold the work to it. Read your prior ledger; pass = lines + 1; fail-safe PROCEED at cap.
        inputs:
          - { role: work:findings-draft, kind: md }
          - { role: work:attempt-log, kind: md, optional: true }
          - { path: "refs/ssti-guide.md", kind: md, optional: true, external: true }
        outputs:
          - { role: work:gaps, kind: md, terminal: true }
          - { role: work:ledger, kind: jsonl, terminal: true }
  - id: P1G-GATE
    name: Route on the completeness verdict
    group: hunt
    type: main_agent
    depends_on: [P1C-COMPLETE]
    description: >
      PURE ROUTING — read only the critic's one-line token. On DIR=RE-DISPATCH and ATTEMPT<cap,
      re-launch P1-HUNT via the Task tool with the GAPS path appended; on PROCEED / cap / unparseable,
      advance. Keep no counter of your own; the ledger file is the source of truth.
```

- [ ] **Step 3: Validate — must be green**

Run:
```bash
SMOKE=/tmp/claude-1000/-home-marc-antoine-Desktop-awok/ef00c539-13ac-4481-817b-f792e9a15c6f/scratchpad/critic-smoke
cd /home/marc-antoine/Desktop/awok
awok --workdir "$SMOKE" validate --workflow critic-smoke
```
Expected: validation passes (exit 0), no schema error. (A dataflow note about `work:gaps`/`work:ledger` is suppressed by `terminal: true`; `attempt-log` has a producer via P1-HUNT.)

- [ ] **Step 4: Generate and assert the SKILL.md rendered the three things**

Run:
```bash
SMOKE=/tmp/claude-1000/-home-marc-antoine-Desktop-awok/ef00c539-13ac-4481-817b-f792e9a15c6f/scratchpad/critic-smoke
cd /home/marc-antoine/Desktop/awok
awok --workdir "$SMOKE" generate --workflow critic-smoke
python3 - "$SMOKE" <<'PY'
import pathlib, sys
skill = pathlib.Path(sys.argv[1], "src/skills/critic-smoke/SKILL.md").read_text()
# (a) per-invocation description rendered as the critic's Task ({{ description }} hook)
assert "stage=smoke" in skill and "frame=hunt" in skill, "description not rendered as Task"
# (b) path-override skill input rendered under a Reads line ({{ inputs_outputs_compact }})
assert "refs/ssti-guide.md" in skill, "path-override input not rendered"
# (c) the gate's routing prose rendered verbatim
assert "PURE ROUTING" in skill and "ledger file is the source of truth" in skill, "gate prose missing"
print("OK: description-as-Task + skill input + gate prose all render")
PY
```
Expected: `OK: description-as-Task + skill input + gate prose all render` (exit 0).

- [ ] **Step 5: Discard the throwaway workdir**

```bash
rm -rf /tmp/claude-1000/-home-marc-antoine-Desktop-awok/ef00c539-13ac-4481-817b-f792e9a15c6f/scratchpad/critic-smoke
```
Expected: removed; nothing changed under `src/` of the engine repo (confirm with `git status --short src/` → only Task 1 & 2 files, already committed).

- [ ] **Step 6: Commit (if any tracked artifact changed — normally nothing to commit here)**

The smoke test writes only under the throwaway workdir, so there is usually nothing to commit. If `git status` shows an unexpected engine-repo change, investigate before committing.

---

### Task 4: Deploy the shared agent

**Files:**
- Modify (deploy target): `~/.claude/agents/completeness-critic.md` (written by `install.sh`)

**Interfaces:**
- Consumes: the committed agent + snippet.
- Produces: the agent available at runtime to any SKILL.md that references it.

- [ ] **Step 1: Deploy**

```bash
cd /home/marc-antoine/Desktop/awok
./install.sh
```
Expected: install reports skills/agents deployed to `~/.claude/`.

- [ ] **Step 2: Confirm the deployed agent is faithful**

Run:
```bash
python3 - <<'PY'
import yaml, pathlib
raw = pathlib.Path.home().joinpath(".claude/agents/completeness-critic.md").read_text()
fm = yaml.safe_load(raw.split("---\n",2)[1])
assert fm["name"] == "completeness-critic"
assert fm["model"] == "inherit"          # NOT materialized to a fixed model here (no effort pinned)
print("OK: deployed agent present and model: inherit")
PY
```
Expected: `OK: deployed agent present and model: inherit`. Restart Claude Code so the new agent registers.

---

### Task 5 (acceptance — real workflow, user-driven, likely a separate session)

Not automatable here: it needs a real target and lives in the user's content workdir. Wire the critic + gate into ONE chosen small workflow and run one real loop.

**Files (in the chosen content workdir, e.g. BountyTemplate):**
- Copy: `completeness-critic.md` + its snippet into that workdir's `src/agents/` + `src/workflow/templates/invocations/` (content workdirs resolve agents locally).
- Modify: the target workflow YAML — add the watched-phase logging line, the critic phase, the gate phase (template: spec §11).

- [ ] **Step 1:** In the target workdir, mirror the agent + snippet (same two files from Tasks 1–2).
- [ ] **Step 2:** Via `/edit-workflow`, add to the watched phase's `description` the launch-time logging line ("Log every attempt AND abandonment to `work/<ns>/attempt-log.md` — append-only"), then add the critic phase and the `main_agent` gate phase, following the spec §11 sketch. Set `stage`, `frame`, `cap=3` in the critic's `description`; attach any skill/reference input (couche 3) only if that placement needs depth.
- [ ] **Step 3:** `awok --workdir <DIR> validate && awok --workdir <DIR> generate && awok deploy --workdir <DIR>`. Expected: green; the generated SKILL.md shows the critic Task + gate routing prose.
- [ ] **Step 4:** Run the workflow on a real target and confirm the two acceptance behaviors: (a) an early-stop is caught (critic returns INSUFFICIENT/INCONCLUSIVE, the gate re-dispatches with the gaps path); (b) genuinely-sufficient work returns SUFFICIENT and does NOT loop. Sanity-check the `ledger.jsonl` pass counter increments and the cap fail-safe fires.

---

## Self-Review

**Spec coverage:** §3 attempt-log substrate → Task 1 §2/§3 + Task 3 smoke wiring (log injected via watched-phase description → Task 5 Step 2). §4 four layers → Task 1 §5 (posture body), snippet `{{ description }}` (Task 2), path-override skill input (Task 3 Step 2, Task 5 Step 2). §5 engine (2 forward phases, prose loop) → Task 3 workflow + Task 5. §6 token → Task 1 §8(a). §7 ledger+gaps → Task 1 §8(b/c). §8 agent body → Task 1 Step 1. §9 snippet → Task 2. §10 gate → Task 3 Step 2 / Task 5 Step 2. §11 YAML → Task 3 / Task 5. §12 decisions (log-injected, posture, re-loop watched, flat cap) → embedded in the agent body + gate prose. Deployment → Task 4. No spec section left without a task.

**Placeholder scan:** none — the agent body, snippet, smoke YAML and all assertions are given verbatim. Task 5 is deliberately manual (real target, separate repo) and says so explicitly rather than faking a test.

**Type consistency:** the output token string is identical in Task 1 §8(a), the spec §6, and asserted markers in Task 1 Step 2 / Task 3 Step 4. Agent name `completeness-critic`, roles `work:findings-draft` / `work:attempt-log` / `work:gaps` / `work:ledger`, and the `{{ description }}` / `{{ inputs_outputs_compact }}` hooks are used consistently across Tasks 1–3.

---

## Post-review refinements (applied after the whole-branch review)

The final whole-branch review returned **Ready to merge** with no Critical/Important findings. Two
Minor hardenings were applied to the committed agent (so `src/agents/completeness-critic.md` now
intentionally exceeds Task 1 Step 1's verbatim block), mirrored into the spec §6/§7:
1. **Token-field independence** (agent §8a + spec §6): STATUS/DIR/STOP are independent — a terminal
   STOP overrides DIR, so a HUNT that caps out with open gaps keeps STATUS=INSUFFICIENT while
   DIR=PROCEED; the gate routes on DIR, not STATUS.
2. **Append-only ledger via read-modify-write** (agent §8b + spec §7): the critic has only `Write`,
   so "append" = read the full prior ledger and rewrite it with all prior lines + the new one; a
   truncated ledger would reset the pass counter and could evade the cap (the only hard bound).

A third Minor (the "owner"/"HANDOFF" vocabulary leaning on the deferred owner-map, §14) was
**accepted as-is**: it degrades harmlessly in a single-owner small workflow and the mandate/HANDOFF
clause is a useful false-positive filter (do not loop the watched agent for out-of-mandate classes).
