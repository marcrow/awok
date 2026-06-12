---
name: workflow-doctor
description: |
  Statically audit an existing awok workflow to tell whether it is well-built:
  every agent well-written and well-scoped, the producer→consumer seams holding
  semantically, and the declared YAML I/O coherent with the agents' hand-written
  prose. A precondition gate assumes `awok validate` is green; a deterministic
  pre-scan gates an LLM audit (drift / load-path continuity / agent fitness) so the
  criticality verdict only escalates where a cheap signal already fired. Use it to
  health-check a workflow (dev or pentest) before you trust it — non-decidable
  issues surface as questions, not verdicts.

---

# /workflow-doctor — static workflow health-check

> ⚠️ This file is **GENERATED** from `src/workflows/workflow-doctor.yaml`.
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

Pipeline of 9 phases, organized into 4 groups:
`gate` (Precondition — refuse to run on a workflow that is not validate-green), `observe` (Honest extraction of observed I/O + a cheap deterministic pre-scan), `audit` (The three concern auditors (drift, load-path continuity, fitness)), `reduce` (Synthesis, triage, adversarial recheck and handoff).

---

## 🧭 Opportunistic autonomy

This workflow permits **scoped improvisation**. Beyond the planned work, you (the
orchestrator) may **author and launch an ad-hoc sub-agent** whenever you spot a
signal the planned agents do not cover.

- **How**: the `Task` tool, `subagent_type: general-purpose` (or `Explore`), with a
  prompt you write yourself from context. These agents do not exist in
  `src/agents/` — you create them on the fly.
- **When**: An auditor surfaces a class of problem outside the three planned concerns (drift / continuity / fitness) that still bears on whether the workflow is well-built.
- **Mode**: usually in the **background**, unless the result is needed to continue the current phase.
- **Nesting limit**: a sub-agent cannot itself spawn sub-agents (max depth = 1). After reading the planned sub-agent's report, it is up to you to launch the follow-up.
- **Scope**: all phases, except those marked ⛔.
- **Examples**: target hard-codes a path no phase produces → ad-hoc producer check; an agent's tools imply a side effect the DAG never declares → ad-hoc trace

---

## Pipeline phases (DAG)

### D0-GATE — Precondition gate
> `gate` · script
Ask the maintainer which workflow to audit and write its name (one slug) to work/workflow-doctor/target.txt. Then run `awok validate` on it: workflow-doctor assumes a green validate and will NOT re-report any finding class validate already owns (schema, cycles, dataflow orphans). If validate is not green, STOP — fix the structural errors first, then re-run workflow-doctor.

```bash
mkdir -p work/workflow-doctor
TARGET="$(tr -d '[:space:]' < work/workflow-doctor/target.txt 2>/dev/null)"
if [ -z "$TARGET" ]; then
  echo "STOP: write the target workflow name to work/workflow-doctor/target.txt, then re-run."
  exit 1
fi
echo "workflow-doctor precondition gate — target: $TARGET"
if awok validate "$TARGET"; then
  echo "GATE: validate green → proceed."
else
  echo "GATE: validate NOT green → STOP. workflow-doctor assumes a green validate; fix schema/dataflow first."
  exit 1
fi

```



### D1-EXTRACT — Extract observed I/O (blind to declared)
> `observe` · agent · ⇐ D0-GATE · ∥ D2-MISMATCH, D5-FITNESS

#### Invocation `prose-io-reader`


**prose-io-reader** [sonnet] · Extracts each target agent's observed I/O from its prose, blind to the declared YAML.
- Reads : `.` (dir) → .
- Writes : `work:observed-io` (json) → work/workflow-doctor/observed-io.json

**Task**: For each agent in the workflow named in `work/workflow-doctor/target.txt`, read ONLY
its body prose and its hand-written Task sentence (never the YAML, never the templated
I/O block) and record what it actually reads/writes, with short evidence quotes and an
`uncertain` list where the prose is vague. Observations, never verdicts.

> ⚙️ **Run on `sonnet`** — launch via the `Task` tool with `model: sonnet` (not inherited from the session model).



