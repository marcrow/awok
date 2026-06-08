# Run isolation — a convention, not a flag

## The problem

A workflow's namespace is fixed: `namespaces: { work: work/<name> }`. So **every run
writes to the same `work/<name>/` tree and overwrites the previous one** — and a
workflow that audits/processes a *target* (e.g. `workflow-doctor`) clobbers its own
prior output when pointed at a second target. (Observed: `workflow-doctor`'s `onboard`
diagnosis was overwritten by its `create-workflow` diagnosis.)

## Why this is a convention, not an engine flag

awok **compiles, it does not execute** — the concrete `work/<name>/…` paths are
**baked into the SKILL.md at `generate` time**. A generic `run_isolation: true` flag
that just injects a "use a fresh run dir" instruction is **leaky**: it cannot reach
*inside* a `type: script` phase whose `cmd` reads a baked path. For example
`create-workflow`'s `S6-GENERATE` runs `… < work/create-workflow/new-name.txt`, and
`onboard`'s git-stats script writes `work/onboard/git-stats.md` — neither knows a
run-id the engine invented in a preamble. So run isolation has to be expressed **by the
workflow itself**, where its scripts and prose can all agree on the run directory.

## The convention

Scope work outputs under a **run/target id computed in the workflow's first phase**,
and have every later phase (prose *and* scripts) write under it:

1. The first phase asks for / derives the run id (the target's name, or a timestamp)
   and writes it somewhere deterministic, e.g. `work/<name>/target.txt`.
2. Scripts read it and build their paths from it:
   ```bash
   TARGET="$(tr -d '[:space:]' < work/<name>/target.txt)"
   RUN_DIR="work/<name>/$TARGET"; mkdir -p "$RUN_DIR"
   # … write everything under "$RUN_DIR/…"
   ```
3. Agent/main_agent phases are told (in their prose) to read/write under
   `work/<name>/<run-id>/…`.

The result: `work/<name>/onboard/…`, `work/<name>/create-workflow/…`, etc. — runs no
longer clobber, and the diff between two runs is a directory comparison.

## Exemplar: `workflow-doctor`

`workflow-doctor` already implements this. Its `D0-GATE` writes the audited workflow's
name to `work/doctor2/target.txt`; the deterministic pre-scan and every auditor write
under `work/doctor2/<target>/…`. Pointing it at `onboard` then `create-workflow`
produces `work/doctor2/onboard/…` and `work/doctor2/create_workflow/…` side by side —
no clobber, and a clean A/B.

## When you don't need it

A workflow run once per target context (e.g. `onboard` on one repo at a time) is fine
without it — re-running just refreshes the report in place, which is usually what you
want. Reach for the convention when you re-run across **targets you want to keep** or
when you're A/B-comparing runs.
