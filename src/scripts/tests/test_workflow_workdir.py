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


def test_generate_uses_workdir_invocation_snippet(bbw_module, tmp_path, restore_roots):
    """generate must read invocation snippets from the workdir, not the engine
    templates dir — otherwise the SKILL renders `_(snippet missing)_`."""
    eng = bbw_module.ENGINE_ROOT
    content = tmp_path / "priv"
    _scaffold_workdir(content)
    bbw_module._apply_roots(eng, content)

    class Args:
        workflow = "wf"
        output_skill = None
    assert bbw_module.cmd_generate(Args()) == 0

    skill = (content / "src" / "skills" / "wf" / "SKILL.md").read_text()
    assert "snippet missing" not in skill          # the workdir snippet WAS found
    assert "wd-agent" in skill


def test_editor_invocation_uses_given_invocations_dir(bbw_module, tmp_path):
    """The web editor must read/write invocation snippets from the supplied
    invocations_dir (the content root), not templates_dir/invocations (engine)."""
    import threading, http.client, json
    from http.server import HTTPServer

    agents = tmp_path / "agents"; agents.mkdir()
    (agents / "edagent.md").write_text("---\nname: edagent\n---\nbody\n")
    inv = tmp_path / "inv"; inv.mkdir()
    (inv / "edagent.md").write_text(
        "---\nagent: edagent\ngenerated: false\n---\n\noriginal snippet\n")
    (tmp_path / "wf").mkdir()
    templates = bbw_module.ENGINE_ROOT / "src" / "workflow" / "templates"

    handler = bbw_module.make_edit_handler(
        tmp_path / "wf", agents, templates, invocations_dir=inv)
    srv = HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        addr = srv.server_address
        c = http.client.HTTPConnection(*addr); c.request("GET", "/api/invocation/edagent")
        r = c.getresponse(); body = json.loads(r.read().decode())
        assert r.status == 200 and "original snippet" in body["prompt"]

        c = http.client.HTTPConnection(*addr)
        c.request("PUT", "/api/invocation/edagent",
                  json.dumps({"prompt": "edited snippet"}),
                  {"Content-Type": "application/json"})
        assert c.getresponse().status == 200
        assert "edited snippet" in (inv / "edagent.md").read_text()
        assert not (templates / "invocations" / "edagent.md").exists()  # engine untouched
    finally:
        srv.shutdown()
