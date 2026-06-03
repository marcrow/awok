"""Tests for snippet loading and template rendering."""
from pathlib import Path
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


def test_generate_cartography_texte(bbw_module, tmp_path):
    workflow_yaml = REPO_ROOT / "src" / "scripts" / "tests" / "fixtures" / "workflows" / "valid-complex.yaml"
    output = tmp_path / "carto.md"
    bbw_module.generate_cartography_texte(workflow_yaml, output)
    content = output.read_text()
    assert "T1" in content and "T4" in content
    assert "Niveau 0" in content
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
