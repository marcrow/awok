# External Content Workdir Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--workdir DIR` / `$AWOK_WORKDIR` so awok compiles + deploys workflows that live in a separate (private) repo, reusing this repo's engine (templates + schema).

**Architecture:** Split the single `REPO_ROOT_GUESS` into `ENGINE_ROOT` (templates + schema, resolved as today) and `CONTENT_ROOT` (workflows/agents/outputs, = `--workdir`, defaults to engine). A `_apply_roots()` helper re-derives every path constant; it runs at import (content == engine → identical to today) and again in `main()` once the flag is known. Content paths move to `CONTENT_ROOT`; engine paths stay on `REPO_ROOT_GUESS` (now an alias of `ENGINE_ROOT`). Two new commands — `awok init` (scaffold) and `awok deploy` (copy skills/agents to `~/.claude`).

**Tech Stack:** Single-file Python CLI `src/scripts/bb-workflow` (stdlib + PyYAML + Jinja2 + jsonschema); pytest via the `bbw_module` fixture (importlib-loads the script as a module).

**Spec:** `docs/superpowers/specs/2026-06-03-external-content-workdir-design.md`

**Run pytest with:** `.venv/bin/python -m pytest`. The `awok` CLI is at `~/.local/bin/awok`.

**CRITICAL — module-global hygiene in tests:** `bbw_module` is loaded once per session, so `ENGINE_ROOT` / `CONTENT_ROOT` / the `DEFAULT_*` constants are shared mutable state. Every test that calls `_apply_roots()` with a temp workdir MUST restore the defaults afterward (use the `restore_roots` fixture defined in Task 1 Step 1). A leaked content root breaks later tests like `test_workflow_realfile`.

---

### Task 1: Resolver core — `ENGINE_ROOT`, `CONTENT_ROOT`, `_apply_roots()`

**Files:**
- Modify: `src/scripts/bb-workflow:57-60` (the globals block) and `:381,:383` (standalone `DEFAULT_AGENTS_DIR` / `DEFAULT_INVOCATIONS_DIR`)
- Test: `src/scripts/tests/test_workflow_workdir.py` (new)
- Test fixture: `src/scripts/tests/conftest.py` (add `restore_roots`)

- [ ] **Step 1: Add the `restore_roots` fixture**

In `src/scripts/tests/conftest.py`, append:

```python
import pytest


@pytest.fixture
def restore_roots(bbw_module):
    """Snapshot the module's root globals and restore them after the test.

    Tests that call _apply_roots() with a temp workdir mutate shared module
    state; this puts ENGINE_ROOT/CONTENT_ROOT (and all DEFAULT_* derived from
    them) back to their import-time values so other tests are unaffected.
    """
    eng, content = bbw_module.ENGINE_ROOT, bbw_module.CONTENT_ROOT
    yield
    bbw_module._apply_roots(eng, content)
```

- [ ] **Step 2: Write the failing test**

Create `src/scripts/tests/test_workflow_workdir.py`:

```python
"""Tests for the engine/content root split (--workdir)."""
from pathlib import Path


def test_default_content_equals_engine(bbw_module):
    """With no workdir, content paths sit on the engine root — unchanged behaviour."""
    eng = bbw_module.ENGINE_ROOT
    assert bbw_module.CONTENT_ROOT == eng
    assert bbw_module.DEFAULT_WORKFLOWS_DIR == eng / "src" / "workflows"
    assert bbw_module.DEFAULT_AGENTS_DIR == eng / "src" / "agents"
    assert bbw_module.DEFAULT_INVOCATIONS_DIR == eng / "src" / "workflow" / "templates" / "invocations"
    assert bbw_module.DEFAULT_SCHEMA_PATH == eng / "src" / "workflow" / "workflow.schema.json"
    assert bbw_module.REPO_ROOT_GUESS == eng


def test_apply_roots_splits_engine_and_content(bbw_module, tmp_path, restore_roots):
    """A workdir moves content paths; templates + schema stay on the engine."""
    eng = bbw_module.ENGINE_ROOT
    content = tmp_path / "wd"
    bbw_module._apply_roots(eng, content)
    # content side
    assert bbw_module.DEFAULT_WORKFLOWS_DIR == content / "src" / "workflows"
    assert bbw_module.DEFAULT_AGENTS_DIR == content / "src" / "agents"
    assert bbw_module.DEFAULT_INVOCATIONS_DIR == content / "src" / "workflow" / "templates" / "invocations"
    # engine side — unchanged
    assert bbw_module.DEFAULT_SCHEMA_PATH == eng / "src" / "workflow" / "workflow.schema.json"
    assert bbw_module.REPO_ROOT_GUESS == eng
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'ENGINE_ROOT'` (and `_apply_roots`).

