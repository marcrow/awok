"""Tests for snippet loading and template rendering."""
from pathlib import Path
import subprocess
import sys
import yaml
import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
SNIPPETS_DIR = REPO_ROOT / "src" / "workflow" / "templates" / "invocations"


def test_load_snippet_parses_frontmatter(bbw_module):
    snippet = bbw_module.load_snippet(SNIPPETS_DIR / "test-agent.md")
    assert snippet.frontmatter["agent"] == "test-agent"
    assert snippet.frontmatter["generated"] is False
    assert "Tu es l'agent test-agent" in snippet.body


def test_load_snippet_missing_file_raises(bbw_module, tmp_path):
    with pytest.raises(FileNotFoundError):
        bbw_module.load_snippet(tmp_path / "missing.md")


def test_load_snippet_no_frontmatter_raises(bbw_module, tmp_path):
    p = tmp_path / "bad.md"
    p.write_text("no frontmatter here")
    with pytest.raises(ValueError, match="frontmatter"):
        bbw_module.load_snippet(p)


def test_render_snippet_substitutes_io(bbw_module):
    snippet = bbw_module.load_snippet(SNIPPETS_DIR / "test-agent.md")
    invocation = {
        "agent": "test-agent",
        "inputs": [{"path": "in/a.json", "kind": "json"}],
        "outputs": [{"path": "out/b.json", "kind": "json"}],
    }
    rendered = bbw_module.render_snippet(snippet, invocation)
    assert "in/a.json" in rendered
    assert "out/b.json" in rendered
    assert "{{ inputs_table }}" not in rendered  # substituted


def test_generate_skill_produces_file(bbw_module, tmp_path):
    """End-to-end: generate SKILL.md from workflow.yaml + snippet."""
    import shutil
    # Setup tmp workspace mirroring the real layout
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"

    # Copy snippet + skeleton from the real repo
    shutil.copy(SNIPPETS_DIR / "test-agent.md", invocations_dir / "test-agent.md")
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )

    # Create agents/ dir with test-agent
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    # Workflow
    workflow_yaml = workflow_dir / "workflow.yaml"
    workflow_yaml.write_text("""schema_version: 1
skill:
  name: test-workflow
  description: Toy workflow used by generate test
groups:
  g: { description: x }
phases:
  - id: T1
    name: First
    group: g
    invocations:
      - agent: test-agent
        inputs: [{ path: in/a.json, kind: json }]
        outputs: [{ path: out/b.json, kind: json }]
""")

    output_skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(
        workflow_path=workflow_yaml,
        output_path=output_skill,
        templates_dir=templates_dir,
        agents_dir=agents_dir,
    )

    content = output_skill.read_text()
    assert "T1" in content and "First" in content
    assert "in/a.json" in content
    assert "out/b.json" in content
    assert "test-agent" in content
    # No invocation pins a model → neither the header convention note nor the
    # per-invocation ⚙️ reminder must appear (gated on any_invocation_model).
    assert "Model is not inherited" not in content
    # No parallelism (1 linear action, 1 invocation) → no Execution-protocol
    # section and no ⚡ reminder (gated on any_parallelism).
    assert "Execution protocol" not in content
    assert "⚡" not in content
    # Vocab alignment: generated prose says "actions", never "phases".
    assert "## Pipeline actions (DAG)" in content
    assert "Pipeline phases" not in content


def test_generate_skill_emits_model_imperative(bbw_module, tmp_path):
    """When an invocation pins a model, the SKILL.md must render it as an IMPERATIVE
    (pass it to the Task tool), not just a decorative [model] label — plus the
    header convention note. Regression guard for the headless tiering loss: the
    orchestrator silently inherited the session model when the model was advisory."""
    import shutil
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"
    shutil.copy(SNIPPETS_DIR / "test-agent.md", invocations_dir / "test-agent.md")
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    workflow_yaml = workflow_dir / "workflow.yaml"
    workflow_yaml.write_text("""schema_version: 1
skill:
  name: tiered-flow
  description: One invocation pins a model
groups:
  g: { description: x }
phases:
  - id: T1
    name: First
    group: g
    invocations:
      - agent: test-agent
        model: haiku
""")

    output_skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(
        workflow_path=workflow_yaml,
        output_path=output_skill,
        templates_dir=templates_dir,
        agents_dir=agents_dir,
    )
    content = output_skill.read_text()
    # Header convention note appears (gated on any_invocation_model).
    assert "Model is not inherited" in content
    # Per-invocation imperative: the model must be passed to the Task tool.
    assert "model: haiku" in content
    assert "not inherited from the session model" in content


