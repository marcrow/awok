"""Web-server orchestration wiring: GET merge, /api/view overlay, save split."""
import textwrap
from pathlib import Path


def _write(dirpath, name, text):
    p = dirpath / name
    p.write_text(textwrap.dedent(text))
    return p


def _base_wf(dirpath):
    return _write(dirpath, "w.yaml", """
        schema_version: 1
        skill: {name: w, description: x}
        groups: {g: {description: x}}
        phases:
          - {id: RECON, name: r, group: g, emits: [{name: endpoints, type: list, source: field, from: recon.json}]}
          - {id: SCAN, name: s, group: g}
    """)


def test_read_workflow_payload_merges_sibling(bbw_module, tmp_path):
    wf = _base_wf(tmp_path)
    _write(tmp_path, "w.orchestration.yaml", "- ref: RECON\n")
    payload = bbw_module.read_workflow_payload(wf)
    assert payload["model"]["orchestration"] == [{"ref": "RECON"}]
    assert "levels" in payload


def test_read_workflow_payload_no_sibling(bbw_module, tmp_path):
    wf = _base_wf(tmp_path)
    payload = bbw_module.read_workflow_payload(wf)
    assert "orchestration" not in payload["model"]
