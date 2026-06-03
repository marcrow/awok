<p align="center">
  <img src="assets/awok-mascot.png" alt="awok mascot" width="200">
</p>

<h1 align="center">awok — Agentic Workflow Orchestration Kompiler</h1>

Multi-agent workflows rot fast. You wire up a pipeline of sub-agents by hand —
one prompt here, a near-identical one there, the I/O contract living only in your
head — and within a week the prompts have drifted apart, nobody can see the whole
DAG anymore, and changing one phase means hunting through half a dozen files
hoping you caught them all.

**awok fixes that by making the workflow a single source of truth.** You describe
a pipeline once in YAML — its phases, the agents each one calls, what flows in and
out — and awok *compiles* it into the artifacts that drive it:

- a Claude Code `SKILL.md` the orchestrator invokes as `/<name>`,
- an offline HTML + ASCII **cartography** of the whole DAG (Mermaid, dataflow,
  on-demand agents), and
- an index of every workflow you've defined.

Crucially, awok **compiles — it does not execute.** The generated skill is run by
Claude Code (a main agent plus Task sub-agents) with a human in the loop. That
compile-only stance is what separates awok from execution engines like CrewAI,
Dagster, Dify or GitHub Actions: one YAML to edit, `awok check` to catch drift
before it ships, and a diagram you can actually read.

## Layout

| Path | Role |
|---|---|
| `src/scripts/bb-workflow` | the compiler + local web editor (`awok edit`) |
| `src/workflows/*.yaml` | **source of truth** — one file per workflow |
| `src/workflow/` | Jinja templates, JSON schema, web-editor front-end, manual sections |
| `src/agents/*.md` | agent definitions (system prompts) |
| `src/skills/<name>/SKILL.md` | **generated** — never edit by hand |
| `docs/architecture-cartography/` | **generated** HTML/ASCII cartography |
| `docs/dev/bb-workflow.md` | user guide |
| `CLAUDE.md` | development guide (was `CLAUDE-DEV.md`) |

The bundled `demo` workflow (`src/workflows/demo.yaml`) is a minimal,
domain-neutral example — a 2-phase `collector → summarizer` pipeline — that
doubles as a test fixture.

## Install (from scratch)

```bash
git clone <repo> awok && cd awok
./install.sh
# → creates .venv, installs deps, links `awok` into ~/.local/bin
awok validate
```

Requires Python 3 (deps: PyYAML, Jinja2, jsonschema — installed into a dedicated
`.venv` by `install.sh`, nothing touches system Python). Override interpreter or
bin dir: `PYTHON=python3.12 AWOK_BIN=~/bin ./install.sh`.

## Commands

```bash
awok validate      # schema + coherence + dataflow warnings
awok generate      # regenerate SKILL.md + cartography + index
awok check         # drift check (pre-commit gate)
awok edit          # local web editor (127.0.0.1)
```

(`bb-workflow` is installed as an alias of `awok` for backward compatibility.)

## Tests

```bash
python -m pytest src/scripts/tests/        # Python (compiler)
cd src/scripts/tests/webedit && bun test   # front-end (after `bun install`)
```

## TBD

Security review -> So you should not exposed the awok edit service.
Improve the WebUI workflow editor.