def test_generate_skill_emits_effort_imperative(bbw_module, tmp_path):
    """A pinned `effort` must render as an IMPERATIVE (pass it to the Task tool),
    like `model`, plus the header convention note. Covers effort-only and the
    combined model+effort directive. Regression guard mirroring the model one."""
    import shutil
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"
    shutil.copy(SNIPPETS_DIR / "test-agent.md", invocations_dir / "test-agent.md")
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    workflow_yaml = workflow_dir / "workflow.yaml"
    workflow_yaml.write_text("""schema_version: 1
skill:
  name: effort-flow
  description: Invocations pin an effort
groups:
  g: { description: x }
phases:
  - id: T1
    name: EffortOnly
    group: g
    invocations:
      - agent: test-agent
        effort: low
  - id: T2
    name: Both
    group: g
    depends_on: [T1]
    invocations:
      - agent: test-agent
        model: sonnet
        effort: max
""")

    output_skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(
        workflow_path=workflow_yaml,
        output_path=output_skill,
        templates_dir=templates_dir,
        agents_dir=agents_dir,
    )
    content = output_skill.read_text()
    # Header convention note for effort (gated on any_invocation_effort).
    assert "Effort is set on the agent, not at launch" in content
    # Effort-only invocation: recorded as frontmatter, NOT a Task-tool argument.
    assert "**Effort `low`**" in content
    assert "written into the agent's frontmatter" in content
    assert "effort: low" in content
    # Combined: model stays a Task-tool arg; effort is frontmatter (applied automatically).
    assert "Run on `sonnet`" in content
    assert "model: sonnet" in content
    assert "Effort `max` is set in the agent's frontmatter" in content
    # Regression: effort must NEVER be rendered as a Task-tool launch argument
    # (the Task tool has no effort parameter — the old wording was broken at runtime).
    assert "and `effort:" not in content
    assert "with `effort:" not in content
    assert "Pass it explicitly to the `Task` tool (`effort" not in content


def test_generate_skill_omits_directive_when_inherit(bbw_module, tmp_path):
    """An invocation left at the inherit default (model/effort unset, or the literal
    'inherit') renders NO ⚙️ directive and no convention note — the session default
    silently wins. Guards the latent 'Run on inherit' bug a web-UI default could hit."""
    import shutil
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"
    shutil.copy(SNIPPETS_DIR / "test-agent.md", invocations_dir / "test-agent.md")
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    workflow_yaml = workflow_dir / "workflow.yaml"
    workflow_yaml.write_text("""schema_version: 1
skill:
  name: inherit-flow
  description: An invocation left at inherit
groups:
  g: { description: x }
phases:
  - id: T1
    name: Inherited
    group: g
    invocations:
      - agent: test-agent
        model: inherit
""")

    output_skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(
        workflow_path=workflow_yaml,
        output_path=output_skill,
        templates_dir=templates_dir,
        agents_dir=agents_dir,
    )
    content = output_skill.read_text()
    assert "Run on `inherit`" not in content
    assert "⚙️" not in content
    assert "Model is not inherited" not in content


def test_generate_skill_emits_parallel_reminder(bbw_module, tmp_path):
    """An action listing >=2 invocations renders the ⚡ intra-action parallel
    reminder (launch them in ONE message), since that parallelism is otherwise
    invisible. Mirrors create-workflow's S4-BLOCK-REVIEW shape. Regression guard
    for the headless turn explosion: the orchestrator launched 'parallel' agents
    one per message."""
    import shutil
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"
    shutil.copy(SNIPPETS_DIR / "test-agent.md", invocations_dir / "test-agent.md")
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    # One action, two invocations → intra-action parallelism.
    workflow_yaml = workflow_dir / "workflow.yaml"
    workflow_yaml.write_text("""schema_version: 1
skill:
  name: fanout-flow
  description: One action runs two independent agents
groups:
  g: { description: x }
phases:
  - id: T1
    name: First
    group: g
    invocations:
      - agent: test-agent
      - agent: test-agent
""")

    output_skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(
        workflow_path=workflow_yaml,
        output_path=output_skill,
        templates_dir=templates_dir,
        agents_dir=agents_dir,
    )
    content = output_skill.read_text()
    # Per-action reminder: both agents launched in one message.
    assert "Parallel — 2 independent agents" in content
    assert "2 `Task` blocks" in content
    # >=2 invocations ⇒ any_parallelism ⇒ the Execution protocol section too.
    assert "Execution protocol" in content


