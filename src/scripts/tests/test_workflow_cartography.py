def test_overlay_marks_branch_and_loop(bbw_module):
    wf = {
        "phases": [{"id": "H", "name": "h", "group": "g"}, {"id": "C", "name": "c", "group": "g"}],
        "orchestration": [
            {"while": {"op": "==", "left": "c.verdict", "right": "INSUFFICIENT"},
             "cap": 3, "body": [{"ref": "H"}, {"ref": "C"}]},
        ],
    }
    ov = bbw_module.build_orchestration_overlay(wf)
    assert ov["loops"] and ov["loops"][0]["cap"] == 3
    assert "H" in ov["loops"][0]["body_ids"] and "C" in ov["loops"][0]["body_ids"]


def test_overlay_empty_without_orchestration(bbw_module):
    assert bbw_module.build_orchestration_overlay({"phases": []}) == {"branches": [], "loops": []}


def test_overlay_marks_branch(bbw_module):
    wf = {
        "phases": [
            {"id": "H", "name": "h", "group": "g"},
            {"id": "A", "name": "a", "group": "g"},
            {"id": "B", "name": "b", "group": "g"},
        ],
        "orchestration": [
            {"if": {"op": "==", "left": "h.verdict", "right": "ok"},
             "then": [{"ref": "A"}], "else": [{"ref": "B"}]},
        ],
    }
    ov = bbw_module.build_orchestration_overlay(wf)
    assert ov["branches"]
    assert "A" in ov["branches"][0]["then_ids"]
    assert "B" in ov["branches"][0]["else_ids"]
