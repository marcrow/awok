"""I/O par rôle + namespaces : dérivation de chemin, schema, round-trip, validation."""
import yaml as _yaml


def test_schema_accepts_role_only_io_ref(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "outputs": [{"role": "extraction:endpoints", "kind": "json"}],
            }],
        }],
    }
    assert bbw_module.validate_schema(wf) == []


def test_schema_rejects_io_ref_without_path_or_role(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a", "outputs": [{"kind": "json"}]}],
        }],
    }
    assert bbw_module.validate_schema(wf) != []


def test_schema_accepts_role_with_namespace_field(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a",
                             "outputs": [{"role": "params", "namespace": "extraction", "kind": "json"}]}],
        }],
    }
    assert bbw_module.validate_schema(wf) == []


def test_schema_still_accepts_explicit_path(bbw_module):
    wf = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "outputs": [{"path": "work/x.json", "kind": "json"}],
            }],
        }],
    }
    assert bbw_module.validate_schema(wf) == []


def test_resolve_explicit_path_wins(bbw_module):
    io = {"path": "notes/findings.md", "role": "x:y", "kind": "md"}
    assert bbw_module.resolve_io_path(io, {"x": "work/x"}) == "notes/findings.md"


def test_resolve_namespaced_role(bbw_module):
    io = {"role": "extraction:endpoints", "kind": "json"}
    ns = {"extraction": "work/extraction"}
    assert bbw_module.resolve_io_path(io, ns) == "work/extraction/endpoints.json"


def test_resolve_role_with_separate_namespace_field(bbw_module):
    io = {"role": "params", "namespace": "extraction", "kind": "json"}
    ns = {"extraction": "work/extraction"}
    assert bbw_module.resolve_io_path(io, ns) == "work/extraction/params.json"


def test_resolve_dir_kind_gets_trailing_slash_no_ext(bbw_module):
    io = {"role": "extraction:chunks", "kind": "dir"}
    ns = {"extraction": "work/extraction"}
    assert bbw_module.resolve_io_path(io, ns) == "work/extraction/chunks/"


def test_resolve_strips_trailing_slash_on_base(bbw_module):
    io = {"role": "notes:tests", "kind": "md"}
    assert bbw_module.resolve_io_path(io, {"notes": "notes/"}) == "notes/tests.md"


def test_resolve_unknown_namespace_returns_none(bbw_module):
    io = {"role": "ghost:x", "kind": "json"}
    assert bbw_module.resolve_io_path(io, {"extraction": "work/extraction"}) is None


def test_resolve_no_path_no_role_returns_none(bbw_module):
    assert bbw_module.resolve_io_path({"kind": "json"}, {}) is None


def test_resolve_io_paths_fills_derived_paths(bbw_module):
    model = {
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "inputs": [{"role": "extraction:sections", "kind": "json"}],
                "outputs": [{"role": "extraction:endpoints", "kind": "json"}],
            }],
        }],
    }
    resolved = bbw_module.resolve_io_paths(model)
    inv = resolved["phases"][0]["invocations"][0]
    assert inv["inputs"][0]["path"] == "work/extraction/sections.json"
    assert inv["outputs"][0]["path"] == "work/extraction/endpoints.json"


def test_resolve_io_paths_does_not_mutate_original(bbw_module):
    model = {
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a",
                             "outputs": [{"role": "extraction:e", "kind": "json"}]}],
        }],
    }
    bbw_module.resolve_io_paths(model)
    assert "path" not in model["phases"][0]["invocations"][0]["outputs"][0]


def test_resolve_io_paths_handles_phase_level_io(bbw_module):
    model = {
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g", "type": "script",
            "outputs": [{"role": "extraction:chunks", "kind": "dir"}],
        }],
    }
    resolved = bbw_module.resolve_io_paths(model)
    assert resolved["phases"][0]["outputs"][0]["path"] == "work/extraction/chunks/"


def test_role_io_ref_roundtrips_without_injected_path(bbw_module):
    model = {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a",
                             "outputs": [{"role": "extraction:endpoints", "kind": "json"}]}],
        }],
    }
    dumped = bbw_module.dump_workflow_yaml(model)
    reloaded = _yaml.safe_load(dumped)
    out = reloaded["phases"][0]["invocations"][0]["outputs"][0]
    assert out == {"role": "extraction:endpoints", "kind": "json"}
    assert "path" not in out
    # YAML must quote the value because it contains a colon
    assert "role:" in dumped and "kind: json" in dumped
    # The dict must appear on a single line (flow style), not block style
    import re
    assert re.search(r'\{[^}]*role[^}]*kind[^}]*\}', dumped)