def test_generate_skill_derives_parallel_with(bbw_module, tmp_path):
    """generate_skill_md must derive parallel_with from the DAG so sibling phases
    render the ∥ marker — even when the YAML does NOT declare parallel_with.

    Regression guard: the CLI generate path used to skip apply_parallel_with
    (it only ran in the web-editor save path), so hand-authored parallel phases
    never showed up as parallel in the generated SKILL.md."""
    import shutil
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"
    shutil.copy(SNIPPETS_DIR / "test-agent.md", invocations_dir / "test-agent.md")
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    # Two sibling phases at level 0 — NO depends_on, NO parallel_with declared.
    workflow_yaml = workflow_dir / "workflow.yaml"
    workflow_yaml.write_text("""schema_version: 1
skill:
  name: par-flow
  description: Two parallel roots, parallel_with NOT declared in the YAML
groups:
  g: { description: x }
phases:
  - id: A1
    name: Alpha
    group: g
    invocations:
      - agent: test-agent
  - id: A2
    name: Beta
    group: g
    invocations:
      - agent: test-agent
""")

    output_skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(
        workflow_path=workflow_yaml,
        output_path=output_skill,
        templates_dir=templates_dir,
        agents_dir=agents_dir,
    )
    content = output_skill.read_text()
    # A1 and A2 are siblings → each must be annotated parallel with the other.
    assert "∥ A2" in content
    assert "∥ A1" in content
    # Sibling actions on a stage → parallelism exists → the Execution protocol
    # section is emitted (gated on any_parallelism via parallel_with).
    assert "Execution protocol" in content
    assert "Pipeline phases" not in content  # vocab aligned to "actions"


def test_generate_cartography_texte(bbw_module, tmp_path):
    workflow_yaml = REPO_ROOT / "src" / "scripts" / "tests" / "fixtures" / "workflows" / "valid-complex.yaml"
    output = tmp_path / "carto.md"
    bbw_module.generate_cartography_texte(workflow_yaml, output)
    content = output.read_text()
    assert "T1" in content and "T4" in content
    assert "Level 0" in content
    assert "g1" in content


def test_generate_mermaid_cartography(bbw_module, tmp_path):
    workflow_yaml = REPO_ROOT / "src" / "scripts" / "tests" / "fixtures" / "workflows" / "valid-complex.yaml"
    output = tmp_path / "carto.mermaid"
    bbw_module.generate_mermaid_cartography(workflow_yaml, output)
    content = output.read_text()
    assert "flowchart TB" in content
    assert "T1" in content and "T4" in content


def test_generate_mermaid_dataflow(bbw_module, tmp_path):
    workflow_yaml = REPO_ROOT / "src" / "scripts" / "tests" / "fixtures" / "workflows" / "valid-complex.yaml"
    output = tmp_path / "df.mermaid"
    bbw_module.generate_mermaid_dataflow(workflow_yaml, output)
    content = output.read_text()
    assert "flowchart LR" in content
    assert "out_a_json" in content  # node_id sanitization


def test_wrap_mermaid_in_html(bbw_module, tmp_path):
    template = tmp_path / "tpl.html"
    template.write_text("<html><body><!--__MERMAID_CONTENT__--></body></html>")
    libs = tmp_path / "libs"
    libs.mkdir()
    (libs / "mermaid.min.js").write_text("/* mock mermaid */")
    (libs / "svg-pan-zoom.min.js").write_text("/* mock panzoom */")
    (libs / "marked.min.js").write_text("/* mock marked */")

    out = tmp_path / "out.html"
    bbw_module.wrap_mermaid_in_html(
        "flowchart TB\nA --> B",
        out,
        template_path=template,
        libs_dir=libs,
    )
    content = out.read_text()
    assert "flowchart TB" in content


