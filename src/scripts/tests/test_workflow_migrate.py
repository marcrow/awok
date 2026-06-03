"""Tests for migrate-from-skill command."""
from pathlib import Path
import pytest


def test_migrate_from_skill_prints_instructions(bbw_module, tmp_path, capsys):
    skill = tmp_path / "SKILL.md"
    skill.write_text("# Skill\n\nphase 1...")
    class A: pass
    args = A()
    args.skill = str(skill)
    args.output_dir = str(tmp_path)
    rc = bbw_module.cmd_migrate_from_skill(args)
    assert rc == 0
    out = capsys.readouterr().out
    assert "workflow.yaml" in out
    assert "templates/invocations" in out


def test_assist_prints_prompt(bbw_module, capsys):
    class A: pass
    args = A()
    args.change_desc = "add a new ssrf-prober agent in T6"
    rc = bbw_module.cmd_assist(args)
    assert rc == 0
    out = capsys.readouterr().out
    assert "ssrf-prober" in out
    assert "bb-workflow validate" in out