def _wf_with_io(io, namespaces=None):
    return {
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": namespaces or {},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a", "outputs": [io]}],
        }],
    }


def test_coherence_flags_unknown_namespace(bbw_module, tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\n---\nbody\n")
    wf = _wf_with_io({"role": "ghost:x", "kind": "json"},
                     namespaces={"extraction": "work/extraction"})
    errs = bbw_module.validate_coherence(wf, agents_dir=tmp_path)
    assert any("ghost" in e and "namespace" in e for e in errs)


def test_coherence_ok_for_known_namespace(bbw_module, tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\n---\nbody\n")
    wf = _wf_with_io({"role": "extraction:x", "kind": "json"},
                     namespaces={"extraction": "work/extraction"})
    assert bbw_module.validate_coherence(wf, agents_dir=tmp_path) == []


def test_coherence_ok_for_explicit_path(bbw_module, tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\n---\nbody\n")
    wf = _wf_with_io({"path": "anywhere.md", "kind": "md"})
    assert bbw_module.validate_coherence(wf, agents_dir=tmp_path) == []


def test_coherence_flags_io_ref_without_path_or_role(bbw_module, tmp_path):
    (tmp_path / "a.md").write_text("---\nname: a\n---\nbody\n")
    wf = _wf_with_io({"kind": "json"})
    errs = bbw_module.validate_coherence(wf, agents_dir=tmp_path)
    assert any("sans path ni role" in e for e in errs)


def test_generate_resolves_role_paths_in_skill(bbw_module, tmp_path):
    import shutil
    from pathlib import Path
    REPO_ROOT = Path(__file__).resolve().parents[3]

    # Setup: templates_dir with invocations/ sub-dir and the skeleton template
    templates_dir = tmp_path / "templates"
    invocations_dir = templates_dir / "invocations"
    invocations_dir.mkdir(parents=True)
    shutil.copy(
        REPO_ROOT / "claude-setup" / "workflow" / "templates" / "skill-skeleton.md.jinja",
        templates_dir / "skill-skeleton.md.jinja",
    )

    # Agent dir
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()

    # Create agent + invocation snippet via create_agent
    bbw_module.create_agent("a", "desc", "Read", "inherit", "fais x",
                            agents_dir=agents_dir, invocations_dir=invocations_dir)

    wf_path = tmp_path / "w.yaml"
    wf_path.write_text(bbw_module.dump_workflow_yaml({
        "schema_version": 1,
        "skill": {"name": "w", "description": "d"},
        "groups": {"g": {"description": "x"}},
        "namespaces": {"extraction": "work/extraction"},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{"agent": "a", "model": "haiku",
                             "outputs": [{"role": "extraction:endpoints", "kind": "json"}]}],
        }],
    }))
    out = tmp_path / "SKILL.md"
    bbw_module.generate_skill_md(wf_path, out, templates_dir=templates_dir,
                                 agents_dir=agents_dir)
    text = out.read_text()
    assert "work/extraction/endpoints.json" in text


def test_compact_shows_role_kind_and_path(bbw_module):
    inputs = [{"role": "extraction:sections", "kind": "json",
               "path": "work/extraction/sections.json"}]
    outputs = [{"role": "extraction:endpoints", "kind": "json",
                "path": "work/extraction/endpoints.json"}]
    s = bbw_module._format_io_compact(inputs, outputs)
    assert "`extraction:sections`" in s
    assert "(json)" in s
    assert "work/extraction/sections.json" in s
    assert "Reads" in s and "Writes" in s


def test_compact_marks_optional_and_legend(bbw_module):
    inputs = [{"role": "x:y", "kind": "json", "path": "work/x/y.json",
               "optional": True}]
    s = bbw_module._format_io_compact(inputs, [])
    assert "optionnel" in s.lower()


def test_compact_falls_back_to_path_basename_without_role(bbw_module):
    s = bbw_module._format_io_compact([{"path": "scope.md", "kind": "md"}], [])
    assert "scope.md" in s


import pathlib


def test_existing_workflows_still_validate_and_generate(bbw_module):
    repo = pathlib.Path(__file__).resolve().parents[3]
    wf_dir = repo / "claude-setup" / "workflows"
    import yaml
    for wf_path in sorted(wf_dir.glob("*.yaml")):
        if wf_path.stem in ("test", "reporter", "report-writer"):  # scratch WIP yamls
            continue
        model = yaml.safe_load(wf_path.read_text())
        assert bbw_module.validate_schema(model) == [], f"{wf_path.name} schema"
        bbw_module.resolve_io_paths(model)  # must not raise