def test_wrap_mermaid_strips_fences(bbw_module, tmp_path):
    """wrap_mermaid_in_html removes ```mermaid ... ``` fences before injection."""
    template = tmp_path / "tpl.html"
    template.write_text("<html><body></body></html>")
    libs = tmp_path / "libs"
    libs.mkdir()
    (libs / "mermaid.min.js").write_text("/* mermaid */")
    (libs / "svg-pan-zoom.min.js").write_text("/* panzoom */")
    (libs / "marked.min.js").write_text("/* marked */")

    fenced = "```mermaid\nflowchart TB\nA --> B\n```\n"
    out = tmp_path / "out.html"
    bbw_module.wrap_mermaid_in_html(fenced, out, template_path=template, libs_dir=libs)
    content = out.read_text()
    # The fences must NOT appear in the HTML
    assert "```mermaid" not in content
    assert "```" not in content.split("</body>")[0].split("class='mermaid'")[-1]
    # The actual mermaid content must be present
    assert "flowchart TB" in content
    assert "A --> B" in content


def test_deploy_agents_materializes_effort(bbw_module, tmp_path):
    """deploy_agents writes a pinned per-invocation effort into the DEPLOYED agent
    frontmatter (source stays clean), gates unsupported models (haiku) with a warning,
    flags conflicts, and clears the key on re-deploy when the pin is removed. This is
    the real runtime path — the Task tool has no effort argument."""
    workflows = tmp_path / "workflows"; workflows.mkdir()
    agents = tmp_path / "agents"; agents.mkdir()
    dest = tmp_path / "deployed"
    # Clean source agents (convention: model inherit, NO effort — effort lives in YAML).
    (agents / "deep.md").write_text(
        "---\nname: deep\nmodel: inherit\ntools:\n  - Read\n---\n\nBody.\n")
    (agents / "cheap.md").write_text("---\nname: cheap\nmodel: inherit\n---\n\nBody.\n")
    (agents / "conf.md").write_text("---\nname: conf\nmodel: inherit\n---\n\nBody.\n")

    (workflows / "w.yaml").write_text("""schema_version: 1
skill: { name: w, description: d }
groups: { g: { description: x } }
phases:
  - id: P1
    name: A
    group: g
    invocations:
      - { agent: deep, model: opus, effort: high }
      - { agent: cheap, model: haiku, effort: max }
  - id: P2
    name: B
    group: g
    depends_on: [P1]
    invocations:
      - { agent: conf, model: opus, effort: low }
      - { agent: conf, model: sonnet, effort: max }
""")

    efforts, warnings = bbw_module.resolve_agent_efforts(workflows)
    assert efforts == {"deep": "high"}                       # only the supported, unambiguous pin
    assert any("cheap" in w and "haiku" in w for w in warnings)        # model gating
    assert any("conf" in w and "conflicting" in w for w in warnings)   # conflict

    n, _ = bbw_module.deploy_agents(agents, workflows, dest)
    assert n == 3
    deep_deployed = (dest / "deep.md").read_text()
    assert "effort: high" in deep_deployed
    assert "tools:" in deep_deployed and "- Read" in deep_deployed   # rest preserved
    assert "effort" not in (agents / "deep.md").read_text()          # source untouched
    assert "effort:" not in (dest / "cheap.md").read_text()          # gated → not injected
    assert "effort:" not in (dest / "conf.md").read_text()           # conflict → not injected

    # Idempotent removal: drop the pin, re-deploy → the deployed key disappears
    # (deploy always re-derives from the pristine source).
    (workflows / "w.yaml").write_text("""schema_version: 1
skill: { name: w, description: d }
groups: { g: { description: x } }
phases:
  - id: P1
    name: A
    group: g
    invocations:
      - { agent: deep, model: opus }
""")
    bbw_module.deploy_agents(agents, workflows, dest)
    assert "effort:" not in (dest / "deep.md").read_text()


