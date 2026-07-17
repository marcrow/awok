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


def test_attach_routes_agent_token_to_invocation(bbw_module):
    model = _wf([{"id": "P", "name": "p", "group": "g",
                  "invocations": [{"agent": "a", "description": "do"}],
                  "emits": [{"name": "status", "type": "string", "source": "token"}]}])
    bbw_module._attach_signal_emissions(model)
    ph = model["phases"][0]
    # agent emitter -> line goes under _agent_emissions[agent], not the phase list
    assert ph["signal_emissions"] == []
    assert any("SIGNALS status=" in ln for ln in ph["_agent_emissions"]["a"])


def test_attach_routes_script_to_phase_list(bbw_module):
    model = _wf([{"id": "S", "name": "s", "group": "g", "type": "script",
                  "emits": [{"name": "found", "type": "bool", "source": "exit_code"}]}])
    bbw_module._attach_signal_emissions(model)
    ph = model["phases"][0]
    # phase-level emitter (script) -> line goes to phase["signal_emissions"]
    assert ph["_agent_emissions"] == {}
    assert any("exit" in ln.lower() and "found" in ln for ln in ph["signal_emissions"])


def test_rule_exit_code_accepts_number(bbw_module):
    # a script's raw exit code (e.g. grep 0/1/2) may be typed number, not only bool
    e = _errs(bbw_module, [{"id": "S", "name": "s", "group": "g", "type": "script",
        "emits": [{"name": "grep_rc", "type": "number", "source": "exit_code"}]}])
    assert not any("exit_code" in m for m in e)


def test_rule_exit_code_still_rejects_string(bbw_module):
    e = _errs(bbw_module, [{"id": "S", "name": "s", "group": "g", "type": "script",
        "emits": [{"name": "x", "type": "string", "source": "exit_code"}]}])
    assert any("exit_code" in m for m in e)


def test_render_emission_script_exit_code_number(bbw_module):
    ph = {"id": "S", "name": "s", "group": "g", "type": "script"}
    s = bbw_module.render_signal_emission(ph, {"name": "grep_rc", "type": "number", "source": "exit_code"})
    # number exit_code describes the integer code, not the 0=>true boolean mapping
    assert "grep_rc" in s and ("integer" in s.lower() or "code" in s.lower())
    assert "true" not in s.lower()


def test_render_emission_field_renames_json_key(bbw_module):
    # source=field with an explicit `field:` — the emitter is told to write a
    # JSON field named by `field`, while the signal KEY still comes from `name`.
    ph = {"id": "ARBITRE", "name": "arb", "group": "g",
          "invocations": [{"agent": "a", "outputs": [{"role": "work:arbitre", "kind": "json"}]}]}
    emit = {"name": "escalade_airbus", "type": "string", "source": "field",
            "from": "work:arbitre", "field": "niveau"}
    s = bbw_module.render_signal_emission(ph, emit)
    assert "`niveau`" in s                       # write the field `niveau`
    assert "arbitre.escalade_airbus" in s        # signal key unchanged
    assert "field `escalade_airbus`" not in s    # NOT a field named like the signal


def test_render_emission_field_defaults_to_name(bbw_module):
    # no `field:` → the JSON field name falls back to the signal name (unchanged behaviour)
    ph = {"id": "P", "name": "p", "group": "g",
          "invocations": [{"agent": "a", "outputs": [{"role": "work:o", "kind": "json"}]}]}
    s = bbw_module.render_signal_emission(ph, {"name": "n", "type": "number", "source": "field", "from": "work:o"})
    assert "field `n`" in s


def test_render_emission_field_rename_script_nature(bbw_module):
    # the rename also applies to a script-nature field emitter
    ph = {"id": "S", "name": "s", "group": "g", "type": "script",
          "outputs": [{"role": "work:o", "kind": "json"}]}
    emit = {"name": "sig", "type": "string", "source": "field", "from": "work:o", "field": "raw"}
    s = bbw_module.render_signal_emission(ph, emit)
    assert "`raw`" in s and "field `sig`" not in s


def test_schema_accepts_field_key(bbw_module):
    model = _wf([{"id": "P", "name": "p", "group": "g",
                  "invocations": [{"agent": "a", "outputs": [{"role": "work:o", "kind": "json"}]}],
                  "emits": [{"name": "sig", "type": "string", "source": "field",
                             "from": "work:o", "field": "niveau"}]}])
    assert bbw_module.validate_schema(model) == []


def test_rule_field_key_requires_source_field(bbw_module):
    # `field` is only meaningful for source=field; on a token signal it is an error
    e = _errs(bbw_module, [{"id": "P", "name": "p", "group": "g",
        "invocations": [{"agent": "x"}],
        "emits": [{"name": "sig", "type": "string", "source": "token", "field": "oops"}]}])
    assert any("field" in m and "sig" in m for m in e)