- [ ] **Step 4: Implement the resolver core**

In `src/scripts/bb-workflow`, replace the block at lines 57-60:

```python
REPO_ROOT_GUESS = _find_repo_root()
DEFAULT_WORKFLOWS_DIR = REPO_ROOT_GUESS / "src" / "workflows"
LEGACY_WORKFLOW_PATH = REPO_ROOT_GUESS / "src" / "workflow" / "workflow.yaml"
DEFAULT_SCHEMA_PATH = REPO_ROOT_GUESS / "src" / "workflow" / "workflow.schema.json"
```

with:

```python
def _apply_roots(engine_root: Path, content_root: Path) -> None:
    """(Re)derive every root-dependent path constant.

    ENGINE_ROOT owns the engine (Jinja templates + JSON schema); CONTENT_ROOT
    owns the workflows/agents and all generated outputs. Called at import
    (content == engine, i.e. identical to today) and again in main() once
    --workdir / $AWOK_WORKDIR is known. Functions read these module globals at
    call time, so re-applying takes effect for the dispatched command.
    """
    global ENGINE_ROOT, CONTENT_ROOT, REPO_ROOT_GUESS
    global DEFAULT_WORKFLOWS_DIR, LEGACY_WORKFLOW_PATH, DEFAULT_SCHEMA_PATH
    global DEFAULT_AGENTS_DIR, DEFAULT_INVOCATIONS_DIR
    ENGINE_ROOT = engine_root
    CONTENT_ROOT = content_root
    REPO_ROOT_GUESS = engine_root  # back-compat alias — always the engine side
    DEFAULT_WORKFLOWS_DIR = content_root / "src" / "workflows"
    LEGACY_WORKFLOW_PATH = content_root / "src" / "workflow" / "workflow.yaml"
    DEFAULT_SCHEMA_PATH = engine_root / "src" / "workflow" / "workflow.schema.json"
    DEFAULT_AGENTS_DIR = content_root / "src" / "agents"
    DEFAULT_INVOCATIONS_DIR = (content_root / "src" / "workflow"
                               / "templates" / "invocations")


ENGINE_ROOT = _find_repo_root()
CONTENT_ROOT = ENGINE_ROOT
REPO_ROOT_GUESS = ENGINE_ROOT
_apply_roots(ENGINE_ROOT, CONTENT_ROOT)
```

Then DELETE the now-redundant standalone assignments at (current) lines 381 and 383:

```python
DEFAULT_AGENTS_DIR = REPO_ROOT_GUESS / "src" / "agents"
```
and
```python
DEFAULT_INVOCATIONS_DIR = (REPO_ROOT_GUESS / "src" / "workflow"
                           / "templates" / "invocations")
```
(both are now set inside `_apply_roots`). Leave any blank line / surrounding comments tidy.

- [ ] **Step 5: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py -q`
Expected: PASS (2 passed).

- [ ] **Step 6: Run the full suite (regression — defaults unchanged)**

Run: `.venv/bin/python -m pytest src/scripts/tests/ -q`
Expected: all pass (the existing tests rely on the default paths, which are byte-identical).

- [ ] **Step 7: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_workdir.py src/scripts/tests/conftest.py
git commit -m "feat(awok): split ENGINE_ROOT vs CONTENT_ROOT with _apply_roots()"
```

---

### Task 2: Repoint content-side path sites to `CONTENT_ROOT`

