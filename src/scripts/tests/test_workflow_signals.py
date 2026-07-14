"""Tests for the signal model."""


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
