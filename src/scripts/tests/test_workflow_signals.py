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