Only the **content** sites change; engine sites keep `REPO_ROOT_GUESS` (now == `ENGINE_ROOT`). The content sites are: `workflow_output_paths` (carto dir + skill), `manual_path`, legacy `dataflow.html` cleanup, `index_path`, the `main` SKILL path, the migrate output dir, and the `assist` / `new-phase` snippet+agent dirs.

**Files:**
- Modify: `src/scripts/bb-workflow` at the content sites listed below
- Test: `src/scripts/tests/test_workflow_workdir.py`

- [ ] **Step 1: Write the failing test (generate into a workdir)**

Append to `src/scripts/tests/test_workflow_workdir.py`:

```python
import shutil

REPO_ROOT = Path(__file__).resolve().parents[3]
ENGINE_INVOCATIONS = REPO_ROOT / "src" / "workflow" / "templates" / "invocations"


def _scaffold_workdir(content: Path):
    """Create a minimal, self-sufficient workdir: one workflow + its agent + snippet."""
    (content / "src" / "workflows").mkdir(parents=True)
    (content / "src" / "agents").mkdir(parents=True)
    inv = content / "src" / "workflow" / "templates" / "invocations"
    inv.mkdir(parents=True)
    # reuse the shared test-agent snippet so render works
    shutil.copy(ENGINE_INVOCATIONS / "test-agent.md", inv / "wd-agent.md")
    (inv / "wd-agent.md").write_text(
        (inv / "wd-agent.md").read_text().replace("agent: test-agent", "agent: wd-agent"))
    (content / "src" / "agents" / "wd-agent.md").write_text(
        "---\nname: wd-agent\nmodel: inherit\ntools:\n  - Read\n  - Write\n---\n\nWrite the result.\n")
    (content / "src" / "workflows" / "wf.yaml").write_text("""schema_version: 1
skill:
  name: wf
  description: Workdir smoke workflow
groups:
  g: { description: x }
phases:
  - id: P1
    name: Only
    group: g
    invocations:
      - agent: wd-agent
""")


def test_generate_writes_into_workdir_not_engine(bbw_module, tmp_path, restore_roots):
    eng = bbw_module.ENGINE_ROOT
    content = tmp_path / "priv"
    _scaffold_workdir(content)
    bbw_module._apply_roots(eng, content)

    class Args:  # minimal argparse.Namespace stand-in
        workflow = "wf"
        output_skill = None
    rc = bbw_module.cmd_generate(Args())

    assert rc == 0
    # SKILL + cartography land under the WORKDIR, never under the engine repo
    assert (content / "src" / "skills" / "wf" / "SKILL.md").is_file()
    assert (content / "docs" / "architecture-cartography" / "wf.html").is_file()
    assert (content / "docs" / "architecture-cartography" / "index.html").is_file()
    assert not (eng / "src" / "skills" / "wf").exists()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py::test_generate_writes_into_workdir_not_engine -q`
Expected: FAIL — the SKILL is written under the engine repo (`eng/src/skills/wf/...`) because `workflow_output_paths` still uses `REPO_ROOT_GUESS`; the `content/.../wf` assertions fail (and it likely pollutes the engine repo — the `restore_roots` fixture limits damage, but delete a stray `src/skills/wf/` if created).

- [ ] **Step 3: Repoint the content sites**

In `src/scripts/bb-workflow`, change `REPO_ROOT_GUESS` → `CONTENT_ROOT` at these sites only:

`workflow_output_paths` (≈ lines 106, 108):
```python
    carto_dir = CONTENT_ROOT / "docs" / "architecture-cartography"
    return {
        "skill": CONTENT_ROOT / "src" / "skills" / skill_name / "SKILL.md",
```

`manual_path` in `generate_skill_md` (≈ line 914):
```python
        manual_path = CONTENT_ROOT / ms["path"]
```

`cmd_generate` legacy cleanup + index (≈ lines 2119, 2134):
```python
    legacy_dataflow_html = CONTENT_ROOT / "docs" / "architecture-cartography" / "dataflow.html"
```
```python
    index_path = CONTENT_ROOT / "docs" / "architecture-cartography" / "index.html"
```