### D2-MISMATCH — Deterministic mismatch pre-scan
> `observe` · script · ⇐ D0-GATE · ∥ D1-EXTRACT, D5-FITNESS
Cheap, no-LLM parse of the target: (a) roles named in an agent's prose but absent from its declared I/O (decidable drift), and (b) producer→consumer seams whose declared role/kind do not line up. These signals GATE the criticality of the downstream semantic audit (a deep finding may only escalate to CRITICAL on a seam this scan already flagged).

```bash
mkdir -p work/workflow-doctor
TARGET="$(tr -d '[:space:]' < work/workflow-doctor/target.txt 2>/dev/null)"
python3 - "$TARGET" <<'PY'
import json, os, re, sys
target = sys.argv[1] if len(sys.argv) > 1 else ""
yaml_path = f"src/workflows/{target}.yaml"
out = {"target": target, "decidable_drift": [], "seam_mismatch": [], "notes": []}
try:
    import yaml  # awok dependency; may be absent in a bare shell
    doc = yaml.safe_load(open(yaml_path))
except Exception as e:
    out["notes"].append(f"deterministic prescan degraded (no yaml / unreadable: {e}); "
                        "downstream auditors must treat all seams as ungated.")
    json.dump(out, open("work/workflow-doctor/mismatch-signals.json", "w"), indent=2)
    print("MM: degraded — wrote notes only"); sys.exit(0)

def roles_of(io):
    rs = []
    for x in (io or []):
        r = x.get("role") or x.get("path")
        if r: rs.append((r, x.get("kind")))
    return rs

agents_dir = "src/agents"
for ph in doc.get("phases", []):
    for inv in ph.get("invocations", []):
        name = inv.get("agent")
        declared = set(r for r, _ in roles_of(inv.get("inputs")) + roles_of(inv.get("outputs")))
        body_path = os.path.join(agents_dir, f"{name}.md")
        if not os.path.exists(body_path):
            continue
        body = open(body_path, encoding="utf-8", errors="ignore").read()
        # (a) role-like tokens (ns:name) mentioned in prose but never declared
        for tok in set(re.findall(r"\b[a-z][a-z0-9-]*:[a-z][a-z0-9-]+\b", body)):
            if tok not in declared:
                out["decidable_drift"].append(
                    {"phase": ph.get("id"), "agent": name, "prose_role": tok,
                     "kind": "role-mentioned-not-declared"})
# (b) seam role/kind: an output role consumed by a later phase whose declared kind differs
produced = {}
for ph in doc.get("phases", []):
    for inv in ph.get("invocations", []):
        for r, k in roles_of(inv.get("outputs")):
            produced[r] = (ph.get("id"), k)
    for r, k in roles_of(ph.get("outputs")):
        produced[r] = (ph.get("id"), k)
for ph in doc.get("phases", []):
    consumes = list(ph.get("inputs") or [])
    for inv in ph.get("invocations", []):
        consumes += list(inv.get("inputs") or [])
    for x in consumes:
        r, k = x.get("role") or x.get("path"), x.get("kind")
        if r in produced and produced[r][1] and k and produced[r][1] != k:
            out["seam_mismatch"].append(
                {"role": r, "producer": produced[r][0], "producer_kind": produced[r][1],
                 "consumer": ph.get("id"), "consumer_kind": k})
json.dump(out, open("work/workflow-doctor/mismatch-signals.json", "w"), indent=2)
print(f"MM: {len(out['decidable_drift'])} decidable-drift, {len(out['seam_mismatch'])} seam-mismatch")
PY

```



### D3-DRIFT — Drift audit (prose vs declared)
> `audit` · agent · ⇐ D1-EXTRACT, D2-MISMATCH · ∥ D4-LOADPATH

#### Invocation `declared-drift-checker`


**declared-drift-checker** [sonnet] · Reconciles observed I/O vs the declared YAML; emits non-decidable drift as questions.
- Reads : `work:observed-io` (json) → work/workflow-doctor/observed-io.json, `work:mismatch-signals` (json) → work/workflow-doctor/mismatch-signals.json, `.` (dir) → .
- Writes : `work:drift-findings` (json) → work/workflow-doctor/drift-findings.json

