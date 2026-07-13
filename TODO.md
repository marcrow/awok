# awok — TODO / features to integrate

> Shared project tracking file. Source of truth for the awok backlog.
> Created 2026-07-13. Check items off as you go; keep each item's context so it stays
> actionable after a `/clear`.

## Sequencing (intended order)

1. **Handle the pending PR first**, then the **effort/frontmatter audit** — do both together,
   because the PR likely touches the same area (doing the audit after the PR is in hand avoids
   stepping on each other). → items [A1] then [A2].
2. Then the orchestration follow-ups (dynamic workflows, web UI blocks, create/doctor/edit).
3. Security and web UI cleanup in parallel where it fits.

---

## A. Priority (PR + effort)

- [ ] **A1 — Handle/integrate the pending pull request.**
  _To specify: PR number / branch / author._ The PR is likely affected by A2 (effort) → handle
  A1 before A2, then do A2 with the PR taken into account.

- [ ] **A2 — Audit the effort model (invocation vs agent frontmatter).**
  `effort` is set **per invocation** in `workflow.yaml`, but `awok deploy` **materializes** it
  into the **deployed** agent's frontmatter (`~/.claude/agents/<name>.md`), because the `Task`
  tool has no `effort` argument. Consequence: an agent **shared** across several workflows with
  different efforts → **the last-deployed workflow overwrites** the frontmatter ("last build
  wins"). A "conflict" guard already covers the *same agent, two efforts, within ONE workflow*
  case (warning, injects nothing) — but the **cross-workflow** case is not covered. Audit and
  decide (namespace the deployed agent per workflow? forbid divergent efforts on a shared agent?
  something else?). Ref: CLAUDE.md § "effort: per-invocation".

---

## B. Orchestration follow-ups (feature shipped 2026-07-13)

> The "standard target" orchestration is shipped on `feat/portes-logiques-orchestration`
> (logic gates + `<name>.orchestration.yaml` + `emits` signals + cartography). These items
> follow directly from it.

- [ ] **B1 — Dynamic workflows (JS compiler).** The `js` target of the same orchestration model.
  `validate_orchestration(target="js")` is **already ready** to reject standard-only bricks
  (file_exists/dir_exists, escape-hatch). Direct logical follow-up (proposed by Claude).
  Ref: plan § "Suivis hors de ce plan" item 1.

- [ ] **B2 — Web UI: editing condition blocks.** Integrate editing of orchestration blocks
  (if / while / until / for_each / parallel) + "expose a signal" when placing a condition.
  Direct follow-up of the changes we just made.
  _To specify: re-check the "few forgotten points" vs the integrated changes._

- [ ] **B3 — create-workflow: orchestration + dynamic.** Have it brainstorm/scaffold an
  orchestration, expose signals, and **read `orchestration-capabilities.yaml`** for guidance
  (the capability file was designed to be consumed "later" by create-workflow). Then the changes
  tied to **dynamic workflow** usage (depends on B1).

- [ ] **B4 — workflow-doctor: audit an orchestration.** Today it does **not** audit an
  orchestration file. To add: flag "conditional-in-the-prompt = stale orchestration", flag
  best-effort overuse, flag escaped logic (escape-hatch), and check signal↔condition seams +
  the mandatory `cap`.
  Ref: plan § "Suivis hors de ce plan" item 3.

- [ ] **B5 — edit-workflow: orchestration-aware.** Reason about orchestration seams when editing
  a workflow (currently blind to the orchestration layer).

> Note: B3/B4/B5 = the 3 meta-workflows **untouched** by the orchestration work (their SKILL.md
> are byte-identical, `awok check` green) — they work but are not orchestration-aware.

---

## C. Web UI (workflow editor)

- [ ] **C1 — Improve the web editor** (from the README TBD, partially done). Remaining:
  - Make the **prompt visualization** of invoked agents more **user-friendly** in the
    **first tab**.
  - _To specify: other remaining web UI changes._
- [x] **C2 — fix invocation file in web UI.** ✅ Done (removed from TBD).

---

## D. awok model / conventions

- [ ] **D1 — Ban multi-agent action blocks.** An action block (`phase`) can currently hold
  **several invocations** (`invocations: [ ... ]`, multiple agents). Leaning decision: **forbid
  it** — 1 block = 1 action = 1 agent. Rationale: multi-agent within a block causes problems
  down the line, hurts readability, and runs counter to what awok is meant to offer. Needs
  thought, but the leaning is to ban (blocking validation + migration of existing workflows that
  use it). **Aligns with the target vocabulary** ("an action is a single unit, no intra-action
  ordering" → see D2).

- [ ] **D2 — Vocabulary migration action/stage/group** (Palier 1 doc done). Remaining:
  Palier 2 (retire inert fields) + Palier 3 (rename `phase`→`action`).
  Ref: memory `awok-vocab-migration`. Overlaps with D1.

---

## E. Security

- [ ] **E1 — Security review of the application** (from the README TBD). Not done yet.
  Security review of the app **and of `awok edit`** (the web editor service). Current rule:
  **do not expose the `awok edit` service.**