`cmd_migrate_from_skill` (≈ lines 2145, 2148):
```python
        CONTENT_ROOT / "src" / "skills" / "main" / "SKILL.md"
```
```python
        CONTENT_ROOT / "src" / "workflow"
```

`cmd_assist` (≈ lines 2214, 2215):
```python
    snippets_dir = snippets_dir or (CONTENT_ROOT / "src" / "workflow" / "templates" / "invocations")
    agents_dir = agents_dir or (CONTENT_ROOT / "src" / "agents")
```

`cmd_new_phase` (≈ lines 2280, 2281):
```python
    snippets_dir = CONTENT_ROOT / "src" / "workflow" / "templates" / "invocations"
    agents_dir = CONTENT_ROOT / "src" / "agents"
```

Leave the **engine** sites unchanged (they keep `REPO_ROOT_GUESS`): the Jinja `templates_dir` defaults (≈ 839, 1297, 1380, 1475, 1496, 2627) and the `html-wrapper.html` path (≈ 1617).

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py::test_generate_writes_into_workdir_not_engine -q`
Expected: PASS. (If a `src/skills/wf/` leaked into the engine repo during the failing run, `git status` will show it — `rm -rf src/skills/wf` and re-check.)

- [ ] **Step 5: Full suite (regression)**

Run: `.venv/bin/python -m pytest src/scripts/tests/ -q`
Expected: all pass; `git status --short src/skills/ docs/architecture-cartography/` shows no stray `wf` artifacts.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_workdir.py
git commit -m "feat(awok): write workflows/agents/outputs from CONTENT_ROOT"
```

---

### Task 3: Wire the `--workdir` flag + `$AWOK_WORKDIR`

**Files:**
- Modify: `src/scripts/bb-workflow` — add `_content_root_arg()` helper + global `--workdir` arg + apply in `main()`
- Test: `src/scripts/tests/test_workflow_workdir.py`

- [ ] **Step 1: Write the failing test for the resolution helper**

Append to `src/scripts/tests/test_workflow_workdir.py`:

```python
import os


def test_content_root_arg_precedence(bbw_module, tmp_path, monkeypatch):
    flag = tmp_path / "fromflag"
    env = tmp_path / "fromenv"
    monkeypatch.setenv("AWOK_WORKDIR", str(env))
    # flag wins over env
    assert bbw_module._content_root_arg(str(flag)) == flag.resolve()
    # env used when no flag
    assert bbw_module._content_root_arg(None) == env.resolve()
    # neither -> None
    monkeypatch.delenv("AWOK_WORKDIR")
    assert bbw_module._content_root_arg(None) is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py::test_content_root_arg_precedence -q`
Expected: FAIL — `module has no attribute '_content_root_arg'`.

- [ ] **Step 3: Add the helper**

In `src/scripts/bb-workflow`, add near `_apply_roots` (just after it):

```python
def _content_root_arg(cli_workdir):
    """Resolve the content root from --workdir (cli) then $AWOK_WORKDIR. None if unset."""
    wd = cli_workdir or os.environ.get("AWOK_WORKDIR")
    return Path(wd).resolve() if wd else None
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py::test_content_root_arg_precedence -q`
Expected: PASS.

- [ ] **Step 5: Add the global `--workdir` arg and apply it in `main()`**

In `main()`, add the argument right after the parser is created (before `sub = parser.add_subparsers(...)`):

```python
    parser.add_argument(
        "--workdir", default=None,
        help="Content root holding src/workflows + src/agents (default: the awok "
             "repo itself). Overrides $AWOK_WORKDIR. Use `awok init --workdir DIR` first.")
```

Then change the dispatch tail of `main()` from:

```python
    args = parser.parse_args()
    sys.exit(args.func(args))
```

to:

```python
    args = parser.parse_args()
    content = _content_root_arg(args.workdir)
    if content is not None:
        _apply_roots(ENGINE_ROOT, content)
    sys.exit(args.func(args))
```

