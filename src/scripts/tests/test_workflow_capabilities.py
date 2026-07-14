"""Tests for the orchestration capability catalogue."""


def test_load_capabilities_shape(bbw_module):
    caps = bbw_module.load_capabilities()
    assert set(caps) >= {"operators", "builtins", "operands"}


def test_file_exists_is_standard_only(bbw_module):
    caps = bbw_module.load_capabilities()
    assert caps["builtins"]["file_exists"]["js_safe"] is False
    assert caps["builtins"]["file_exists"]["standard"] is True


def test_numeric_operator_declares_types(bbw_module):
    caps = bbw_module.load_capabilities()
    assert caps["operators"]["<"]["types"] == ["number"]


def test_escape_hatch_not_js_safe(bbw_module):
    caps = bbw_module.load_capabilities()
    assert caps["operands"]["escape_hatch"]["js_safe"] is False
