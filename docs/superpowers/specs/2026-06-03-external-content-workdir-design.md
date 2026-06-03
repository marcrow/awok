# External content workdir — engine/content root split

**Date:** 2026-06-03
**Status:** design approved (brainstormed with the maintainer)
**Goal:** let awok compile + deploy workflows that live in a **separate (private)
repo**, reusing this repo's engine. A `--workdir DIR` flag points awok at a
content root that holds its own `workflows/ + agents/`, while the Jinja templates
and JSON schema stay shared from the installed engine. No fork, no gitignore
juggling, no name leaks into the public repo.

## Two roots

- **ENGINE_ROOT** — the installed awok repo. Owns the engine: `src/scripts/bb-workflow`,
  `src/workflow/templates/*.jinja`, `html-wrapper.html`, webedit, vendored JS libs,
  and `src/workflow/workflow.schema.json`. Resolved exactly as today
  (`$BB_WORKFLOW_REPO` → walk up CWD for `src/workflow/workflow.schema.json` →
  `Path(__file__).parents[2]`).
- **CONTENT_ROOT** — the workdir (`--workdir` / `$AWOK_WORKDIR`). **Defaults to
  ENGINE_ROOT**, so with no flag every path and output is byte-identical to today.
  Owns content: `src/workflows/`, `src/agents/`, `src/workflow/templates/invocations/`,
  `src/workflow/manual/`, and the generated `src/skills/` + `docs/architecture-cartography/`.

Layout decision: a content workdir **mirrors `src/`** — it is "an awok repo minus
the engine." Agents/snippets are **self-sufficient**: they resolve *only* from
CONTENT_ROOT (no fallback to engine agents), which keeps the resolver simple.

## Resolution map

| From ENGINE_ROOT | From CONTENT_ROOT |
|---|---|
| `src/workflow/templates/*.jinja` (skill-skeleton, cartography, dataflow, on-demand, texte) | `src/workflows/` (`DEFAULT_WORKFLOWS_DIR`, `discover_workflows`, `resolve_workflow`) |
| `src/workflow/workflow.schema.json` (`DEFAULT_SCHEMA_PATH`) | `src/agents/` (`DEFAULT_AGENTS_DIR`) |
| `html-wrapper.html`, webedit assets, cached mermaid/panzoom/marked libs | `src/workflow/templates/invocations/` (`DEFAULT_INVOCATIONS_DIR`) |
| | `src/workflow/manual/` (manual_sections `ms["path"]`) |
| | generated `src/skills/<name>/SKILL.md` (`workflow_output_paths`) |
| | `docs/architecture-cartography/` + `index.html` |

Precedence for CONTENT_ROOT: `--workdir` flag > `$AWOK_WORKDIR` > ENGINE_ROOT.
`$BB_WORKFLOW_REPO` keeps overriding ENGINE_ROOT only (rarely needed).

## Implementation shape

- Introduce module globals `ENGINE_ROOT` and `CONTENT_ROOT` plus `_apply_roots(engine, content)`
  that (re)derives every dependent path constant (`DEFAULT_WORKFLOWS_DIR`,
  `DEFAULT_AGENTS_DIR`, `DEFAULT_INVOCATIONS_DIR`, `DEFAULT_SCHEMA_PATH`,
  `LEGACY_WORKFLOW_PATH`).
- Call `_apply_roots()` at import (defaults: content = engine) and again in `main()`
  after parsing the global `--workdir`, **before** dispatching `args.func`. Functions
  read these globals at call time, so reassignment takes effect.
- Replace the ~20 `REPO_ROOT_GUESS / …` sites: templates(jinja) + schema → `ENGINE_ROOT`;
  workflows, agents, invocations, manual, skills, cartography, index → `CONTENT_ROOT`.
  (`REPO_ROOT_GUESS` stays as an alias of `ENGINE_ROOT` for back-compat.)

## CLI surface

Global `--workdir DIR` on the top-level parser; honoured by `validate`, `generate`,
`check`, `edit`.

- **`awok init [--workdir DIR]`** — scaffold a content workdir, idempotent
  (creates only what is missing, never overwrites): the mirror dirs
  (`src/workflows`, `src/agents`, `src/workflow/templates/invocations`,
  `src/workflow/manual`, `src/skills`, `docs/architecture-cartography`), a `.gitignore`
  (ignore `work/`), and a minimal example workflow (`example.yaml` + one agent +
  its snippet) so `generate` works immediately.
- **`awok deploy [--workdir DIR]`** — copy `CONTENT_ROOT/src/skills/*` → `~/.claude/skills/`
  and `CONTENT_ROOT/src/agents/*` → `~/.claude/agents/` (additive, like `install.sh`,
  honours `$CLAUDE_HOME`). `install.sh` stays the one-time engine setup (and still
  deploys the engine repo's own skills/agents).

## Errors / first run

- `--workdir` with no `src/workflows/` → exit 1 with a message pointing to `awok init`.
- `generate` creates missing *output* dirs (`src/skills/`, cartography) but does not
  invent a workflows dir.
- A workflow referencing an agent absent from `CONTENT_ROOT/src/agents/` fails coherence
  validation with a clear "agent not found in <workdir>" message (self-sufficient rule).

## Docs to update

- **CLAUDE.md** — new "Engine vs content root" section: the resolution table,
  `--workdir`/`AWOK_WORKDIR`, `awok init`, `awok deploy`.
- **README.md** — a "Private / external workflows" section showing the
  `init → generate → deploy` loop against a separate repo.
- **docs/dev/bb-workflow.md** — document the flag, precedence, and resolution map.

## Tests

- Resolution: with no `--workdir`, all paths equal today's (regression guard);
  with `--workdir`, content paths move, templates/schema stay on engine.
- `init`: scaffolds a fresh dir; re-running on an existing dir is a no-op (no clobber).
- `generate` into a tmp workdir: succeeds with a self-sufficient agent; fails clearly
  when the agent is missing from the workdir.
- `deploy`: copies the workdir's skills/agents into a tmp `$CLAUDE_HOME`.

## Out of scope

- Engine-fallback for shared agents (rejected: workdir is self-sufficient).
- Flat workdir layout (rejected: mirror `src/` keeps the resolver uniform).
- `workflow_call` across workdirs.