- [ ] **Step 6: Verify via the CLI (subprocess, end to end through argparse)**

Run:
```bash
cd /home/marc-antoine/Desktop/awok
TMP=$(mktemp -d)
mkdir -p "$TMP/src/workflows"
awok --workdir "$TMP" validate 2>&1; echo "rc=$?"
```
Expected: it operates on the empty workdir (no workflows) — a "No workflows found (looked in `$TMP/src/workflows`)" style message, **not** the engine repo's workflows. This proves the flag reaches the resolver. `rm -rf "$TMP"`.

- [ ] **Step 7: Full suite + commit**

```bash
.venv/bin/python -m pytest src/scripts/tests/ -q
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_workdir.py
git commit -m "feat(awok): --workdir / AWOK_WORKDIR select the content root"
```

---

### Task 4: `awok init` — scaffold a content workdir (idempotent)

**Files:**
- Modify: `src/scripts/bb-workflow` — add `cmd_init` + subparser
- Test: `src/scripts/tests/test_workflow_workdir.py`

- [ ] **Step 1: Write the failing test**

Append to `src/scripts/tests/test_workflow_workdir.py`:

```python
def test_init_scaffolds_and_is_idempotent(bbw_module, tmp_path, restore_roots):
    content = tmp_path / "newwd"
    bbw_module._apply_roots(bbw_module.ENGINE_ROOT, content)

    class Args:
        pass
    assert bbw_module.cmd_init(Args()) == 0

    # dirs + example files exist
    assert (content / "src" / "workflows" / "example.yaml").is_file()
    assert (content / "src" / "agents" / "example-agent.md").is_file()
    assert (content / "src" / "workflow" / "templates" / "invocations" / "example-agent.md").is_file()
    assert (content / "src" / "skills").is_dir()
    assert (content / "docs" / "architecture-cartography").is_dir()
    assert (content / ".gitignore").is_file()

    # the scaffolded workflow validates against the engine schema, self-sufficiently
    name, path = bbw_module.resolve_workflow("example")
    assert bbw_module.validate_schema(__import__("yaml").safe_load(path.read_text())) == []

    # idempotent: editing the example then re-running must NOT clobber it
    edited = content / "src" / "workflows" / "example.yaml"
    edited.write_text(edited.read_text() + "\n# my edit\n")
    assert bbw_module.cmd_init(Args()) == 0
    assert "# my edit" in edited.read_text()
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py::test_init_scaffolds_and_is_idempotent -q`
Expected: FAIL — `module has no attribute 'cmd_init'`.

- [ ] **Step 3: Implement `cmd_init`**

In `src/scripts/bb-workflow`, add (near the other `cmd_*` functions):

```python
_INIT_EXAMPLE_WORKFLOW = """schema_version: 1
skill:
  name: example
  description: |
    Example workflow scaffolded by `awok init`. Replace it with your own
    (or delete it). Run `awok --workdir <this-dir> generate` to compile it.
  title: "/example — scaffolded workflow"
namespaces:
  work: work/example
groups:
  main:
    description: The single phase group
    risk: none
phases:
  - id: P0-EXAMPLE
    name: Example phase
    group: main
    type: agent
    invocations:
      - agent: example-agent
        model: sonnet
        description: Does the example work
        outputs:
          - { role: work:result, kind: md, terminal: true }
"""

_INIT_EXAMPLE_AGENT = """---
name: example-agent
description: Example agent scaffolded by `awok init`. Replace with your own.
model: inherit
tools:
  - Read
  - Write
---

You are an example agent. Do the work described in your task and write the
`result` output declared for your invocation.
"""

_INIT_EXAMPLE_SNIPPET = """---
agent: example-agent
generated: false
---

**{{ agent }}** [{{ model }}] · Example scaffolded agent.
{{ inputs_outputs_compact }}

**Task**: Write the `result`.
"""


def cmd_init(args):
    """Scaffold a content workdir (idempotent: never overwrites existing files)."""
    root = CONTENT_ROOT
    for d in [
        root / "src" / "workflows",
        root / "src" / "agents",
        root / "src" / "workflow" / "templates" / "invocations",
        root / "src" / "workflow" / "manual",
        root / "src" / "skills",
        root / "docs" / "architecture-cartography",
    ]:
        d.mkdir(parents=True, exist_ok=True)

    def _write_if_absent(path: Path, text: str):
        if not path.exists():
            path.write_text(text, encoding="utf-8")

    _write_if_absent(root / ".gitignore", "work/\n")
    _write_if_absent(root / "src" / "workflows" / "example.yaml", _INIT_EXAMPLE_WORKFLOW)
    _write_if_absent(root / "src" / "agents" / "example-agent.md", _INIT_EXAMPLE_AGENT)
    _write_if_absent(
        root / "src" / "workflow" / "templates" / "invocations" / "example-agent.md",
        _INIT_EXAMPLE_SNIPPET)

    print(f"✅ workdir ready at {root}")
    print(f"  next: awok --workdir {root} generate && awok --workdir {root} deploy")
    return 0
```

