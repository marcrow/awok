# create-workflow — v1.2 backlog

> Running list of improvements found while dogfooding create-workflow (v1.1) to
> build `workflow-doctor` (v0) then `doctor2` (v1.1). Batched after the A/B run.
> Status: **A (A1–A5) + B (B1–B4) — v1.2.** **C2 (interactive checkpoint) shipped as an
> engine phase field; C1 (run isolation) shipped as a convention — see
> `docs/dev/run-isolation.md` (a generic flag is leaky: awok bakes `work/` paths into
> `type:script` cmds at generate). All cleared; only the empirical re-dogfood remains.**

## A. Brainstorm UX (the heart — highest priority)

The v1.1 mandatory floor fixed the *content* failure (it now genuinely pushes,
generates, and challenges). But it over-corrected on *pacing*: it pushes hard but
does not **stop and wait** for the maintainer, and it dumps too much per message.

| # | Item | Evidence |
|---|---|---|
| **A1** | **Wait-gates / no decide-and-advance.** One prompt or one artifact → **STOP → wait** for the maintainer. Never cross a movement, never decide on their behalf. "OK?" must mean *actually wait for the OK* (observed: it asked "OK?" then immediately advanced to S3 and deferred a sub-decision unilaterally). | confirmed 3× |
| **A2** | **Density.** One thing per message. Never dump 3 forms + 4 agents + a pivot question at once — the maintainer had to re-read twice and only understood while answering. | run v1.1 |
| **A3** | **Decompose S2 into 3 coarse movements** — *diverge/frame → challenge → converge/name* — to create hard stop-boundaries AND fix "adversarial too early" (firing the panel during generation violates the diverge/converge firewall). NOT fine technique-phases (that makes it mechanical and kills the adaptive double-diamond). | maintainer |
| **A4** | **Mermaid HTML: reuse awok's HTML style/wrapper** (`html-wrapper.html`) for the `dag-alternatives.html` so it matches the generated cartography visually. | maintainer |
| **A5** | **Mermaid HTML: richer per-node action explanations, ideally on hover (tooltip).** The feature is genuinely useful; the node notes are too terse. | maintainer |

A1+A2 are the same root ("one thing → wait"); A3 reinforces it structurally.

## B. create-workflow content fixes (from the v0 doctor's audit of create-workflow)

Orthogonal to the brainstorm; do NOT confound the A/B (target for the A/B = onboard).

- **B1** — `workflow-scout` (S4) and `skill-reviewer` (S7) read `src/agents/` but don't
  declare it → add `{ path: "src/agents/", kind: dir, external: true }` inputs.
- **B2** — trim `Grep`+`Glob` from the 4 panel agents (premortem, devils-advocate,
  rolestormer, cross-pollinator) — never exercised (tool-overbroad).
- **B3** — `tessl-review.md` hardcodes `/abs/path/to/src/skills/<name>` in its bash →
  use `$SKILL_DIR`/`realpath`.
- **B4** — SKILL.md leaks an untranslated FR fragment `→ éclair build-vs-borrow scout`
  in `opportunistic.examples`.

## C. Engine-level chantiers (separate from create-workflow content)

- **C1 — Run isolation.** `work/<name>/` is fixed → re-running a workflow (or auditing a
  second target) clobbers the prior run. Confirmed: workflow-doctor's onboard diagnosis
  was overwritten by its create-workflow diagnosis. Direction: scope outputs by
  target/run (`work/<name>/<target|run-id>/`). Note: the v1.1 create-workflow run already
  did this *spontaneously* (`work/create-workflow/doctor2/`) — worth making a convention.
- **C2 — Interactive checkpoint.** awok is fire-and-forget DAG; it has no native "await
  human" gate. The brainstorm is the one place that needs one. Consider an explicit
  `interactive`/`await` marker that renders as a hard STOP instruction (reinforces A1).