**Task**: Pass the pre-scan's decidable_drift through unchanged, then judge only the
residue: where an agent's prose works on an artifact it never declares, or declares an
output its prose never produces. Exclude anything `awok validate` owns. Phrase every
non-decidable finding as a question that names the decision it unblocks.

> ⚙️ **Run on `sonnet`** — launch via the `Task` tool with `model: sonnet` (not inherited from the session model).



### D4-LOADPATH — Load-path continuity audit
> `audit` · agent · ⇐ D1-EXTRACT, D2-MISMATCH · ∥ D3-DRIFT

#### Invocation `seam-continuity-tracer`


**seam-continuity-tracer** [opus] · Checks each producer→consumer seam holds semantically; scores criticality, gated by the pre-scan.
- Reads : `work:observed-io` (json) → work/workflow-doctor/observed-io.json, `work:mismatch-signals` (json) → work/workflow-doctor/mismatch-signals.json, `.` (dir) → .
- Writes : `work:loadpath-findings` (json) → work/workflow-doctor/loadpath-findings.json

**Task**: Walk every DAG seam; state what the producer promises vs what the consumer
assumes, and flag capacity mismatches. A semantic mismatch may only be raised as a
QUESTION — it escalates to CRITICAL only on a seam the pre-scan's `seam_mismatch`
already flagged. Name the weakest link that governs the verdict and any single point of
failure.

> ⚙️ **Run on `opus`** — launch via the `Task` tool with `model: opus` (not inherited from the session model).



### D5-FITNESS — Agent fitness / quality audit
> `audit` · agent · ⇐ D0-GATE · ∥ D1-EXTRACT, D2-MISMATCH

#### Invocation `agent-quality-auditor`


**agent-quality-auditor** [sonnet] · Scores each target agent against the embedded best-practices rubric — hard violations only.
- Reads : `.` (dir) → .
- Writes : `work:fitness-findings` (json) → work/workflow-doctor/fitness-findings.json

**Task**: Judge each agent against the rubric in the agent body — emit only HARD
violations (missing required tool, pinned model, description↔body contradiction, no
output contract), cap style notes at a shared top-3 (non-blocking), and never penalize
terseness. Add inter-agent coherence findings. Warn if the engine schema_version exceeds
the rubric's.

> ⚙️ **Run on `sonnet`** — launch via the `Task` tool with `model: sonnet` (not inherited from the session model).



### D6-REDUCE — Reduce / triage / diagnosis
> `reduce` · main_agent · ⇐ D3-DRIFT, D4-LOADPATH, D5-FITNESS
As the orchestrator (you already hold the three auditors' outputs), merge them into one diagnosis. Apply the caps: at most 7 questions total, each naming the specific maintainer decision it unblocks; suppress any question that does not move the criticality score. Compute a weakest-link verdict (the most critical seam/agent governs) and flag single points of failure. Exclude any finding class `awok validate` already owns.




### D7-RECHECK — Adversarial recheck of blockers
> `reduce` · agent · ⇐ D6-REDUCE

#### Invocation `finding-rechecker`


**finding-rechecker** [opus] · Re-examines only the blocking findings with a fresh lens; clears or confirms each before the verdict.
- Reads : `work:diagnosis` (md) → work/workflow-doctor/diagnosis.md, `.` (dir) → .
- Writes : `work:verdict` (md) → work/workflow-doctor/verdict.md

**Task**: Re-derive each blocking finding from the target's own text as if seeing it
fresh, and try to refute it. Mark each CONFIRMED / CLEARED / DOWNGRADED, defaulting to
CLEARED when refutation even partly succeeds. Write the final verdict (HEALTHY /
NEEDS-FIX / BLOCKED) governed by the surviving weakest link, then the questions and
capped style notes.

> ⚙️ **Run on `opus`** — launch via the `Task` tool with `model: opus` (not inherited from the session model).



### D8-HOOK — Scenario-efficacy handoff
> `reduce` · main_agent · ⇐ D7-RECHECK
Close with a short handoff note. workflow-doctor audited STRUCTURE, COORDINATION and agent FITNESS statically — it did NOT test whether the workflow is effective on real cases (awok has no runtime). Real efficacy testing (generated pentest scenarios, simulated runs, web-researched cases) is a heavier, separate future workflow. Point the maintainer to that opening; do not attempt it here.