- [ ] **Step 4: Register the `init` subparser**

In `main()`, alongside the other `sub.add_parser(...)` calls, add:

```python
    p_init = sub.add_parser("init", help="Scaffold a content workdir (use with --workdir)")
    p_init.set_defaults(func=cmd_init)
```

- [ ] **Step 5: Run to verify it passes**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py::test_init_scaffolds_and_is_idempotent -q`
Expected: PASS.

- [ ] **Step 6: Verify init→generate works end to end via CLI**

Run:
```bash
cd /home/marc-antoine/Desktop/awok
TMP=$(mktemp -d)
awok --workdir "$TMP" init && awok --workdir "$TMP" generate 2>&1 | tail -3
ls "$TMP/src/skills/example/SKILL.md" && echo OK
rm -rf "$TMP"
```
Expected: `init` scaffolds, `generate` compiles the example, `SKILL.md` exists → `OK`.

- [ ] **Step 7: Full suite + commit**

```bash
.venv/bin/python -m pytest src/scripts/tests/ -q
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_workdir.py
git commit -m "feat(awok): add 'awok init' to scaffold a content workdir"
```

---

### Task 5: `awok deploy` — copy a workdir's skills/agents to `~/.claude`

**Files:**
- Modify: `src/scripts/bb-workflow` — add `cmd_deploy` + subparser
- Test: `src/scripts/tests/test_workflow_workdir.py`

- [ ] **Step 1: Write the failing test**

Append to `src/scripts/tests/test_workflow_workdir.py`:

```python
def test_deploy_copies_skills_and_agents(bbw_module, tmp_path, restore_roots, monkeypatch):
    content = tmp_path / "wd"
    (content / "src" / "skills" / "wf").mkdir(parents=True)
    (content / "src" / "skills" / "wf" / "SKILL.md").write_text("# wf skill\n")
    (content / "src" / "agents").mkdir(parents=True)
    (content / "src" / "agents" / "a1.md").write_text("---\nname: a1\n---\nbody\n")
    bbw_module._apply_roots(bbw_module.ENGINE_ROOT, content)

    claude_home = tmp_path / "claude"
    monkeypatch.setenv("CLAUDE_HOME", str(claude_home))

    class Args:
        pass
    assert bbw_module.cmd_deploy(Args()) == 0
    assert (claude_home / "skills" / "wf" / "SKILL.md").is_file()
    assert (claude_home / "agents" / "a1.md").is_file()
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py::test_deploy_copies_skills_and_agents -q`
Expected: FAIL — `module has no attribute 'cmd_deploy'`.

- [ ] **Step 3: Implement `cmd_deploy`**

In `src/scripts/bb-workflow`, add:

```python
def cmd_deploy(args):
    """Deploy the content workdir's skills + agents into ~/.claude (additive).

    Per-workdir equivalent of what install.sh does for the engine repo. Honours
    $CLAUDE_HOME. Never deletes skills/agents awok does not own.
    """
    import shutil
    claude_home = Path(os.environ.get("CLAUDE_HOME") or (Path.home() / ".claude"))
    skills_src = CONTENT_ROOT / "src" / "skills"
    agents_src = CONTENT_ROOT / "src" / "agents"
    n_skills = n_agents = 0
    if skills_src.is_dir():
        (claude_home / "skills").mkdir(parents=True, exist_ok=True)
        for child in skills_src.iterdir():
            if child.is_dir():
                shutil.copytree(child, claude_home / "skills" / child.name,
                                dirs_exist_ok=True)
                n_skills += 1
    if agents_src.is_dir():
        (claude_home / "agents").mkdir(parents=True, exist_ok=True)
        for f in sorted(agents_src.glob("*.md")):
            shutil.copy2(f, claude_home / "agents" / f.name)
            n_agents += 1
    print(f"→ deployed {n_skills} skill(s) + {n_agents} agent(s) to {claude_home}")
    print("  restart Claude Code so the new agents register as dispatchable subagents.")
    return 0