def test_check_effort_warnings_flags_unsupported_model(bbw_module):
    """validate warns when an effort is pinned on a model that can't run it (haiku),
    for both phase invocations and on-demand agents; supported models are silent."""
    wf = {
        "phases": [{"id": "P1", "invocations": [
            {"agent": "a", "model": "haiku", "effort": "high"},   # flagged
            {"agent": "b", "model": "sonnet", "effort": "high"},  # fine
            {"agent": "c", "model": "opus"},                      # no effort
            {"agent": "e", "effort": "low"},                      # inherit model — fine
        ]}],
        "on_demand_agents": [{"agent": "d", "model": "haiku", "effort": "max"}],  # flagged
    }
    warns = bbw_module.check_effort_warnings(wf)
    assert len(warns) == 2
    assert any("'a'" in w and "haiku" in w for w in warns)
    assert any("'d'" in w and "haiku" in w for w in warns)
    assert not any(f"'{x}'" in w for w in warns for x in ("b", "c", "e"))


def test_generate_skill_drops_effort_on_unsupported_model(bbw_module, tmp_path):
    """An effort pinned on haiku is NOT advertised in the SKILL (it's dropped at deploy,
    so claiming it would be a lie). The model line still renders; the effort note and the
    effort header note do not."""
    import shutil
    workflow_dir = tmp_path / "workflow"
    invocations_dir = workflow_dir / "templates" / "invocations"
    invocations_dir.mkdir(parents=True)
    templates_dir = workflow_dir / "templates"
    shutil.copy(SNIPPETS_DIR / "test-agent.md", invocations_dir / "test-agent.md")
    shutil.copy(
        REPO_ROOT / "src" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "test-agent.md").write_text("---\nname: test-agent\n---\n")

    workflow_yaml = workflow_dir / "workflow.yaml"
    workflow_yaml.write_text("""schema_version: 1
skill:
  name: haiku-effort
  description: Effort pinned on haiku (unsupported)
groups:
  g: { description: x }
phases:
  - id: T1
    name: Cheap
    group: g
    invocations:
      - agent: test-agent
        model: haiku
        effort: high
""")

    output_skill = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(
        workflow_path=workflow_yaml,
        output_path=output_skill,
        templates_dir=templates_dir,
        agents_dir=agents_dir,
    )
    content = output_skill.read_text()
    assert "Run on `haiku`" in content                          # model still rendered
    assert "Effort `high`" not in content                       # effort NOT advertised
    assert "is set in the agent's frontmatter" not in content
    assert "Effort is set on the agent, not at launch" not in content  # header note gated off


def test_existing_skills_unchanged_after_regen(tmp_path):
    """Golden regression: the 4 committed legacy workflows have no
    `<name>.orchestration.yaml` sibling, so they must regenerate byte-identical
    SKILL.md — the global backward-compat guarantee of the whole orchestration
    feature (no orchestration file => pure DAG => today's output, unchanged;
    legacy `skip_if`/`conditions` keep generating exactly as before).

    `generate`'s only output-path override is `--output-skill` (single
    workflow only; see `cmd_generate`) — it does NOT redirect the cartography
    outputs (`docs/architecture-cartography/*`, `src/skills/*` for other
    workflows), which are resolved from CONTENT_ROOT. To keep this test free
    of side effects on the real repo, the content-owned inputs (src/workflows,
    src/agents, src/workflow/templates/invocations, src/workflow/manual) are
    copied into a throwaway `--workdir`, so cartography/index writes land in
    tmp_path instead of the real docs/ and src/skills/ trees. Only the
    resulting SKILL.md (via --output-skill) is compared against what's
    committed.
    """
    import shutil

    workdir = tmp_path / "workdir"
    for rel in ("src/workflows", "src/agents",
                "src/workflow/templates/invocations", "src/workflow/manual"):
        dst = workdir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(REPO_ROOT / rel, dst)

    for name in ["onboard", "create-workflow", "workflow-doctor", "edit-workflow"]:
        committed = (REPO_ROOT / "src" / "skills" / name / "SKILL.md").read_text()
        out = tmp_path / f"{name}.md"
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "src" / "scripts" / "bb-workflow"),
             "--workdir", str(workdir),
             "generate", "--workflow", name, "--output-skill", str(out)],
            cwd=REPO_ROOT, capture_output=True, text=True,
        )
        assert result.returncode == 0, (
            f"generate failed for {name}:\n{result.stdout}\n{result.stderr}"
        )
        assert out.read_text() == committed, (
            f"{name} SKILL.md drifted after regen (backward-compat broken)"
        )
