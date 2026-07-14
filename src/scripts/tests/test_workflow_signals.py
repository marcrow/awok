"""Signals-on-action: schema, validation, emitter resolution, generation."""

def _wf(phases):
    return {"schema_version": 1, "skill": {"name": "w", "description": "x"},
            "groups": {"g": {"description": "x"}}, "phases": phases}


def test_schema_accepts_exit_code_and_by(bbw_module):
    model = _wf([
        {"id": "SCAN", "name": "s", "group": "g", "type": "script",
         "emits": [{"name": "found", "type": "bool", "source": "exit_code"}]},
        {"id": "A", "name": "a", "group": "g",
         "emits": [{"name": "status", "type": "string", "source": "token", "by": "recon"}],
         "invocations": [{"agent": "recon"}]},
    ])
    assert bbw_module.validate_schema(model) == []


def test_schema_rejects_unknown_source(bbw_module):
    model = _wf([{"id": "SCAN", "name": "s", "group": "g",
                  "emits": [{"name": "x", "type": "bool", "source": "nope"}]}])
    assert any("source" in e or "nope" in e for e in bbw_module.validate_schema(model))


def test_collect_signals_from_emits(bbw_module):
    wf = {"phases": [
        {"id": "CRITIC", "name": "c", "group": "g",
         "emits": [{"name": "verdict", "type": "enum", "source": "token"}]},
    ]}
    sig = bbw_module.collect_signals(wf)
    assert "critic.verdict" in sig
    assert sig["critic.verdict"]["type"] == "enum"
    assert sig["critic.verdict"]["source"] == "token"
    assert sig["critic.verdict"]["phase"] == "CRITIC"


def test_collect_signals_empty_when_no_emits(bbw_module):
    wf = {"phases": [{"id": "T1", "name": "a", "group": "g"}]}
    assert bbw_module.collect_signals(wf) == {}


def test_emitter_field_resolves_to_role_producer(bbw_module):
    model = _wf([
        {"id": "SRC", "name": "s", "group": "g",
         "invocations": [{"agent": "a1", "outputs": [{"role": "work:data", "kind": "json"}]}],
         "emits": [{"name": "n", "type": "number", "source": "field", "from": "work:data.n"}]},
    ])
    model["namespaces"] = {"work": "work/w"}
    ph = model["phases"][0]
    em = bbw_module.resolve_signal_emitter(model, ph, ph["emits"][0])
    assert em["kind"] == "invocation" and em["agent"] == "a1"


def test_emitter_token_single_agent_is_that_agent(bbw_module):
    model = _wf([
        {"id": "P", "name": "p", "group": "g",
         "invocations": [{"agent": "a1"}],
         "emits": [{"name": "s", "type": "string", "source": "token"}]},
    ])
    ph = model["phases"][0]
    em = bbw_module.resolve_signal_emitter(model, ph, ph["emits"][0])
    assert em["kind"] == "invocation" and em["agent"] == "a1"


def test_emitter_script_is_phase_level(bbw_module):
    model = _wf([{"id": "S", "name": "s", "group": "g", "type": "script",
                  "emits": [{"name": "f", "type": "bool", "source": "exit_code"}]}])
    ph = model["phases"][0]
    em = bbw_module.resolve_signal_emitter(model, ph, ph["emits"][0])
    assert em["kind"] == "phase" and em["nature"] == "script"


def _errs(bbw, phases):
    return bbw.validate_coherence(_wf(phases),
                                  agents_dir=None, workflows_dir=None)


def test_rule_exit_code_requires_script_and_bool(bbw_module):
    e = _errs(bbw_module, [{"id": "A", "name": "a", "group": "g",
        "invocations": [{"agent": "x"}],
        "emits": [{"name": "f", "type": "bool", "source": "exit_code"}]}])
    assert any("exit_code" in m and "script" in m for m in e)
    e2 = _errs(bbw_module, [{"id": "S", "name": "s", "group": "g", "type": "script",
        "emits": [{"name": "f", "type": "string", "source": "exit_code"}]}])
    assert any("exit_code" in m and "bool" in m for m in e2)


def test_rule_list_requires_field(bbw_module):
    e = _errs(bbw_module, [{"id": "P", "name": "p", "group": "g",
        "invocations": [{"agent": "x"}],
        "emits": [{"name": "items", "type": "list", "source": "token"}]}])
    assert any("list" in m and "field" in m for m in e)


def test_rule_field_role_must_be_produced(bbw_module):
    e = _errs(bbw_module, [{"id": "P", "name": "p", "group": "g",
        "invocations": [{"agent": "x"}],
        "emits": [{"name": "n", "type": "number", "source": "field", "from": "work:ghost.n"}]}])
    assert any("ghost" in m or "not produced" in m for m in e)


def test_valid_signals_pass(bbw_module):
    e = _errs(bbw_module, [{"id": "S", "name": "s", "group": "g", "type": "script",
        "emits": [{"name": "f", "type": "bool", "source": "exit_code"}]}])
    assert not any("signal" in m or "exit_code" in m for m in e)


def test_render_emission_agent_token(bbw_module):
    ph = {"id": "P", "name": "p", "group": "g", "invocations": [{"agent": "a"}]}
    s = bbw_module.render_signal_emission(ph, {"name": "status", "type": "string", "source": "token"})
    assert "SIGNALS status=" in s


def test_render_emission_agent_field(bbw_module):
    ph = {"id": "P", "name": "p", "group": "g",
          "invocations": [{"agent": "a", "outputs": [{"role": "work:o", "kind": "json"}]}]}
    s = bbw_module.render_signal_emission(ph, {"name": "n", "type": "number", "source": "field", "from": "work:o.n"})
    assert "field" in s and "`n`" in s


def test_render_emission_script_exit_code(bbw_module):
    ph = {"id": "S", "name": "s", "group": "g", "type": "script"}
    s = bbw_module.render_signal_emission(ph, {"name": "found", "type": "bool", "source": "exit_code"})
    assert "exit" in s.lower() and "found" in s
