"""Tests for DAG construction and topological order."""
from pathlib import Path
import yaml


FIXTURES_DIR = Path(__file__).parent / "fixtures" / "workflows"


def load_fixture(name):
    with open(FIXTURES_DIR / name) as f:
        return yaml.safe_load(f)


def test_build_dag_returns_topo_order(bbw_module):
    wf = load_fixture("valid-complex.yaml")
    dag = bbw_module.build_dag(wf)
    order = dag.topo_order()
    # T1 must come before T2 and T3, T2 and T3 before T4
    assert order.index("T1") < order.index("T2")
    assert order.index("T1") < order.index("T3")
    assert order.index("T2") < order.index("T4")
    assert order.index("T3") < order.index("T4")


def test_dag_parallel_groups(bbw_module):
    """parallel_with phases form a same execution level."""
    wf = load_fixture("valid-complex.yaml")
    dag = bbw_module.build_dag(wf)
    levels = dag.execution_levels()
    # Level 0: T1
    # Level 1: T2, T3 (parallel)
    # Level 2: T4
    assert levels[0] == ["T1"]
    assert set(levels[1]) == {"T2", "T3"}
    assert levels[2] == ["T4"]


def test_dag_dataflow_edges(bbw_module):
    """Each input matched to its producing output."""
    wf = load_fixture("valid-complex.yaml")
    dag = bbw_module.build_dag(wf)
    edges = dag.dataflow_edges()
    # T1 produces out/a.json, consumed by T2 and T3
    assert ("T1", "agent-a", "T2", "agent-b", "out/a.json") in edges
    assert ("T1", "agent-a", "T3", "agent-c", "out/a.json") in edges


def test_orphan_input_warning(bbw_module):
    """Input file that has no producing phase generates a warning."""
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "inputs": [{"path": "work/nowhere/missing.json", "kind": "json"}],
            }],
        }],
    }
    warnings = bbw_module.check_dataflow_warnings(wf)
    assert any("missing.json" in w and "no producer" in w for w in warnings)


def test_optional_input_no_warning(bbw_module):
    """Optional input without producer doesn't warn."""
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "inputs": [{"path": "work/nowhere/missing.json", "kind": "json", "optional": True}],
            }],
        }],
    }
    warnings = bbw_module.check_dataflow_warnings(wf)
    assert not any("missing.json" in w for w in warnings)


def test_orphan_output_warning(bbw_module):
    """Output that no one consumes is a soft warning."""
    wf = {
        "schema_version": 1,
        "groups": {"g": {"description": "x"}},
        "phases": [{
            "id": "T1", "name": "x", "group": "g",
            "invocations": [{
                "agent": "a",
                "outputs": [{"path": "work/intermediate/x.json", "kind": "json"}],
            }],
        }],
    }
    warnings = bbw_module.check_dataflow_warnings(wf)
    assert any("x.json" in w and "no consumer" in w for w in warnings)
