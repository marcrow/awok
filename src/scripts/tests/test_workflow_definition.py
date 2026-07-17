import importlib.util, pathlib, copy
from importlib.machinery import SourceFileLoader
_loader = SourceFileLoader(
    "bbw", str(pathlib.Path(__file__).resolve().parents[1] / "bb-workflow"))
spec = importlib.util.spec_from_loader("bbw", _loader)
bbw = importlib.util.module_from_spec(spec); spec.loader.exec_module(bbw)

BASE = {
    "schema_version": 1,
    "skill": {"name": "demo", "description": "d"},
    "groups": {"g": {"description": "x"}},
    "phases": [{"id": "P0", "name": "p", "group": "g"}],
}

def _wf(**over):
    wf = copy.deepcopy(BASE); wf.update(over); return wf

def test_schema_accepts_minimal_definition():
    wf = _wf(definition={
        "params": [{"name": "question", "type": "string", "required": True}],
        "outputs": [{"role": "work:report", "kind": "md", "produced_by": "promote"}],
        "emits": [{"name": "status", "type": "string", "source": "promote", "from": "p0.status"}],
    })
    assert bbw.validate_schema(wf) == []

def test_schema_rejects_bad_param_name_and_bad_produced_by():
    wf = _wf(definition={"params": [{"name": "Bad", "type": "string"}],
                         "outputs": [{"role": "work:r", "kind": "md", "produced_by": "nope"}]})
    errs = bbw.validate_schema(wf)
    assert any("params" in e for e in errs)
    assert any("produced_by" in e or "outputs" in e for e in errs)

def test_schema_accepts_workflow_call_args():
    wf = _wf(phases=[{"id": "C1", "name": "call", "group": "g",
                      "type": "workflow_call", "workflow": "other",
                      "args": {"question": "hello", "mode": "signal:p0.status"}}])
    assert bbw.validate_schema(wf) == []

def test_params_rules():
    wf = _wf(definition={"params": [
        {"name": "ok", "type": "enum", "values": ["a"], "default": "a"},
        {"name": "bad_enum", "type": "enum", "values": []},
        {"name": "req_def", "type": "string", "required": True, "default": "x"},
        {"name": "dup", "type": "string"}, {"name": "dup", "type": "string"},
        {"name": "listp", "type": "list"},
    ]})
    errs = bbw.validate_definition(wf)
    assert any("bad_enum" in e and "values" in e for e in errs)
    assert any("req_def" in e and "default" in e for e in errs)
    assert any("duplicate" in e and "dup" in e for e in errs)
    assert any("listp" in e and "of" in e for e in errs)
    assert not any("'ok'" in e for e in errs)