```

- [ ] **Step 4: Register the `deploy` subparser**

In `main()`, add:

```python
    p_deploy = sub.add_parser("deploy", help="Deploy a workdir's skills/agents to ~/.claude")
    p_deploy.set_defaults(func=cmd_deploy)
```

- [ ] **Step 5: Run to verify it passes**

Run: `.venv/bin/python -m pytest src/scripts/tests/test_workflow_workdir.py::test_deploy_copies_skills_and_agents -q`
Expected: PASS.

- [ ] **Step 6: Full suite + commit**

```bash
.venv/bin/python -m pytest src/scripts/tests/ -q
git add src/scripts/bb-workflow src/scripts/tests/test_workflow_workdir.py
git commit -m "feat(awok): add 'awok deploy' for per-workdir skill/agent deployment"
```

---

### Task 6: Documentation — CLAUDE.md, README.md, dev doc

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/dev/bb-workflow.md`

- [ ] **Step 1: CLAUDE.md — add an "Engine vs content root" section**

Insert this section in `CLAUDE.md` immediately after the `## Architecture` section:

```markdown
## Engine vs content root (`--workdir`)

awok separates two roots so private workflows can live in a **separate repo**
while reusing this engine:

- **ENGINE_ROOT** — this awok repo. Owns the engine: `src/scripts/bb-workflow`,
  the Jinja templates `src/workflow/templates/*.jinja`, `workflow.schema.json`,
  `html-wrapper.html`, webedit.
- **CONTENT_ROOT** — `--workdir DIR` (or `$AWOK_WORKDIR`); defaults to ENGINE_ROOT,
  so with no flag everything behaves as before. Owns the content: `src/workflows/`,
  `src/agents/`, `src/workflow/templates/invocations/`, `src/workflow/manual/`,
  and the generated `src/skills/` + `docs/architecture-cartography/`.

A content workdir is "an awok repo minus the engine" — it mirrors `src/` and its
agents are **self-sufficient** (resolved only from the workdir; templates + schema
come from the engine).

```bash
awok init   --workdir ~/pentest-workflows   # scaffold (idempotent)
awok --workdir ~/pentest-workflows validate
awok --workdir ~/pentest-workflows generate
awok deploy --workdir ~/pentest-workflows   # → ~/.claude/{skills,agents}
```

Precedence: `--workdir` > `$AWOK_WORKDIR` > engine. `$BB_WORKFLOW_REPO` still
overrides ENGINE_ROOT only.
```

- [ ] **Step 2: README.md — add a "Private / external workflows" section**

Insert in `README.md` immediately before the `## Commands` section:

```markdown
## Private / external workflows

Keep workflows you don't want in this repo (e.g. pentest pipelines) in a
**separate private repo** and point awok at it with `--workdir` — the engine
(templates + schema) is reused, only your workflows/agents/outputs live there:

```bash
awok init   --workdir ~/pentest-workflows   # scaffold the workdir (once)
awok --workdir ~/pentest-workflows generate # compile into the workdir
awok deploy --workdir ~/pentest-workflows   # deploy its skills/agents to ~/.claude
# restart Claude Code, then invoke the private skill
```

The workdir mirrors `src/` (its own `src/workflows/` + `src/agents/`); set
`AWOK_WORKDIR` to avoid repeating the flag. Nothing private touches this repo.
```

- [ ] **Step 3: docs/dev/bb-workflow.md — document the flag**

Append to `docs/dev/bb-workflow.md`:

```markdown
## `--workdir` / `$AWOK_WORKDIR` (external content root)

awok resolves paths from two roots: **ENGINE_ROOT** (this repo — templates +
schema, found via `$BB_WORKFLOW_REPO` → schema-marker walk-up → install location)
and **CONTENT_ROOT** (`--workdir` / `$AWOK_WORKDIR`, default = engine).

| From ENGINE_ROOT | From CONTENT_ROOT |
|---|---|
| `src/workflow/templates/*.jinja`, `html-wrapper.html`, webedit | `src/workflows/`, `src/agents/` |
| `src/workflow/workflow.schema.json` | `src/workflow/templates/invocations/`, `src/workflow/manual/` |
| | generated `src/skills/`, `docs/architecture-cartography/`, `index.html` |

`awok init --workdir DIR` scaffolds a workdir (idempotent); `awok deploy --workdir DIR`
copies its `src/skills/*` + `src/agents/*` into `~/.claude/` (honours `$CLAUDE_HOME`).
Agents are self-sufficient: a workflow referencing an agent absent from the workdir
fails coherence validation.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md docs/dev/bb-workflow.md
git commit -m "docs(awok): document --workdir / engine-content split, init, deploy"
```

---

### Task 7: Full verification + manual end-to-end

**Files:** none (verification gate).

- [ ] **Step 1: Full suite**

Run: `.venv/bin/python -m pytest src/scripts/tests/ -q`
Expected: all pass.

- [ ] **Step 2: Drift + no-workdir regression**

Run:
```bash
cd /home/marc-antoine/Desktop/awok
awok validate && awok check
```
Expected: `✅ [onboard] valid` and `✅ [onboard] no drift` — the engine repo's own workflow is unaffected (content defaults to engine).

- [ ] **Step 3: Real workdir lifecycle (init → generate → deploy)**

Run:
```bash
cd /home/marc-antoine/Desktop/awok
TMP=$(mktemp -d); CH=$(mktemp -d)
awok --workdir "$TMP" init
awok --workdir "$TMP" generate 2>&1 | tail -2
CLAUDE_HOME="$CH" awok deploy --workdir "$TMP"
test -f "$TMP/src/skills/example/SKILL.md" && test -f "$CH/skills/example/SKILL.md" \
  && test -f "$CH/agents/example-agent.md" && echo "E2E OK"
rm -rf "$TMP" "$CH"
```
Expected: `E2E OK` — the example compiled into the workdir and deployed into the isolated `$CLAUDE_HOME`, with zero artifacts written into this repo (`git status --short` clean apart from pre-existing in-flight edits).

---

## Self-review notes (author)

- **Spec coverage:** two roots + `_apply_roots` (T1); content sites repointed, engine sites untouched (T2); `--workdir`/`AWOK_WORKDIR` precedence (T3); `awok init` idempotent scaffold + example (T4); `awok deploy` (T5); CLAUDE.md/README/dev-doc (T6); regression + e2e incl. self-sufficient-agent failure path exercised by the missing-agent case in coherence (T2 scaffold is self-sufficient; an absent agent already fails `validate_coherence`). All spec sections map to a task.
- **Module-global hygiene:** every workdir test takes `restore_roots`; T1 Step 1 defines it. Flagged in the header as the top footgun.
- **Naming consistency:** `ENGINE_ROOT`, `CONTENT_ROOT`, `_apply_roots`, `_content_root_arg`, `cmd_init`, `cmd_deploy`, `AWOK_WORKDIR`, `CLAUDE_HOME` used identically across tasks. `REPO_ROOT_GUESS` retained as the engine alias so engine-side sites need no edits.
- **No-workdir == today:** `_apply_roots(engine, engine)` at import reproduces the exact current constants; the full suite in T1 Step 6 is the regression guard.
```
